import socket
import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.devices.registry import device_status, touch_device
from app.models.db_models import DBDevice, DBAuditLog
from app.simulator.engine import simulator

router = APIRouter()

DEVICE_TYPES = {
    "rfid_reader": "Lector RFID/UHF industrial",
    "esp32_rfid": "ESP32 + RC522 (checkpoint RFID)",
    "esp32_csi": "ESP32 Wi‑Fi CSI (actividad de zona)",
    "esp32_button": "ESP32 + pulsadores (paro / andon)",
    "esp32_process": "ESP32 + sensor de proceso (ciclos)",
    "camera_vision": "Cámara cenital (tracking XY)",
    "esp32": "ESP32 genérico",
}


class DeviceIn(BaseModel):
    device_id: str = Field(..., min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(..., min_length=1, max_length=128)
    type: str = "esp32"
    station_id: Optional[str] = None
    zone_id: Optional[str] = None
    ingest_mode: str = "http"


class DevicePatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    station_id: Optional[str] = None
    zone_id: Optional[str] = None
    is_active: Optional[bool] = None


class HeartbeatIn(BaseModel):
    firmware: Optional[str] = None
    rssi: Optional[int] = None
    ip: Optional[str] = None
    latency_ms: Optional[float] = None


def _out(d: DBDevice, now: datetime) -> dict:
    return {
        "id": d.id,
        "device_id": d.device_id,
        "name": d.name,
        "type": d.type,
        "station_id": d.station_id,
        "zone_id": d.zone_id,
        "ingest_mode": d.ingest_mode,
        "firmware_version": d.firmware_version,
        "is_active": d.is_active,
        "simulated": bool(d.simulated),
        "last_heartbeat": d.last_heartbeat,
        "last_latency_ms": d.last_latency_ms,
        "status": device_status(d, now),
        "created_at": d.created_at,
    }


@router.get("/devices")
async def list_devices(session: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    devices = (await session.execute(select(DBDevice).order_by(DBDevice.created_at))).scalars().all()
    return [_out(d, now) for d in devices]


@router.get("/devices/types")
async def list_device_types():
    return [{"value": k, "label": v} for k, v in DEVICE_TYPES.items()]


@router.post("/devices", status_code=status.HTTP_201_CREATED)
async def register_device(dev_in: DeviceIn, session: AsyncSession = Depends(get_db)):
    """Da de alta un dispositivo que se espera conectar. Queda en estado 'waiting'."""
    if dev_in.type not in DEVICE_TYPES:
        raise HTTPException(status_code=422, detail=f"Tipo desconocido: {dev_in.type}")
    exists = (await session.execute(select(DBDevice).where(DBDevice.device_id == dev_in.device_id))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Ya existe un dispositivo con ese ID")
    dev = DBDevice(
        id=f"dev-{uuid.uuid4().hex[:8]}",
        device_id=dev_in.device_id,
        name=dev_in.name,
        type=dev_in.type,
        station_id=dev_in.station_id,
        zone_id=dev_in.zone_id,
        ingest_mode=dev_in.ingest_mode,
        is_active=True,
        simulated=False,
        last_heartbeat=None,
        status="waiting",
        created_at=datetime.utcnow(),
    )
    session.add(dev)
    session.add(DBAuditLog(action="REGISTER_DEVICE", actor="Supervisor", entity_type="DEVICE", entity_id=dev.device_id, details={"type": dev.type}))
    await session.commit()
    return _out(dev, datetime.utcnow())


@router.put("/devices/{device_id}")
async def update_device(device_id: str, patch: DevicePatch, session: AsyncSession = Depends(get_db)):
    dev = (await session.execute(select(DBDevice).where(DBDevice.device_id == device_id))).scalar_one_or_none()
    if not dev:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")
    data = patch.model_dump(exclude_unset=True)
    if "type" in data and data["type"] not in DEVICE_TYPES:
        raise HTTPException(status_code=422, detail=f"Tipo desconocido: {data['type']}")
    for k, v in data.items():
        setattr(dev, k, v)
    await session.commit()
    return _out(dev, datetime.utcnow())


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(device_id: str, session: AsyncSession = Depends(get_db)):
    dev = (await session.execute(select(DBDevice).where(DBDevice.device_id == device_id))).scalar_one_or_none()
    if not dev:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")
    if dev.simulated:
        raise HTTPException(status_code=409, detail="Los nodos de demostración no se eliminan")
    await session.delete(dev)
    await session.commit()


@router.post("/devices/{device_id}/heartbeat")
async def device_heartbeat(
    device_id: str,
    latency_ms: Optional[float] = None,
    body: Optional[HeartbeatIn] = Body(None),
    session: AsyncSession = Depends(get_db),
):
    """Latido del ESP32. Un ID desconocido se registra como 'detectado sin asignar'."""
    dev = await touch_device(
        session,
        device_id,
        latency_ms=(body.latency_ms if body and body.latency_ms is not None else latency_ms),
        firmware=body.firmware if body else None,
        ingest_mode="http",
    )
    await session.commit()
    return {"status": "ok", "device_id": device_id, "registered": dev.is_active, "timestamp": dev.last_heartbeat}


def _lan_ips() -> List[str]:
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no envía nada; solo elige la interfaz de salida
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


@router.get("/connect/info")
async def connect_info(request: Request):
    """Datos que necesita el firmware para hablar con este servidor."""
    port = request.url.port or 8000
    ips = _lan_ips()
    host = ips[0] if ips else "IP_DEL_SERVIDOR"
    return {
        "mode": simulator.mode,
        "lan_ips": ips,
        "port": port,
        "base_url": f"http://{host}:{port}",
        "events_url": f"http://{host}:{port}{settings.API_V1_STR}/events",
        "heartbeat_url_template": f"http://{host}:{port}{settings.API_V1_STR}/devices/{{DEVICE_ID}}/heartbeat",
        "rfid_events_url": f"http://{host}:{port}{settings.API_V1_STR}/rfid/events",
        "rfid_auth_required": bool(settings.RFID_INGEST_TOKEN),
        "rfid_auth_header": "X-Factory-Pulse-Key",
        "heartbeat_interval_seconds": 10,
        "device_timeout_seconds": settings.DEVICE_TIMEOUT_SECONDS,
        "mqtt": {
            "enabled": settings.MQTT_ENABLED,
            "host": settings.MQTT_BROKER_HOST,
            "port": settings.MQTT_BROKER_PORT,
            "topic_template": f"{settings.MQTT_TOPIC_PREFIX}/{{LINE_ID}}/{{DEVICE_ID}}/events",
        },
    }
