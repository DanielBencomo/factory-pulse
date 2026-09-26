import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.db_models import DBPolygonZone, DBAuditLog, DBFloorPlan, DBStation
from app.ws.manager import ws_manager
from pydantic import BaseModel, Field
from typing import Optional
from app.models.schemas import PolygonZoneCreate, PolygonZoneResponse, ZoneType

router = APIRouter()

@router.get("/zones", response_model=List[PolygonZoneResponse])
async def list_zones(session: AsyncSession = Depends(get_db)):
    stmt = select(DBPolygonZone)
    res = await session.execute(stmt)
    zones = res.scalars().all()
    return [
        PolygonZoneResponse(
            id=z.id,
            zone_id=z.zone_id,
            floor_plan_id=z.floor_plan_id,
            name=z.name,
            type=ZoneType(z.type),
            polygon=z.polygon,
            color=z.color,
            station_ids=z.station_ids or [],
            max_capacity=z.max_capacity,
            max_stay_seconds=z.max_stay_seconds,
            is_aggregated_only=z.is_aggregated_only,
            line_id=z.line_id,
            interior=z.interior,
            created_at=z.created_at
        )
        for z in zones
    ]

@router.post("/zones", response_model=PolygonZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_zone(zone_in: PolygonZoneCreate, session: AsyncSession = Depends(get_db)):
    db_zone = DBPolygonZone(
        id=f"zone-{uuid.uuid4().hex[:8]}",
        zone_id=zone_in.zone_id,
        floor_plan_id=zone_in.floor_plan_id,
        name=zone_in.name,
        type=zone_in.type.value,
        polygon=zone_in.polygon,
        color=zone_in.color,
        station_ids=zone_in.station_ids,
        max_capacity=zone_in.max_capacity,
        max_stay_seconds=zone_in.max_stay_seconds,
        is_aggregated_only=zone_in.is_aggregated_only,
        line_id=zone_in.line_id,
        created_at=datetime.utcnow()
    )
    session.add(db_zone)
    await session.commit()
    await session.refresh(db_zone)
    return PolygonZoneResponse(
        id=db_zone.id,
        zone_id=db_zone.zone_id,
        floor_plan_id=db_zone.floor_plan_id,
        name=db_zone.name,
        type=ZoneType(db_zone.type),
        polygon=db_zone.polygon,
        color=db_zone.color,
        station_ids=db_zone.station_ids or [],
        max_capacity=db_zone.max_capacity,
        max_stay_seconds=db_zone.max_stay_seconds,
        is_aggregated_only=db_zone.is_aggregated_only,
        line_id=db_zone.line_id,
        created_at=db_zone.created_at
    )


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
