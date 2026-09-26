import {
  FloorPlan, PolygonZone, Station, Device, Stop, StopReason,
  Alert, AlertRuleConfig, MetricsSummary, DashboardConfig,
  CatalogModule, ScaleCalibration
} from '../types';

const API_BASE = '/api';

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

  // Devices
  async listDevices(): Promise<Device[]> {
    const res = await fetch(`${API_BASE}/devices`);
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
