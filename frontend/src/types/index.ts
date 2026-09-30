export type EventMode = 'demo' | 'replay' | 'live';

export type EventType =
  | 'position'
  | 'zone_occupancy'
  | 'zone_enter'
  | 'zone_exit'
  | 'presence'
  | 'machine_state'
  | 'cycle'
  | 'button_press'
  | 'environment'
  | 'heartbeat';

export type StationStatus =
  | 'idle'
  | 'active'
  | 'waiting_material'
  | 'unattended'
  | 'stopped'
  | 'present'
  | 'unknown';

export type StopScope = 'plant' | 'line' | 'station' | 'zone';

export type ModuleAvailability = 'active' | 'simulated' | 'needs_device' | 'experimental';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertStatus = 'new' | 'acknowledged' | 'resolved';

export type ZoneType = 'work' | 'transit' | 'storage' | 'rest' | 'bathroom' | 'restricted';

export interface ScaleCalibration {
  is_calibrated: boolean;
  point1: [number, number];
  point2: [number, number];
  real_distance_meters: number;
  meters_per_norm_unit: number;
}

export interface FloorPlan {
  id: string;
  name: string;
  description?: string;
  width_meters: number;
  height_meters: number;
  image_url?: string;
  svg_data?: string;
  calibration: ScaleCalibration;
  created_at: string;
  updated_at: string;
}

export interface PolygonZone {
  id: string;
  zone_id: string;
  floor_plan_id: string;
  name: string;
  type: ZoneType;
  polygon: [number, number][];
  color: string;
  station_ids: string[];
  max_capacity?: number;
  max_stay_seconds?: number;
  is_aggregated_only: boolean;
  line_id?: string | null;
  interior?: InteriorItem[] | null;
}

export type InteriorKind =
  | 'machine'
  | 'conveyor'
  | 'bench'
  | 'rack'
  | 'workstation'
  | 'cart'
  | 'rfid'
  | 'csi'
  | 'button'
  | 'process'
  | 'camera';

/** Elemento dentro de un área, en metros desde la esquina superior izquierda de la zona. */
export interface InteriorItem {
  id: string;
  kind: InteriorKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 90 | 180 | 270;
  label?: string | null;
  variant?: string | null;
  device_id?: string | null;
}

export type EquipmentType = 'smt' | 'reflow' | 'aoi' | 'pack' | 'manual' | 'generic';

export interface Line {
  id: string;
  name: string;
  order: number;
  /** Área de la línea en 0..1. Nula = se deriva de sus zonas. */
  polygon: [number, number][] | null;
}

export interface Layout {
  floor_plan: { id: string; name: string; width_meters: number; height_meters: number };
  lines: Line[];
  zones: PolygonZone[];
  stations: Station[];
}

/** Punto de trayectoria: x, y normalizados y marca de tiempo en ms. */
export type TrackPoint = [number, number, number];

export interface Station {
  id: string;
  station_id: string;
  line_id: string;
  name: string;
  order_in_line: number;
  ideal_cycle_seconds: number;
  position_x: number;
  position_y: number;
  current_status: StationStatus;
  current_worker_track_id?: string;
  target_pieces_per_hour: number;
  last_event_at?: string;
  last_cycle_time?: number;
  parts_produced_shift: number;
  equipment_type?: EquipmentType;
}

export interface Device {
  id: string;
  device_id: string;
  name: string;
  type: string;
  station_id?: string;
  zone_id?: string;
  ingest_mode: string;
  firmware_version?: string;
  is_active: boolean;
  last_heartbeat?: string;
  last_latency_ms?: number;
  status: DeviceStatus;
  simulated?: boolean;
  created_at: string;
}

export type DeviceStatus = 'online' | 'offline' | 'waiting' | 'warning';
export type SystemMode = 'demo' | 'live' | 'replay';

export type SpatialLayer = 'zones' | 'routes' | 'traffic' | 'dwell';

export interface SpatialZoneMetric {
  zone_id: string;
  name: string;
  type: ZoneType;
  line_id?: string | null;
  current_count: number | null;
  average_occupancy: number;
  peak_occupancy: number;
  person_minutes: number;
  occupied_pct: number;
  stationary_pct: number;
  moving_pct: number;
  unknown_motion_pct: number;
  visits: number | null;
  visits_per_hour: number | null;
  area_m2: number;
  peak_density_person_m2: number;
  max_capacity?: number | null;
  congested_seconds: number;
  excess_person_minutes: number;
  sustained_peak_seconds: number;
  is_aggregated_only: boolean;
}

