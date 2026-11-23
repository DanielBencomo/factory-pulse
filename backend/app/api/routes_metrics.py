"""Estado operativo actual. Las métricas históricas se sirven en /analytics y /spatial."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.devices.registry import device_status
from app.models.db_models import DBAlert, DBDevice, DBStation, DBStop
from app.models.schemas import MetricsSummaryResponse, StationMetric

router = APIRouter()


@router.get("/metrics", response_model=MetricsSummaryResponse)
async def get_metrics_summary(
    window_minutes: int = Query(60, ge=5, le=480),
    line_id: str = "line-1",
    session: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    stations = (await session.scalars(select(DBStation).where(DBStation.line_id == line_id))).all()
    alerts = (await session.scalars(select(DBAlert.id).where(DBAlert.status == "new"))).all()
    stops = (await session.scalars(select(DBStop.id).where(DBStop.status == "open"))).all()
    devices = (await session.scalars(select(DBDevice).where(DBDevice.simulated.is_not(True)))).all()

    return MetricsSummaryResponse(
        time_window_start=now - timedelta(minutes=window_minutes),
        time_window_end=now,
        stations=[
            StationMetric(
                station_id=s.station_id,
                name=s.name,
                current_status=s.current_status if s.last_event_at else "unknown",
                target_parts=s.target_pieces_per_hour,
            )
            for s in stations
        ],
        total_open_stops=len(stops),
        total_active_alerts=len(alerts),
        online_devices_count=sum(device_status(d, now) == "online" for d in devices),
        total_devices_count=len(devices),
    )
