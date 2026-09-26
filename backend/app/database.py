import os
import uuid
from datetime import datetime, timedelta
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text

from app.config import settings
from app.models.db_models import (
    Base, DBFloorPlan, DBLine, DBPolygonZone, DBStation, DBDevice,
    DBStopReason, DBAlertRule, DBDashboard, DBAuditLog
)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

# Columnas agregadas después de la primera versión. create_all no altera tablas
# existentes, así que se agregan aquí de forma idempotente (solo SQLite).
_ADDED_COLUMNS = [
    ("polygon_zones", "line_id", "VARCHAR(64)"),
    ("stations", "equipment_type", "VARCHAR(32)"),
    ("polygon_zones", "interior", "JSON"),
    ("devices", "simulated", "BOOLEAN DEFAULT 0"),
]

async def _migrate_columns(conn):
    if "sqlite" not in settings.DATABASE_URL:
        return
    for table, column, ddl in _ADDED_COLUMNS:
        cols = (await conn.execute(text(f"PRAGMA table_info({table})"))).fetchall()
        if cols and column not in {c[1] for c in cols}:
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))

def _equipment_from_name(name: str) -> str:
    n = name.lower()
    for key, kind in (("smt", "smt"), ("reflow", "reflow"), ("reflujo", "reflow"), ("aoi", "aoi"), ("empaque", "pack")):
        if key in n:
            return kind
    return "generic"

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_columns(conn)
    
    # Run idempotent default seeding
    async with AsyncSessionLocal() as session:
        await seed_default_data(session)
        await session.commit()