export interface SpatialTransition {
  from_zone_id: string;
  from_name: string;
  to_zone_id: string;
  to_name: string;
  count: number;
}

export interface SpatialInsight {
  id: string;
  tone: 'good' | 'info' | 'attention';
  priority: number;
  title: string;
  observation: string;
  evidence: string;
  suggestion: string;
  scope_type: 'plant' | 'zone';
  scope_id?: string | null;
  layer: SpatialLayer;
}

export interface SpatialSummary {
  mode: SystemMode;
  scope: { type: 'plant' | 'line' | 'station' | 'zone'; id?: string | null; label: string };
  window: { start: string; end: string; minutes: number; step_s: number };
  generated_at: string;
  summary: {
    current_people: number | null;
    average_occupancy: number;
    peak_occupancy: number;
    observed_person_minutes: number;
    stationary_pct: number;
    moving_pct: number;
    unknown_motion_pct: number;
    coverage_pct: number;
    fresh: boolean;
    last_observation_age_seconds: number | null;
    top_dwell_zone: { zone_id: string; name: string; person_minutes: number } | null;
    max_congestion: { zone_id: string; name: string; people: number; capacity: number | null; sustained_seconds: number; over_capacity: boolean } | null;
    distance_m: number;
    distance_per_person_hour_m: number | null;
    total_transitions: number;
    route_concentration_pct: number;
    transition_entropy_pct: number;
    backtrack_ratio_pct: number;
    zone_utilization_pct: number;
    congestion_excess_person_minutes: number;
    congested_seconds: number;
    peak_density_person_m2: number;
    source_count: number;
    calibrated: boolean;
  };
  zones: SpatialZoneMetric[];
  transitions: SpatialTransition[];
  insights: SpatialInsight[];
  methodology: {
    position_max_age_s: number;
    occupancy_max_age_s: number;
    stationary_threshold_m_s: number;
    privacy: string;
    interpretation: string;
  };
}

export interface Playback {
  active: boolean;
  recording_id: string | null;
  name: string | null;
  speed: number;
  loop: boolean;
  progress: number;
}

export interface Recording {
  id: string;
  name: string;
  source_mode: string;
  started_at: string;
  ended_at: string;
  duration_s: number;
  event_count: number;
}

export interface Badge {
  tag_id: string;
  person: string;
  role?: string | null;
  active?: boolean;
}

export interface ZoneSignals {
  zone_id: string;
  station_id: string | null;
  mode: SystemMode;
  now: string;
  rfid: { tag_id: string; kind: 'entrada' | 'salida'; at: string; person: string | null; role: string | null; device_id: string | null }[];
  csi: { state: 'actividad' | 'quietud' | 'sin_presencia'; confidence: number | null; motion: number | null; at: string; device_id: string | null } | null;
  pir: { present: boolean; confidence: number | null; at: string; device_id: string | null } | null;
  button: { action: string; at: string; device_id: string | null } | null;
  process: { cycles_last_hour: number; last_cycle: { at: string; cycle_time_seconds: number | null } | null; machine: { state: string; at: string } | null };
}

export interface ConnectInfo {
  mode: SystemMode;
  lan_ips: string[];
  port: number;
  base_url: string;
  events_url: string;
  heartbeat_url_template: string;
  rfid_events_url: string;
  rfid_auth_required: boolean;
  rfid_auth_header: string;
  heartbeat_interval_seconds: number;
  device_timeout_seconds: number;
  mqtt: { enabled: boolean; host: string; port: number; topic_template: string };
}

export interface ZoneOccupancy {
  zone_id: string;
  name: string;
  type: ZoneType;
  line_id?: string | null;
  count: number;
  max_capacity?: number | null;
  is_aggregated_only: boolean;
  privacy: 'aggregate_only' | 'anonymous_tracks';
  source: 'vision_aggregate' | 'tracks';
}

export interface OccupancySnapshot {
  mode: SystemMode;
  at: string;
  max_age_seconds: number;
  total_people: number;
  tracked_people: number;
  unassigned: number;
  zones: ZoneOccupancy[];
}

export interface RFIDConfig {
  events_url: string;
  batch_url: string;
  auth_required: boolean;
  auth_header: string;
  accepted_identifiers: string[];
  max_batch_size: number;
}

export type AnalyticsState = 'productivo' | 'espera' | 'presente' | 'ausencia' | 'paro' | 'sin_datos';

export interface StationAnalytics {
  station_id: string;
  name: string;
  order: number;
  seconds: Record<AnalyticsState, number>;
  has_process_data: boolean;
  pieces: number;
  good_pct: number | null;
  pieces_per_hour: number;
  available_s: number;
  target_pph: number;
  avg_cycle_s: number | null;
  ideal_cycle_s: number;
}

