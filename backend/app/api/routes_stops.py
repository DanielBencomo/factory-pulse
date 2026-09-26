import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models.db_models import DBStop, DBStopReason, DBAuditLog, DBStation
from app.models.schemas import StopCreate, StopUpdate, StopResponse, StopScope
from app.ws.manager import ws_manager

router = APIRouter()

@router.get("/stops", response_model=List[StopResponse])
async def list_stops(
    status: Optional[str] = None, # 'open' | 'closed'
    scope_id: Optional[str] = None,
    session: AsyncSession = Depends(get_db)
):
    stmt = select(DBStop).order_by(desc(DBStop.started_at))
    if status:
        stmt = stmt.where(DBStop.status == status)
    if scope_id:
        stmt = stmt.where(DBStop.scope_id == scope_id)

    res = await session.execute(stmt)
    stops = res.scalars().all()

    return [
        StopResponse(
            id=s.id,
            scope_type=StopScope(s.scope_type),
            scope_id=s.scope_id,
            reason=s.reason,
            reason_code=s.reason_code,
            author=s.author,
            started_at=s.started_at,
            ended_at=s.ended_at,
            duration_seconds=s.duration_seconds,
            is_authorized=s.is_authorized,
            status=s.status,
            notes=s.notes,
            created_at=s.created_at,
            updated_at=s.updated_at
        )
        for s in stops
    ]

