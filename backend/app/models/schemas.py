from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from app.models.domain import (
    EventMode, EventType, StationStatus, StopScope,
    IntervalClassification, ModuleAvailability, AlertSeverity,
    AlertStatus, ZoneType
)

# --- BASE / COMMON ---

class BaseResponse(BaseModel):
    success: bool = True
    message: Optional[str] = None

# --- EVENT PAYLOADS ---

class PositionPayload(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0, description="Normalized X coordinate 0..1")
    y: float = Field(..., ge=0.0, le=1.0, description="Normalized Y coordinate 0..1")
    track_id: str = Field(..., description="Ephemeral track ID, e.g. TRK-A12")
    confidence: float = Field(1.0, ge=0.0, le=1.0, description="Confidence score 0..1")
    source: str = Field("vision_local", description="Sensor/provider origin")
    speed_m_s: Optional[float] = Field(None, description="Calculated speed in m/s")

class ZoneEventPayload(BaseModel):
    zone_id: str
    track_id: str
    duration_in_zone_seconds: Optional[float] = None

class PresencePayload(BaseModel):
    station_id: str
    present: bool
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    device_id: Optional[str] = None
    track_id: Optional[str] = None

class MachineStatePayload(BaseModel):
    station_id: str
    state: str = Field(..., description="'running' | 'idle' | 'fault' | 'stopped'")
    current_cycle_seconds: Optional[float] = None
    parts_count: Optional[int] = None
    temperature_c: Optional[float] = None

class CyclePayload(BaseModel):
    station_id: str
    cycle_time_seconds: float
    is_good_piece: bool = True
    total_parts: int = 1
    defect_reason: Optional[str] = None

class ButtonPressPayload(BaseModel):
    station_id: Optional[str] = None
    button_name: str = "andon_yellow"
    action: str = Field(..., description="'request_material' | 'supervisor_call' | 'stop_line' | 'sos'")
    notes: Optional[str] = None

class EnvironmentPayload(BaseModel):
    temperature_c: float
    humidity_pct: float
    co2_ppm: Optional[float] = None
    noise_db: Optional[float] = None
    lux: Optional[float] = None
    station_id: Optional[str] = None

class HeartbeatPayload(BaseModel):
    status: str = "online"
    battery_pct: Optional[float] = None
    rssi: Optional[int] = None
    uptime_seconds: Optional[int] = None

# --- EVENT SCHEMAS ---

class EventIngest(BaseModel):
    event_id: str = Field(..., description="Unique event UUID to prevent duplication")
    device_id: Optional[str] = Field(None, description="Physical device origin")
    source_id: Optional[str] = Field("api_http", description="Origin source system")
    occurred_at: datetime = Field(default_factory=datetime.utcnow, description="UTC timestamp of occurrence")
    received_at: Optional[datetime] = Field(None, description="UTC timestamp of ingest")
    type: EventType
    payload: Dict[str, Any]
    quality: float = Field(1.0, ge=0.0, le=1.0)
    mode: EventMode = Field(EventMode.LIVE)

class EventResponse(EventIngest):
    id: Optional[int] = None
    received_at: datetime

# --- FLOOR PLAN & ZONES ---

class ScaleCalibration(BaseModel):
    is_calibrated: bool = False
    point1: List[float] = Field(default=[0.0, 0.0], description="[x, y] normalized")
    point2: List[float] = Field(default=[1.0, 0.0], description="[x, y] normalized")
    real_distance_meters: float = Field(default=30.0, gt=0.0)
    meters_per_norm_unit: float = Field(default=30.0, gt=0.0)

class FloorPlanBase(BaseModel):
    name: str = "Línea 1 - Ensamble Electrónico"
    description: Optional[str] = "Plano general de la nave de producción A"
    width_meters: float = 40.0
    height_meters: float = 25.0
    image_url: Optional[str] = None
    svg_data: Optional[str] = None
    calibration: ScaleCalibration = Field(default_factory=ScaleCalibration)

class FloorPlanCreate(FloorPlanBase):
    pass