async def seed_default_data(session: AsyncSession):
    # 1. Floor Plan
    stmt = select(DBFloorPlan).where(DBFloorPlan.id == "fp-main")
    res = await session.execute(stmt)
    if not res.scalar_one_or_none():
        fp = DBFloorPlan(
            id="fp-main",
            name="Línea 1 - Ensamble Electrónico (Maquiladora)",
            description="Línea de producción principal con 4 estaciones de trabajo, almacenamiento, pasillos y sanitarios",
            width_meters=40.0,
            height_meters=25.0,
            calibration={
                "is_calibrated": True,
                "point1": [0.05, 0.5],
                "point2": [0.95, 0.5],
                "real_distance_meters": 36.0,
                "meters_per_norm_unit": 40.0
            }
        )
        session.add(fp)

    # 1b. Línea de producción por defecto
    if not (await session.execute(select(DBLine).where(DBLine.id == "line-1"))).scalar_one_or_none():
        session.add(DBLine(id="line-1", floor_plan_id="fp-main", name="Línea 1", order=1, polygon=None))

    # 2. Polygon Zones
    zones_data = [
        {
            "id": "zone-ws1",
            "zone_id": "zone-ws1",
            "floor_plan_id": "fp-main",
            "name": "Estación 1 - Inserción SMT",
            "type": "work",
            "polygon": [[0.08, 0.20], [0.26, 0.20], [0.26, 0.55], [0.08, 0.55]],
            "color": "#3b82f6",
            "station_ids": ["st-1"],
            "line_id": "line-1",
            "max_stay_seconds": 600,
            "is_aggregated_only": False
        },
        {
            "id": "zone-ws2",
            "zone_id": "zone-ws2",
            "floor_plan_id": "fp-main",
            "name": "Estación 2 - Soldadura Reflujo",
            "type": "work",
            "polygon": [[0.30, 0.20], [0.48, 0.20], [0.48, 0.55], [0.30, 0.55]],
            "color": "#10b981",
            "station_ids": ["st-2"],
            "line_id": "line-1",
            "max_stay_seconds": 600,
            "is_aggregated_only": False
        },
        {
            "id": "zone-ws3",
            "zone_id": "zone-ws3",
            "floor_plan_id": "fp-main",
            "name": "Estación 3 - Inspección Óptica AOI",
            "type": "work",
            "polygon": [[0.52, 0.20], [0.70, 0.20], [0.70, 0.55], [0.52, 0.55]],
            "color": "#8b5cf6",
            "station_ids": ["st-3"],
            "line_id": "line-1",
            "max_stay_seconds": 600,
            "is_aggregated_only": False
        },
        {
            "id": "zone-ws4",
            "zone_id": "zone-ws4",
            "floor_plan_id": "fp-main",
            "name": "Estación 4 - Empaque y Test Final",
            "type": "work",
            "polygon": [[0.74, 0.20], [0.92, 0.20], [0.92, 0.55], [0.74, 0.55]],
            "color": "#f59e0b",
            "station_ids": ["st-4"],
            "line_id": "line-1",
            "max_stay_seconds": 600,
            "is_aggregated_only": False
        },
        {
            "id": "zone-storage",
            "zone_id": "zone-storage",
            "floor_plan_id": "fp-main",
            "name": "Almacén de Materia Prima / Componentes",
            "type": "storage",
            "polygon": [[0.08, 0.65], [0.38, 0.65], [0.38, 0.92], [0.08, 0.92]],
            "color": "#6366f1",
            "station_ids": [],
            "max_stay_seconds": 180,
            "is_aggregated_only": False
        },
        {
            "id": "zone-transit",
            "zone_id": "zone-transit",
            "floor_plan_id": "fp-main",
            "name": "Pasillo Principal de Tránsito",
            "type": "transit",
            "polygon": [[0.05, 0.56], [0.95, 0.56], [0.95, 0.64], [0.05, 0.64]],
            "color": "#64748b",
            "station_ids": [],
            "max_stay_seconds": 60,
            "is_aggregated_only": False
        },
        {
            "id": "zone-rest",
            "zone_id": "zone-rest",
            "floor_plan_id": "fp-main",
            "name": "Área de Descanso / Hidratación",
            "type": "rest",
            "polygon": [[0.44, 0.68], [0.66, 0.68], [0.66, 0.92], [0.44, 0.92]],
            "color": "#06b6d4",
            "station_ids": [],
            "max_stay_seconds": 900,
            "is_aggregated_only": False
        },
        {
            "id": "zone-bathroom",
            "zone_id": "zone-bathroom",
            "floor_plan_id": "fp-main",
            "name": "Acceso a Sanitarios (Agregado Anónimo)",
            "type": "bathroom",
            "polygon": [[0.74, 0.68], [0.92, 0.68], [0.92, 0.92], [0.74, 0.92]],
            "color": "#ec4899",
            "station_ids": [],
            "max_stay_seconds": 600,
            "is_aggregated_only": True # Privacy-first aggregate
        }
    ]
    for zd in zones_data:
        stmt = select(DBPolygonZone).where(DBPolygonZone.id == zd["id"])
        res = await session.execute(stmt)
        if not res.scalar_one_or_none():
            session.add(DBPolygonZone(**zd))

    # 3. Stations
    stations_data = [
        {"id": "st-1", "station_id": "st-1", "line_id": "line-1", "name": "Estación 1 (SMT)", "order_in_line": 1, "ideal_cycle_seconds": 40.0, "position_x": 0.17, "position_y": 0.38, "target_pieces_per_hour": 75, "equipment_type": "smt"},
        {"id": "st-2", "station_id": "st-2", "line_id": "line-1", "name": "Estación 2 (Reflow)", "order_in_line": 2, "ideal_cycle_seconds": 45.0, "position_x": 0.39, "position_y": 0.38, "target_pieces_per_hour": 65, "equipment_type": "reflow"},
        {"id": "st-3", "station_id": "st-3", "line_id": "line-1", "name": "Estación 3 (AOI)", "order_in_line": 3, "ideal_cycle_seconds": 35.0, "position_x": 0.61, "position_y": 0.38, "target_pieces_per_hour": 80, "equipment_type": "aoi"},
        {"id": "st-4", "station_id": "st-4", "line_id": "line-1", "name": "Estación 4 (Empaque)", "order_in_line": 4, "ideal_cycle_seconds": 50.0, "position_x": 0.83, "position_y": 0.38, "target_pieces_per_hour": 60, "equipment_type": "pack"},
    ]
    for st in stations_data:
        stmt = select(DBStation).where(DBStation.id == st["id"])
        res = await session.execute(stmt)
        if not res.scalar_one_or_none():
            session.add(DBStation(**st))

    # 3b. Rellenar campos nuevos en bases creadas antes de que existieran
    await session.flush()
    for st in (await session.execute(select(DBStation))).scalars().all():
        if not st.equipment_type:
            st.equipment_type = _equipment_from_name(st.name)
    st_lines = {st.station_id: st.line_id for st in (await session.execute(select(DBStation))).scalars().all()}
    for z in (await session.execute(select(DBPolygonZone))).scalars().all():
        if z.line_id is None and z.station_ids:
            z.line_id = st_lines.get(z.station_ids[0])

    # 4. Devices (nodos de demostración: los alimenta el simulador)
    devices_data = [
        {"id": "dev-esp32-01", "device_id": "esp32-line1-st1", "name": "ESP32 Nodo Estación 1 (Botón & ToF)", "type": "esp32", "station_id": "st-1", "zone_id": "zone-ws1", "ingest_mode": "http", "status": "online", "simulated": True},
        {"id": "dev-esp32-02", "device_id": "esp32-line1-st2", "name": "ESP32 Nodo Estación 2 (Corriente/Ciclo)", "type": "esp32", "station_id": "st-2", "zone_id": "zone-ws2", "ingest_mode": "http", "status": "online", "simulated": True},
        {"id": "dev-esp32-03", "device_id": "esp32-line1-st3", "name": "ESP32 Nodo Estación 3 (PIR Presencia)", "type": "esp32", "station_id": "st-3", "zone_id": "zone-ws3", "ingest_mode": "mqtt", "status": "online", "simulated": True},
        {"id": "dev-esp32-04", "device_id": "esp32-line1-st4", "name": "ESP32 Nodo Estación 4 (Andon/Empaque)", "type": "esp32", "station_id": "st-4", "zone_id": "zone-ws4", "ingest_mode": "http", "status": "online", "simulated": True},
        {"id": "dev-cam-01", "device_id": "cam-overhead-line1", "name": "Cámara Cenital Visión Local (OpenCV)", "type": "camera_vision", "station_id": None, "zone_id": "zone-transit", "ingest_mode": "http", "status": "online", "simulated": True},
        {"id": "dev-env-01", "device_id": "env-dht22-ambient", "name": "ESP32 Sensor Ambiental (DHT22)", "type": "esp32", "station_id": "st-2", "zone_id": "zone-ws2", "ingest_mode": "mqtt", "status": "online", "simulated": True}
    ]
    for dev in devices_data:
        stmt = select(DBDevice).where(DBDevice.id == dev["id"])
        res = await session.execute(stmt)
        existing = res.scalar_one_or_none()
        if not existing:
            session.add(DBDevice(**dev))
        elif not existing.simulated:
            existing.simulated = True  # bases creadas antes de la columna

    # 5. Stop Reasons Catalog
    stop_reasons = [
        {"id": "sr-1", "code": "MAN-01", "category": "Mantenimiento", "description": "Mantenimiento preventivo programado", "is_authorized_by_default": True},
        {"id": "sr-2", "code": "MAN-02", "category": "Mantenimiento", "description": "Falla mecánica o eléctrica imprevista", "is_authorized_by_default": True},
        {"id": "sr-3", "code": "MAT-01", "category": "Material", "description": "Falta de componentes en estación", "is_authorized_by_default": True},
        {"id": "sr-4", "code": "MAT-02", "category": "Material", "description": "Espera de lote / liberación de almacén", "is_authorized_by_default": True},
        {"id": "sr-5", "code": "CAL-01", "category": "Calidad", "description": "Ajuste de parámetros por defecto de soldadura", "is_authorized_by_default": True},
        {"id": "sr-6", "code": "OPE-01", "category": "Planificado", "description": "Cambio de turno o junta de seguridad de 5 minutos", "is_authorized_by_default": True},
        {"id": "sr-7", "code": "OPE-02", "category": "Planificado", "description": "Comedor o receso programado", "is_authorized_by_default": True},
        # Causas que pide el documento del hackathon
        {"id": "sr-8", "code": "MOD-01", "category": "Cambio de modelo", "description": "Cambio de modelo / set-up", "is_authorized_by_default": True},
        {"id": "sr-9", "code": "BRK-01", "category": "Planificado", "description": "Break programado", "is_authorized_by_default": True},
        {"id": "sr-10", "code": "OTR-01", "category": "Otro", "description": "Otro (describir en notas)", "is_authorized_by_default": True},
        {"id": "sr-11", "code": "PEND-01", "category": "Pendiente", "description": "Paro por pulsador · pendiente de causa", "is_authorized_by_default": False},
    ]
    for sr in stop_reasons:
        stmt = select(DBStopReason).where(DBStopReason.id == sr["id"])
        res = await session.execute(stmt)
        if not res.scalar_one_or_none():
            session.add(DBStopReason(**sr))

    # 6. Alert Rules
    alert_rules = [
        {"id": "rule-travel", "rule_id": "excessive_travel", "name": "Recorrido Excesivo de Operador", "rule_type": "excessive_travel", "threshold": 25.0, "window_seconds": 120, "severity": "warning", "enabled": True, "cooldown_seconds": 90, "description": "Alerta cuando la distancia recorrida en 2 min supera el umbral esperado para el puesto"},
        {"id": "rule-dwell", "rule_id": "abnormal_dwell", "name": "Permanencia Anormal en Almacén/Pasillo", "rule_type": "abnormal_dwell", "threshold": 180.0, "window_seconds": 180, "severity": "warning", "enabled": True, "cooldown_seconds": 120, "description": "Operador permanece más del tiempo límite en zona de tránsito o almacén"},
        {"id": "rule-atypical", "rule_id": "atypical_flow", "name": "Cruce o Flujo Atípico de Proceso", "rule_type": "atypical_flow", "threshold": 1.0, "window_seconds": 60, "severity": "warning", "enabled": True, "cooldown_seconds": 60, "description": "Salto o movimiento que evade la secuencia natural de estaciones"},
        {"id": "rule-bottleneck", "rule_id": "bottleneck", "name": "Cuello de Botella / Cola de Espera", "rule_type": "bottleneck", "threshold": 3.0, "window_seconds": 90, "severity": "critical", "enabled": True, "cooldown_seconds": 120, "description": "Acumulación de más de 3 personas u órdenes en una estación"},
        {"id": "rule-unattended", "rule_id": "unattended_station", "name": "Estación Desatendida con Trabajo Pendiente", "rule_type": "unattended_station", "threshold": 120.0, "window_seconds": 120, "severity": "critical", "enabled": True, "cooldown_seconds": 90, "description": "Estación sin presencia confiable mientras hay flujo de producción"},
        {"id": "rule-machine-stopped", "rule_id": "machine_stopped", "name": "Máquina Detenida sin Paro Declarado", "rule_type": "machine_stopped", "threshold": 90.0, "window_seconds": 90, "severity": "warning", "enabled": True, "cooldown_seconds": 90, "description": "Presencia detectada pero máquina sin registrar ciclos"},
        {"id": "rule-sensor-lost", "rule_id": "sensor_disconnected", "name": "Sensor o ESP32 sin Latido (Desconectado)", "rule_type": "sensor_disconnected", "threshold": 30.0, "window_seconds": 30, "severity": "critical", "enabled": True, "cooldown_seconds": 60, "description": "Sensor no reporta heartbeat en el intervalo de tolerancia"},
        {"id": "rule-env", "rule_id": "environment_out_of_bounds", "name": "Temperatura o Humedad Fuera de Rango", "rule_type": "environment_out_of_bounds", "threshold": 32.0, "window_seconds": 60, "severity": "warning", "enabled": True, "cooldown_seconds": 180, "description": "Condiciones ambientales exceden norma ESD o confort en línea"},
        {"id": "rule-discrepancy", "rule_id": "sensor_discrepancy", "name": "Discrepancia entre Sensores", "rule_type": "sensor_discrepancy", "threshold": 15.0, "window_seconds": 60, "severity": "warning", "enabled": True, "cooldown_seconds": 120, "description": "RFID, cámara y CSI no coinciden sobre si hay alguien en la estación"},
        {"id": "rule-repeat", "rule_id": "repeated_visits", "name": "Visitas Repetidas a una Zona", "rule_type": "repeated_visits", "threshold": 4.0, "window_seconds": 600, "severity": "warning", "enabled": True, "cooldown_seconds": 300, "description": "Un track entra muchas veces a la misma zona de apoyo en la ventana (surtido deficiente)"},
        {"id": "rule-material", "rule_id": "material_missing", "name": "Falta de Material Solicitada por Andon", "rule_type": "material_missing", "threshold": 60.0, "window_seconds": 60, "severity": "warning", "enabled": True, "cooldown_seconds": 60, "description": "Pulsación de botón de material sin atender en 60 segundos"}
    ]
    for ar in alert_rules:
        stmt = select(DBAlertRule).where(DBAlertRule.id == ar["id"])
        res = await session.execute(stmt)
        if not res.scalar_one_or_none():
            session.add(DBAlertRule(**ar))

    # 7. Default Dashboards (Operational & Management Views)
    dashboards_data = [
        {
            "id": "dash-operativo",
            "dashboard_id": "dash-operativo",
            "name": "Vista Operativa en Vivo (Planta & Flujo)",
            "description": "Monitoreo en tiempo real de línea 1, mapa spaghetti, heatmap, paros y alertas activas",
            "is_default": True,
            "layouts": {
                "lg": [
                    {"i": "kpi-prod", "x": 0, "y": 0, "w": 3, "h": 3, "minW": 2, "minH": 2},
                    {"i": "kpi-wait", "x": 3, "y": 0, "w": 3, "h": 3, "minW": 2, "minH": 2},
                    {"i": "kpi-stop", "x": 6, "y": 0, "w": 3, "h": 3, "minW": 2, "minH": 2},
                    {"i": "kpi-oee", "x": 9, "y": 0, "w": 3, "h": 3, "minW": 2, "minH": 2},
                    {"i": "map-2d", "x": 0, "y": 3, "w": 8, "h": 9, "minW": 4, "minH": 6},
                    {"i": "donut-time", "x": 8, "y": 3, "w": 4, "h": 5, "minW": 3, "minH": 4},
                    {"i": "alerts-stream", "x": 8, "y": 8, "w": 4, "h": 4, "minW": 3, "minH": 4},
                    {"i": "timeline-states", "x": 0, "y": 12, "w": 7, "h": 5, "minW": 4, "minH": 4},
                    {"i": "stops-history", "x": 7, "y": 12, "w": 5, "h": 5, "minW": 3, "minH": 4},
                    {"i": "devices-health", "x": 0, "y": 17, "w": 12, "h": 4, "minW": 4, "minH": 3}
                ]
            },
            "widgets": [
                {"id": "kpi-prod", "type": "kpi_productive", "title": "Tiempo Productivo", "dataSource": "metrics/live", "config": {"unit": "%", "color": "emerald"}, "layout": {"x": 0, "y": 0, "w": 3, "h": 3}, "visible": True, "minW": 2, "minH": 2},
                {"id": "kpi-wait", "type": "kpi_waiting", "title": "Tiempo de Espera", "dataSource": "metrics/live", "config": {"unit": "%", "color": "amber"}, "layout": {"x": 3, "y": 0, "w": 3, "h": 3}, "visible": True, "minW": 2, "minH": 2},
                {"id": "kpi-stop", "type": "kpi_stops", "title": "Paros Autorizados", "dataSource": "metrics/live", "config": {"unit": "min", "color": "rose"}, "layout": {"x": 6, "y": 0, "w": 3, "h": 3}, "visible": True, "minW": 2, "minH": 2},
                {"id": "kpi-oee", "type": "kpi_oee", "title": "Disponibilidad / OEE Parcial", "dataSource": "metrics/live", "config": {"unit": "%", "color": "cyan"}, "layout": {"x": 9, "y": 0, "w": 3, "h": 3}, "visible": True, "minW": 2, "minH": 2},
                {"id": "map-2d", "type": "floorplan_spaghetti", "title": "Plano 2D: Spaghetti & Heatmap", "dataSource": "floorplan/live", "config": {"showSpaghetti": True, "showHeatmap": True, "showZones": True, "showStations": True}, "layout": {"x": 0, "y": 3, "w": 8, "h": 9}, "visible": True, "minW": 4, "minH": 6},
                {"id": "donut-time", "type": "donut_time_split", "title": "Distribución del Universo Temporal", "dataSource": "metrics/time_universe", "config": {}, "layout": {"x": 8, "y": 3, "w": 4, "h": 5}, "visible": True, "minW": 3, "minH": 4},
                {"id": "alerts-stream", "type": "alert_stream", "title": "Alertas y Anomalías en Vivo", "dataSource": "alerts/live", "config": {}, "layout": {"x": 8, "y": 8, "w": 4, "h": 4}, "visible": True, "minW": 3, "minH": 4},
                {"id": "timeline-states", "type": "state_timeline", "title": "Serie Temporal de Estados por Estación", "dataSource": "metrics/timeline", "config": {}, "layout": {"x": 0, "y": 12, "w": 7, "h": 5}, "visible": True, "minW": 4, "minH": 4},
                {"id": "stops-history", "type": "stops_table", "title": "Historial de Paros y Denominador Ajustado", "dataSource": "stops/history", "config": {}, "layout": {"x": 7, "y": 12, "w": 5, "h": 5}, "visible": True, "minW": 3, "minH": 4},
                {"id": "devices-health", "type": "device_health", "title": "Salud y Frescura de Sensores / ESP32", "dataSource": "devices/health", "config": {}, "layout": {"x": 0, "y": 17, "w": 12, "h": 4}, "visible": True, "minW": 4, "minH": 3}
            ]
        },
        {
            "id": "dash-analitica",
            "dashboard_id": "dash-analitica",
            "name": "Vista Analítica de Flujo y Espacios",
            "description": "Análisis comparativo de permanencia, distancias recorridas y utilización de zonas",
            "is_default": False,
            "layouts": {
                "lg": [
                    {"i": "zone-dwell", "x": 0, "y": 0, "w": 6, "h": 6, "minW": 3, "minH": 3},
                    {"i": "station-comp", "x": 6, "y": 0, "w": 6, "h": 6, "minW": 3, "minH": 3},
                    {"i": "distance-chart", "x": 0, "y": 6, "w": 6, "h": 5, "minW": 3, "minH": 3},
                    {"i": "andon-board", "x": 6, "y": 6, "w": 6, "h": 5, "minW": 3, "minH": 3}
                ]
            },
            "widgets": [
                {"id": "zone-dwell", "type": "zone_dwell_bars", "title": "Permanencia y Ocupación por Zonas", "dataSource": "metrics/zones", "config": {}, "layout": {"x": 0, "y": 0, "w": 6, "h": 6}, "visible": True, "minW": 3, "minH": 3},
                {"id": "station-comp", "type": "station_comparison", "title": "Comparativa de Productividad por Estación", "dataSource": "metrics/stations", "config": {}, "layout": {"x": 6, "y": 0, "w": 6, "h": 6}, "visible": True, "minW": 3, "minH": 3},
                {"id": "distance-chart", "type": "distance_bars", "title": "Distancia Recorrida por Track (Calibrada en m)", "dataSource": "metrics/distance", "config": {}, "layout": {"x": 0, "y": 6, "w": 6, "h": 5}, "visible": True, "minW": 3, "minH": 3},
                {"id": "andon-board", "type": "andon_board", "title": "Tablero Andon y Estado de Máquinas", "dataSource": "metrics/andon", "config": {}, "layout": {"x": 6, "y": 6, "w": 6, "h": 5}, "visible": True, "minW": 3, "minH": 3}
            ]
        }
    ]
    for dbd in dashboards_data:
        stmt = select(DBDashboard).where(DBDashboard.id == dbd["id"])
        res = await session.execute(stmt)
        if not res.scalar_one_or_none():
            session.add(DBDashboard(**dbd))

    # Audit log entry for system initialization
    audit = DBAuditLog(
        action="SYSTEM_INIT",
        actor="System",
        entity_type="SYSTEM",
        entity_id="init",
        details={"message": "Factory Pulse base de datos inicializada correctamente"}
    )
    session.add(audit)
