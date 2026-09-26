import pytest
from datetime import datetime, timedelta
from app.calculations.intervals import compute_interval_union, compute_total_union_duration_seconds, partition_time_universe
from app.calculations.distance import calculate_trajectory_distance, TrajectoryPoint
from app.calculations.zones import is_point_in_polygon, aggregate_zone_metrics
from app.calculations.oee import calculate_station_productivity

def test_interval_union_overlapping():
    """
    Verifies that two overlapping stop intervals are merged and not double-discounted.
    [0..30] U [15..45] -> Duration = 45s, not 60s.
    """
    t0 = datetime(2026, 9, 26, 8, 0, 0)
    t1 = t0 + timedelta(seconds=30)
    t2 = t0 + timedelta(seconds=15)
    t3 = t0 + timedelta(seconds=45)

    intervals = [(t0, t1), (t2, t3)]
    merged = compute_interval_union(intervals)
    assert len(merged) == 1
    assert merged[0] == (t0, t3)

    duration = compute_total_union_duration_seconds(intervals)
    assert duration == 45.0

def test_interval_union_disjoint():
    """
    Verifies that disjoint stop intervals are summed correctly.
    [0..20] and [40..60] -> Duration = 40s.
    """
    t0 = datetime(2026, 9, 26, 8, 0, 0)
    t1 = t0 + timedelta(seconds=20)
    t2 = t0 + timedelta(seconds=40)
    t3 = t0 + timedelta(seconds=60)

    intervals = [(t0, t1), (t2, t3)]
    merged = compute_interval_union(intervals)
    assert len(merged) == 2
    duration = compute_total_union_duration_seconds(intervals)
    assert duration == 40.0

def test_time_universe_conservation():
    """
    Verifies that Productive + Waiting + Absent + Unknown == Adjusted Planned Time without leakage.
    """
    gross_planned = 3600.0 # 1 hour
    t0 = datetime(2026, 9, 26, 8, 0, 0)
    t1 = t0 + timedelta(minutes=10) # 600s stop
    
    stop_intervals = [(t0, t1)]
    
    res = partition_time_universe(
        gross_planned_seconds=gross_planned,
        authorized_stop_intervals=stop_intervals,
        productive_raw_seconds=2000.0,
        waiting_raw_seconds=800.0,
        absent_raw_seconds=200.0,
        unknown_raw_seconds=0.0
    )

    assert res["gross_planned_seconds"] == 3600.0
    assert res["authorized_stops_union_seconds"] == 600.0
    assert res["adjusted_planned_seconds"] == 3000.0
    
    reconstructed = res["productive_seconds"] + res["waiting_seconds"] + res["absent_seconds"] + res["unknown_seconds"]
    assert abs(reconstructed - res["adjusted_planned_seconds"]) < 1e-6
    assert res["conservation_check_error_seconds"] == 0.0

def test_trajectory_distance_and_filters():
    """
    Verifies distance calculation with calibration, jitter rejection, and outlier rejection.
    """
    t0 = datetime(2026, 9, 26, 8, 0, 0)
    points = [
        TrajectoryPoint(0.1, 0.1, t0),
        TrajectoryPoint(0.1001, 0.1001, t0 + timedelta(seconds=1)), # Jitter point -> should be filtered
        TrajectoryPoint(0.2, 0.1, t0 + timedelta(seconds=2)), # Valid movement dx=0.1
        TrajectoryPoint(0.95, 0.95, t0 + timedelta(seconds=3)), # Teleport glitch -> should be filtered
        TrajectoryPoint(0.3, 0.1, t0 + timedelta(seconds=4)), # Valid movement dx=0.1
    ]

    # Without calibration
    uncalibrated_res = calculate_trajectory_distance(points, calibration_scale_meters=None)
    assert uncalibrated_res["is_calibrated"] is False
    assert uncalibrated_res["calibrated_meters"] is None
    assert uncalibrated_res["jitter_filtered_count"] >= 1
    assert uncalibrated_res["speed_outlier_count"] >= 1

    # With calibration: 40 meters per 1.0 norm unit
    calibrated_res = calculate_trajectory_distance(points, calibration_scale_meters=40.0)
    assert calibrated_res["is_calibrated"] is True
    assert calibrated_res["calibrated_meters"] is not None
    assert calibrated_res["calibrated_meters"] > 0

def test_point_in_polygon_and_privacy_zone():
    """
    Verifies ray-casting point-in-polygon and privacy-first bathroom aggregation.
    """
    # Square zone [0, 0] to [0.5, 0.5]
    zone = {
        "zone_id": "zone-bath",
        "name": "Sanitarios",
        "type": "bathroom",
        "polygon": [[0.0, 0.0], [0.5, 0.0], [0.5, 0.5], [0.0, 0.5]],
        "is_aggregated_only": True
    }

    assert is_point_in_polygon([0.25, 0.25], zone["polygon"]) is True
    assert is_point_in_polygon([0.8, 0.8], zone["polygon"]) is False

    # Check aggregation
    pos_events = [
        {"payload": {"x": 0.2, "y": 0.2, "track_id": "TRK-01"}, "occurred_at": datetime.utcnow()},
        {"payload": {"x": 0.3, "y": 0.3, "track_id": "TRK-02"}, "occurred_at": datetime.utcnow()},
    ]

    metrics = aggregate_zone_metrics(pos_events, [zone])
    assert len(metrics) == 1
    assert metrics[0]["occupancy_count"] == 2
    assert metrics[0]["is_aggregated_only"] is True
    # Ensure track IDs are not leaked in the dictionary
    assert "unique_tracks" not in metrics[0]

def test_oee_qualification():
    """
    Verifies that incomplete data is accurately labeled as partial availability, not complete OEE.
    """
    # Incomplete data: missing quality breakdown
    partial_res = calculate_station_productivity(
        operating_time_seconds=3000.0,
        adjusted_planned_seconds=3600.0,
        parts_produced_good=None,
        parts_produced_total=60,
        ideal_cycle_seconds=45.0
    )
    assert partial_res["is_full_oee"] is False
    assert "Parcial" in partial_res["metric_name"]

    # Complete data
    complete_res = calculate_station_productivity(
        operating_time_seconds=3000.0,
        adjusted_planned_seconds=3600.0,
        parts_produced_good=58,
        parts_produced_total=60,
        ideal_cycle_seconds=45.0
    )
    assert complete_res["is_full_oee"] is True
    assert complete_res["oee"] is not None
    assert complete_res["quality"] == round((58 / 60) * 100, 2)
