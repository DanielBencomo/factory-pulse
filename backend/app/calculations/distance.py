import math
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from app.calculations.trajectory import JITTER_M, MAX_GAP_S, observed_step_m, visible_step

class TrajectoryPoint:
    def __init__(self, x: float, y: float, timestamp: datetime, confidence: float = 1.0, segment_id: str | None = None):
        self.x = x
        self.y = y
        self.timestamp = timestamp
        self.confidence = confidence
        self.segment_id = segment_id

def calculate_trajectory_distance(
    points: List[TrajectoryPoint],
    floor_dimensions_m: Optional[Tuple[float, float]] = None,
    jitter_threshold_norm: float = 0.005, # 0.5% of floor width threshold
    max_speed_norm_per_sec: float = 0.35,
    private_polys=(),
) -> Dict[str, Any]:
    """
    Calculates total accumulated travel distance for a sequence of points.
    Filters:
    1. Jitter filter: Sub-threshold noise oscillations are dropped.
    2. Speed outlier filter: Sudden impossible coordinate jumps (e.g. camera glitch) are dropped.
    3. Scale calibration: Converts to meters ONLY if calibrated scale is given.
    """
    if len(points) < 2:
        return {
            "raw_distance_norm": 0.0,
            "calibrated_meters": None,
            "is_calibrated": floor_dimensions_m is not None,
            "sample_count": len(points),
            "jitter_filtered_count": 0,
            "speed_outlier_count": 0,
            "speed_avg_m_s": None
        }

    total_norm_dist = 0.0
    total_m = 0.0
    jitter_count = 0
    outlier_count = 0
    valid_segments_count = 0
    total_time_delta_sec = 0.0

    for last_valid_point, curr_point in zip(points, points[1:]):
        
        # Euclidean distance in normalized coordinate space [0, 1]
        dx = curr_point.x - last_valid_point.x
        dy = curr_point.y - last_valid_point.y
        step_dist = math.sqrt(dx * dx + dy * dy)
        
        dt = (curr_point.timestamp - last_valid_point.timestamp).total_seconds()
        if curr_point.segment_id != last_valid_point.segment_id or not 0 < dt <= MAX_GAP_S:
            continue
        if not visible_step((last_valid_point.x, last_valid_point.y), (curr_point.x, curr_point.y), None, private_polys):
            continue
        step_m = (
            observed_step_m(dt, dx * floor_dimensions_m[0], dy * floor_dimensions_m[1], curr_point.segment_id, last_valid_point.segment_id)
            if floor_dimensions_m else None
        )
        too_fast = step_m is None if floor_dimensions_m else step_dist / dt > max_speed_norm_per_sec
        if too_fast:
            outlier_count += 1
            # Skip glitch teleport point
            continue

        valid_segments_count += 1
        total_time_delta_sec += dt
        if (step_m < JITTER_M if step_m is not None else step_dist < jitter_threshold_norm):
            jitter_count += 1
            continue

        total_norm_dist += step_dist
        total_m += step_m or 0.0

    is_calibrated = floor_dimensions_m is not None
    calibrated_meters = total_m if is_calibrated and valid_segments_count else None
    
    speed_avg_m_s = None
    if is_calibrated and total_time_delta_sec > 0 and calibrated_meters is not None:
        speed_avg_m_s = calibrated_meters / total_time_delta_sec

    return {
        "raw_distance_norm": round(total_norm_dist, 4),
        "calibrated_meters": round(calibrated_meters, 2) if calibrated_meters is not None else None,
        "is_calibrated": is_calibrated,
        "sample_count": len(points),
        "jitter_filtered_count": jitter_count,
        "speed_outlier_count": outlier_count,
        "speed_avg_m_s": round(speed_avg_m_s, 2) if speed_avg_m_s is not None else None
    }
