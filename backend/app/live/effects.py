"""
Efectos inmediatos de un evento real, además de guardarlo:

  cycle         suma piezas a la estación (contador del turno y último ciclo)
  button_press  action=stop_line abre un paro "pendiente de causa" en la
                estación; volver a presionar lo cierra. El supervisor lo
                justifica después desde la app (hasta entonces no se descuenta).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import DBAuditLog, DBEvent, DBStation, DBStop

PENDING_CODE = "PEND-01"


async def apply_event_effects(session: AsyncSession, ev: DBEvent) -> Optional[str]:
    """Devuelve el tipo de mensaje WebSocket a difundir, si aplica."""
    p = ev.payload or {}
    sid = p.get("station_id")

    if ev.type == "cycle" and sid:
        st = (await session.execute(select(DBStation).where(DBStation.station_id == sid))).scalar_one_or_none()
        if st:
            st.parts_produced_shift = (st.parts_produced_shift or 0) + int(p.get("total_parts") or 1)
            st.last_cycle_time = p.get("cycle_time_seconds")
            st.last_event_at = ev.occurred_at
        return None

    if ev.type == "button_press" and p.get("action") == "stop_line" and sid:
        open_stop = (
            await session.execute(
                select(DBStop).where(DBStop.scope_type == "station", DBStop.scope_id == sid, DBStop.status == "open")
            )
        ).scalars().first()
        if open_stop:
            open_stop.ended_at = ev.occurred_at
            open_stop.duration_seconds = max(0.0, (ev.occurred_at - open_stop.started_at).total_seconds())
            open_stop.status = "closed"
            open_stop.updated_at = datetime.utcnow()
            session.add(DBAuditLog(action="CLOSE_STOP", actor=f"Pulsador {ev.device_id}", entity_type="STOP", entity_id=open_stop.id, details={"source": "button"}))
        else:
            stop_id = f"stop-{uuid.uuid4().hex[:8]}"
            session.add(DBStop(
                id=stop_id, scope_type="station", scope_id=sid,
                reason="Paro por pulsador · pendiente de causa", reason_code=PENDING_CODE,
                author=f"Pulsador {ev.device_id or ''}".strip(), started_at=ev.occurred_at,
                is_authorized=False, status="open", notes="Abierto desde el pulsador físico. Falta que el supervisor registre la causa.",
            ))
            session.add(DBAuditLog(action="CREATE_STOP", actor=f"Pulsador {ev.device_id}", entity_type="STOP", entity_id=stop_id, details={"source": "button"}))
        return "STOP_UPDATED"
    return None
