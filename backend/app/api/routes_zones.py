import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.db_models import DBPolygonZone, DBAuditLog, DBEvent, DBFloorPlan, DBLine, DBStation
from app.calculations.analytics import point_in_polygon
from app.simulator.engine import simulator
from app.ws.manager import ws_manager
from pydantic import BaseModel, Field
from typing import Optional
from app.models.schemas import PolygonZoneCreate, PolygonZoneResponse, ZoneType

router = APIRouter()


def _polygon_area(polygon: List[List[float]]) -> float:
    return abs(sum(
        polygon[i][0] * polygon[(i + 1) % len(polygon)][1]
        - polygon[(i + 1) % len(polygon)][0] * polygon[i][1]
        for i in range(len(polygon))
    )) / 2 if len(polygon) >= 3 else 0.0


def _zone_response(z: DBPolygonZone) -> PolygonZoneResponse:
    return PolygonZoneResponse(
        id=z.id, zone_id=z.zone_id, floor_plan_id=z.floor_plan_id,
        name=z.name, type=ZoneType(z.type), polygon=z.polygon, color=z.color,
        station_ids=z.station_ids or [], max_capacity=z.max_capacity,
        max_stay_seconds=z.max_stay_seconds,
        is_aggregated_only=z.is_aggregated_only, line_id=z.line_id,
        interior=z.interior, created_at=z.created_at,
    )

@router.get("/zones", response_model=List[PolygonZoneResponse])
async def list_zones(session: AsyncSession = Depends(get_db)):
    stmt = select(DBPolygonZone)
    res = await session.execute(stmt)
    zones = res.scalars().all()
    return [_zone_response(z) for z in zones]

