import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.db_models import DBPolygonZone, DBAuditLog
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
        created_at=db_zone.created_at
    )
