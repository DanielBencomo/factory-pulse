"""Resumen espacial e insights explicables para supervisión industrial."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.calculations.analytics import point_in_polygon
from app.calculations.spatial import build_spatial_insights, compute_spatial_summary
from app.database import get_db
from app.models.db_models import DBEvent, DBFloorPlan, DBLine, DBPolygonZone, DBStation
from app.simulator.engine import simulator


router = APIRouter()
SPATIAL_TYPES = ("position", "zone_occupancy")


def _epoch(value: datetime) -> float:
    return value.replace(tzinfo=timezone.utc).timestamp()


def _centroid(poly: List[List[float]]) -> Tuple[float, float]:
    return (
        sum(float(point[0]) for point in poly) / max(1, len(poly)),
        sum(float(point[1]) for point in poly) / max(1, len(poly)),
    )


def _derived_polygon(zones: List[DBPolygonZone]) -> Optional[List[List[float]]]:
    points = [point for zone in zones for point in (zone.polygon or [])]
    if not points:
        return None
    x0 = max(0.0, min(point[0] for point in points) - 0.02)
    y0 = max(0.0, min(point[1] for point in points) - 0.02)
    x1 = min(1.0, max(point[0] for point in points) + 0.02)
    y1 = min(1.0, max(point[1] for point in points) + 0.02)
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def _zone_dict(zone: DBPolygonZone) -> Dict[str, Any]:
    return {
        "zone_id": zone.zone_id,
        "name": zone.name,
        "type": zone.type,
        "polygon": zone.polygon,
        "line_id": zone.line_id,
        "max_capacity": zone.max_capacity,
        "is_aggregated_only": bool(zone.is_aggregated_only),
    }


async def _scope_context(
    session: AsyncSession,
    scope: str,
    scope_id: Optional[str],
) -> Tuple[List[DBPolygonZone], Optional[List[List[float]]], str, bool]:
    zones = (await session.execute(select(DBPolygonZone))).scalars().all()
    if scope == "plant":
        return zones, None, "Planta completa", True

    if not scope_id:
        raise HTTPException(status_code=422, detail=f"scope_id es obligatorio para scope={scope}")

    if scope == "zone":
        zone = next((z for z in zones if z.zone_id == scope_id or z.id == scope_id), None)
        if not zone:
            raise HTTPException(status_code=404, detail="Zona no encontrada")
        return [zone], zone.polygon, zone.name, False

    stations = (await session.execute(select(DBStation))).scalars().all()
    if scope == "station":
        station = next((s for s in stations if s.station_id == scope_id or s.id == scope_id), None)
        if not station:
            raise HTTPException(status_code=404, detail="Estación no encontrada")
        zone = next((z for z in zones if station.station_id in (z.station_ids or [])), None)
        if not zone:
            raise HTTPException(status_code=422, detail="La estación no tiene una zona espacial vinculada")
        return [zone], zone.polygon, station.name, False

    line = (await session.execute(select(DBLine).where(DBLine.id == scope_id))).scalar_one_or_none()
    if not line:
        raise HTTPException(status_code=404, detail="Línea no encontrada")
    station_ids = {s.station_id for s in stations if s.line_id == line.id}
    direct = [z for z in zones if z.line_id == line.id or any(sid in station_ids for sid in (z.station_ids or []))]
    polygon = line.polygon or _derived_polygon(direct)
    selected = list(direct)
    if polygon:
        known = {z.zone_id for z in selected}
        selected.extend(
            z for z in zones
            if z.zone_id not in known and point_in_polygon(*_centroid(z.polygon), polygon)
        )
    return selected, polygon, line.name, False


async def _build_spatial_response(
    session: AsyncSession,
    *,
    scope: str,
    scope_id: Optional[str],
    minutes: int,
    mode: Optional[str],
) -> Dict[str, Any]:
    active_mode = mode or simulator.mode
    floor_plan = (await session.execute(select(DBFloorPlan))).scalars().first()
    width_m = floor_plan.width_meters if floor_plan else 40.0
    height_m = floor_plan.height_meters if floor_plan else 25.0
    zones, scope_poly, scope_label, use_total = await _scope_context(session, scope, scope_id)

    latest = (
        await session.execute(
            select(func.max(DBEvent.occurred_at)).where(
                DBEvent.mode == active_mode,
                DBEvent.type.in_(SPATIAL_TYPES),
            )
        )
    ).scalar()
    now = datetime.utcnow()
    if active_mode in ("demo", "replay") and latest is not None:
        end = latest
    else:
        end = max(now, latest) if latest is not None else now
    start = end - timedelta(minutes=minutes)
    lead = timedelta(seconds=15)
    rows = (
        await session.execute(
            select(DBEvent.occurred_at, DBEvent.type, DBEvent.payload, DBEvent.device_id)
            .where(
                DBEvent.mode == active_mode,
                DBEvent.type.in_(SPATIAL_TYPES),
                DBEvent.occurred_at >= start - lead,
                DBEvent.occurred_at <= end,
            )
            .order_by(DBEvent.occurred_at)
        )
    ).all()

    positions: Dict[str, List[Tuple[float, float, float, Optional[float]]]] = defaultdict(list)
    occupancy: Dict[str, List[Tuple[float, int, Dict[str, int]]]] = defaultdict(list)
    devices = set()
    for occurred_at, event_type, payload, device_id in rows:
        payload = payload or {}
        device = str(device_id or payload.get("source") or "unknown")
        devices.add(device)
        timestamp = _epoch(occurred_at)
        if event_type == "position" and payload.get("track_id") and "x" in payload and "y" in payload:
            speed = payload.get("speed_m_s")
            try:
                parsed_speed = float(speed) if speed is not None else None
            except (TypeError, ValueError):
                parsed_speed = None
            positions[str(payload["track_id"])].append((
                timestamp, float(payload["x"]), float(payload["y"]), parsed_speed,
            ))
        elif event_type == "zone_occupancy":
            if isinstance(payload.get("counts"), dict):
                counts = {
                    str(zone_id): max(0, int(count))
                    for zone_id, count in payload["counts"].items()
                    if isinstance(count, (int, float))
                }
                occupancy[device].append((timestamp, max(0, int(payload.get("count", sum(counts.values())))), counts))
            elif payload.get("zone_id"):
                zone_id = str(payload["zone_id"])
                count = max(0, int(payload.get("count", 0)))
                occupancy[f"{device}:{zone_id}"].append((timestamp, count, {zone_id: count}))

    result = compute_spatial_summary(
        t0=_epoch(start),
        t1=_epoch(end),
        zones=[_zone_dict(zone) for zone in zones],
        positions=positions,
        occupancy=occupancy,
        width_m=width_m,
        height_m=height_m,
        scope_poly=scope_poly,
        use_occupancy_total=use_total,
    )
    result["summary"]["source_count"] = len(devices)
    result["summary"]["calibrated"] = bool((floor_plan.calibration or {}).get("is_calibrated")) if floor_plan else False
    insights = build_spatial_insights(result)
    return {
        "mode": active_mode,
        "scope": {"type": scope, "id": scope_id, "label": scope_label},
        "window": {
            "start": start.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
            "end": end.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
            "minutes": minutes,
            "step_s": result["step_s"],
        },
        "generated_at": now.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "summary": result["summary"],
        "zones": result["zones"],
        "transitions": result["transitions"],
        "insights": insights,
        "methodology": {
            "position_max_age_s": 10,
            "occupancy_max_age_s": 12,
            "stationary_threshold_m_s": 0.15,
            "privacy": "Sin reconocimiento facial; zonas sensibles sólo agregadas; la respuesta no contiene track IDs.",
            "interpretation": "Quietud y permanencia son observaciones; no equivalen por sí solas a improductividad.",
        },
    }


@router.get("/spatial/summary")
async def spatial_summary(
    scope: str = Query("plant", pattern="^(plant|line|station|zone)$"),
    scope_id: Optional[str] = Query(None),
    minutes: int = Query(60, ge=5, le=720),
    mode: Optional[str] = Query(None, pattern="^(demo|live|replay)$"),
    session: AsyncSession = Depends(get_db),
):
    return await _build_spatial_response(session, scope=scope, scope_id=scope_id, minutes=minutes, mode=mode)


@router.get("/spatial/insights")
async def spatial_insights(
    scope: str = Query("plant", pattern="^(plant|line|station|zone)$"),
    scope_id: Optional[str] = Query(None),
    minutes: int = Query(60, ge=5, le=720),
    mode: Optional[str] = Query(None, pattern="^(demo|live|replay)$"),
    session: AsyncSession = Depends(get_db),
):
    result = await _build_spatial_response(session, scope=scope, scope_id=scope_id, minutes=minutes, mode=mode)
    return {
        "mode": result["mode"],
        "scope": result["scope"],
        "window": result["window"],
        "coverage_pct": result["summary"]["coverage_pct"],
        "insights": result["insights"],
    }