@router.post("/zones", response_model=PolygonZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_zone(zone_in: PolygonZoneCreate, session: AsyncSession = Depends(get_db)):
    if not zone_in.name.strip():
        raise HTTPException(status_code=422, detail="La zona necesita un nombre")
    if len(zone_in.polygon) < 3 or any(
        len(p) != 2 or not (0 <= p[0] <= 1 and 0 <= p[1] <= 1)
        for p in zone_in.polygon
    ):
        raise HTTPException(status_code=422, detail="El polígono debe tener al menos 3 puntos dentro de 0..1")
    if _polygon_area(zone_in.polygon) < 1e-6:
        raise HTTPException(status_code=422, detail="El polígono no puede tener área cero")
    if (await session.execute(select(DBPolygonZone).where(DBPolygonZone.zone_id == zone_in.zone_id))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Ya existe una zona con ese ID")
    if not (await session.execute(select(DBFloorPlan).where(DBFloorPlan.id == zone_in.floor_plan_id))).scalar_one_or_none():
        raise HTTPException(status_code=422, detail="El plano indicado no existe")
    if zone_in.line_id and not (await session.execute(select(DBLine).where(DBLine.id == zone_in.line_id))).scalar_one_or_none():
        raise HTTPException(status_code=422, detail="La línea indicada no existe")
    known_stations = set((await session.execute(select(DBStation.station_id))).scalars().all())
    missing = [sid for sid in zone_in.station_ids if sid not in known_stations]
    if missing:
        raise HTTPException(status_code=422, detail=f"Estaciones desconocidas: {', '.join(missing)}")
    db_zone = DBPolygonZone(
        id=f"zone-{uuid.uuid4().hex[:8]}",
        zone_id=zone_in.zone_id,
        floor_plan_id=zone_in.floor_plan_id,
        name=zone_in.name.strip(),
        type=zone_in.type.value,
        polygon=zone_in.polygon,
        color=zone_in.color,
        station_ids=zone_in.station_ids,
        max_capacity=zone_in.max_capacity,
        max_stay_seconds=zone_in.max_stay_seconds,
        is_aggregated_only=zone_in.is_aggregated_only or zone_in.type == ZoneType.BATHROOM,
        line_id=zone_in.line_id,
        interior=zone_in.interior,
        created_at=datetime.utcnow()
    )
    session.add(db_zone)
    session.add(DBAuditLog(
        action="CREATE_ZONE", actor="Editor sobre cámara", entity_type="ZONE",
        entity_id=zone_in.zone_id,
        details={"name": zone_in.name, "line_id": zone_in.line_id},
    ))
    await session.commit()
    await session.refresh(db_zone)
    await ws_manager.broadcast({"type": "LAYOUT_UPDATED"})
    return _zone_response(db_zone)


@router.get("/zones/occupancy/live")
async def live_zone_occupancy(
    max_age_seconds: int = Query(15, ge=3, le=120),
    session: AsyncSession = Depends(get_db),
):
    """Conteo actual por área; nunca devuelve track_id en zonas privadas."""
    now = datetime.utcnow()
    since = now - timedelta(seconds=max_age_seconds)
    zones = (await session.execute(select(DBPolygonZone))).scalars().all()
    rows = (
        await session.execute(
            select(DBEvent.occurred_at, DBEvent.type, DBEvent.payload, DBEvent.device_id)
            .where(
                DBEvent.mode == simulator.mode,
                DBEvent.occurred_at >= since,
                DBEvent.type.in_(["position", "zone_occupancy"]),
            )
            .order_by(DBEvent.occurred_at)
        )
    ).all()

    tracks: Dict[str, tuple[datetime, float, float]] = {}
    bundles: Dict[str, tuple[datetime, Dict[str, Any]]] = {}
    legacy: Dict[tuple[str, str], tuple[datetime, Dict[str, Any]]] = {}
    for at, event_type, payload, device_id in rows:
        payload = payload or {}
        device = device_id or "unknown"
        if event_type == "position" and payload.get("track_id"):
            tracks[str(payload["track_id"])] = (
                at, float(payload.get("x", 0)), float(payload.get("y", 0))
            )
        elif event_type == "zone_occupancy":
            if isinstance(payload.get("counts"), dict):
                bundles[device] = (at, payload)
            elif payload.get("zone_id"):
                legacy[(device, str(payload["zone_id"]))] = (at, payload)

    aggregate_counts: Counter[str] = Counter()
    aggregate_total = 0
    for _at, payload in bundles.values():
        aggregate_total += max(0, int(payload.get("count", 0)))
        for zone_id, count in payload.get("counts", {}).items():
            aggregate_counts[str(zone_id)] += max(0, int(count))
    bundled_devices = set(bundles)
    for (device, zone_id), (_at, payload) in legacy.items():
        if device in bundled_devices:
            continue
        count = max(0, int(payload.get("count", 0)))
        aggregate_counts[zone_id] += count
        aggregate_total += count

    aggregate_available = bool(bundles or legacy)
    tracked_counts: Counter[str] = Counter()
    for _track_id, (_at, x, y) in tracks.items():
        zone = next((z for z in zones if point_in_polygon(x, y, z.polygon)), None)
        if zone:
            tracked_counts[zone.zone_id] += 1

    result = []
    for zone in zones:
        count = aggregate_counts[zone.zone_id] if aggregate_available else tracked_counts[zone.zone_id]
        result.append({
            "zone_id": zone.zone_id,
            "name": zone.name,
            "type": zone.type,
            "line_id": zone.line_id,
            "count": count,
            "max_capacity": zone.max_capacity,
            "is_aggregated_only": bool(zone.is_aggregated_only),
            "privacy": "aggregate_only" if zone.is_aggregated_only else "anonymous_tracks",
            "source": "vision_aggregate" if aggregate_available else "tracks",
        })

    tracked_total = len(tracks)
    total = aggregate_total if aggregate_available else tracked_total
    assigned = sum(item["count"] for item in result)
    return {
        "mode": simulator.mode,
        "at": now.isoformat(),
        "max_age_seconds": max_age_seconds,
        "total_people": total,
        "tracked_people": tracked_total,
        "unassigned": max(0, total - assigned),
        "zones": result,
    }


# --- Interior editable de cada área ---

INTERIOR_KINDS = {"machine", "conveyor", "bench", "rack", "workstation", "cart", "rfid", "csi", "button", "process", "camera"}


class InteriorItem(BaseModel):
    id: str = Field(..., max_length=64)
    kind: str
    x: float
    y: float
    w: float = Field(..., gt=0.05, le=500)
    h: float = Field(..., gt=0.05, le=500)
    rot: int = 0
    label: Optional[str] = Field(None, max_length=80)
    variant: Optional[str] = Field(None, max_length=32)
    device_id: Optional[str] = Field(None, max_length=64)


class InteriorPoint(BaseModel):
    x: float
    y: float


class InteriorIn(BaseModel):
    items: List[InteriorItem]
    operator: Optional[InteriorPoint] = None


@router.put("/zones/{zone_id}/interior")
async def save_interior(zone_id: str, body: InteriorIn, session: AsyncSession = Depends(get_db)):
    zone = (await session.execute(select(DBPolygonZone).where(DBPolygonZone.zone_id == zone_id))).scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zona no encontrada")
    fp = (await session.execute(select(DBFloorPlan).where(DBFloorPlan.id == zone.floor_plan_id))).scalar_one_or_none()
    W = fp.width_meters if fp else 40.0
    H = fp.height_meters if fp else 25.0
    xs = [p[0] for p in zone.polygon]
    ys = [p[1] for p in zone.polygon]
    zw, zh = (max(xs) - min(xs)) * W, (max(ys) - min(ys)) * H

    errors = []
    for it in body.items:
        if it.kind not in INTERIOR_KINDS:
            errors.append(f"Tipo desconocido: {it.kind}")
        if it.rot not in (0, 90, 180, 270):
            errors.append(f"{it.label or it.kind}: rotación inválida")
        if it.x < -0.05 or it.y < -0.05 or it.x + it.w > zw + 0.05 or it.y + it.h > zh + 0.05:
            errors.append(f"{it.label or it.kind}: queda fuera del área ({zw:.1f} × {zh:.1f} m)")
    if errors:
        raise HTTPException(status_code=422, detail=errors)

    zone.interior = [it.model_dump() for it in body.items]

    if body.operator and zone.station_ids:
        st = (await session.execute(select(DBStation).where(DBStation.station_id == zone.station_ids[0]))).scalar_one_or_none()
        if st:
            st.position_x = round(min(max(xs), max(min(xs), min(xs) + body.operator.x / W)), 4)
            st.position_y = round(min(max(ys), max(min(ys), min(ys) + body.operator.y / H)), 4)

    session.add(DBAuditLog(action="UPDATE_INTERIOR", actor="Editor de layout", entity_type="ZONE", entity_id=zone_id, details={"items": len(body.items)}))
    await session.commit()
    await ws_manager.broadcast({"type": "LAYOUT_UPDATED"})
    return {"zone_id": zone_id, "interior": zone.interior}
