"""
Historial de trayectorias por track, para dibujar spaghetti por línea o estación.

La ventana se mide contra el reloj del servidor y exige posiciones de piso.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.cameras.calibration import active_revisions, main_floor, revision_key
from app.cameras.observations import vision_zones, zone_revision
from app.calculations.evidence import floor_position
from app.calculations.trajectory import trajectory_policy
from app.models.db_models import DBEvent

router = APIRouter()

@router.get("/tracks/history")
async def track_history(
    minutes: int = Query(15, ge=1, le=240),
    max_points: int = Query(12000, ge=50, le=40000),
    session: AsyncSession = Depends(get_db),
):
    mode = "live"
    now = datetime.utcnow()
    since = now - timedelta(minutes=minutes)
    floor = await main_floor(session)
    revisions = await active_revisions(session, floor)
    layout_revision = zone_revision(await vision_zones(session))
    response = {
        "calibration_key": revision_key(floor, revisions) if floor else None,
        "zone_revision": layout_revision,
        "trajectory": trajectory_policy(),
        "tracks": {},
    }
    if not revisions:
        return response
    res = await session.execute(
        select(DBEvent.occurred_at, DBEvent.payload, DBEvent.device_id)
        .where(DBEvent.type == "position", DBEvent.occurred_at >= since, DBEvent.occurred_at <= now, DBEvent.mode == mode)
        .order_by(DBEvent.occurred_at)
    )

    out = response["tracks"]
    for occurred_at, p, device_id in res.all():
        position = floor_position(p or {}, device_id, revisions, layout_revision)
        if position is None:
            continue
        trk, x, y = position
        ts = occurred_at.replace(tzinfo=timezone.utc).timestamp() * 1000
        out.setdefault(trk, []).append([x, y, ts, p["segment_id"]])

    response["tracks"] = {k: v[-max_points:] for k, v in out.items()}
    return response
