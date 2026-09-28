"""Adaptador estable para lectores RFID de prototipo o industriales.

Acepta UID (RC522), EPC (UHF), antena y RSSI. Convierte cada lectura al
contrato de eventos de Factory Pulse, conservando deduplicación y WebSocket.
"""
from datetime import datetime
from enum import Enum
import secrets
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes_events import ingest_event
from app.config import settings
from app.database import get_db
from app.models.db_models import DBDevice, DBPolygonZone, DBStation
from app.models.domain import EventMode, EventType
from app.models.schemas import EventIngest, EventResponse

router = APIRouter()


class RFIDAction(str, Enum):
    READ = "read"
    ENTER = "enter"
    EXIT = "exit"
    ZONE_ENTER = "zone_enter"
    ZONE_EXIT = "zone_exit"


class RFIDRead(BaseModel):
    event_id: Optional[str] = Field(None, max_length=96)
    reader_id: Optional[str] = Field(None, min_length=1, max_length=64)
    device_id: Optional[str] = Field(None, min_length=1, max_length=64)
    tag_id: str = Field(..., min_length=1, max_length=128)
    event: RFIDAction = RFIDAction.READ
    zone_id: Optional[str] = Field(None, max_length=64)
    station_id: Optional[str] = Field(None, max_length=64)
    antenna_id: Optional[str] = Field(None, max_length=64)
    rssi: Optional[float] = None
    occurred_at: Optional[datetime] = None
    quality: float = Field(1.0, ge=0.0, le=1.0)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_reader(self):
        if not self.reader_id and not self.device_id:
            raise ValueError("reader_id o device_id es obligatorio")
        if self.reader_id and self.device_id and self.reader_id != self.device_id:
            raise ValueError("reader_id y device_id deben coincidir")
        if not self.tag_id.strip():
            raise ValueError("tag_id no puede estar vacío")
        return self


def _authorize(token: Optional[str]) -> None:
    expected = settings.RFID_INGEST_TOKEN
    if expected and (not token or not secrets.compare_digest(token, expected)):
        raise HTTPException(status_code=401, detail="Clave RFID inválida")


async def _normalize(read: RFIDRead, session: AsyncSession) -> EventIngest:
    reader_id = (read.reader_id or read.device_id or "").strip()
    device = (
        await session.execute(select(DBDevice).where(DBDevice.device_id == reader_id))
    ).scalar_one_or_none()
    zone_id = read.zone_id or (device.zone_id if device else None)
    station_id = read.station_id or (device.station_id if device else None)

    if zone_id:
        zone = (
            await session.execute(select(DBPolygonZone).where(DBPolygonZone.zone_id == zone_id))
        ).scalar_one_or_none()
        if not zone:
            raise HTTPException(status_code=422, detail=f"Zona desconocida: {zone_id}")
        if not station_id and zone.station_ids:
            station_id = zone.station_ids[0]
    if station_id:
        station = (
            await session.execute(select(DBStation).where(DBStation.station_id == station_id))
        ).scalar_one_or_none()
        if not station:
            raise HTTPException(status_code=422, detail=f"Estación desconocida: {station_id}")
        if not zone_id:
            linked = (
                await session.execute(select(DBPolygonZone))
            ).scalars().all()
            zone_id = next(
                (z.zone_id for z in linked if station_id in (z.station_ids or [])), None
            )

    event_type = (
        EventType.ZONE_EXIT
        if read.event in {RFIDAction.EXIT, RFIDAction.ZONE_EXIT}
        else EventType.ZONE_ENTER
    )
    payload: Dict[str, Any] = {
        "tag_id": read.tag_id.strip().upper(),
        "reader_id": reader_id,
        "source": "rfid",
    }
    if zone_id:
        payload["zone_id"] = zone_id
    if station_id:
        payload["station_id"] = station_id
    if read.antenna_id:
        payload["antenna_id"] = read.antenna_id
    if read.rssi is not None:
        payload["rssi"] = read.rssi
    if read.metadata:
        payload["metadata"] = read.metadata

    return EventIngest(
        event_id=read.event_id or f"rfid-{uuid.uuid4().hex}",
        device_id=reader_id,
        source_id="rfid_adapter",
        occurred_at=read.occurred_at or datetime.utcnow(),
        type=event_type,
        payload=payload,
        quality=read.quality,
        mode=EventMode.LIVE,
    )


async def _ingest_read(read: RFIDRead, session: AsyncSession) -> EventResponse:
    event = await _normalize(read, session)
    response = await ingest_event(event, session)

    # touch_device(), llamado por ingest_event, descubre lectores desconocidos.
    # Se etiqueta el nuevo nodo correctamente para que el dashboard lo muestre.
    device = (
        await session.execute(select(DBDevice).where(DBDevice.device_id == event.device_id))
    ).scalar_one_or_none()
    if device and device.name.startswith("Nuevo ·"):
        device.type = "rfid_reader"
        device.name = f"Lector RFID · {event.device_id}"
        device.ingest_mode = "http"
        await session.commit()
    return response


@router.get("/rfid/config")
async def rfid_config(request: Request):
    base = str(request.base_url).rstrip("/")
    return {
        "events_url": f"{base}{settings.API_V1_STR}/rfid/events",
        "batch_url": f"{base}{settings.API_V1_STR}/rfid/events/batch",
        "auth_required": bool(settings.RFID_INGEST_TOKEN),
        "auth_header": "X-Factory-Pulse-Key",
        "accepted_identifiers": ["UID", "EPC"],
        "max_batch_size": 500,
    }


@router.post("/rfid/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def ingest_rfid_event(
    read: RFIDRead,
    x_factory_pulse_key: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_db),
):
    _authorize(x_factory_pulse_key)
    return await _ingest_read(read, session)


@router.post("/rfid/events/batch", response_model=List[EventResponse])
async def ingest_rfid_batch(
    reads: List[RFIDRead],
    x_factory_pulse_key: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_db),
):
    _authorize(x_factory_pulse_key)
    if len(reads) > 500:
        raise HTTPException(status_code=413, detail="Máximo 500 lecturas por lote")
    return [await _ingest_read(read, session) for read in reads]