export interface Analytics {
  line_id: string;
  mode: SystemMode;
  window: { start_ms: number; end_ms: number; step_s: number; bucket_s: number };
  states: AnalyticsState[];
  summary: {
    seconds: Record<AnalyticsState, number>;
    available_s: number;
    pct_of_available: Record<Exclude<AnalyticsState, 'paro' | 'sin_datos'>, number>;
    stops_minutes: number;
    line_output: number;
    line_output_target: number;
    bottleneck_station_id: string | null;
    distance_m: number;
    has_position_data: boolean;
    has_process_data: boolean;
  };
  stations: StationAnalytics[];
  timeline: { station_id: string; segments: [number, number, AnalyticsState][] }[];
  buckets_ms: number[];
  output_by_bucket: Record<string, number[]>;
  line_output_by_bucket: number[];
  line_target_per_bucket: number;
  distance_by_bucket: Record<string, number[]>;
  stops_pareto: { reason: string; minutes: number; count: number }[];
  zone_dwell: { zone_id: string; name: string; type: string; person_s: number; occupied_s: number; visits: number | null; is_aggregated_only: boolean }[];
  previous_summary: Analytics['summary'] | null;
}

export interface Stop {
  id: string;
  scope_type: StopScope;
  scope_id: string;
  reason: string;
  reason_code: string;
  author: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  is_authorized: boolean;
  status: 'open' | 'closed';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface StopReason {
  id: string;
  code: string;
  category: string;
  description: string;
}

export interface Alert {
  id: string;
  rule_id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: AlertStatus;
  scope_type?: StopScope;
  scope_id?: string;
  triggered_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  resolved_by?: string;
  evidence: Record<string, any>;
}

export interface AlertRuleConfig {
  rule_id: string;
  name: string;
  rule_type: string;
  threshold: number;
  window_seconds: number;
  severity: AlertSeverity;
  enabled: boolean;
  cooldown_seconds: number;
  scope_type?: StopScope;
  scope_id?: string;
  description: string;
}

export interface TimeUniverseMetrics {
  gross_planned_seconds: number;
  authorized_stops_union_seconds: number;
  adjusted_planned_seconds: number;
  productive_seconds: number;
  waiting_seconds: number;
  absent_seconds: number;
  unknown_seconds: number;
  conservation_check_error_seconds: number;
}

export interface DistanceMetric {
  track_id: string;
  raw_distance_norm: number;
  calibrated_meters?: number;
  is_calibrated: boolean;
  speed_avg_m_s?: number;
  sample_count: number;
  jitter_filtered_count: number;
  speed_outlier_count: number;
}

export interface ZoneDwellMetric {
  zone_id: string;
  zone_name: string;
  zone_type: ZoneType;
  total_dwell_seconds: number;
  occupancy_count: number;
  entry_count: number;
  exit_count: number;
  is_aggregated_only: boolean;
}

export interface StationMetric {
  station_id: string;
  name: string;
  current_status: StationStatus;
  productive_ratio: number;
  waiting_ratio: number;
  idle_ratio: number;
  stopped_ratio: number;
  parts_produced: number;
  target_parts: number;
  availability_ratio: number;
  partial_oee_note: string;
}

export interface MetricsSummary {
  time_window_start: string;
  time_window_end: string;
  shift_name: string;
  time_universe: TimeUniverseMetrics;
  stations: StationMetric[];
  zones: ZoneDwellMetric[];
  distances: DistanceMetric[];
  total_active_tracks: number;
  total_open_stops: number;
  total_active_alerts: number;
  online_devices_count: number;
  total_devices_count: number;
  mode: EventMode;
}

export interface WidgetConfig {
  id: string;
  type: string;
  title: string;
  dataSource: string;
  config: Record<string, any>;
  layout: { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
  visible: boolean;
  minW: number;
  minH: number;
}

export interface DashboardConfig {
  id: string;
  dashboard_id: string;
  name: string;
  description?: string;
  is_default: boolean;
  layouts: Record<string, any[]>;
  widgets: WidgetConfig[];
  created_at: string;
  updated_at: string;
}

export interface CatalogModule {
  id: string;
  category: string;
  name: string;
  description: string;
  availability: ModuleAvailability;
  data_requirements: string[];
  signal_type: string;
  relative_cost: string;
  expected_resolution: string;
  deployment_requirements: string;
  is_active_in_demo: boolean;
  toggle_enabled: boolean;
}
