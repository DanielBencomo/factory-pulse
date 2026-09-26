"""
Reproducción de grabaciones (plan B de la demo).

Copia los eventos de un tramo guardado respetando sus tiempos relativos, con la
hora actual y en modo "replay". Así el mapa, las reglas y la analítica se ven
igual que en vivo, pero sin mezclarse con datos reales ni con los del simulador.
"""
import asyncio
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.db_models import DBEvent, DBRecording
from app.ws.manager import ws_manager

logger = logging.getLogger("factory_pulse.replay")

REPLAY_TYPES = ["position", "presence", "machine_state", "cycle", "zone_enter", "zone_exit", "button_press", "environment"]


class Replayer:
    def __init__(self):
        self.task: Optional[asyncio.Task] = None
        self.recording_id: Optional[str] = None
        self.recording_name: Optional[str] = None
        self.speed: float = 1.0
        self.loop: bool = True
        self.progress: float = 0.0

    @property
    def active(self) -> bool:
        return self.task is not None and not self.task.done()

    def status(self) -> dict:
        return {
            "active": self.active,
            "recording_id": self.recording_id,
            "name": self.recording_name,
            "speed": self.speed,
            "loop": self.loop,
            "progress": round(self.progress, 3),
        }

    async def play(self, recording: DBRecording, speed: float = 1.0, loop: bool = True):
        self.stop()
        self.recording_id, self.recording_name = recording.id, recording.name
        self.speed, self.loop, self.progress = speed, loop, 0.0
        self.task = asyncio.create_task(self._run(recording.id, recording.source_mode, recording.started_at, recording.ended_at))

    def stop(self):
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None

    async def _run(self, rec_id: str, source_mode: str, start: datetime, end: datetime):
        async with AsyncSessionLocal() as session:
            events = (
                await session.execute(
                    select(DBEvent)
                    .where(DBEvent.mode == source_mode, DBEvent.occurred_at >= start, DBEvent.occurred_at <= end, DBEvent.type.in_(REPLAY_TYPES))
                    .order_by(DBEvent.occurred_at)
                )
            ).scalars().all()
            events = [(e.occurred_at, e.type, e.payload, e.device_id, e.source_id, e.quality) for e in events]
        if not events:
            logger.warning(f"Grabación {rec_id} sin eventos")
            return
        span = max(1.0, (events[-1][0] - events[0][0]).total_seconds())

        while True:
            t0 = events[0][0]
            wall0 = asyncio.get_event_loop().time()
            i = 0
            while i < len(events):
                elapsed = (asyncio.get_event_loop().time() - wall0) * self.speed
                batch = []
                while i < len(events) and (events[i][0] - t0).total_seconds() <= elapsed:
                    batch.append(events[i])
                    i += 1
                if batch:
                    now = datetime.utcnow()
                    async with AsyncSessionLocal() as session:
                        for _, etype, payload, dev, src, q in batch:
                            session.add(DBEvent(
                                event_id=f"rp-{uuid.uuid4().hex[:12]}", device_id=dev, source_id=f"replay:{src or ''}"[:64],
                                occurred_at=now, received_at=now, type=etype, payload=payload, quality=q, mode="replay",
                            ))
                        await session.commit()
                    if any(b[1] != "position" for b in batch):
                        await ws_manager.broadcast({"type": "NEW_EVENT", "source": "replay"})
                self.progress = min(1.0, elapsed / span)
                await asyncio.sleep(0.2)
            if not self.loop:
                self.progress = 1.0
                return


replayer = Replayer()
