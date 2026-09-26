import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.live.replay import REPLAY_TYPES, replayer
from app.models.db_models import DBEvent, DBRecording
from app.simulator.engine import simulator
from app.ws.manager import ws_manager

router = APIRouter()


class RecordingIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    minutes: int = Field(15, ge=1, le=240)


def _out(r: DBRecording) -> dict:
    return {
        "id": r.id, "name": r.name, "source_mode": r.source_mode, "started_at": r.started_at, "ended_at": r.ended_at,
        "duration_s": (r.ended_at - r.started_at).total_seconds(), "event_count": r.event_count, "created_at": r.created_at,
    }


@router.get("/recordings")
async def list_recordings(session: AsyncSession = Depends(get_db)):
    rows = (await session.execute(select(DBRecording).order_by(DBRecording.created_at.desc()))).scalars().all()
    return {"recordings": [_out(r) for r in rows], "playback": replayer.status()}


@router.post("/recordings", status_code=201)
async def save_recording(body: RecordingIn, session: AsyncSession = Depends(get_db)):
    """Guarda los últimos N minutos del modo actual (demo o en vivo) como respaldo."""
    mode = simulator.mode
    if mode == "replay":
        raise HTTPException(status_code=409, detail="No se puede grabar mientras se reproduce una grabación")
    end = datetime.utcnow()
    start = end - timedelta(minutes=body.minutes)
    count = (
        await session.execute(
            select(func.count(DBEvent.id)).where(DBEvent.mode == mode, DBEvent.occurred_at >= start, DBEvent.occurred_at <= end, DBEvent.type.in_(REPLAY_TYPES))
        )
    ).scalar() or 0
    if count == 0:
        raise HTTPException(status_code=422, detail="No hay eventos en esa ventana para guardar")
    rec = DBRecording(id=f"rec-{uuid.uuid4().hex[:8]}", name=body.name, source_mode=mode, started_at=start, ended_at=end, event_count=count)
    session.add(rec)
    await session.commit()
    return _out(rec)


@router.post("/recordings/{rec_id}/play")
async def play_recording(
    rec_id: str,
    speed: float = Query(1.0, ge=0.25, le=10.0),
    loop: bool = Query(True),
    session: AsyncSession = Depends(get_db),
):
    rec = (await session.execute(select(DBRecording).where(DBRecording.id == rec_id))).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    simulator.pause()
    simulator.mode = "replay"
    await replayer.play(rec, speed=speed, loop=loop)
    await ws_manager.broadcast({"type": "MODE_CHANGED", "mode": "replay"})
    return replayer.status()


@router.delete("/recordings/{rec_id}", status_code=204)
async def delete_recording(rec_id: str, session: AsyncSession = Depends(get_db)):
    rec = (await session.execute(select(DBRecording).where(DBRecording.id == rec_id))).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    if replayer.recording_id == rec_id and replayer.active:
        raise HTTPException(status_code=409, detail="Detén la reproducción antes de eliminarla")
    await session.delete(rec)
    await session.commit()