@router.post("/stops", response_model=StopResponse, status_code=status.HTTP_201_CREATED)
async def create_stop(stop_in: StopCreate, session: AsyncSession = Depends(get_db)):
    """
    Starts/Registers an authorized or operational stop.
    Never deletes raw telemetry events.
    """
    stop_id = f"stp-{uuid.uuid4().hex[:8]}"
    duration_sec = None
    stop_status = "open"

    if stop_in.ended_at:
        duration_sec = (stop_in.ended_at - stop_in.started_at).total_seconds()
        stop_status = "closed"

    db_stop = DBStop(
        id=stop_id,
        scope_type=stop_in.scope_type.value,
        scope_id=stop_in.scope_id,
        reason=stop_in.reason,
        reason_code=stop_in.reason_code,
        author=stop_in.author,
        started_at=stop_in.started_at,
        ended_at=stop_in.ended_at,
        duration_seconds=duration_sec,
        is_authorized=stop_in.is_authorized,
        status=stop_status,
        notes=stop_in.notes,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    session.add(db_stop)

    # If stop scope is a station, update its status
    if stop_in.scope_type == StopScope.STATION:
        st_stmt = select(DBStation).where(DBStation.station_id == stop_in.scope_id)
        st_res = await session.execute(st_stmt)
        st = st_res.scalar_one_or_none()
        if st:
            st.current_status = "stopped"

    # Audit entry
    audit = DBAuditLog(
        action="CREATE_STOP",
        actor=stop_in.author,
        entity_type="STOP",
        entity_id=stop_id,
        details={
            "reason": stop_in.reason,
            "scope_type": stop_in.scope_type.value,
            "scope_id": stop_in.scope_id,
            "is_authorized": stop_in.is_authorized
        }
    )
    session.add(audit)

    await session.commit()
    await session.refresh(db_stop)

    # Broadcast update
    await ws_manager.broadcast({
        "type": "STOP_UPDATED",
        "action": "created",
        "stop_id": db_stop.id,
        "scope_id": db_stop.scope_id,
        "status": db_stop.status
    })

    return StopResponse(
        id=db_stop.id,
        scope_type=StopScope(db_stop.scope_type),
        scope_id=db_stop.scope_id,
        reason=db_stop.reason,
        reason_code=db_stop.reason_code,
        author=db_stop.author,
        started_at=db_stop.started_at,
        ended_at=db_stop.ended_at,
        duration_seconds=db_stop.duration_seconds,
        is_authorized=db_stop.is_authorized,
        status=db_stop.status,
        notes=db_stop.notes,
        created_at=db_stop.created_at,
        updated_at=db_stop.updated_at
    )

@router.put("/stops/{stop_id}/close", response_model=StopResponse)
async def close_stop(stop_id: str, ended_at: Optional[datetime] = None, session: AsyncSession = Depends(get_db)):
    """
    Finishes an ongoing stop. Validates that ended_at >= started_at.
    """
    stmt = select(DBStop).where(DBStop.id == stop_id)
    res = await session.execute(stmt)
    stop = res.scalar_one_or_none()
    if not stop:
        raise HTTPException(status_code=404, detail="Paro no encontrado")

    end_time = ended_at or datetime.utcnow()
    if end_time < stop.started_at:
        raise HTTPException(status_code=400, detail="La fecha de fin no puede ser anterior al inicio del paro")

    stop.ended_at = end_time
    stop.duration_seconds = (end_time - stop.started_at).total_seconds()
    stop.status = "closed"
    stop.updated_at = datetime.utcnow()

    # Revert station status if applicable
    if stop.scope_type == "station":
        st_stmt = select(DBStation).where(DBStation.station_id == stop.scope_id)
        st_res = await session.execute(st_stmt)
        st = st_res.scalar_one_or_none()
        if st and st.current_status == "stopped":
            st.current_status = "idle"

    # Audit entry
    audit = DBAuditLog(
        action="CLOSE_STOP",
        actor=stop.author,
        entity_type="STOP",
        entity_id=stop_id,
        details={"duration_seconds": stop.duration_seconds}
    )
    session.add(audit)

    await session.commit()
    await session.refresh(stop)

    await ws_manager.broadcast({
        "type": "STOP_UPDATED",
        "action": "closed",
        "stop_id": stop.id,
        "duration_seconds": stop.duration_seconds
    })

    return StopResponse(
        id=stop.id,
        scope_type=StopScope(stop.scope_type),
        scope_id=stop.scope_id,
        reason=stop.reason,
        reason_code=stop.reason_code,
        author=stop.author,
        started_at=stop.started_at,
        ended_at=stop.ended_at,
        duration_seconds=stop.duration_seconds,
        is_authorized=stop.is_authorized,
        status=stop.status,
        notes=stop.notes,
        created_at=stop.created_at,
        updated_at=stop.updated_at
    )

@router.put("/stops/{stop_id}", response_model=StopResponse)
async def update_stop(stop_id: str, patch: StopUpdate, session: AsyncSession = Depends(get_db)):
    """
    Corrige o justifica un paro (p. ej. el que abrió un pulsador con causa pendiente).
    Al marcarlo como justificado, su intervalo completo deja de contar como espera.
    """
    stop = (await session.execute(select(DBStop).where(DBStop.id == stop_id))).scalar_one_or_none()
    if not stop:
        raise HTTPException(status_code=404, detail="Paro no encontrado")
    data = patch.model_dump(exclude_unset=True)
    if "reason_code" in data:
        reason = (await session.execute(select(DBStopReason).where(DBStopReason.code == data["reason_code"]))).scalar_one_or_none()
        if not reason:
            raise HTTPException(status_code=422, detail=f"Causa desconocida: {data['reason_code']}")
        data.setdefault("reason", reason.description)
    if "ended_at" in data and data["ended_at"] is not None and data["ended_at"] < stop.started_at:
        raise HTTPException(status_code=400, detail="La fecha de fin no puede ser anterior al inicio del paro")
    before = {"reason_code": stop.reason_code, "is_authorized": stop.is_authorized}
    for k, v in data.items():
        setattr(stop, k, v)
    if stop.ended_at:
        stop.duration_seconds = (stop.ended_at - stop.started_at).total_seconds()
    stop.updated_at = datetime.utcnow()
    session.add(DBAuditLog(action="UPDATE_STOP", actor=data.get("author") or stop.author, entity_type="STOP", entity_id=stop_id, details={"before": before, "after": {k: str(v) for k, v in data.items()}}))
    await session.commit()
    await session.refresh(stop)
    await ws_manager.broadcast({"type": "STOP_UPDATED", "action": "updated", "stop_id": stop.id})
    return StopResponse(
        id=stop.id, scope_type=StopScope(stop.scope_type), scope_id=stop.scope_id, reason=stop.reason, reason_code=stop.reason_code,
        author=stop.author, started_at=stop.started_at, ended_at=stop.ended_at, duration_seconds=stop.duration_seconds,
        is_authorized=stop.is_authorized, status=stop.status, notes=stop.notes, created_at=stop.created_at, updated_at=stop.updated_at,
    )


@router.get("/stops/reasons")
async def list_stop_reasons(session: AsyncSession = Depends(get_db)):
    stmt = select(DBStopReason)
    res = await session.execute(stmt)
    reasons = res.scalars().all()
    return [{"id": r.id, "code": r.code, "category": r.category, "description": r.description} for r in reasons]
