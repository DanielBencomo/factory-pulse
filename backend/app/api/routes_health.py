from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.mqtt.adapter import mqtt_adapter
from app.simulator.engine import simulator
from app.ws.manager import ws_manager

router = APIRouter()

@router.get("/health")
async def get_health(session: AsyncSession = Depends(get_db)):
    db_ok = False
    try:
        await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "status": "ok" if db_ok else "degraded",
        "timestamp_utc": datetime.utcnow().isoformat(),
        "database": "connected" if db_ok else "disconnected",
        "mqtt": {
            "enabled": mqtt_adapter.is_connected,
            "status": "connected" if mqtt_adapter.is_connected else "standby_or_disabled"
        },
        "simulator": {
            "is_running": simulator.is_running,
            "scene": simulator.current_scene,
            "speed": simulator.speed,
            "mode": simulator.mode
        },
        "websocket_clients_connected": len(ws_manager.active_connections)
    }