class FloorPlanResponse(FloorPlanBase):
    id: str
    created_at: datetime
    updated_at: datetime

class PolygonZoneBase(BaseModel):
    zone_id: str
    floor_plan_id: str = "fp-main"
    name: str
    type: ZoneType
    polygon: List[List[float]] = Field(..., description="Array of [x, y] coordinates in 0..1")
    color: str = "#3b82f6"
    station_ids: List[str] = Field(default_factory=list)
    max_capacity: Optional[int] = None
    max_stay_seconds: Optional[int] = 300
    is_aggregated_only: bool = Field(False, description="For bathrooms/rest areas - hides personal IDs")

class PolygonZoneCreate(PolygonZoneBase):
    pass

class PolygonZoneResponse(PolygonZoneBase):
    id: str
    created_at: datetime

# --- STATIONS & DEVICES ---

class StationBase(BaseModel):
    station_id: str
    line_id: str = "line-1"
    name: str
    order_in_line: int
    ideal_cycle_seconds: float = 45.0
    position_x: float = Field(..., ge=0.0, le=1.0)
    position_y: float = Field(..., ge=0.0, le=1.0)
    current_status: StationStatus = StationStatus.IDLE
    current_worker_track_id: Optional[str] = None
    target_pieces_per_hour: int = 60

class StationCreate(StationBase):
    pass

class StationResponse(StationBase):
    id: str
    last_event_at: Optional[datetime] = None
    last_cycle_time: Optional[float] = None
    parts_produced_shift: int = 0

class DeviceBase(BaseModel):
    device_id: str
    name: str
    type: str = Field(..., description="'esp32' | 'camera_vision' | 'ble_beacon' | 'rfid_reader' | 'wifi_csi_node'")
    station_id: Optional[str] = None
    zone_id: Optional[str] = None
    ingest_mode: str = Field("http", description="'http' | 'mqtt' | 'websocket'")
    firmware_version: Optional[str] = "v1.2.0"
    is_active: bool = True

class DeviceCreate(DeviceBase):
    pass

class DeviceResponse(DeviceBase):
    id: str
    last_heartbeat: Optional[datetime] = None
    last_latency_ms: Optional[float] = None
    status: str = "online"
    created_at: datetime

# --- PAROS (STOPS / DOWNTIME) ---

class StopCreate(BaseModel):
    scope_type: StopScope = StopScope.LINE
    scope_id: str = "line-1"
    reason: str
    reason_code: str = "MAN-01"
    author: str = "Admin Operaciones"
    started_at: datetime
    ended_at: Optional[datetime] = None
    is_authorized: bool = True
    notes: Optional[str] = None

    @field_validator("ended_at")
    @classmethod
    def validate_ended_after_started(cls, v, values):
        if v is not None and "started_at" in values.data and v < values.data["started_at"]:
            raise ValueError("ended_at no puede ser anterior a started_at")
        return v

class StopUpdate(BaseModel):
    reason: Optional[str] = None
    reason_code: Optional[str] = None
    ended_at: Optional[datetime] = None
    is_authorized: Optional[bool] = None
    notes: Optional[str] = None
    author: Optional[str] = None

class StopResponse(BaseModel):
    id: str
    scope_type: StopScope
    scope_id: str
    reason: str
    reason_code: str
    author: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    is_authorized: bool
    status: str = "open" # "open" | "closed"
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

# --- ALERTS & RULES ---

class AlertRuleConfig(BaseModel):
    rule_id: str
    name: str
    rule_type: str = Field(..., description="'excessive_travel' | 'abnormal_dwell' | 'atypical_flow' | 'bottleneck' | 'unattended_station' | 'machine_stopped' | 'sensor_disconnected' | 'environment_out_of_bounds' | 'material_missing' | 'microstop'")
    threshold: float
    window_seconds: int = 60
    severity: AlertSeverity = AlertSeverity.WARNING
    enabled: bool = True
    cooldown_seconds: int = 120
    scope_type: Optional[StopScope] = None
    scope_id: Optional[str] = None
    description: str = ""

