"""
GET /analytics: métricas de una línea en una ventana de tiempo, reconstruidas desde
eventos (ver app/calculations/analytics.py). Solo usa eventos del modo activo
(demo o en vivo) para no mezclar datos simulados con los de dispositivos reales.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.calculations.analytics import compute_line_analytics
from app.database import get_db
from app.models.db_models import DBEvent, DBFloorPlan, DBLine, DBPolygonZone, DBStation, DBStop
from app.simulator.engine import simulator

router = APIRouter()


def _epoch(dt: datetime) -> float:
    return dt.replace(tzinfo=timezone.utc).timestamp()


@router.get("/analytics")
async def line_analytics(
    line_id: str = Query("line-1"),
    minutes: int = Query(60, ge=5, le=720),
    mode: Optional[str] = Query(None, pattern="^(demo|live|replay)$"),
    compare: bool = Query(True, description="Incluir el resumen de la ventana anterior del mismo largo"),
    session: AsyncSession = Depends(get_db),
):
    mode = mode or simulator.mode
    now = datetime.utcnow()
    ctx = await _context(session, line_id)
    result = await _compute(session, ctx, mode, now - timedelta(minutes=minutes), now)
    # Comparación con la ventana anterior (antes/después) para ver si una acción de mejora movió los números.
    if compare and minutes <= 240:
        prev = await _compute(session, ctx, mode, now - timedelta(minutes=2 * minutes), now - timedelta(minutes=minutes))
        result["previous_summary"] = prev["summary"]
    else:
        result["previous_summary"] = None
    result["line_id"] = line_id
    result["mode"] = mode
    return result


async def _context(session: AsyncSession, line_id: str) -> dict:
    fp = (await session.execute(select(DBFloorPlan))).scalars().first()
    stations_db = (
        await session.execute(select(DBStation).where(DBStation.line_id == line_id).order_by(DBStation.order_in_line))
    ).scalars().all()
    zones = (await session.execute(select(DBPolygonZone))).scalars().all()
    zone_of = {sid: z for z in zones for sid in (z.station_ids or [])}
    stations = [
        {
            "station_id": s.station_id,
            "name": s.name,
            "order": s.order_in_line,
            "ideal_cycle": max(1.0, s.ideal_cycle_seconds or 45.0),
            "target_pph": s.target_pieces_per_hour or 0,
            "polygon": zone_of[s.station_id].polygon,
        }
        for s in stations_db
        if s.station_id in zone_of
    ]
    station_ids = {s["station_id"] for s in stations}
    line_zone_ids = {z.zone_id for z in zones if z.line_id == line_id or (z.station_ids and z.station_ids[0] in station_ids)}

    line = (await session.execute(select(DBLine).where(DBLine.id == line_id))).scalar_one_or_none()
    area = line.polygon if line and line.polygon else None
    if area is None:
        own = [p for z in zones if z.zone_id in line_zone_ids for p in z.polygon]
        if own:
            x0, y0 = max(0, min(p[0] for p in own) - 0.02), max(0, min(p[1] for p in own) - 0.02)
            x1, y1 = min(1, max(p[0] for p in own) + 0.02), min(1, max(p[1] for p in own) + 0.02)
            area = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    return {
        "line_id": line_id,
        "W": fp.width_meters if fp else 40.0,
        "H": fp.height_meters if fp else 25.0,
        "stations": stations,
        "station_ids": station_ids,
        "zones": zones,
        "line_zone_ids": line_zone_ids,
        "zone_to_station": {z.zone_id: z.station_ids[0] for z in zones if z.station_ids},
        "area": area,
    }


async def _compute(session: AsyncSession, ctx: dict, mode: str, start: datetime, end: datetime) -> dict:
    lead = timedelta(seconds=120)  # contexto previo para estados vigentes al inicio
    station_ids = ctx["station_ids"]
    rows = (
        await session.execute(
            select(DBEvent.occurred_at, DBEvent.type, DBEvent.payload)
            .where(
                DBEvent.type.in_(["position", "machine_state", "cycle", "presence"]),
                DBEvent.occurred_at >= start - lead,
                DBEvent.occurred_at <= end,
                DBEvent.mode == mode,
            )
            .order_by(DBEvent.occurred_at)
        )
    ).all()

    positions: Dict[str, List] = {}
    machine: Dict[str, List] = {}
    cycles: Dict[str, List] = {}
    presence: Dict[str, List] = {}
    for occurred_at, etype, p in rows:
        t = _epoch(occurred_at)
        sid = p.get("station_id") or ctx["zone_to_station"].get(p.get("zone_id", ""))
        if etype == "position" and "track_id" in p:
            positions.setdefault(p["track_id"], []).append((t, p.get("x", 0.0), p.get("y", 0.0)))
        elif etype == "machine_state" and sid in station_ids:
            machine.setdefault(sid, []).append((t, p.get("state", "idle")))
        elif etype == "cycle" and sid in station_ids:
            for _ in range(max(1, int(p.get("total_parts") or 1))):
                cycles.setdefault(sid, []).append((t, float(p.get("cycle_time_seconds") or 0), bool(p.get("is_good_piece", True))))
        elif etype == "presence" and sid in station_ids:
            present = p.get("state") in ("actividad", "quietud") if "state" in p else bool(p.get("present"))
            presence.setdefault(sid, []).append((t, present))

    stops_db = (
        await session.execute(
            select(DBStop).where(DBStop.started_at <= end, or_(DBStop.ended_at.is_(None), DBStop.ended_at >= start))
        )
    ).scalars().all()
    stops = []
    for st in stops_db:
        if st.scope_type == "plant" or (st.scope_type == "line" and st.scope_id == ctx["line_id"]):
            applies = None
        elif st.scope_type == "station" and st.scope_id in station_ids:
            applies = {st.scope_id}
        elif st.scope_type == "zone" and st.scope_id in ctx["line_zone_ids"]:
            z = next((z for z in ctx["zones"] if z.zone_id == st.scope_id), None)
            applies = set(z.station_ids or []) if z and z.station_ids else set()
        else:
            continue
        stops.append({
            "start": _epoch(st.started_at),
            "end": _epoch(st.ended_at) if st.ended_at else _epoch(end),
            "authorized": bool(st.is_authorized),
            "reason": st.reason,
            "station_ids": applies,
        })

    return compute_line_analytics(
        t0=_epoch(start),
        t1=_epoch(end),
        stations=ctx["stations"],
        positions=positions,
        machine=machine,
        cycles=cycles,
        stops=stops,
        line_area=ctx["area"],
        m_per_x=ctx["W"],
        m_per_y=ctx["H"],
        presence=presence,
        zones=[
            {"zone_id": z.zone_id, "name": z.name, "type": z.type, "polygon": z.polygon, "is_aggregated_only": z.is_aggregated_only}
            for z in ctx["zones"]
        ],
    )
