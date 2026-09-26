from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models.db_models import DBEvent, DBStation, DBDevice, DBStop, DBPolygonZone, DBFloorPlan, DBAlert
from app.models.schemas import (
    MetricsSummaryResponse, TimeUniverseMetrics, StationMetric,
    ZoneDwellMetric, DistanceMetric, StationStatus, ZoneType, EventMode
)
from app.calculations.intervals import partition_time_universe
from app.calculations.distance import calculate_trajectory_distance, TrajectoryPoint
from app.calculations.zones import aggregate_zone_metrics
from app.calculations.oee import calculate_station_productivity

router = APIRouter()

@router.get("/metrics", response_model=MetricsSummaryResponse)
async def get_metrics_summary(
    window_minutes: int = Query(60, ge=5, le=480),
    line_id: str = "line-1",
    session: AsyncSession = Depends(get_db)
):
    """
    Computes real-time industrial KPIs, time universe partitions, zone occupancies,
    and calibrated distances based on stored events and stops.
    """
    now = datetime.utcnow()
    window_start = now - timedelta(minutes=window_minutes)

    # 1. Fetch authorized stops in the window
    stops_stmt = select(DBStop).where(
        DBStop.is_authorized == True,
        DBStop.started_at <= now
    )
    stops_res = await session.execute(stops_stmt)
    stops = stops_res.scalars().all()

    stop_intervals = []
    for s in stops:
        s_start = max(window_start, s.started_at)
        s_end = min(now, s.ended_at) if s.ended_at else now
        if s_end > s_start:
            stop_intervals.append((s_start, s_end))

    # Gross planned time in seconds for the selected window
    gross_planned_sec = float(window_minutes * 60)

    # 2. Fetch stations
    st_stmt = select(DBStation).where(DBStation.line_id == line_id)
    st_res = await session.execute(st_stmt)
    stations = st_res.scalars().all()

    # 3. Fetch events in window
    ev_stmt = select(DBEvent).where(DBEvent.occurred_at >= window_start).order_by(DBEvent.occurred_at)
    ev_res = await session.execute(ev_stmt)
    events = ev_res.scalars().all()

    # 4. Classify raw states from station telemetry
    total_active_stations = len(stations) or 4
    active_count = sum(1 for s in stations if s.current_status == "active")
    waiting_count = sum(1 for s in stations if s.current_status == "waiting_material")
    unattended_count = sum(1 for s in stations if s.current_status == "unattended")
    
    # Estimate proportions
    prod_raw = gross_planned_sec * (active_count / total_active_stations)
    wait_raw = gross_planned_sec * (waiting_count / total_active_stations)
    absent_raw = gross_planned_sec * (unattended_count / total_active_stations)
    unknown_raw = 0.0

    # Strict mathematical partition
    time_universe_dict = partition_time_universe(
        gross_planned_seconds=gross_planned_sec,
        authorized_stop_intervals=stop_intervals,
        productive_raw_seconds=prod_raw,
        waiting_raw_seconds=wait_raw,
        absent_raw_seconds=absent_raw,
        unknown_raw_seconds=unknown_raw
    )

    time_universe = TimeUniverseMetrics(**time_universe_dict)

    # 5. Station Metrics
    station_metrics: List[StationMetric] = []
    adj_time = time_universe.adjusted_planned_seconds
    
    for st in stations:
        is_active = st.current_status == "active"
        is_waiting = st.current_status == "waiting_material"
        
        st_prod_sec = adj_time * 0.85 if is_active else 0.0
        productivity_eval = calculate_station_productivity(
            operating_time_seconds=st_prod_sec,
            adjusted_planned_seconds=adj_time,
            parts_produced_good=st.parts_produced_shift,
            parts_produced_total=st.parts_produced_shift,
            ideal_cycle_seconds=st.ideal_cycle_seconds
        )

        station_metrics.append(StationMetric(
            station_id=st.station_id,
            name=st.name,
            current_status=StationStatus(st.current_status),
            productive_ratio=0.85 if is_active else 0.0,
            waiting_ratio=0.85 if is_waiting else 0.10,
            idle_ratio=0.05,
            stopped_ratio=0.0 if is_active else 0.80,
            parts_produced=st.parts_produced_shift,
            target_parts=st.target_pieces_per_hour,
            availability_ratio=productivity_eval["availability"] / 100.0,
            partial_oee_note=productivity_eval.get("note") or productivity_eval.get("formula", "")
        ))

    # 6. Zones and Privacy Dwell Aggregations
    zones_stmt = select(DBPolygonZone)
    zones_res = await session.execute(zones_stmt)
    zones = zones_res.scalars().all()
    zones_dicts = [{"zone_id": z.zone_id, "name": z.name, "type": z.type, "polygon": z.polygon, "is_aggregated_only": z.is_aggregated_only} for z in zones]

    pos_events_dicts = [
        {"payload": e.payload, "occurred_at": e.occurred_at}
        for e in events if e.type == "position"
    ]
    zone_stats = aggregate_zone_metrics(pos_events_dicts, zones_dicts)

    zone_metrics = [
        ZoneDwellMetric(
            zone_id=zs["zone_id"],
            zone_name=zs["zone_name"],
            zone_type=ZoneType(zs["zone_type"]),
            total_dwell_seconds=zs["total_dwell_seconds"],
            occupancy_count=zs["occupancy_count"],
            entry_count=zs["entry_count"],
            exit_count=zs["exit_count"],
            is_aggregated_only=zs["is_aggregated_only"]
        )
        for zs in zone_stats
    ]

    # 7. Distance summary for tracks
    fp_stmt = select(DBFloorPlan).where(DBFloorPlan.id == "fp-main")
    fp_res = await session.execute(fp_stmt)
    fp = fp_res.scalar_one_or_none()
    scale_m = fp.calibration.get("meters_per_norm_unit", 40.0) if (fp and fp.calibration.get("is_calibrated")) else None

    # Group positions by track_id
    track_positions: Dict[str, List[TrajectoryPoint]] = {}
    for e in events:
        if e.type == "position":
            p = e.payload
            trk = p.get("track_id", "anonymous")
            if trk not in track_positions:
                track_positions[trk] = []
            track_positions[trk].append(TrajectoryPoint(p["x"], p["y"], e.occurred_at, p.get("confidence", 1.0)))

    distance_metrics: List[DistanceMetric] = []
    for trk_id, pts in track_positions.items():
        d_res = calculate_trajectory_distance(pts, calibration_scale_meters=scale_m)
        distance_metrics.append(DistanceMetric(
            track_id=trk_id,
            raw_distance_norm=d_res["raw_distance_norm"],
            calibrated_meters=d_res["calibrated_meters"],
            is_calibrated=d_res["is_calibrated"],
            speed_avg_m_s=d_res["speed_avg_m_s"],
            sample_count=d_res["sample_count"],
            jitter_filtered_count=d_res["jitter_filtered_count"],
            speed_outlier_count=d_res["speed_outlier_count"]
        ))

    # 8. Counts
    alerts_stmt = select(DBAlert).where(DBAlert.status == "new")
    alerts_res = await session.execute(alerts_stmt)
    active_alerts_count = len(alerts_res.scalars().all())

    open_stops_stmt = select(DBStop).where(DBStop.status == "open")
    open_stops_res = await session.execute(open_stops_stmt)
    open_stops_count = len(open_stops_res.scalars().all())

    dev_stmt = select(DBDevice)
    dev_res = await session.execute(dev_stmt)
    all_devs = dev_res.scalars().all()
    online_devs_count = sum(1 for d in all_devs if d.status == "online")

    return MetricsSummaryResponse(
        time_window_start=window_start,
        time_window_end=now,
        shift_name="Turno 1 - Matutino",
        time_universe=time_universe,
        stations=station_metrics,
        zones=zone_metrics,
        distances=distance_metrics,
        total_active_tracks=len(track_positions),
        total_open_stops=open_stops_count,
        total_active_alerts=active_alerts_count,
        online_devices_count=online_devs_count,
        total_devices_count=len(all_devs),
        mode=EventMode.LIVE
    )
