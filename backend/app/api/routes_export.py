import csv
import io
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models.db_models import DBEvent, DBStop

router = APIRouter()

@router.get("/export/events.csv")
async def export_events_csv(
    hours: int = Query(24, ge=1, le=168),
    session: AsyncSession = Depends(get_db)
):
    since = datetime.utcnow() - timedelta(hours=hours)
    stmt = select(DBEvent).where(DBEvent.occurred_at >= since).order_by(desc(DBEvent.occurred_at))
    res = await session.execute(stmt)
    events = res.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["event_id", "device_id", "source_id", "occurred_at_utc", "received_at_utc", "type", "mode", "quality", "payload_json"])

    for ev in events:
        writer.writerow([
            ev.event_id,
            ev.device_id or "",
            ev.source_id or "",
            ev.occurred_at.isoformat(),
            ev.received_at.isoformat(),
            ev.type,
            ev.mode,
            ev.quality,
            str(ev.payload)
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=factory_pulse_events_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"}
    )

@router.get("/export/stops.csv")
async def export_stops_csv(session: AsyncSession = Depends(get_db)):
    stmt = select(DBStop).order_by(desc(DBStop.started_at))
    res = await session.execute(stmt)
    stops = res.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["stop_id", "scope_type", "scope_id", "reason", "reason_code", "author", "started_at_utc", "ended_at_utc", "duration_seconds", "is_authorized", "status", "notes"])

    for s in stops:
        writer.writerow([
            s.id,
            s.scope_type,
            s.scope_id,
            s.reason,
            s.reason_code,
            s.author,
            s.started_at.isoformat(),
            s.ended_at.isoformat() if s.ended_at else "",
            s.duration_seconds or "",
            s.is_authorized,
            s.status,
            s.notes or ""
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=factory_pulse_stops_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"}
    )
