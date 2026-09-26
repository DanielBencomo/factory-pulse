import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.db_models import DBDevice, DBAuditLog
from app.models.schemas import DeviceCreate, DeviceResponse

router = APIRouter()

@router.get("/devices", response_model=List[DeviceResponse])
async def list_devices(session: AsyncSession = Depends(get_db)):
    stmt = select(DBDevice)
    res = await session.execute(stmt)
    devices = res.scalars().all()
    return [
        DeviceResponse(
            id=d.id,
            device_id=d.device_id,
            name=d.name,
            type=d.type,
            station_id=d.station_id,
            zone_id=d.zone_id,
            ingest_mode=d.ingest_mode,
            firmware_version=d.firmware_version,
            is_active=d.is_active,
            last_heartbeat=d.last_heartbeat,
            last_latency_ms=d.last_latency_ms,
            status=d.status,
            created_at=d.created_at
        )
        for d in devices
    ]

@router.post("/devices", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def create_device(dev_in: DeviceCreate, session: AsyncSession = Depends(get_db)):
    db_dev = DBDevice(
        id=f"dev-{uuid.uuid4().hex[:8]}",
        device_id=dev_in.device_id,
        name=dev_in.name,
        type=dev_in.type,
        station_id=dev_in.station_id,
        zone_id=dev_in.zone_id,
        ingest_mode=dev_in.ingest_mode,
        firmware_version=dev_in.firmware_version,
        is_active=dev_in.is_active,
        status="online",
        last_heartbeat=datetime.utcnow(),
        created_at=datetime.utcnow()
    )
    session.add(db_dev)
    await session.commit()
    await session.refresh(db_dev)
    return DeviceResponse(
        id=db_dev.id,
        device_id=db_dev.device_id,
        name=db_dev.name,
        type=db_dev.type,
        station_id=db_dev.station_id,
        zone_id=db_dev.zone_id,
        ingest_mode=db_dev.ingest_mode,
        firmware_version=db_dev.firmware_version,
        is_active=db_dev.is_active,
        last_heartbeat=db_dev.last_heartbeat,
        last_latency_ms=db_dev.last_latency_ms,
        status=db_dev.status,
        created_at=db_dev.created_at
    )

@router.post("/devices/{device_id}/heartbeat")
async def device_heartbeat(
    device_id: str,
    latency_ms: Optional[float] = 15.0,
    session: AsyncSession = Depends(get_db)
):
    stmt = select(DBDevice).where(DBDevice.device_id == device_id)
    res = await session.execute(stmt)
    dev = res.scalar_one_or_none()
    if not dev:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

    dev.last_heartbeat = datetime.utcnow()
    dev.last_latency_ms = latency_ms
    dev.status = "online"
    await session.commit()

    return {"status": "ok", "device_id": device_id, "timestamp": dev.last_heartbeat}