class AlertResponse(BaseModel):
    id: str
    rule_id: str
    title: str
    description: str
    severity: AlertSeverity
    status: AlertStatus
    scope_type: Optional[StopScope] = None
    scope_id: Optional[str] = None
    triggered_at: datetime
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    evidence: Dict[str, Any] = Field(default_factory=dict)

# --- DASHBOARDS & WIDGETS ---

class WidgetConfig(BaseModel):
    id: str
    type: str # 'kpi_productive' | 'kpi_waiting' | 'kpi_stops' | 'floorplan_spaghetti' | 'heatmap' | 'state_timeline' | 'zone_dwell_bars' | 'donut_time_split' | 'station_comparison' | 'alert_stream' | 'stops_table' | 'device_health' | 'andon_board' | 'custom_echart'
    title: str
    dataSource: str = "metrics/live"
    config: Dict[str, Any] = Field(default_factory=dict)
    layout: Dict[str, Any] = Field(default_factory=lambda: {"x": 0, "y": 0, "w": 6, "h": 4})
    visible: bool = True
    minW: int = 2
    minH: int = 2

class DashboardConfigBase(BaseModel):
    dashboard_id: str
    name: str
    description: Optional[str] = None
    is_default: bool = False
    layouts: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict) # Breakpoint layouts: lg, md, sm
    widgets: List[WidgetConfig] = Field(default_factory=list)

class DashboardConfigCreate(DashboardConfigBase):
    pass

class DashboardConfigResponse(DashboardConfigBase):
    id: str
    created_at: datetime
    updated_at: datetime

# --- CATALOG MODULES ---

class CatalogModule(BaseModel):
    id: str
    category: str
    name: str
    description: str
    availability: ModuleAvailability
    data_requirements: List[str]
    signal_type: str
    relative_cost: str # 'Bajo' | 'Medio' | 'Alto' | 'N/A'
    expected_resolution: str
    deployment_requirements: str
    is_active_in_demo: bool = True
    toggle_enabled: bool = True

# --- AUDIT LOG ---

class AuditLogEntry(BaseModel):
    id: Optional[int] = None
    action: str
    actor: str
    entity_type: str
    entity_id: str
    details: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# --- METRICS & KPIs ---

class TimeUniverseMetrics(BaseModel):
    gross_planned_seconds: float
    authorized_stops_union_seconds: float
    adjusted_planned_seconds: float
    productive_seconds: float
    waiting_seconds: float
    absent_seconds: float
    unknown_seconds: float
    conservation_check_error_seconds: float = 0.0 # Strict: Productive+Waiting+Absent+Unknown == Adjusted Planned

class DistanceMetric(BaseModel):
    track_id: str
    raw_distance_norm: float
    calibrated_meters: Optional[float] = None
    is_calibrated: bool = False
    speed_avg_m_s: Optional[float] = None
    sample_count: int = 0
    jitter_filtered_count: int = 0
    speed_outlier_count: int = 0

class ZoneDwellMetric(BaseModel):
    zone_id: str
    zone_name: str
    zone_type: ZoneType
    total_dwell_seconds: float
    occupancy_count: int
    entry_count: int
    exit_count: int
    is_aggregated_only: bool = False

class StationMetric(BaseModel):
    station_id: str
    name: str
    current_status: StationStatus
    productive_ratio: float
    waiting_ratio: float
    idle_ratio: float
    stopped_ratio: float
    parts_produced: int
    target_parts: int
    availability_ratio: float
    partial_oee_note: str

class MetricsSummaryResponse(BaseModel):
    time_window_start: datetime
    time_window_end: datetime
    shift_name: str = "Turno 1 - Matutino"
    time_universe: TimeUniverseMetrics
    stations: List[StationMetric]
    zones: List[ZoneDwellMetric]
    distances: List[DistanceMetric]
    total_active_tracks: int
    total_open_stops: int
    total_active_alerts: int
    online_devices_count: int
    total_devices_count: int
    mode: EventMode = EventMode.LIVE
