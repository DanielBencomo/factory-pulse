import {
  FloorPlan, PolygonZone, Station, Device, Stop, StopReason,
  Alert, AlertRuleConfig, MetricsSummary, DashboardConfig,
  CatalogModule, ScaleCalibration, Layout, Line, TrackPoint,
  Analytics, ConnectInfo, SystemMode, InteriorItem, Badge, Recording, Playback, ZoneSignals,
  OccupancySnapshot, RFIDConfig, ZoneType, SpatialSummary, CameraConfig, CameraInput, CameraProfile
} from '../types';

const API_BASE = '/api';

async function errorText(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  if (Array.isArray(err.detail)) return err.detail.map((d: any) => (typeof d === 'string' ? d : d.msg)).join(' · ');
  return err.detail || fallback;
}

export const api = {
  // Health
  async getHealth() {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },

  // Metrics
  async getMetrics(windowMinutes: number = 60, lineId: string = 'line-1'): Promise<MetricsSummary> {
    const res = await fetch(`${API_BASE}/metrics?window_minutes=${windowMinutes}&line_id=${lineId}`);
    if (!res.ok) throw new Error('Error fetching metrics');
    return res.json();
  },

  // Events Ingest
  async sendEvent(eventData: Record<string, any>) {
    const res = await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    });
    if (!res.ok) throw new Error('Error sending event');
    return res.json();
  },

  async listEvents(limit: number = 100) {
    const res = await fetch(`${API_BASE}/events?limit=${limit}`);
    return res.json();
  },

  // Floor Plans
  async listFloorPlans(): Promise<FloorPlan[]> {
    const res = await fetch(`${API_BASE}/floorplans`);
    return res.json();
  },

  async updateCalibration(planId: string, calibration: ScaleCalibration): Promise<FloorPlan> {
    const res = await fetch(`${API_BASE}/floorplans/${planId}/calibration`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(calibration),
    });
    return res.json();
  },

  // Zones & Stations
  async listZones(): Promise<PolygonZone[]> {
    const res = await fetch(`${API_BASE}/zones`);
    return res.json();
  },

  async createZone(zone: {
    zone_id: string; floor_plan_id: string; name: string; type: ZoneType;
    polygon: [number, number][]; color: string; station_ids: string[];
    max_capacity?: number; is_aggregated_only: boolean; line_id?: string | null;
  }): Promise<PolygonZone> {
    const res = await fetch(`${API_BASE}/zones`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(zone),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo crear el área'));
    return res.json();
  },

  async getZoneOccupancy(): Promise<OccupancySnapshot> {
    const res = await fetch(`${API_BASE}/zones/occupancy/live`, { cache: 'no-store' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo leer la ocupación'));
    return res.json();
  },

  async listStations(): Promise<Station[]> {
    const res = await fetch(`${API_BASE}/stations`);
    return res.json();
  },

  async updateStationStatus(stationId: string, status: string): Promise<Station> {
    const res = await fetch(`${API_BASE}/stations/${stationId}/status?new_status=${status}`, {
      method: 'PUT',
    });
    return res.json();
  },

  // Layout editable
  async getLayout(): Promise<Layout> {
    const res = await fetch(`${API_BASE}/layout`);
    if (!res.ok) throw new Error('Error fetching layout');
    return res.json();
  },

  async saveLayout(layout: Layout): Promise<Layout> {
    const res = await fetch(`${API_BASE}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(layout),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = Array.isArray(err.detail)
        ? err.detail.map((d: any) => (typeof d === 'string' ? d : d.msg)).join(' · ')
        : err.detail;
      throw new Error(detail || 'No se pudo guardar el layout');
    }
    return res.json();
  },

  async listLines(): Promise<Line[]> {
    const res = await fetch(`${API_BASE}/lines`);
    return res.json();
  },

  async updateLinePolygon(lineId: string, polygon: [number, number][]): Promise<Line> {
    const res = await fetch(`${API_BASE}/lines/${encodeURIComponent(lineId)}/polygon`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ polygon }),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo actualizar la línea'));
    return res.json();
  },

  async getTrackHistory(minutes: number = 30): Promise<Record<string, TrackPoint[]>> {
    const res = await fetch(`${API_BASE}/tracks/history?minutes=${minutes}`);
    if (!res.ok) return {};
    return res.json();
  },

  // Interior de un área
  async saveInterior(zoneId: string, items: InteriorItem[], operator?: { x: number; y: number }) {
    const res = await fetch(`${API_BASE}/zones/${zoneId}/interior`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, operator }),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo guardar el interior'));
    return res.json();
  },

  // Analítica reconstruida desde eventos
  async getAnalytics(lineId: string, minutes: number): Promise<Analytics> {
    const res = await fetch(`${API_BASE}/analytics?line_id=${encodeURIComponent(lineId)}&minutes=${minutes}`);
    if (!res.ok) throw new Error('Error fetching analytics');
    return res.json();
  },

  async getSpatialSummary(
    scope: 'plant' | 'line' | 'station' | 'zone' = 'plant',
    scopeId?: string | null,
    minutes: number = 60,
    mode?: SystemMode,
  ): Promise<SpatialSummary> {
    const params = new URLSearchParams({ scope, minutes: String(minutes) });
    if (scopeId) params.set('scope_id', scopeId);
    if (mode) params.set('mode', mode);
    const res = await fetch(`${API_BASE}/spatial/summary?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo calcular la analítica espacial'));
    return res.json();
  },

  // Modo del sistema y conexión de dispositivos
  async getSystemMode(): Promise<{ mode: SystemMode; simulator_running: boolean; playback?: Playback }> {
    const res = await fetch(`${API_BASE}/system/mode`);
    return res.json();
  },

  async setSystemMode(mode: SystemMode): Promise<{ mode: SystemMode; simulator_running: boolean; playback?: Playback }> {
    const res = await fetch(`${API_BASE}/system/mode?mode=${mode}`, { method: 'PUT' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo cambiar el modo'));
    return res.json();
  },

  async getConnectInfo(): Promise<ConnectInfo> {
    const res = await fetch(`${API_BASE}/connect/info`);
    return res.json();
  },

  async getRFIDConfig(): Promise<RFIDConfig> {
    const res = await fetch(`${API_BASE}/rfid/config`);
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo leer la configuración RFID'));
    return res.json();
  },

  async listDeviceTypes(): Promise<{ value: string; label: string }[]> {
    const res = await fetch(`${API_BASE}/devices/types`);
    return res.json();
  },

  async registerDevice(dev: { device_id: string; name: string; type: string; station_id?: string | null; zone_id?: string | null }) {
    const res = await fetch(`${API_BASE}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dev),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo registrar el dispositivo'));
    return res.json();
  },

  async updateDevice(deviceId: string, patch: Partial<Device>) {
    const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo actualizar el dispositivo'));
    return res.json();
  },

  async deleteDevice(deviceId: string) {
    const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo eliminar el dispositivo'));
  },

  // Devices
  async listDevices(): Promise<Device[]> {
    const res = await fetch(`${API_BASE}/devices`);
    return res.json();
  },

  // Cámaras registradas y proveedores de visión. El navegador nunca necesita
  // conocer el puerto interno que se asignó a cada proceso local.
  async listCameras(): Promise<CameraConfig[]> {
    const res = await fetch(`${API_BASE}/cameras`);
    if (!res.ok) throw new Error(await errorText(res, 'No se pudieron leer las cámaras'));
    return res.json();
  },

  async listCameraProfiles(): Promise<CameraProfile[]> {
    const res = await fetch(`${API_BASE}/cameras/profiles`);
    if (!res.ok) throw new Error(await errorText(res, 'No se pudieron leer los perfiles'));
    return res.json();
  },

  async registerCamera(camera: CameraInput): Promise<CameraConfig> {
    const res = await fetch(`${API_BASE}/cameras`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(camera),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo registrar la cámara'));
    return res.json();
  },

  async updateCamera(cameraId: string, patch: Partial<CameraInput>): Promise<CameraConfig> {
    const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(cameraId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo actualizar la cámara'));
    return res.json();
  },

  async deleteCamera(cameraId: string) {
    const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(cameraId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo eliminar la cámara'));
  },

  async startCamera(cameraId: string) {
    const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(cameraId)}/start`, { method: 'POST' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo iniciar la cámara'));
    return res.json();
  },

  async stopCamera(cameraId: string) {
    const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(cameraId)}/stop`, { method: 'POST' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo detener la cámara'));
    return res.json();
  },

  async probeCamera(cameraId: string) {
    const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(cameraId)}/probe`, { method: 'POST' });
    if (!res.ok) throw new Error(await errorText(res, 'La prueba de conexión falló'));
    return res.json();
  },

  async sendDeviceHeartbeat(deviceId: string, latencyMs: number = 12.0) {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/heartbeat?latency_ms=${latencyMs}`, {
      method: 'POST',
    });
    return res.json();
  },

  // Stops / Paros
  async listStops(status?: string): Promise<Stop[]> {
    const url = status ? `${API_BASE}/stops?status=${status}` : `${API_BASE}/stops`;
    const res = await fetch(url);
    return res.json();
  },

  async createStop(stopData: Partial<Stop>): Promise<Stop> {
    const res = await fetch(`${API_BASE}/stops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stopData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error creating stop');
    }
    return res.json();
  },

  async updateStop(stopId: string, patch: Partial<Stop>): Promise<Stop> {
    const res = await fetch(`${API_BASE}/stops/${stopId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo actualizar el paro'));
    return res.json();
  },

  // Señales reales de un área y tarjetas RFID
  async getZoneSignals(zoneId: string): Promise<ZoneSignals> {
    const res = await fetch(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/signals`);
    if (!res.ok) throw new Error('Error fetching signals');
    return res.json();
  },

  async listBadges(): Promise<{ badges: Badge[]; unknown: { tag_id: string; last_seen: string; station_id?: string; reads: number }[] }> {
    const res = await fetch(`${API_BASE}/badges`);
    return res.json();
  },

  async saveBadge(b: Badge) {
    const res = await fetch(`${API_BASE}/badges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo guardar la tarjeta'));
    return res.json();
  },

  async deleteBadge(tagId: string) {
    await fetch(`${API_BASE}/badges/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
  },

  // Grabaciones (plan B)
  async listRecordings(): Promise<{ recordings: Recording[]; playback: Playback }> {
    const res = await fetch(`${API_BASE}/recordings`);
    return res.json();
  },

  async saveRecording(name: string, minutes: number): Promise<Recording> {
    const res = await fetch(`${API_BASE}/recordings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, minutes }),
    });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo guardar la grabación'));
    return res.json();
  },

  async playRecording(id: string, speed = 1, loop = true): Promise<Playback> {
    const res = await fetch(`${API_BASE}/recordings/${id}/play?speed=${speed}&loop=${loop}`, { method: 'POST' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo reproducir'));
    return res.json();
  },

  async deleteRecording(id: string) {
    const res = await fetch(`${API_BASE}/recordings/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await errorText(res, 'No se pudo eliminar'));
  },

  async closeStop(stopId: string, endedAt?: string): Promise<Stop> {
    const url = endedAt
      ? `${API_BASE}/stops/${stopId}/close?ended_at=${encodeURIComponent(endedAt)}`
      : `${API_BASE}/stops/${stopId}/close`;
    const res = await fetch(url, { method: 'PUT' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error closing stop');
    }
    return res.json();
  },

  async listStopReasons(): Promise<StopReason[]> {
    const res = await fetch(`${API_BASE}/stops/reasons`);
    return res.json();
  },

  // Alerts & Rules
  async listAlerts(status?: string): Promise<Alert[]> {
    const url = status ? `${API_BASE}/alerts?status=${status}` : `${API_BASE}/alerts`;
    const res = await fetch(url);
    return res.json();
  },

  async acknowledgeAlert(alertId: string, actor: string = 'Supervisor Planta'): Promise<Alert> {
    const res = await fetch(`${API_BASE}/alerts/${alertId}/acknowledge?actor=${encodeURIComponent(actor)}`, {
      method: 'PUT',
    });
    return res.json();
  },

  async resolveAlert(alertId: string, actor: string = 'Supervisor Planta'): Promise<Alert> {
    const res = await fetch(`${API_BASE}/alerts/${alertId}/resolve?actor=${encodeURIComponent(actor)}`, {
      method: 'PUT',
    });
    return res.json();
  },

  async listAlertRules(): Promise<AlertRuleConfig[]> {
    const res = await fetch(`${API_BASE}/alerts/rules`);
    return res.json();
  },

  async updateAlertRule(ruleId: string, ruleData: AlertRuleConfig): Promise<AlertRuleConfig> {
    const res = await fetch(`${API_BASE}/alerts/rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ruleData),
    });
    return res.json();
  },

  // Dashboards
  async listDashboards(): Promise<DashboardConfig[]> {
    const res = await fetch(`${API_BASE}/dashboards`);
    return res.json();
  },

  async getDashboard(dashboardId: string): Promise<DashboardConfig> {
    const res = await fetch(`${API_BASE}/dashboards/${dashboardId}`);
    return res.json();
  },

  async updateDashboard(dashboardId: string, config: Partial<DashboardConfig>): Promise<DashboardConfig> {
    const res = await fetch(`${API_BASE}/dashboards/${dashboardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.json();
  },

  // Simulator
  async getSimulatorStatus() {
    const res = await fetch(`${API_BASE}/simulator/status`);
    return res.json();
  },

  async startSimulator(speed: number = 1.0) {
    const res = await fetch(`${API_BASE}/simulator/start?speed=${speed}`, { method: 'POST' });
    return res.json();
  },

  async pauseSimulator() {
    const res = await fetch(`${API_BASE}/simulator/pause`, { method: 'POST' });
    return res.json();
  },

  async resetSimulator(hardReset: boolean = true) {
    const res = await fetch(`${API_BASE}/simulator/reset?hard_reset_demo_only=${hardReset}`, { method: 'POST' });
    return res.json();
  },

  async setSimulatorScene(sceneNumber: number) {
    const res = await fetch(`${API_BASE}/simulator/scene?scene_number=${sceneNumber}`, { method: 'POST' });
    return res.json();
  },

  async injectSimulatorEvent(eventData: Record<string, any>) {
    const res = await fetch(`${API_BASE}/simulator/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    });
    return res.json();
  },

  // Modules Catalog
  async listModules(): Promise<CatalogModule[]> {
    const res = await fetch(`${API_BASE}/modules`);
    return res.json();
  },
};
