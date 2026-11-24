"""
Historial de trayectorias por track, para dibujar spaghetti por línea o estación.

La ventana se mide contra el reloj del servidor y exige posiciones de piso.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.cameras.calibration import active_revisions
from app.calculations.evidence import floor_position
from app.models.db_models import DBEvent

router = APIRouter()

MIN_STEP = 0.002        # desplazamiento mínimo (normalizado) para guardar un punto
MAX_GAP_SECONDS = 10.0  # aunque no se mueva, un punto cada 10 s conserva el tiempo


@router.get("/tracks/history")
async def track_history(
    minutes: int = Query(15, ge=1, le=240),
    max_points: int = Query(1500, ge=50, le=5000),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, List[List[float]]]:
    mode = "live"
    now = datetime.utcnow()
    since = now - timedelta(minutes=minutes)
    revisions = await active_revisions(session)
    if not revisions:
        return {}
    res = await session.execute(
        select(DBEvent.occurred_at, DBEvent.payload, DBEvent.device_id)
        .where(DBEvent.type == "position", DBEvent.occurred_at >= since, DBEvent.occurred_at <= now, DBEvent.mode == mode)
        .order_by(DBEvent.occurred_at)
    )

    out: Dict[str, List[List[float]]] = {}
    for occurred_at, p, device_id in res.all():
        position = floor_position(p or {}, device_id, revisions)
        if position is None:
            continue
        trk, x, y = position
        ts = round(occurred_at.replace(tzinfo=timezone.utc).timestamp() * 1000)
        pts = out.setdefault(trk, [])
        if pts:
            lx, ly, lt = pts[-1]
            if abs(x - lx) < MIN_STEP and abs(y - ly) < MIN_STEP and (ts - lt) < MAX_GAP_SECONDS * 1000:
                continue
        pts.append([round(x, 4), round(y, 4), ts])

    return {k: v[-max_points:] for k, v in out.items()}
