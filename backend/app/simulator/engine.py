import asyncio
import math
import random
import uuid
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.db_models import DBEvent, DBStation, DBDevice, DBStop, DBAlert, DBAuditLog, DBPolygonZone
from app.ws.manager import ws_manager
from app.rules.engine import rule_engine
from app.calculations.intervals import partition_time_universe
from app.calculations.distance import calculate_trajectory_distance, TrajectoryPoint
from app.calculations.zones import aggregate_zone_metrics

logger = logging.getLogger("factory_pulse.simulator")

class SimulatorEngine:
    def __init__(self):
        self.is_running: bool = False
        self.speed: float = 1.0
        self.current_scene: int = 1
        self.seed: int = 42
        self.sim_time: datetime = datetime.utcnow()
        self.tick_count: int = 0
        self.task: Optional[asyncio.Task] = None
        self.mode: str = "demo" # "demo" | "replay" | "live"
        
        # Operators state (Anonymous ephemeral tracks)
        self.tracks = {
            "TRK-OP1": {"x": 0.17, "y": 0.38, "target_station": "st-1", "name": "Operador SMT", "speed": 0.02, "history": []},
            "TRK-OP2": {"x": 0.39, "y": 0.38, "target_station": "st-2", "name": "Operador Reflow", "speed": 0.02, "history": []},
            "TRK-OP3": {"x": 0.61, "y": 0.38, "target_station": "st-3", "name": "Operador AOI", "speed": 0.02, "history": []},
            "TRK-OP4": {"x": 0.83, "y": 0.38, "target_station": "st-4", "name": "Operador Empaque", "speed": 0.02, "history": []},
            "TRK-MAT": {"x": 0.22, "y": 0.75, "target_station": "zone-storage", "name": "Carro Materialista", "speed": 0.03, "history": []},
        }
        # Layout leído de la base en cada tick: los operadores simulados siguen
        # a las estaciones aunque se edite el plano.
        self.layout: Dict[str, Any] = {"stations": [], "storage": (0.22, 0.78), "rest": (0.55, 0.80), "lines": []}
        self._dt: float = 0.0                  # segundos reales desde el tick anterior
        self._last_tick: Optional[datetime] = None
        self._cycle_acc: Dict[str, float] = {}
        self._cycle_next: Dict[str, float] = {}
        self._cycled: set = set()
        self._scene_stop_id: Optional[str] = None

    @staticmethod
    def _center(poly) -> tuple:
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)

    async def _refresh_layout(self, session: AsyncSession):
        st_res = await session.execute(select(DBStation).order_by(DBStation.line_id, DBStation.order_in_line))
        stations = [
            {"station_id": s.station_id, "line_id": s.line_id, "name": s.name, "x": s.position_x, "y": s.position_y,
             "ideal": max(5.0, s.ideal_cycle_seconds or 45.0)}
            for s in st_res.scalars().all()
        ]
        zones = (await session.execute(select(DBPolygonZone))).scalars().all()
        storage = next((self._center(z.polygon) for z in zones if z.type == "storage"), self.layout["storage"])
        rest = next((self._center(z.polygon) for z in zones if z.type == "rest"), self.layout["rest"])
        self.layout = {"stations": stations, "storage": storage, "rest": rest,
                       "lines": sorted({s["line_id"] for s in stations})}
        self._sync_tracks()

    def _sync_tracks(self):
        """Un operador simulado por estación (TRK-OP1..n) más el materialista."""
        wanted = set()
        for i, st in enumerate(self.layout["stations"]):
            tid = f"TRK-OP{i + 1}"
            wanted.add(tid)
            short = st["name"].split("(")[-1].rstrip(")") if "(" in st["name"] else st["name"]
            if tid not in self.tracks:
                self.tracks[tid] = {"x": st["x"], "y": st["y"], "history": [], "speed": 0.02}
            self.tracks[tid]["target_station"] = st["station_id"]
            self.tracks[tid]["name"] = f"Operador {short}"
        for tid in [t for t in self.tracks if t.startswith("TRK-OP") and t not in wanted]:
            del self.tracks[tid]

    def _station(self, idx: int) -> Optional[Dict[str, Any]]:
        st = self.layout["stations"]
        return st[idx] if 0 <= idx < len(st) else None

    def _move(self, trk: str, x: float, y: float):
        self.tracks[trk]["x"] = round(min(1.0, max(0.0, x)), 4)
        self.tracks[trk]["y"] = round(min(1.0, max(0.0, y)), 4)
        self.tracks[trk]["history"].append((self.tracks[trk]["x"], self.tracks[trk]["y"]))

    @staticmethod
    def _along(points: List[tuple], t: float) -> tuple:
        """Posición en t∈[0,1) sobre una polilínea recorrida a velocidad constante."""
        segs = [(points[i], points[i + 1]) for i in range(len(points) - 1)]
        lens = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in segs]
        d = t * (sum(lens) or 1.0)
        for (a, b), seg_len in zip(segs, lens):
            if d <= seg_len:
                k = d / seg_len if seg_len else 0
                return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)
            d -= seg_len
        return points[-1]

    def start(self, speed: float = 1.0):
        self.speed = speed
        self.is_running = True
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._simulation_loop())
        logger.info(f"Simulator started at speed {self.speed}x")

    def pause(self):
        self.is_running = False
        logger.info("Simulator paused")

    async def reset(self, hard_reset_demo_only: bool = True):
        self.pause()
        self.tick_count = 0
        self.current_scene = 1
        self.sim_time = datetime.utcnow()
        random.seed(self.seed)

        # Regresar a cada operador a su estación del layout actual
        async with AsyncSessionLocal() as layout_session:
            await self._refresh_layout(layout_session)
        for i, st in enumerate(self.layout["stations"]):
            self.tracks[f"TRK-OP{i + 1}"]["x"], self.tracks[f"TRK-OP{i + 1}"]["y"] = st["x"], st["y"]
        self.tracks["TRK-MAT"]["x"], self.tracks["TRK-MAT"]["y"] = self.layout["storage"]

        for k in self.tracks:
            self.tracks[k]["history"] = []

        if hard_reset_demo_only:
            async with AsyncSessionLocal() as session:
                # Delete only events generated in demo mode, NEVER delete live events
                await session.execute(delete(DBEvent).where(DBEvent.mode == "demo"))
                await session.execute(delete(DBAlert).where(DBAlert.rule_id != "system_init"))
                await session.commit()

        await ws_manager.broadcast({
            "type": "SIM_RESET",
            "scene": 1,
            "message": "Simulador reiniciado a Escena 1 (Operación Normal)"
        })
        logger.info("Simulator reset to Scene 1")

    def set_scene(self, scene_number: int):
        self.current_scene = max(1, min(8, scene_number))
        logger.info(f"Simulator scene switched to: {self.current_scene}")

    async def inject_event(self, event_data: Dict[str, Any]):
        """
        Manually inject an event from UI or ESP32 simulator.
        """
        async with AsyncSessionLocal() as session:
            ev = DBEvent(
                event_id=event_data.get("event_id", f"evt-{uuid.uuid4().hex[:10]}"),
                device_id=event_data.get("device_id", "manual-injector"),
                source_id=event_data.get("source_id", "ui_button"),
                occurred_at=datetime.fromisoformat(str(event_data.get("occurred_at", datetime.utcnow().isoformat()))),
                received_at=datetime.utcnow(),
                type=event_data.get("type", "button_press"),
                payload=event_data.get("payload", {}),
                quality=float(event_data.get("quality", 1.0)),
                mode=event_data.get("mode", "live")
            )
            session.add(ev)
            await session.commit()

            # Broadcast immediately
            await ws_manager.broadcast({
                "type": "NEW_EVENT",
                "event": {
                    "event_id": ev.event_id,
                    "device_id": ev.device_id,
                    "type": ev.type,
                    "payload": ev.payload,
                    "occurred_at": ev.occurred_at.isoformat(),
                    "quality": ev.quality,
                    "mode": ev.mode
                }
            })

    async def _simulation_loop(self):
        while self.is_running:
            try:
                self.tick_count += 1
                # Reloj real: así paros, alertas y eventos comparten la misma línea de tiempo.
                now_real = datetime.utcnow()
                self._dt = min(10.0, (now_real - self._last_tick).total_seconds()) if self._last_tick else 0.0
                self._last_tick = now_real
                self.sim_time = now_real
                self._cycled = set()

                async with AsyncSessionLocal() as layout_session:
                    await self._refresh_layout(layout_session)
                
                # Update tracks & produce scene-specific behaviors
                events_to_insert = await self._generate_scene_step()

                async with AsyncSessionLocal() as session:
                    # Persist generated events
                    for ev in events_to_insert:
                        session.add(ev)

                    # Update stations status and parts produced
                    await self._update_stations_state(session)

                    # Update device heartbeats
                    await self._update_devices_state(session)

                    # Escena 6: paro justificado real (queda en el registro de paros)
                    await self._sync_scene_stop(session)

                    await session.commit()

                    # Run alert rules evaluation
                    recent_events_dicts = [{"type": ev.type, "payload": ev.payload} for ev in events_to_insert]
                    zones_res = await session.execute(select(DBPolygonZone))
                    zones_list = [{"zone_id": z.zone_id, "name": z.name, "type": z.type, "polygon": z.polygon, "is_aggregated_only": z.is_aggregated_only} for z in zones_res.scalars().all()]
                    
                    pos_events_dicts = [{"payload": ev.payload, "occurred_at": ev.occurred_at} for ev in events_to_insert if ev.type == "position"]
                    zones_metrics = aggregate_zone_metrics(pos_events_dicts, zones_list)

                    st_res = await session.execute(select(DBStation))
                    stations_dicts = [{"station_id": s.station_id, "name": s.name, "current_status": s.current_status} for s in st_res.scalars().all()]

                    dev_res = await session.execute(select(DBDevice))
                    devices_dicts = [{"device_id": d.device_id, "name": d.name, "status": d.status, "last_heartbeat": d.last_heartbeat, "station_id": d.station_id} for d in dev_res.scalars().all()]

                    distances_dicts = []
                    for trk_id, trk_data in self.tracks.items():
                        hist_pts = [TrajectoryPoint(p[0], p[1], self.sim_time) for p in trk_data["history"][-20:]]
                        d_calc = calculate_trajectory_distance(hist_pts, calibration_scale_meters=40.0)
                        d_calc["track_id"] = trk_id
                        distances_dicts.append(d_calc)

                    new_alerts = await rule_engine.evaluate_rules(
                        session,
                        recent_events_dicts,
                        stations_dicts,
                        zones_metrics,
                        devices_dicts,
                        distances_dicts
                    )
                    await session.commit()

                    # Broadcast tick over WebSocket
                    await ws_manager.broadcast({
                        "type": "SIM_TICK",
                        "tick": self.tick_count,
                        "scene": self.current_scene,
                        "sim_time": self.sim_time.isoformat(),
                        "mode": self.mode,
                        "tracks": {k: {"x": v["x"], "y": v["y"], "name": v["name"]} for k, v in self.tracks.items()},
                        "zones_metrics": zones_metrics,
                        "new_alerts_count": len(new_alerts),
                        "events_emitted_count": len(events_to_insert)
                    })

                # Sleep based on speed multiplier
                sleep_sec = max(0.1, 1.5 / self.speed)
                await asyncio.sleep(sleep_sec)

            except Exception as e:
                logger.error(f"Error in simulation loop: {e}", exc_info=True)
                await asyncio.sleep(2.0)

    async def _generate_scene_step(self) -> List[DBEvent]:
        events: List[DBEvent] = []
        now = self.sim_time

        # --- SCENE LOGIC ---
        # Scene 1: Normal operation
        # Scene 2: Station 2 present but machine stopped -> Espera
        # Scene 3: Station 3 absent -> Ausencia / Desconocido
        # Scene 4: Material shortage -> Materialist excessive travel to warehouse
        # Scene 5: Abnormal flow -> Operator 1 walks into storage/restricted zone
        # Scene 6: Authorized stop in Line 1
        # Scene 7: Sensor ESP32-04 dropped heartbeat (offline)
        # Scene 8: External event injection

        # 1. Movimiento según escena, anclado a las estaciones del layout
        stations = self.layout["stations"]
        storage = self.layout["storage"]
        op = lambda i: f"TRK-OP{i + 1}"

        if self.current_scene == 1:
            for i, st in enumerate(stations):
                self._move(
                    op(i),
                    st["x"] + math.sin(self.tick_count * 0.3 + i) * 0.012,
                    st["y"] + math.cos(self.tick_count * 0.2 + i) * 0.012,
                )

            # El operador de la estación 2 lleva WIP a la siguiente de su línea cada 40 ticks
            s2, s3 = self._station(1), self._station(2)
            if s2 and s3 and s2["line_id"] == s3["line_id"] and self.tick_count % 40 < 10:
                x, y = self._along([(s2["x"], s2["y"]), (s3["x"], s3["y"]), (s2["x"], s2["y"])], (self.tick_count % 40) / 10)
                self.tracks[op(1)]["history"].pop()
                self._move(op(1), x, y)

            # Materialista: almacén → estación 1 → estación 2 → almacén
            route = [storage] + [(st["x"], st["y"] + 0.04) for st in stations[:2]] + [storage]
            x, y = self._along(route, (self.tick_count % 30) / 30.0) if len(route) > 2 else storage
            self._move("TRK-MAT", x, y)

        elif self.current_scene == 2:
            st = self._station(1)
            if st:
                self._move(op(1), st["x"] + math.sin(self.tick_count * 0.1) * 0.005, st["y"] + math.cos(self.tick_count * 0.1) * 0.005)

        elif self.current_scene == 3:
            if self._station(2):
                rx, ry = self.layout["rest"]
                self._move(op(2), rx + math.sin(self.tick_count * 0.2) * 0.02, ry + math.cos(self.tick_count * 0.2) * 0.02)

        elif self.current_scene == 4:
            # Excessive travel: Material cart moving fast across entire plant
            mat_phase = (self.tick_count % 20) / 20.0
            self.tracks["TRK-MAT"]["x"] = round(0.10 + mat_phase * 0.80, 4)
            self.tracks["TRK-MAT"]["y"] = round(0.60 + math.sin(mat_phase * math.pi * 4) * 0.20, 4)
            self.tracks["TRK-MAT"]["history"].append((self.tracks["TRK-MAT"]["x"], self.tracks["TRK-MAT"]["y"]))

        elif self.current_scene == 5:
            # Flujo atípico: el operador 1 entra al almacén
            if self._station(0):
                sx, sy = storage
                self._move(op(0), sx + math.sin(self.tick_count * 0.2) * 0.05, sy + math.cos(self.tick_count * 0.2) * 0.05)

        elif self.current_scene == 6:
            # Authorized stop scene: operators paused
            for trk in self.tracks:
                self.tracks[trk]["history"].append((self.tracks[trk]["x"], self.tracks[trk]["y"]))

        # Emit Position Events
        for trk_id, trk in self.tracks.items():
            ev = DBEvent(
                event_id=f"pos-{trk_id}-{uuid.uuid4().hex[:8]}",
                device_id="cam-overhead-line1",
                source_id="vision_local",
                occurred_at=now,
                received_at=now,
                type="position",
                payload={
                    "x": trk["x"],
                    "y": trk["y"],
                    "track_id": trk_id,
                    "confidence": 0.95,
                    "source": "vision_local",
                    "speed_m_s": round(trk["speed"] * 40.0, 2)
                },
                quality=1.0,
                mode=self.mode
            )
            events.append(ev)

        # Estado de máquina y ciclos por estación (lo que reportaría el sensor de proceso)
        for i, st in enumerate(stations):
            sid = st["station_id"]
            running = not (
                (self.current_scene == 2 and i == 1)
                or (self.current_scene == 3 and i == 2)
                or self.current_scene == 6
            )
            device = f"esp32-line1-{sid}"
            if self.tick_count % 3 == 0:
                events.append(DBEvent(
                    event_id=f"mach-{sid}-{uuid.uuid4().hex[:8]}",
                    device_id=device, source_id="esp32_http", occurred_at=now, received_at=now,
                    type="machine_state",
                    payload={"station_id": sid, "state": "running" if running else "idle"},
                    quality=1.0, mode=self.mode,
                ))
            if not running:
                continue
            self._cycle_acc[sid] = self._cycle_acc.get(sid, 0.0) + self._dt
            target = self._cycle_next.setdefault(sid, st["ideal"] * random.uniform(0.9, 1.25))
            if self._cycle_acc[sid] >= target:
                self._cycle_acc[sid] = 0.0
                self._cycle_next[sid] = st["ideal"] * random.uniform(0.9, 1.25)
                self._cycled.add(sid)
                events.append(DBEvent(
                    event_id=f"cyc-{sid}-{uuid.uuid4().hex[:8]}",
                    device_id=device, source_id="esp32_http", occurred_at=now, received_at=now,
                    type="cycle",
                    payload={"station_id": sid, "cycle_time_seconds": round(target, 1), "is_good_piece": random.random() > 0.03, "total_parts": 1},
                    quality=1.0, mode=self.mode,
                ))

        # Emit Environmental telemetry every 5 ticks
        if self.tick_count % 5 == 0:
            temp = 33.5 if self.current_scene == 5 else round(23.5 + math.sin(self.tick_count * 0.1) * 1.5, 1)
            ev_env = DBEvent(
                event_id=f"env-{uuid.uuid4().hex[:8]}",
                device_id="env-dht22-ambient",
                source_id="mqtt_adapter",
                occurred_at=now,
                received_at=now,
                type="environment",
                payload={
                    "temperature_c": temp,
                    "humidity_pct": 48.0,
                    "co2_ppm": 520.0,
                    "lux": 450.0
                },
                quality=1.0,
                mode=self.mode
            )
            events.append(ev_env)

        return events

    async def _update_stations_state(self, session: AsyncSession):
        st_stmt = select(DBStation)
        st_res = await session.execute(st_stmt)
        stations = st_res.scalars().all()

        idx = {s["station_id"]: i for i, s in enumerate(self.layout["stations"])}
        for st in stations:
            if st.station_id in self._cycled:
                st.parts_produced_shift += 1
            if self.current_scene == 1:
                st.current_status = "active"
            elif self.current_scene == 2 and idx.get(st.station_id) == 1:
                st.current_status = "waiting_material"
            elif self.current_scene == 3 and idx.get(st.station_id) == 2:
                st.current_status = "unattended"
            elif self.current_scene == 6:
                st.current_status = "stopped"
            else:
                st.current_status = "active"

    async def _update_devices_state(self, session: AsyncSession):
        # Solo los nodos de demostración: un ESP32 real nunca recibe latidos inventados.
        dev_stmt = select(DBDevice).where(DBDevice.simulated == True)  # noqa: E712
        dev_res = await session.execute(dev_stmt)
        devices = dev_res.scalars().all()

        for dev in devices:
            if self.current_scene == 7 and dev.device_id == "esp32-line1-st4":
                dev.status = "offline"
            else:
                dev.status = "online"
                dev.last_heartbeat = self.sim_time
                dev.last_latency_ms = round(12.0 + random.random() * 8.0, 1)

    async def _sync_scene_stop(self, session: AsyncSession):
        line_id = (self.layout.get("lines") or ["line-1"])[0]
        if self.current_scene == 6 and not self._scene_stop_id:
            self._scene_stop_id = f"stop-sim-{uuid.uuid4().hex[:8]}"
            session.add(DBStop(
                id=self._scene_stop_id, scope_type="line", scope_id=line_id,
                reason="Junta de seguridad (escena de demo)", reason_code="OPE-01", author="Simulador",
                started_at=self.sim_time, is_authorized=True, status="open",
            ))
            await ws_manager.broadcast({"type": "STOP_UPDATED"})
        elif self.current_scene != 6 and self._scene_stop_id:
            stop = (await session.execute(select(DBStop).where(DBStop.id == self._scene_stop_id))).scalar_one_or_none()
            if stop and stop.status == "open":
                stop.ended_at = self.sim_time
                stop.duration_seconds = (stop.ended_at - stop.started_at).total_seconds()
                stop.status = "closed"
            self._scene_stop_id = None
            await ws_manager.broadcast({"type": "STOP_UPDATED"})

simulator = SimulatorEngine()
