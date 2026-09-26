import math
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

class TrajectoryPoint:
    def __init__(self, x: float, y: float, timestamp: datetime, confidence: float = 1.0):
        self.x = x
        self.y = y
        self.timestamp = timestamp
        self.confidence = confidence

def calculate_trajectory_distance(
    points: List[TrajectoryPoint],
    calibration_scale_meters: Optional[float] = None, # meters per 1.0 norm distance
    jitter_threshold_norm: float = 0.005, # 0.5% of floor width threshold
    max_speed_norm_per_sec: float = 0.35 # max plausible speed in normalized units/s (approx 14 m/s in a 40m floor)
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
            "calibrated_meters": 0.0 if calibration_scale_meters else None,
            "is_calibrated": calibration_scale_meters is not None,
            "sample_count": len(points),
            "jitter_filtered_count": 0,
            "speed_outlier_count": 0,
            "speed_avg_m_s": 0.0
        }

    total_norm_dist = 0.0
    jitter_count = 0
    outlier_count = 0
    valid_segments_count = 0
    total_time_delta_sec = 0.0

    last_valid_point = points[0]

    for i in range(1, len(points)):
        curr_point = points[i]
        
        # Euclidean distance in normalized coordinate space [0, 1]
        dx = curr_point.x - last_valid_point.x
        dy = curr_point.y - last_valid_point.y
        step_dist = math.sqrt(dx * dx + dy * dy)
        
        dt = max(0.001, (curr_point.timestamp - last_valid_point.timestamp).total_seconds())

        # 1. Jitter filter check
        if step_dist < jitter_threshold_norm:
            jitter_count += 1
            continue

        # 2. Speed outlier filter check
        speed_norm_s = step_dist / dt
        if speed_norm_s > max_speed_norm_per_sec:
            outlier_count += 1
            # Skip glitch teleport point
            continue

        # Valid point transition
        total_norm_dist += step_dist
        total_time_delta_sec += dt
        valid_segments_count += 1
        last_valid_point = curr_point

    is_calibrated = calibration_scale_meters is not None and calibration_scale_meters > 0
    calibrated_meters = total_norm_dist * calibration_scale_meters if is_calibrated else None
    
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
