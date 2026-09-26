import uuid
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models.db_models import DBAlert, DBAlertRule, DBEvent, DBStation, DBDevice
from app.models.domain import AlertSeverity, AlertStatus

async def has_open_alert(session: AsyncSession, rule_id: str, scope_id: Optional[str]) -> bool:
    stmt = select(DBAlert.id).where(
        DBAlert.rule_id == rule_id,
        DBAlert.scope_id == scope_id,
        DBAlert.status != "resolved",
    ).limit(1)
    return (await session.execute(stmt)).first() is not None


class RuleEngine:
    def __init__(self):
        self.last_triggered: Dict[str, datetime] = {}

    async def evaluate_rules(
        self,
        session: AsyncSession,
        recent_events: List[Dict[str, Any]],
        stations_state: List[Dict[str, Any]],
        zones_state: List[Dict[str, Any]],
        devices_state: List[Dict[str, Any]],
        distances_state: List[Dict[str, Any]]
    ) -> List[DBAlert]:
        """
        Evaluates active rules and triggers new alerts if thresholds are breached and cooldown elapsed.
        """
        stmt = select(DBAlertRule).where(DBAlertRule.enabled == True)
        res = await session.execute(stmt)
        rules = res.scalars().all()

        now = datetime.utcnow()
        created_alerts = []

        for rule in rules:
            cooldown = timedelta(seconds=rule.cooldown_seconds)
            rule_key = f"{rule.rule_id}_{rule.scope_id or 'global'}"
            last_time = self.last_triggered.get(rule_key)
            if last_time and (now - last_time) < cooldown:
                continue

            alert_triggered = False
            title = ""
            desc = ""
            evidence = {}
            severity = rule.severity
            scope_type = rule.scope_type
            scope_id = rule.scope_id

            # 1. Excessive travel rule
            if rule.rule_type == "excessive_travel":
                for dist in distances_state:
                    dist_val = dist.get("calibrated_meters") or (dist.get("raw_distance_norm", 0) * 40.0)
                    if dist_val > rule.threshold:
                        alert_triggered = True
                        title = f"Recorrido Excesivo: {dist.get('track_id')}"
                        desc = f"El operador/carro {dist.get('track_id')} acumuló {dist_val:.1f} m en la ventana de evaluación (Umbral: {rule.threshold} m)."
                        evidence = {"track_id": dist.get("track_id"), "distance_meters": dist_val, "threshold": rule.threshold}
                        scope_type = "line"
                        scope_id = "line-1"
                        break

            # 2. Abnormal dwell in zone
            elif rule.rule_type == "abnormal_dwell":
                for zone in zones_state:
                    if zone.get("zone_type") in ["transit", "storage"] and zone.get("total_dwell_seconds", 0) > rule.threshold:
                        alert_triggered = True
                        title = f"Permanencia Anormal en {zone.get('zone_name')}"
                        desc = f"Se detectó permanencia acumulada de {zone.get('total_dwell_seconds', 0):.0f} s (Umbral: {rule.threshold} s)."
                        evidence = {"zone_id": zone.get("zone_id"), "dwell_sec": zone.get("total_dwell_seconds"), "threshold": rule.threshold}
                        scope_type = "zone"
                        scope_id = zone.get("zone_id")
                        break

            # 3. Bottleneck / Queue
            elif rule.rule_type == "bottleneck":
                for zone in zones_state:
                    if zone.get("occupancy_count", 0) >= int(rule.threshold):
                        alert_triggered = True
                        title = f"Cuello de Botella en {zone.get('zone_name')}"
                        desc = f"Ocupación anormal de {zone.get('occupancy_count')} personas/órdenes simultáneas (Límite: {int(rule.threshold)})."
                        evidence = {"zone_id": zone.get("zone_id"), "occupancy": zone.get("occupancy_count"), "threshold": rule.threshold}
                        scope_type = "zone"
                        scope_id = zone.get("zone_id")
                        break

            # 4. Unattended station
            elif rule.rule_type == "unattended_station":
                for st in stations_state:
                    if st.get("current_status") == "unattended":
                        alert_triggered = True
                        title = f"Estación Desatendida: {st.get('name')}"
                        desc = f"La estación {st.get('name')} no reporta presencia confiable mientras hay flujo de producción activo."
                        evidence = {"station_id": st.get("station_id"), "status": "unattended"}
                        scope_type = "station"
                        scope_id = st.get("station_id")
                        break

            # 5. Machine stopped / waiting with worker present
            elif rule.rule_type == "machine_stopped":
                for st in stations_state:
                    if st.get("current_status") == "waiting_material":
                        alert_triggered = True
                        title = f"Máquina Inactiva con Operador Presente: {st.get('name')}"
                        desc = f"Operador presente en {st.get('name')} pero la estación se encuentra en espera sin ciclo productivo."
                        evidence = {"station_id": st.get("station_id"), "status": "waiting_material"}
                        scope_type = "station"
                        scope_id = st.get("station_id")
                        break

            # 6. Sensor disconnected / no heartbeat
            elif rule.rule_type == "sensor_disconnected":
                for dev in devices_state:
                    if dev.get("status") == "offline":
                        alert_triggered = True
                        title = f"Sensor Desconectado: {dev.get('name')}"
                        desc = f"El dispositivo {dev.get('device_id')} no ha emitido señal en el tiempo de tolerancia ({rule.threshold} s)."
                        evidence = {"device_id": dev.get("device_id"), "last_heartbeat": dev.get("last_heartbeat")}
                        scope_type = "station"
                        scope_id = dev.get("station_id") or "line-1"
                        break

            # 7. Environment out of bounds
            elif rule.rule_type == "environment_out_of_bounds":
                for ev in recent_events:
                    if ev.get("type") == "environment":
                        p = ev.get("payload", {})
                        temp = p.get("temperature_c", 22.0)
                        if temp > rule.threshold:
                            alert_triggered = True
                            title = f"Temperatura Alta en Línea: {temp:.1f}°C"
                            desc = f"Sensor ambiental detectó {temp:.1f}°C excediendo el límite de {rule.threshold:.1f}°C."
                            evidence = {"temperature_c": temp, "threshold": rule.threshold, "humidity": p.get("humidity_pct")}
                            scope_type = "line"
                            scope_id = "line-1"
                            break

            # 8. Material missing
            elif rule.rule_type == "material_missing":
                for ev in recent_events:
                    if ev.get("type") == "button_press" and ev.get("payload", {}).get("action") == "request_material":
                        alert_triggered = True
                        title = "Andon: Solicitud Urgente de Material"
                        desc = f"Operador en estación {ev.get('payload', {}).get('station_id', 'st-2')} activó llamada por falta de componentes."
                        evidence = ev.get("payload", {})
                        scope_type = "station"
                        scope_id = ev.get("payload", {}).get("station_id", "st-2")
                        break

            if alert_triggered:
                self.last_triggered[rule_key] = now
                # Una condición que persiste no debe generar una alerta nueva cada enfriamiento:
                # si ya hay una igual sin resolver, se deja esa.
                if await has_open_alert(session, rule.rule_id, scope_id):
                    continue
                alert = DBAlert(
                    id=f"alt-{uuid.uuid4().hex[:8]}",
                    rule_id=rule.rule_id,
                    title=title,
                    description=desc,
                    severity=severity,
                    status="new",
                    scope_type=scope_type,
                    scope_id=scope_id,
                    triggered_at=now,
                    evidence=evidence
                )
                session.add(alert)
                created_alerts.append(alert)

        return created_alerts

rule_engine = RuleEngine()
