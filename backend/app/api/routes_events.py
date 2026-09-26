import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models.db_models import DBEvent
from app.models.schemas import EventIngest, EventResponse
from app.models.domain import EventType, EventMode
from app.ws.manager import ws_manager

router = APIRouter()

@router.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def ingest_event(event_in: EventIngest, session: AsyncSession = Depends(get_db)):
    """
    Ingests a single event with deduplication by event_id.
    Broadcasts new event to all WebSocket clients in real-time.
    """
    # 1. Deduplication check
    stmt = select(DBEvent).where(DBEvent.event_id == event_in.event_id)
    res = await session.execute(stmt)
    existing = res.scalar_one_or_none()
    if existing:
        # Idempotent response: return existing event without double insertion
        return EventResponse(
            id=existing.id,
            event_id=existing.event_id,
            device_id=existing.device_id,
            source_id=existing.source_id,
            occurred_at=existing.occurred_at,
            received_at=existing.received_at,
            type=EventType(existing.type),
            payload=existing.payload,
            quality=existing.quality,
            mode=EventMode(existing.mode)
        )

    db_event = DBEvent(
        event_id=event_in.event_id,
        device_id=event_in.device_id,
        source_id=event_in.source_id or "api_http",
        occurred_at=event_in.occurred_at or datetime.utcnow(),
        received_at=datetime.utcnow(),
        type=event_in.type.value,
        payload=event_in.payload,
        quality=event_in.quality,
        mode=event_in.mode.value
    )
    session.add(db_event)
    await session.commit()
    await session.refresh(db_event)

    # Broadcast via WebSocket
    await ws_manager.broadcast({
        "type": "NEW_EVENT",
        "event": {
            "id": db_event.id,
            "event_id": db_event.event_id,
            "device_id": db_event.device_id,
            "source_id": db_event.source_id,
            "occurred_at": db_event.occurred_at.isoformat(),
            "received_at": db_event.received_at.isoformat(),
            "type": db_event.type,
            "payload": db_event.payload,
            "quality": db_event.quality,
            "mode": db_event.mode
        }
    })

    return EventResponse(
        id=db_event.id,
        event_id=db_event.event_id,
        device_id=db_event.device_id,
        source_id=db_event.source_id,
        occurred_at=db_event.occurred_at,
        received_at=db_event.received_at,
        type=EventType(db_event.type),
        payload=db_event.payload,
        quality=db_event.quality,
        mode=EventMode(db_event.mode)
    )

@router.post("/events/batch", response_model=List[EventResponse])
async def ingest_events_batch(events_in: List[EventIngest], session: AsyncSession = Depends(get_db)):
    """
    Batch event ingestion for camera vision or sensor bursts.
    """
    responses = []
    for ev_in in events_in:
        ev_res = await ingest_event(ev_in, session)
        responses.append(ev_res)
    return responses

@router.get("/events", response_model=List[EventResponse])
async def list_events(
    type: Optional[EventType] = None,
    mode: Optional[EventMode] = None,
    device_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_db)
):
    """
    Retrieves events ordered chronologically (most recent first).
    """
    stmt = select(DBEvent).order_by(desc(DBEvent.occurred_at))
    if type:
        stmt = stmt.where(DBEvent.type == type.value)
    if mode:
        stmt = stmt.where(DBEvent.mode == mode.value)
    if device_id:
        stmt = stmt.where(DBEvent.device_id == device_id)

    stmt = stmt.offset(offset).limit(limit)
    res = await session.execute(stmt)
    events = res.scalars().all()

    return [
        EventResponse(
            id=e.id,
            event_id=e.event_id,
            device_id=e.device_id,
            source_id=e.source_id,
            occurred_at=e.occurred_at,
            received_at=e.received_at,
            type=EventType(e.type),
            payload=e.payload,
            quality=e.quality,
            mode=EventMode(e.mode)
        )
        for e in events
    ]
