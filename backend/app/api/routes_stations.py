import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.db_models import DBStation
from app.models.schemas import StationCreate, StationResponse, StationStatus

router = APIRouter()

@router.get("/stations", response_model=List[StationResponse])
async def list_stations(session: AsyncSession = Depends(get_db)):
    stmt = select(DBStation).order_by(DBStation.order_in_line)
    res = await session.execute(stmt)
    stations = res.scalars().all()
    return [
        StationResponse(
            id=s.id,
            station_id=s.station_id,
            line_id=s.line_id,
            name=s.name,
            order_in_line=s.order_in_line,
            ideal_cycle_seconds=s.ideal_cycle_seconds,
            position_x=s.position_x,
            position_y=s.position_y,
            current_status=StationStatus(s.current_status),
            current_worker_track_id=s.current_worker_track_id,
            target_pieces_per_hour=s.target_pieces_per_hour,
            last_event_at=s.last_event_at,
            last_cycle_time=s.last_cycle_time,
            parts_produced_shift=s.parts_produced_shift
        )
        for s in stations
    ]

@router.put("/stations/{station_id}/status", response_model=StationResponse)
async def update_station_status(station_id: str, new_status: StationStatus, session: AsyncSession = Depends(get_db)):
    stmt = select(DBStation).where(DBStation.station_id == station_id)
    res = await session.execute(stmt)
    st = res.scalar_one_or_none()
    if not st:
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    
    st.current_status = new_status.value
    st.last_event_at = datetime.utcnow()
    await session.commit()
    await session.refresh(st)

    return StationResponse(
        id=st.id,
        station_id=st.station_id,
        line_id=st.line_id,
        name=st.name,
        order_in_line=st.order_in_line,
        ideal_cycle_seconds=st.ideal_cycle_seconds,
        position_x=st.position_x,
        position_y=st.position_y,
        current_status=StationStatus(st.current_status),
        current_worker_track_id=st.current_worker_track_id,
        target_pieces_per_hour=st.target_pieces_per_hour,
        last_event_at=st.last_event_at,
        last_cycle_time=st.last_cycle_time,
        parts_produced_shift=st.parts_produced_shift
    )
