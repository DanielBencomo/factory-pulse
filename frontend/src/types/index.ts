export type EventMode = 'demo' | 'replay' | 'live';

export type EventType =
  | 'position'
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
}

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
  status: 'online' | 'offline' | 'warning';
  created_at: string;
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
