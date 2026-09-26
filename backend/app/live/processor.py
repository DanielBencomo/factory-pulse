"""
Procesador de datos reales (modo "live" y "replay").

En demo, el simulador genera posiciones, estados y alertas. Con dispositivos
reales nadie hacía ese trabajo; este ciclo lo cubre:

  cada 1 s   difunde la última posición de cada track (mapa y spaghetti en vivo)
  cada 5 s   deriva el estado de cada estación, evalúa reglas y busca
             discrepancias entre RFID, cámara y CSI
  cada 30 s  detecta visitas repetidas a zonas de apoyo
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select, or_

from app.calculations.analytics import point_in_polygon
from app.calculations.distance import TrajectoryPoint, calculate_trajectory_distance
from app.calculations.zones import aggregate_zone_metrics
from app.database import AsyncSessionLocal
from app.devices.registry import device_status
from app.models.db_models import DBAlert, DBAlertRule, DBDevice, DBEvent, DBFloorPlan, DBPolygonZone, DBStation, DBStop
from app.rules.engine import has_open_alert, rule_engine
from app.ws.manager import ws_manager

logger = logging.getLogger("factory_pulse.live")

POSITION_MAX_AGE = 10.0
PRESENCE_MAX_AGE = 30.0
MACHINE_MAX_AGE = 90.0
CSI_PRESENT = {"actividad", "quietud"}


def _center_in(zone_poly, x, y) -> bool:
    xs = [p[0] for p in zone_poly]
    ys = [p[1] for p in zone_poly]
    return min(xs) <= x <= max(xs) and min(ys) <= y <= max(ys) and point_in_polygon(x, y, zone_poly)


def _station_key(payload: Dict[str, Any], zone_to_station: Dict[str, str]) -> Optional[str]:
    return payload.get("station_id") or zone_to_station.get(payload.get("zone_id", ""))


class LiveProcessor:
    def __init__(self):
        self.task: Optional[asyncio.Task] = None
        self.tick_count = 0
        self._last_eval: Optional[datetime] = None
        self._cooldown: Dict[str, datetime] = {}

    def start(self):
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._loop())

    def stop(self):
        if self.task:
            self.task.cancel()

    async def _loop(self):
        from app.simulator.engine import simulator  # evita import circular

        while True:
            try:
                if simulator.mode in ("live", "replay"):
                    await self.tick(simulator.mode)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # el ciclo nunca debe morir por un dato raro
                logger.error(f"Error en procesador en vivo: {e}", exc_info=True)
            await asyncio.sleep(1.0)

    async def tick(self, mode: str):
        self.tick_count += 1
        now = datetime.utcnow()
        full = self.tick_count % 5 == 0
        window = timedelta(seconds=600 if self.tick_count % 30 == 0 else (120 if full else 12))

        async with AsyncSessionLocal() as session:
            rows = (
                await session.execute(
                    select(DBEvent.occurred_at, DBEvent.type, DBEvent.payload, DBEvent.device_id)
                    .where(DBEvent.mode == mode, DBEvent.occurred_at >= now - window)
                    .order_by(DBEvent.occurred_at)
                )
            ).all()

            positions: Dict[str, List[Tuple[datetime, float, float]]] = {}
            for at, etype, p, _dev in rows:
                if etype == "position" and "track_id" in p:
                    positions.setdefault(p["track_id"], []).append((at, p.get("x", 0.0), p.get("y", 0.0)))

            live_tracks = {
                trk: pts[-1] for trk, pts in positions.items() if (now - pts[-1][0]).total_seconds() <= POSITION_MAX_AGE
            }
            await ws_manager.broadcast({
                "type": "TRACKS",
                "mode": mode,
                "sim_time": now.isoformat(),
                "tracks": {k: {"x": v[1], "y": v[2], "name": k} for k, v in live_tracks.items()},
            })

            if not full:
                return

            zones = (await session.execute(select(DBPolygonZone))).scalars().all()
            stations = (await session.execute(select(DBStation))).scalars().all()
            zone_of = {sid: z for z in zones for sid in (z.station_ids or [])}
            zone_to_station = {z.zone_id: z.station_ids[0] for z in zones if z.station_ids}

            statuses = await self._update_station_status(session, now, rows, stations, zone_of, zone_to_station, live_tracks)
            await self._evaluate_rules(session, now, rows, stations, zones, live_tracks, positions, statuses)
            await self._check_discrepancies(session, now, rows, stations, zone_of, zone_to_station, positions, live_tracks)
            if window.total_seconds() >= 600:
                await self._check_repeated_visits(session, now, zones, positions)
            await session.commit()

    # ── estado de cada estación a partir de eventos reales ──
    async def _update_station_status(self, session, now, rows, stations, zone_of, zone_to_station, live_tracks) -> Dict[str, str]:
        stops = (await session.execute(select(DBStop).where(DBStop.status == "open", DBStop.is_authorized == True))).scalars().all()  # noqa: E712
        presence: Dict[str, Tuple[datetime, bool]] = {}
        machine: Dict[str, Tuple[datetime, str]] = {}
        cycles: Dict[str, datetime] = {}
        for at, etype, p, _dev in rows:
            sid = _station_key(p, zone_to_station)
            if not sid:
                continue
            if etype == "presence":
                present = p.get("state") in CSI_PRESENT if "state" in p else bool(p.get("present"))
                presence[sid] = (at, present)
            elif etype == "machine_state":
                machine[sid] = (at, p.get("state", "idle"))
            elif etype == "cycle":
                cycles[sid] = at

        camera_active = bool(live_tracks)
        out: Dict[str, str] = {}
        for st in stations:
            sid = st.station_id
            zone = zone_of.get(sid)
            stopped = any(
                s.scope_type == "plant" or (s.scope_type == "line" and s.scope_id == st.line_id) or (s.scope_type == "station" and s.scope_id == sid)
                for s in stops
            )
            in_zone = bool(zone) and any(_center_in(zone.polygon, x, y) for _, x, y in live_tracks.values())
            pres = presence.get(sid)
            pres_ok = pres is not None and (now - pres[0]).total_seconds() <= PRESENCE_MAX_AGE
            present = in_zone or (pres_ok and pres[1])
            mach = machine.get(sid)
            running = (mach is not None and (now - mach[0]).total_seconds() <= MACHINE_MAX_AGE and mach[1] == "running") or (
                sid in cycles and (now - cycles[sid]).total_seconds() <= max(2 * (st.ideal_cycle_seconds or 45), 60)
            )
            has_process = mach is not None or sid in cycles

            if stopped:
                status = "stopped"
            elif not camera_active and not pres_ok and not has_process:
                status = "unknown"
            elif not present:
                status = "unattended"
            elif not has_process:
                status = "present"
            else:
                status = "active" if running else "waiting_material"

            if st.current_status != status:
                st.current_status = status
                st.last_event_at = now
            out[sid] = status
        return out

    # ── reglas existentes, ahora también con datos reales ──
    async def _evaluate_rules(self, session, now, rows, stations, zones, live_tracks, positions, statuses):
        since = self._last_eval or now - timedelta(seconds=5)
        self._last_eval = now
        recent = [{"type": t, "payload": p} for at, t, p, _ in rows if at > since and t != "position"]
        zones_list = [{"zone_id": z.zone_id, "name": z.name, "type": z.type, "polygon": z.polygon, "is_aggregated_only": z.is_aggregated_only} for z in zones]
        snapshot = [{"payload": {"x": v[1], "y": v[2], "track_id": k}, "occurred_at": v[0]} for k, v in live_tracks.items()]
        zones_metrics = aggregate_zone_metrics(snapshot, zones_list)
        stations_dicts = [{"station_id": s.station_id, "name": s.name, "current_status": statuses.get(s.station_id, s.current_status)} for s in stations]
        devices = (await session.execute(select(DBDevice).where(DBDevice.simulated == False, DBDevice.is_active == True))).scalars().all()  # noqa: E712
        devices_dicts = [
            {"device_id": d.device_id, "name": d.name, "status": device_status(d, now), "last_heartbeat": d.last_heartbeat, "station_id": d.station_id}
            for d in devices
        ]
        fp = (await session.execute(select(DBFloorPlan))).scalars().first()
        scale = fp.width_meters if fp else 40.0
        distances = []
        for trk, pts in positions.items():
            recent_pts = [TrajectoryPoint(x, y, at) for at, x, y in pts if (now - at).total_seconds() <= 120]
            d = calculate_trajectory_distance(recent_pts, calibration_scale_meters=scale)
            d["track_id"] = trk
            distances.append(d)
        alerts = await rule_engine.evaluate_rules(session, recent, stations_dicts, zones_metrics, devices_dicts, distances)
        if alerts:
            await ws_manager.broadcast({"type": "ALERT_UPDATED", "count": len(alerts)})

    async def _rule(self, session, rule_id: str) -> Optional[DBAlertRule]:
        return (await session.execute(select(DBAlertRule).where(DBAlertRule.rule_id == rule_id, DBAlertRule.enabled == True))).scalar_one_or_none()  # noqa: E712

    async def _raise(self, session, rule: DBAlertRule, key: str, scope_type: str, scope_id: str, title: str, desc: str, evidence: dict, now: datetime):
        last = self._cooldown.get(key)
        if last and (now - last).total_seconds() < rule.cooldown_seconds:
            return
        if await has_open_alert(session, rule.rule_id, scope_id):
            return
        self._cooldown[key] = now
        session.add(DBAlert(
            id=f"alt-{uuid.uuid4().hex[:8]}", rule_id=rule.rule_id, title=title[:128], description=desc[:256],
            severity=rule.severity, status="new", scope_type=scope_type, scope_id=scope_id, triggered_at=now, evidence=evidence,
        ))
        await ws_manager.broadcast({"type": "ALERT_UPDATED"})

    # ── fusión: los sensores deben contar la misma historia ──
    async def _check_discrepancies(self, session, now, rows, stations, zone_of, zone_to_station, positions, live_tracks):
        rule = await self._rule(session, "sensor_discrepancy")
        if not rule or not live_tracks:
            return  # sin cámara activa no hay contra qué comparar
        tol = rule.threshold
        names = {s.station_id: s.name for s in stations}

        def camera_saw(zone, t0: datetime, t1: datetime) -> bool:
            return any(t0 <= at <= t1 and _center_in(zone.polygon, x, y) for pts in positions.values() for at, x, y in pts)

        latest_csi: Dict[str, Tuple[datetime, str]] = {}
        for at, etype, p, dev in rows:
            sid = _station_key(p, zone_to_station)
            zone = zone_of.get(sid) if sid else None
            if not zone:
                continue
            # 1) RFID registró una entrada que la cámara no ve
            if etype == "zone_enter" and p.get("tag_id") and now - timedelta(seconds=60) <= at <= now - timedelta(seconds=tol):
                if not camera_saw(zone, at - timedelta(seconds=tol), at + timedelta(seconds=tol)):
                    await self._raise(
                        session, rule, f"rfid-{sid}", "station", sid,
                        f"RFID sin confirmación de cámara: {names.get(sid, sid)}",
                        f"La tarjeta {p['tag_id']} se leyó en la entrada pero la cámara no vio a nadie en la estación (±{tol:.0f} s).",
                        {"tag_id": p["tag_id"], "station_id": sid, "read_at": at.isoformat()}, now,
                    )
            if etype == "presence" and p.get("source") == "csi" and "state" in p:
                latest_csi[sid] = (at, p["state"])

        for sid, (at, state) in latest_csi.items():
            if (now - at).total_seconds() > PRESENCE_MAX_AGE:
                continue
            zone = zone_of[sid]
            seen_now = camera_saw(zone, now - timedelta(seconds=tol), now)
            # 2) CSI detecta actividad pero la cámara no ve a nadie (posible oclusión)
            if state == "actividad" and not seen_now:
                await self._raise(
                    session, rule, f"csi-act-{sid}", "station", sid,
                    f"Actividad sin persona en cámara: {names.get(sid, sid)}",
                    f"El nodo CSI reporta actividad y la cámara no detecta a nadie en los últimos {tol:.0f} s. Revisa oclusión o ángulo.",
                    {"station_id": sid, "csi_state": state}, now,
                )
            # 3) La cámara ve a alguien de forma sostenida y el CSI dice que no hay nadie
            if state == "sin_presencia" and camera_saw(zone, now - timedelta(seconds=tol * 4), now - timedelta(seconds=tol * 3)) and seen_now:
                await self._raise(
                    session, rule, f"csi-none-{sid}", "station", sid,
                    f"CSI no detecta a quien la cámara sí ve: {names.get(sid, sid)}",
                    "La cámara mantiene un track dentro de la estación y el CSI reporta sin presencia. Recalibra el umbral del nodo.",
                    {"station_id": sid, "csi_state": state}, now,
                )

    async def _check_repeated_visits(self, session, now, zones, positions):
        rule = await self._rule(session, "repeated_visits")
        if not rule:
            return
        since = now - timedelta(seconds=rule.window_seconds)
        support = [z for z in zones if z.type in ("storage", "restricted") and not z.is_aggregated_only]
        for trk, pts in positions.items():
            for z in support:
                inside_prev, entries = False, 0
                for at, x, y in pts:
                    if at < since:
                        continue
                    inside = _center_in(z.polygon, x, y)
                    if inside and not inside_prev:
                        entries += 1
                    inside_prev = inside
                if entries >= rule.threshold:
                    await self._raise(
                        session, rule, f"rep-{trk}-{z.zone_id}", "zone", z.zone_id,
                        f"Visitas repetidas a {z.name}",
                        f"{trk} entró {entries} veces en {rule.window_seconds // 60} min. Puede indicar surtido deficiente o material mal ubicado.",
                        {"track_id": trk, "zone_id": z.zone_id, "entries": entries}, now,
                    )


live_processor = LiveProcessor()
