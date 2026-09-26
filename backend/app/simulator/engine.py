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

        # Reset operator positions
        self.tracks["TRK-OP1"]["x"], self.tracks["TRK-OP1"]["y"] = 0.17, 0.38
        self.tracks["TRK-OP2"]["x"], self.tracks["TRK-OP2"]["y"] = 0.39, 0.38
        self.tracks["TRK-OP3"]["x"], self.tracks["TRK-OP3"]["y"] = 0.61, 0.38
        self.tracks["TRK-OP4"]["x"], self.tracks["TRK-OP4"]["y"] = 0.83, 0.38
        self.tracks["TRK-MAT"]["x"], self.tracks["TRK-MAT"]["y"] = 0.22, 0.75

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
                self.sim_time += timedelta(seconds=2)
                
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

        # 1. Update Positions with realistic movement
        if self.current_scene == 1:
            # Subtle natural breathing movement around stations
            for i, trk in enumerate(["TRK-OP1", "TRK-OP2", "TRK-OP3", "TRK-OP4"]):
                base_x = 0.17 + (i * 0.22)
                base_y = 0.38
                noise_x = math.sin(self.tick_count * 0.3 + i) * 0.015
                noise_y = math.cos(self.tick_count * 0.2 + i) * 0.015
                self.tracks[trk]["x"] = round(base_x + noise_x, 4)
                self.tracks[trk]["y"] = round(base_y + noise_y, 4)
                self.tracks[trk]["history"].append((self.tracks[trk]["x"], self.tracks[trk]["y"]))

            # Materialist moving back and forth between storage and stations
            mat_t = (self.tick_count % 30) / 30.0
            if mat_t < 0.5:
                # Storage to Station 1 & 2
                self.tracks["TRK-MAT"]["x"] = round(0.20 + (mat_t * 2) * 0.25, 4)
                self.tracks["TRK-MAT"]["y"] = round(0.75 - (mat_t * 2) * 0.25, 4)
            else:
                # Return to storage
                self.tracks["TRK-MAT"]["x"] = round(0.45 - ((mat_t - 0.5) * 2) * 0.25, 4)
                self.tracks["TRK-MAT"]["y"] = round(0.50 + ((mat_t - 0.5) * 2) * 0.25, 4)
            self.tracks["TRK-MAT"]["history"].append((self.tracks["TRK-MAT"]["x"], self.tracks["TRK-MAT"]["y"]))

        elif self.current_scene == 2:
            # Station 2 present but machine stopped
            self.tracks["TRK-OP2"]["x"] = 0.39 + math.sin(self.tick_count * 0.1) * 0.005
            self.tracks["TRK-OP2"]["y"] = 0.38 + math.cos(self.tick_count * 0.1) * 0.005
            self.tracks["TRK-OP2"]["history"].append((self.tracks["TRK-OP2"]["x"], self.tracks["TRK-OP2"]["y"]))

        elif self.current_scene == 3:
            # Operator 3 left station to rest / hallway
            self.tracks["TRK-OP3"]["x"] = 0.55 + math.sin(self.tick_count * 0.2) * 0.02
            self.tracks["TRK-OP3"]["y"] = 0.80 + math.cos(self.tick_count * 0.2) * 0.02
            self.tracks["TRK-OP3"]["history"].append((self.tracks["TRK-OP3"]["x"], self.tracks["TRK-OP3"]["y"]))

        elif self.current_scene == 4:
            # Excessive travel: Material cart moving fast across entire plant
            mat_phase = (self.tick_count % 20) / 20.0
            self.tracks["TRK-MAT"]["x"] = round(0.10 + mat_phase * 0.80, 4)
            self.tracks["TRK-MAT"]["y"] = round(0.60 + math.sin(mat_phase * math.pi * 4) * 0.20, 4)
            self.tracks["TRK-MAT"]["history"].append((self.tracks["TRK-MAT"]["x"], self.tracks["TRK-MAT"]["y"]))

        elif self.current_scene == 5:
            # Abnormal flow: Operator 1 enters restricted storage area
            self.tracks["TRK-OP1"]["x"] = 0.25 + math.sin(self.tick_count * 0.2) * 0.05
            self.tracks["TRK-OP1"]["y"] = 0.78 + math.cos(self.tick_count * 0.2) * 0.05
            self.tracks["TRK-OP1"]["history"].append((self.tracks["TRK-OP1"]["x"], self.tracks["TRK-OP1"]["y"]))

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

        # Emit Machine Cycles & States
        if self.tick_count % 3 == 0:
            st2_state = "idle" if self.current_scene == 2 else "running"
            st3_state = "idle" if self.current_scene == 3 else "running"

            ev_mach = DBEvent(
                event_id=f"mach-st2-{uuid.uuid4().hex[:8]}",
                device_id="esp32-line1-st2",
                source_id="esp32_http",
                occurred_at=now,
                received_at=now,
                type="machine_state",
                payload={
                    "station_id": "st-2",
                    "state": st2_state,
                    "current_cycle_seconds": 45.0 if st2_state == "running" else 0.0,
                    "parts_count": 1
                },
                quality=1.0,
                mode=self.mode
            )
            events.append(ev_mach)

            if st2_state == "running":
                ev_cyc = DBEvent(
                    event_id=f"cyc-st2-{uuid.uuid4().hex[:8]}",
                    device_id="esp32-line1-st2",
                    source_id="esp32_http",
                    occurred_at=now,
                    received_at=now,
                    type="cycle",
                    payload={
                        "station_id": "st-2",
                        "cycle_time_seconds": 44.2,
                        "is_good_piece": True,
                        "total_parts": 1
                    },
                    quality=1.0,
                    mode=self.mode
                )
                events.append(ev_cyc)

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

        for st in stations:
            if self.current_scene == 1:
                st.current_status = "active"
                if self.tick_count % 5 == 0:
                    st.parts_produced_shift += 1
            elif self.current_scene == 2 and st.station_id == "st-2":
                st.current_status = "waiting_material"
            elif self.current_scene == 3 and st.station_id == "st-3":
                st.current_status = "unattended"
            elif self.current_scene == 6:
                st.current_status = "stopped"
            else:
                st.current_status = "active"

    async def _update_devices_state(self, session: AsyncSession):
        dev_stmt = select(DBDevice)
        dev_res = await session.execute(dev_stmt)
        devices = dev_res.scalars().all()

        for dev in devices:
            if self.current_scene == 7 and dev.device_id == "esp32-line1-st4":
                dev.status = "offline"
            else:
                dev.status = "online"
                dev.last_heartbeat = self.sim_time
                dev.last_latency_ms = round(12.0 + random.random() * 8.0, 1)

simulator = SimulatorEngine()
