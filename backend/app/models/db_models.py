import json
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class DBEvent(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(String(64), unique=True, index=True, nullable=False)
    device_id = Column(String(64), index=True, nullable=True)
    source_id = Column(String(64), index=True, nullable=True)
    occurred_at = Column(DateTime, index=True, nullable=False)
    received_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    type = Column(String(32), index=True, nullable=False)
    payload = Column(JSON, nullable=False)
    quality = Column(Float, default=1.0)
    mode = Column(String(16), default="live", index=True)

class DBFloorPlan(Base):
    __tablename__ = "floor_plans"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    description = Column(String(256), nullable=True)
    width_meters = Column(Float, default=40.0)
    height_meters = Column(Float, default=25.0)
    image_url = Column(Text, nullable=True)
    svg_data = Column(Text, nullable=True)
    calibration = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DBLine(Base):
    """Línea de producción. El área (polygon) es opcional: si es nula se deriva de sus zonas."""
    __tablename__ = "lines"

    id = Column(String(64), primary_key=True)
    floor_plan_id = Column(String(64), ForeignKey("floor_plans.id"), default="fp-main")
    name = Column(String(128), nullable=False)
    order = Column(Integer, default=1)
    polygon = Column(JSON, nullable=True)  # [[x, y], ...] en 0..1
    created_at = Column(DateTime, default=datetime.utcnow)

class DBPolygonZone(Base):
    __tablename__ = "polygon_zones"

    id = Column(String(64), primary_key=True)
    zone_id = Column(String(64), unique=True, index=True, nullable=False)
    floor_plan_id = Column(String(64), ForeignKey("floor_plans.id"), default="fp-main")
    name = Column(String(128), nullable=False)
    type = Column(String(32), nullable=False)
    polygon = Column(JSON, nullable=False) # List of [x, y]
    color = Column(String(32), default="#3b82f6")
    station_ids = Column(JSON, default=list)
    max_capacity = Column(Integer, nullable=True)
    max_stay_seconds = Column(Integer, default=300)
    is_aggregated_only = Column(Boolean, default=False)
    line_id = Column(String(64), nullable=True)
    # Arreglo interno del área en metros relativos a su esquina superior izquierda.
    interior = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class DBStation(Base):
    __tablename__ = "stations"

    id = Column(String(64), primary_key=True)
    station_id = Column(String(64), unique=True, index=True, nullable=False)
    line_id = Column(String(64), default="line-1")
    name = Column(String(128), nullable=False)
    order_in_line = Column(Integer, default=1)
    ideal_cycle_seconds = Column(Float, default=45.0)
    position_x = Column(Float, nullable=False)
    position_y = Column(Float, nullable=False)
    current_status = Column(String(32), default="idle")
    current_worker_track_id = Column(String(64), nullable=True)
    target_pieces_per_hour = Column(Integer, default=60)
    last_event_at = Column(DateTime, nullable=True)
    last_cycle_time = Column(Float, nullable=True)
    parts_produced_shift = Column(Integer, default=0)
    equipment_type = Column(String(32), default="generic")

class DBDevice(Base):
    __tablename__ = "devices"

    id = Column(String(64), primary_key=True)
    device_id = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(128), nullable=False)
    type = Column(String(32), nullable=False)
    station_id = Column(String(64), nullable=True)
    zone_id = Column(String(64), nullable=True)
    ingest_mode = Column(String(32), default="http")
    firmware_version = Column(String(32), default="v1.2.0")
    is_active = Column(Boolean, default=True)
    last_heartbeat = Column(DateTime, nullable=True)
    last_latency_ms = Column(Float, nullable=True)
    status = Column(String(32), default="online")
    # True solo para los nodos de demostración que alimenta el simulador.
    simulated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class DBStop(Base):
    __tablename__ = "stops"

    id = Column(String(64), primary_key=True)
    scope_type = Column(String(32), nullable=False) # 'plant' | 'line' | 'station' | 'zone'
    scope_id = Column(String(64), index=True, nullable=False)
    reason = Column(String(256), nullable=False)
    reason_code = Column(String(64), nullable=False)
    author = Column(String(128), nullable=False)
    started_at = Column(DateTime, nullable=False, index=True)
    ended_at = Column(DateTime, nullable=True, index=True)
    duration_seconds = Column(Float, nullable=True)
    is_authorized = Column(Boolean, default=True)
    status = Column(String(32), default="open") # 'open' | 'closed'
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DBBadge(Base):
    """Tarjeta RFID asignada a una persona. La identidad solo se usa en checkpoints."""
    __tablename__ = "badges"

    tag_id = Column(String(64), primary_key=True)
    person = Column(String(128), nullable=False)
    role = Column(String(64), nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class DBRecording(Base):
    """Tramo de eventos guardado como respaldo para reproducirlo (plan B de la demo)."""
    __tablename__ = "recordings"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    source_mode = Column(String(16), nullable=False)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=False)
    event_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class DBStopReason(Base):
    __tablename__ = "stop_reasons"

    id = Column(String(64), primary_key=True)
    code = Column(String(32), unique=True, nullable=False)
    category = Column(String(64), nullable=False) # 'Mantenimiento' | 'Material' | 'Calidad' | 'Operación' | 'Planificado'
    description = Column(String(256), nullable=False)
    is_authorized_by_default = Column(Boolean, default=True)

class DBAlert(Base):
    __tablename__ = "alerts"

    id = Column(String(64), primary_key=True)
    rule_id = Column(String(64), index=True, nullable=False)
    title = Column(String(128), nullable=False)
    description = Column(String(256), nullable=False)
    severity = Column(String(32), default="warning")
    status = Column(String(32), default="new") # 'new' | 'acknowledged' | 'resolved'
    scope_type = Column(String(32), nullable=True)
    scope_id = Column(String(64), nullable=True)
    triggered_at = Column(DateTime, default=datetime.utcnow, index=True)
    acknowledged_at = Column(DateTime, nullable=True)
    acknowledged_by = Column(String(128), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(String(128), nullable=True)
    evidence = Column(JSON, default=dict)

class DBAlertRule(Base):
    __tablename__ = "alert_rules"

    id = Column(String(64), primary_key=True)
    rule_id = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(128), nullable=False)
    rule_type = Column(String(64), nullable=False)
    threshold = Column(Float, nullable=False)
    window_seconds = Column(Integer, default=60)
    severity = Column(String(32), default="warning")
    enabled = Column(Boolean, default=True)
    cooldown_seconds = Column(Integer, default=120)
    scope_type = Column(String(32), nullable=True)
    scope_id = Column(String(64), nullable=True)
    description = Column(String(256), default="")

class DBDashboard(Base):
    __tablename__ = "dashboards"

    id = Column(String(64), primary_key=True)
    dashboard_id = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(128), nullable=False)
    description = Column(String(256), nullable=True)
    is_default = Column(Boolean, default=False)
    layouts = Column(JSON, nullable=False)
    widgets = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DBAuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    action = Column(String(64), nullable=False)
    actor = Column(String(128), nullable=False)
    entity_type = Column(String(64), nullable=False)
    entity_id = Column(String(64), nullable=False)
    details = Column(JSON, default=dict)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
