import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { FloorPlan2D } from './components/FloorPlan2D';
import { DashboardGrid } from './components/DashboardGrid';
import { StopsModal } from './components/StopsModal';
import { SimulatorControls } from './components/SimulatorControls';
import { ModuleCatalogModal } from './components/ModuleCatalogModal';
import { AlertsManagerModal } from './components/AlertsManagerModal';
import { CalibrationModal } from './components/CalibrationModal';
import { ExportModal } from './components/ExportModal';
import { api } from './services/api';
import { wsClient } from './services/websocket';
import {
  EventMode,
  FloorPlan,
  PolygonZone,
  Station,
  Device,
  Stop,
  StopReason,
  Alert,
  AlertRuleConfig,
  MetricsSummary,
  DashboardConfig,
  CatalogModule,
  ScaleCalibration,
} from './types';

export const App: React.FC = () => {
  // Global State
  const [mode, setMode] = useState<EventMode>('demo');
  const [windowMinutes, setWindowMinutes] = useState<number>(60);
  const [shiftName, setShiftName] = useState<string>('Turno 1 - Matutino');
  const [isWsConnected, setIsWsConnected] = useState<boolean>(true);

  // Entities State
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [zones, setZones] = useState<PolygonZone[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopReasons, setStopReasons] = useState<StopReason[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRuleConfig[]>([]);
  const [modules, setModules] = useState<CatalogModule[]>([]);
  const [dashboards, setDashboards] = useState<DashboardConfig[]>([]);
  const [currentDashboard, setCurrentDashboard] = useState<DashboardConfig | null>(null);

  // Simulator State
  const [simRunning, setSimRunning] = useState<boolean>(true);
  const [simScene, setSimScene] = useState<number>(1);
  const [simSpeed, setSimSpeed] = useState<number>(1.0);
  const [tracks, setTracks] = useState<Record<string, { x: number; y: number; name: string }>>({
    'TRK-OP1': { x: 0.17, y: 0.38, name: 'Operador SMT' },
    'TRK-OP2': { x: 0.39, y: 0.38, name: 'Operador Reflow' },
    'TRK-OP3': { x: 0.61, y: 0.38, name: 'Operador AOI' },
    'TRK-OP4': { x: 0.83, y: 0.38, name: 'Operador Empaque' },
    'TRK-MAT': { x: 0.22, y: 0.75, name: 'Carro Materialista' },
  });

  // Modals Visibility
  const [isStopsModalOpen, setIsStopsModalOpen] = useState<boolean>(false);
  const [isSimModalOpen, setIsSimModalOpen] = useState<boolean>(false);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState<boolean>(false);
  const [isAlertsModalOpen, setIsAlertsModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isCalibModalOpen, setIsCalibModalOpen] = useState<boolean>(false);
  const [isEditingDashboard, setIsEditingDashboard] = useState<boolean>(false);

  // Initial Load
  const fetchAllData = useCallback(async () => {
    try {
      const [
        metricsData,
        fpList,
        zonesList,
        stationsList,
        devicesList,
        stopsList,
        reasonsList,
        alertsList,
        rulesList,
        modulesList,
        dashList,
      ] = await Promise.all([
        api.getMetrics(windowMinutes),
        api.listFloorPlans(),
        api.listZones(),
        api.listStations(),
        api.listDevices(),
        api.listStops(),
        api.listStopReasons(),
        api.listAlerts(),
        api.listAlertRules(),
        api.listModules(),
        api.listDashboards(),
      ]);

      setMetrics(metricsData);
      if (fpList.length > 0) setFloorPlan(fpList[0]);
      setZones(zonesList);
      setStations(stationsList);
      setDevices(devicesList);
      setStops(stopsList);
      setStopReasons(reasonsList);
      setAlerts(alertsList);
      setAlertRules(rulesList);
      setModules(modulesList);
      setDashboards(dashList);
      if (dashList.length > 0) setCurrentDashboard(dashList[0]);
    } catch (e) {
      console.error('Error fetching initial data:', e);
    }
  }, [windowMinutes]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // WebSocket Subscriber
  useEffect(() => {
    wsClient.connect();

    const unsubscribe = wsClient.subscribe((msg) => {
      if (msg.type === 'SIM_TICK') {
        if (msg.tracks) setTracks(msg.tracks);
        setSimScene(msg.scene);
      } else if (msg.type === 'NEW_EVENT' || msg.type === 'STOP_UPDATED' || msg.type === 'ALERT_UPDATED') {
        // Refresh metrics and entity lists on meaningful updates
        api.getMetrics(windowMinutes).then(setMetrics).catch(console.error);
        api.listAlerts().then(setAlerts).catch(console.error);
        api.listStops().then(setStops).catch(console.error);
        api.listStations().then(setStations).catch(console.error);
        api.listDevices().then(setDevices).catch(console.error);
      }
    });

    // Periodic Refresh Fallback every 4 seconds
    const interval = setInterval(() => {
      api.getMetrics(windowMinutes).then(setMetrics).catch(console.error);
      api.listAlerts().then(setAlerts).catch(console.error);
    }, 4000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [windowMinutes]);

  // Action Handlers
  const handleCreateStop = async (stopData: Partial<Stop>) => {
    await api.createStop(stopData);
    const updatedStops = await api.listStops();
    setStops(updatedStops);
    const updatedMetrics = await api.getMetrics(windowMinutes);
    setMetrics(updatedMetrics);
  };

  const handleCloseStop = async (stopId: string) => {
    await api.closeStop(stopId);
    const updatedStops = await api.listStops();
    setStops(updatedStops);
    const updatedMetrics = await api.getMetrics(windowMinutes);
    setMetrics(updatedMetrics);
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    await api.acknowledgeAlert(alertId);
    const updatedAlerts = await api.listAlerts();
    setAlerts(updatedAlerts);
  };

  const handleResolveAlert = async (alertId: string) => {
    await api.resolveAlert(alertId);
    const updatedAlerts = await api.listAlerts();
    setAlerts(updatedAlerts);
  };

  const handleUpdateRule = async (ruleId: string, ruleData: AlertRuleConfig) => {
    await api.updateAlertRule(ruleId, ruleData);
    const updatedRules = await api.listAlertRules();
    setAlertRules(updatedRules);
  };

  const handleUpdateCalibration = async (calib: ScaleCalibration) => {
    if (floorPlan) {
      const updatedFp = await api.updateCalibration(floorPlan.id, calib);
      setFloorPlan(updatedFp);
      const updatedMetrics = await api.getMetrics(windowMinutes);
      setMetrics(updatedMetrics);
    }
  };

  // Simulator Handlers
  const handleStartSim = async (speed: number) => {
    await api.startSimulator(speed);
    setSimRunning(true);
    setSimSpeed(speed);
  };

  const handlePauseSim = async () => {
    await api.pauseSimulator();
    setSimRunning(false);
  };

  const handleResetSim = async () => {
    await api.resetSimulator(true);
    setSimScene(1);
    fetchAllData();
  };

  const handleSetScene = async (sceneNum: number) => {
    await api.setSimulatorScene(sceneNum);
    setSimScene(sceneNum);
  };

  const handleInjectEvent = async (eventData: Record<string, any>) => {
    await api.injectSimulatorEvent(eventData);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Global Navigation Bar */}
      <Header
        mode={mode}
        onModeChange={setMode}
        windowMinutes={windowMinutes}
        onWindowChange={setWindowMinutes}
        shiftName={shiftName}
        onShiftChange={setShiftName}
        onOpenStopsModal={() => setIsStopsModalOpen(true)}
        onOpenSimulatorModal={() => setIsSimModalOpen(true)}
        onOpenCatalogModal={() => setIsCatalogModalOpen(true)}
        onOpenAlertsModal={() => setIsAlertsModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onOpenCalibrationModal={() => setIsCalibModalOpen(true)}
        onToggleEditDashboard={() => setIsEditingDashboard(!isEditingDashboard)}
        isEditingDashboard={isEditingDashboard}
        activeAlertsCount={alerts.filter((a) => a.status === 'new').length}
        openStopsCount={stops.filter((s) => s.status === 'open').length}
        isWsConnected={isWsConnected}
      />

      {/* Main Production Floor & Dashboard Container */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-4 space-y-4">
        {/* Top Split: Interactive 2D Map on Left / KPIs & Analytics on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* 2D Floor Plan (5 cols on large screens) */}
          <div className="lg:col-span-5 h-[520px]">
            <FloorPlan2D
              floorPlan={floorPlan}
              zones={zones}
              stations={stations}
              tracks={tracks}
              distances={metrics?.distances || []}
              onUpdateCalibration={handleUpdateCalibration}
            />
          </div>

          {/* Core Analytics Dashboard (7 cols on large screens) */}
          <div className="lg:col-span-7">
            <DashboardGrid
              widgets={currentDashboard?.widgets || []}
              metrics={metrics}
              alerts={alerts}
              stops={stops}
              stations={stations}
              devices={devices}
              isEditing={isEditingDashboard}
              onAcknowledgeAlert={handleAcknowledgeAlert}
              onResolveAlert={handleResolveAlert}
              onCloseStop={handleCloseStop}
            />
          </div>
        </div>
      </main>

      {/* Modals & Dialogs */}
      <StopsModal
        isOpen={isStopsModalOpen}
        onClose={() => setIsStopsModalOpen(false)}
        onSubmit={handleCreateStop}
        stopReasons={stopReasons}
      />

      <SimulatorControls
        isOpen={isSimModalOpen}
        onClose={() => setIsSimModalOpen(false)}
        isRunning={simRunning}
        currentScene={simScene}
        speed={simSpeed}
        onStart={handleStartSim}
        onPause={handlePauseSim}
        onReset={handleResetSim}
        onSetScene={handleSetScene}
        onInjectEvent={handleInjectEvent}
      />

      <ModuleCatalogModal
        isOpen={isCatalogModalOpen}
        onClose={() => setIsCatalogModalOpen(false)}
        modules={modules}
      />

      <AlertsManagerModal
        isOpen={isAlertsModalOpen}
        onClose={() => setIsAlertsModalOpen(false)}
        alerts={alerts}
        rules={alertRules}
        onAcknowledgeAlert={handleAcknowledgeAlert}
        onResolveAlert={handleResolveAlert}
        onUpdateRule={handleUpdateRule}
      />

      <CalibrationModal
        isOpen={isCalibModalOpen}
        onClose={() => setIsCalibModalOpen(false)}
        calibration={
          floorPlan?.calibration || {
            is_calibrated: true,
            point1: [0.05, 0.5],
            point2: [0.95, 0.5],
            real_distance_meters: 36.0,
            meters_per_norm_unit: 40.0,
          }
        }
        onSave={handleUpdateCalibration}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />
    </div>
  );
};
