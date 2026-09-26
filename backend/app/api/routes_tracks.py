"""
Historial de trayectorias por track, para dibujar spaghetti por línea o estación.

La ventana se mide contra el evento de posición más reciente (no contra el reloj
del servidor): así funciona igual con datos en vivo, reproducidos o simulados.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.db_models import DBEvent, DBFloorPlan
from app.simulator.engine import simulator

router = APIRouter()

MIN_STEP = 0.002        # desplazamiento mínimo (normalizado) para guardar un punto
MAX_GAP_SECONDS = 10.0  # aunque no se mueva, un punto cada 10 s conserva el tiempo


@router.get("/tracks/history")
async def track_history(
    minutes: int = Query(15, ge=1, le=240),
    max_points: int = Query(1500, ge=50, le=5000),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, List[List[float]]]:
    mode = simulator.mode  # no mezclar trayectorias simuladas con las reales
    latest = (await session.execute(select(func.max(DBEvent.occurred_at)).where(DBEvent.type == "position", DBEvent.mode == mode))).scalar()
    if latest is None:
        return {}
    since = latest - timedelta(minutes=minutes)
    # Si la nave cambió de medidas, lo anterior está en otro marco de coordenadas.
    fp = (await session.execute(select(DBFloorPlan))).scalars().first()
    frame_since = (fp.calibration or {}).get("frame_since") if fp else None
    if frame_since:
        since = max(since, datetime.fromisoformat(frame_since) + timedelta(microseconds=1))
    res = await session.execute(
        select(DBEvent.occurred_at, DBEvent.payload)
        .where(DBEvent.type == "position", DBEvent.occurred_at >= since, DBEvent.mode == mode)
        .order_by(DBEvent.occurred_at)
    )

    out: Dict[str, List[List[float]]] = {}
    for occurred_at, p in res.all():
        trk = p.get("track_id")
        if not trk or "x" not in p or "y" not in p:
            continue
        ts = round(occurred_at.replace(tzinfo=timezone.utc).timestamp() * 1000)
        pts = out.setdefault(trk, [])
        if pts:
            lx, ly, lt = pts[-1]
            if abs(p["x"] - lx) < MIN_STEP and abs(p["y"] - ly) < MIN_STEP and (ts - lt) < MAX_GAP_SECONDS * 1000:
                continue
        pts.append([round(p["x"], 4), round(p["y"], 4), ts])

    return {k: v[-max_points:] for k, v in out.items()}
