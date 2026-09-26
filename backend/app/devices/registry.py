"""
Registro de dispositivos físicos (ESP32, cámara local, etc.).

El estado se deriva del último latido, no de un campo guardado:
  waiting  → registrado pero nunca se ha comunicado
  online   → latido dentro de DEVICE_TIMEOUT_SECONDS
  offline  → se comunicó alguna vez pero dejó de hacerlo

Cualquier latido o evento de un device_id desconocido lo da de alta como
"detectado sin registrar" (is_active = False) para que el supervisor lo asigne.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db_models import DBDevice
from app.ws.manager import ws_manager


def device_status(dev: DBDevice, now: Optional[datetime] = None) -> str:
    if dev.last_heartbeat is None:
        return "waiting"
    now = now or datetime.utcnow()
    age = (now - dev.last_heartbeat).total_seconds()
    return "online" if age <= settings.DEVICE_TIMEOUT_SECONDS else "offline"


async def touch_device(
    session: AsyncSession,
    device_id: str,
    *,
    latency_ms: Optional[float] = None,
    firmware: Optional[str] = None,
    ingest_mode: Optional[str] = None,
) -> DBDevice:
    """Marca actividad de un dispositivo. Avisa por WebSocket cuando se (re)conecta."""
    dev = (await session.execute(select(DBDevice).where(DBDevice.device_id == device_id))).scalar_one_or_none()
    now = datetime.utcnow()
    discovered = dev is None
    was_online = dev is not None and device_status(dev, now) == "online"

    if dev is None:
        dev = DBDevice(
            id=f"dev-{uuid.uuid4().hex[:8]}",
            device_id=device_id,
            name=f"Nuevo · {device_id}",
            type="esp32",
            ingest_mode=ingest_mode or "http",
            is_active=False,
            simulated=False,
            created_at=now,
        )
        session.add(dev)

    dev.last_heartbeat = now
    dev.status = "online"
    if latency_ms is not None:
        dev.last_latency_ms = latency_ms
    if firmware:
        dev.firmware_version = firmware[:32]
    if ingest_mode:
        dev.ingest_mode = ingest_mode
    await session.flush()

    if not was_online and not dev.simulated:
        await ws_manager.broadcast({
            "type": "DEVICE_CONNECTED",
            "device_id": device_id,
            "discovered": discovered,
            "name": dev.name,
        })
    return dev
