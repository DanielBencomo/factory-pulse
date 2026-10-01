import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar, Page, PAGES } from './components/Sidebar';
import { FloorPlan2D } from './components/FloorPlan2D';
import { ZoneOccupancyPanel } from './components/ZoneOccupancyPanel';
import { SpatialInsightsPanel } from './components/SpatialInsightsPanel';
import { KpiStrip, StationTablePanel, AlertsPanel, StopsPanel, SourcesStrip } from './components/DashboardGrid';
import { StopsModal } from './components/StopsModal';
import { SimulatorControls } from './components/SimulatorControls';
import { ModuleCatalogModal } from './components/ModuleCatalogModal';
import { AlertsManagerModal } from './components/AlertsManagerModal';
import { CalibrationModal } from './components/CalibrationModal';
import { ExportModal } from './components/ExportModal';
import { LayoutEditor } from './components/LayoutEditor';
import { InteriorEditor } from './components/InteriorEditor';
import { DevicesPage } from './pages/DevicesPage';
import { CamerasPage } from './pages/CamerasPage';
import { RecordingsModal } from './components/RecordingsModal';
import { JustifyStopModal } from './components/JustifyStopModal';
import { api } from './services/api';
import { wsClient } from './services/websocket';
import {
  Analytics,
  FloorPlan,
  PolygonZone,
  Station,
  Device,
  Stop,
  StopReason,
  Alert,
  AlertRuleConfig,
  MetricsSummary,
  CatalogModule,
  ScaleCalibration,
  Layout,
  Line,
  SystemMode,
  Playback,
  SpatialLayer,
  SpatialSummary,
  CameraConfig,
} from './types';

// ECharts pesa mucho y solo se necesita al abrir Métricas. Cargar esa página
// bajo demanda mantiene ágil la vista principal de planta/cámara.
const MetricsPage = React.lazy(() => import('./pages/MetricsPage').then((module) => ({ default: module.MetricsPage })));

const pageFromHash = (): Page => {
  const h = window.location.hash.replace(/^#\/?/, '') as Page;
  return PAGES.some((p) => p.id === h) ? h : 'planta';
};

export const App: React.FC = () => {
  // Navegación y contexto
  const [page, setPage] = useState<Page>(pageFromHash);
  const [windowMinutes, setWindowMinutes] = useState<number>(60);
  const [lineId, setLineId] = useState<string>('line-1');
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [mode, setMode] = useState<SystemMode>('demo');
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);

  // Datos
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [zones, setZones] = useState<PolygonZone[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopReasons, setStopReasons] = useState<StopReason[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRuleConfig[]>([]);
  const [modules, setModules] = useState<CatalogModule[]>([]);
  const [spatial, setSpatial] = useState<SpatialSummary | null>(null);
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [focusZoneId, setFocusZoneId] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<SpatialLayer | null>(null);
  const [mapRequestVersion, setMapRequestVersion] = useState(0);

  // Simulador
  const [simRunning, setSimRunning] = useState<boolean>(true);
  const [simScene, setSimScene] = useState<number>(1);
  const [simSpeed, setSimSpeed] = useState<number>(1.0);
  const [tickTime, setTickTime] = useState<number | undefined>(undefined);
  const [tracks, setTracks] = useState<Record<string, { x: number; y: number; name: string }>>({});

  // Editores y modales
  const [layoutDraft, setLayoutDraft] = useState<Layout | null>(null);
  const [interiorZoneId, setInteriorZoneId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'stop' | 'sim' | 'modules' | 'rules' | 'export' | 'calib' | 'recordings'>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [justifying, setJustifying] = useState<Stop | null>(null);

  /* ── navegación por hash (#/metricas, #/dispositivos…) ── */
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (p: Page) => {
    setInteriorZoneId(null);
    window.location.hash = `/${p}`;
    setPage(p);
  };

  /* ── carga ── */
  const refreshLayout = useCallback(async () => {
    const [fpList, zonesList, stationsList, linesList] = await Promise.all([api.listFloorPlans(), api.listZones(), api.listStations(), api.listLines()]);
    if (fpList.length > 0) setFloorPlan(fpList[0]);
    setZones(zonesList);
    setStations(stationsList);
    setLines(linesList);
  }, []);

  const refreshAnalytics = useCallback(() => {
    api.getAnalytics(lineId, windowMinutes).then(setAnalytics).catch(console.error);
    api.getMetrics(windowMinutes, lineId).then(setMetrics).catch(console.error);
  }, [lineId, windowMinutes]);

  const refreshSpatial = useCallback(() => {
    api.getSpatialSummary('plant', null, windowMinutes, mode)
      .then((value) => {
        setSpatial(value);
        setSpatialError(null);
      })
      .catch((error) => setSpatialError(error instanceof Error ? error.message : 'Error desconocido'));
  }, [windowMinutes, mode]);

  const refreshDevices = useCallback(() => api.listDevices().then(setDevices).catch(console.error), []);
  const refreshCameras = useCallback(() => api.listCameras().then(setCameras).catch(console.error), []);

  // Carga completa. Se repite cada vez que vuelve la conexión con el servidor, para que
  // un reinicio del backend durante la demo no deje la pantalla vacía.
  const loadAll = useCallback(() => {
    refreshLayout().catch(console.error);
    refreshDevices();
    refreshCameras();
    api.getSystemMode().then((m) => {
      setMode(m.mode);
      setSimRunning(m.simulator_running);
      setPlayback(m.playback ?? null);
    }).catch(console.error);
    Promise.all([api.listStops(), api.listStopReasons(), api.listAlerts(), api.listAlertRules(), api.listModules()])
      .then(([s, r, a, rules, mods]) => {
        setStops(s);
        setStopReasons(r);
        setAlerts(a);
        setAlertRules(rules);
        setModules(mods);
      })
      .catch(console.error);
  }, [refreshLayout, refreshDevices, refreshCameras]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    refreshAnalytics();
    const id = setInterval(refreshAnalytics, 10_000);
    return () => clearInterval(id);
  }, [refreshAnalytics]);

  useEffect(() => {
    refreshSpatial();
    const id = setInterval(refreshSpatial, 5_000);
    return () => clearInterval(id);
  }, [refreshSpatial]);

  // El estado de los dispositivos depende del tiempo transcurrido: se consulta seguido.
  useEffect(() => {
    const id = setInterval(() => {
      refreshDevices();
      refreshCameras();
    }, 5_000);
    return () => clearInterval(id);
  }, [refreshDevices, refreshCameras]);

  /* ── tiempo real ── */
  useEffect(() => {
    wsClient.connect();
    let wasOpen = true;
    const offStatus = wsClient.onStatus((open) => {
      setIsWsConnected(open);
      if (open && !wasOpen) loadAll();
      wasOpen = open;
    });
    // Los eventos reales pueden llegar varias veces por segundo: se agrupan las recargas.
    let pending: number | null = null;
    const refreshSoon = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        api.listAlerts().then(setAlerts).catch(console.error);
        api.listStops().then(setStops).catch(console.error);
        api.listStations().then(setStations).catch(console.error);
      }, 1500);
    };
    const off = wsClient.subscribe((msg) => {
      if (msg.type === 'SIM_TICK' || msg.type === 'TRACKS') {
        if (msg.tracks) setTracks(msg.tracks);
        setSimScene(msg.scene);
        if (msg.sim_time) setTickTime(Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(msg.sim_time) ? msg.sim_time : `${msg.sim_time}Z`));
      } else if (msg.type === 'LAYOUT_UPDATED') {
        refreshLayout().catch(console.error);
      } else if (msg.type === 'DEVICE_CONNECTED') {
        refreshDevices();
        refreshCameras();
      } else if (msg.type === 'MODE_CHANGED') {
        setMode(msg.mode);
        if (msg.mode !== 'demo') setTracks({});
        api.getSystemMode().then((m) => setPlayback(m.playback ?? null)).catch(console.error);
      } else if (msg.type === 'NEW_EVENT' || msg.type === 'STOP_UPDATED' || msg.type === 'ALERT_UPDATED') {
        if (msg.event?.type === 'position') return;
        refreshSoon();
      }
    });
    const slow = setInterval(() => api.listAlerts().then(setAlerts).catch(console.error), 8_000);
    return () => {
      off();
      offStatus();
      clearInterval(slow);
      if (pending !== null) clearTimeout(pending);
    };
  }, [refreshLayout, refreshDevices, refreshCameras, loadAll]);

  /* ── acciones ── */
  const changeMode = async (m: SystemMode) => {
    try {
      const r = await api.setSystemMode(m);
      setMode(r.mode);
      setSimRunning(r.simulator_running);
      setPlayback(r.playback ?? null);
      if (r.mode !== 'demo') setTracks({});
      refreshAnalytics();
    } catch (e) {
      console.error(e);
    }
  };

  const changeLine = (id: string) => {
    setLineId(id);
    setFocusLineId(id);
  };

  const handleCreateStop = async (stopData: Partial<Stop>) => {
    await api.createStop(stopData);
    setStops(await api.listStops());
    refreshAnalytics();
  };
  const handleCloseStop = async (stopId: string) => {
    await api.closeStop(stopId);
    setStops(await api.listStops());
    refreshAnalytics();
  };
  const handleAcknowledgeAlert = async (alertId: string) => {
    await api.acknowledgeAlert(alertId);
    setAlerts(await api.listAlerts());
  };
  const handleResolveAlert = async (alertId: string) => {
    await api.resolveAlert(alertId);
    setAlerts(await api.listAlerts());
  };
  const handleUpdateRule = async (ruleId: string, ruleData: AlertRuleConfig) => {
    await api.updateAlertRule(ruleId, ruleData);
    setAlertRules(await api.listAlertRules());
  };
  const handleUpdateCalibration = async (calib: ScaleCalibration) => {
    if (floorPlan) setFloorPlan(await api.updateCalibration(floorPlan.id, calib));
  };

  const openLayoutEditor = async () => {
    try {
      setLayoutDraft(await api.getLayout());
    } catch (e) {
      console.error(e);
    }
  };
  useEffect(() => {
    if (page === 'layout' && !layoutDraft) openLayoutEditor();
    if (page !== 'layout' && layoutDraft) setLayoutDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  /* ── derivados ── */
  const lineName = lines.find((l) => l.id === lineId)?.name;
  const realDevices = devices.filter((d) => !d.simulated && d.is_active && d.type !== 'camera_vision');
  const pendingDevices = devices.filter((d) => !d.simulated && !d.is_active && d.type !== 'camera_vision').length;
  const openStops = stops.filter((s) => s.status === 'open').length;
  const interiorZone = zones.find((z) => z.id === interiorZoneId) ?? null;
  const pageTitle = interiorZone ? `Interior · ${interiorZone.name}` : PAGES.find((p) => p.id === page)?.title ?? '';

  /* ── contenido ── */
  let content: React.ReactNode;
  if (interiorZone && floorPlan) {
    content = (
      <InteriorEditor
        key={interiorZone.id}
        zone={interiorZone}
        station={stations.find((s) => interiorZone.station_ids.includes(s.station_id))}
        widthM={floorPlan.width_meters}
        heightM={floorPlan.height_meters}
        devices={devices}
        onCancel={() => setInteriorZoneId(null)}
        onSaved={() => {
          setInteriorZoneId(null);
          refreshLayout().catch(console.error);
        }}
      />
    );
  } else if (page === 'planta') {
    content = (
      <div className="space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8 min-w-0">
            <FloorPlan2D
              floorPlan={floorPlan}
              zones={zones}
              stations={stations}
              lines={lines}
              stationMetrics={metrics?.stations}
              stops={stops}
              tracks={tracks}
              tickTime={tickTime}
              devices={devices}
              mode={mode}
              focusLineId={focusLineId}
              focusZoneId={focusZoneId}
              requestedLayer={mapLayer}
              requestVersion={mapRequestVersion}
              onScopeLineChange={setLineId}
              onEditLayout={() => navigate('layout')}
              onEditInterior={setInteriorZoneId}
            />
          </div>
          <div className="xl:col-span-4 min-w-0">
            <SpatialInsightsPanel
              data={spatial}
              error={spatialError}
              onRetry={refreshSpatial}
              onExplore={(zoneId, layer) => {
                setFocusZoneId(zoneId ?? '__plant__');
                setMapLayer(layer);
                setMapRequestVersion((version) => version + 1);
              }}
            />
          </div>
        </div>
        <KpiStrip analytics={analytics} />
        <SourcesStrip devices={devices} tracksCount={Object.keys(tracks).length} mode={mode} />
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-7 min-w-0">
            <StationTablePanel analytics={analytics} metrics={metrics} lineName={lineName} />
          </div>
          <div className="xl:col-span-5 min-w-0">
            <AlertsPanel
              alerts={alerts}
              onAcknowledgeAlert={handleAcknowledgeAlert}
              onResolveAlert={handleResolveAlert}
              limit={4}
              action={
                alerts.length > 4 ? (
                  <button className="btn btn-sm btn-ghost" onClick={() => navigate('eventos')}>
                    Ver todas
                  </button>
                ) : undefined
              }
            />
          </div>
        </div>
      </div>
    );
  } else if (page === 'camara') {
    content = (
      <div className="space-y-4">
        <CamerasPage
          cameras={cameras} mode={mode} floorPlan={floorPlan}
          zones={zones} lines={lines} stations={stations}
          onChanged={async () => { await Promise.all([refreshCameras(), refreshDevices()]); }}
          onLayoutChanged={refreshLayout}
        />
        <ZoneOccupancyPanel mode={mode} />
      </div>
    );
  } else if (page === 'metricas') {
    content = (
      <React.Suspense fallback={<div className="panel p-10 text-center text-ink-3 text-[13px]">Cargando analíticas…</div>}>
        <MetricsPage analytics={analytics} spatial={spatial} lineName={lineName} />
      </React.Suspense>
    );
  } else if (page === 'eventos') {
    content = (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 min-w-0">
          <StopsPanel
            stops={stops}
            onCloseStop={handleCloseStop}
            onJustify={setJustifying}
            limit={30}
            action={
              <button className="btn btn-sm btn-danger" onClick={() => setModal('stop')}>
                Declarar paro
              </button>
            }
          />
        </div>
        <div className="xl:col-span-5 min-w-0">
          <AlertsPanel
            alerts={alerts}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            onResolveAlert={handleResolveAlert}
            limit={30}
            action={
              <button className="btn btn-sm" onClick={() => setModal('rules')}>
                Reglas
              </button>
            }
          />
        </div>
      </div>
    );
  } else if (page === 'dispositivos') {
    content = <DevicesPage devices={devices} stations={stations} mode={mode} onModeChange={changeMode} onChanged={refreshDevices} />;
  } else if (page === 'layout') {
    content = layoutDraft ? (
      <LayoutEditor
        key={JSON.stringify(layoutDraft.floor_plan) + layoutDraft.zones.length}
        initial={layoutDraft}
        onCancel={() => navigate('planta')}
        onSaved={(saved) => {
          setLayoutDraft(saved);
          refreshLayout().catch(console.error);
        }}
        onEditInterior={setInteriorZoneId}
      />
    ) : (
      <div className="panel p-10 text-center text-ink-3">Cargando layout…</div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col lg:flex-row">
      <Sidebar
        page={page}
        onNavigate={navigate}
        alertsNew={alerts.filter((a) => a.status === 'new').length}
        openStops={openStops}
        devicesOnline={realDevices.filter((d) => d.status === 'online').length}
        devicesReal={realDevices.length}
        devicesPending={pendingDevices}
        simulatorAvailable={mode === 'demo'}
        onOpenSimulator={() => setModal('sim')}
        onOpenRecordings={() => setModal('recordings')}
        onOpenCalibration={() => setModal('calib')}
        onOpenModules={() => setModal('modules')}
        onOpenExport={() => setModal('export')}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <Header
          title={pageTitle}
          lines={lines}
          lineId={lineId}
          onLineChange={changeLine}
          windowMinutes={windowMinutes}
          onWindowChange={setWindowMinutes}
          mode={mode}
          onModeChange={changeMode}
          playback={playback}
          isWsConnected={isWsConnected}
          openStopsCount={openStops}
          onDeclareStop={() => setModal('stop')}
          showContext={page === 'planta' || page === 'metricas'}
        />
        {mode === 'replay' && (
          <div className="px-4 lg:px-6 py-2 text-[12.5px] bg-warn-soft text-warn border-b border-line flex items-center gap-3">
            Reproduciendo la grabación “{playback?.name ?? '…'}”: los tableros muestran datos grabados, no la planta en este momento.
            <button className="btn btn-sm ml-auto" onClick={() => changeMode('live')}>
              Detener y volver a En vivo
            </button>
          </div>
        )}
        {mode === 'live' && page !== 'dispositivos' && realDevices.every((d) => d.status !== 'online') && (
          <div className="px-4 lg:px-6 py-2 text-[12.5px] bg-info-soft text-info border-b border-line flex items-center gap-3">
            En vivo: el simulador está apagado y todavía no hay dispositivos conectados, por eso los tableros aparecen vacíos.
            <button className="btn btn-sm ml-auto" onClick={() => navigate('dispositivos')}>
              Ver dispositivos
            </button>
          </div>
        )}
        <main className="flex-1 w-full max-w-[1800px] mx-auto px-4 lg:px-6 py-4 lg:py-5">{content}</main>
      </div>

      {modal === 'stop' && (
        <StopsModal
          isOpen
          onClose={() => setModal(null)}
          onSubmit={handleCreateStop}
          stopReasons={stopReasons}
          lines={lines}
          stations={stations}
          zones={zones}
          defaultLineId={lineId}
        />
      )}
      <SimulatorControls
        isOpen={modal === 'sim'}
        onClose={() => setModal(null)}
        isRunning={simRunning}
        currentScene={simScene}
        speed={simSpeed}
        onStart={async (speed) => {
          await api.startSimulator(speed);
          setSimRunning(true);
          setSimSpeed(speed);
        }}
        onPause={async () => {
          await api.pauseSimulator();
          setSimRunning(false);
        }}
        onReset={async () => {
          await api.resetSimulator(true);
          setSimScene(1);
          refreshAnalytics();
          refreshSpatial();
        }}
        onSetScene={async (n) => {
          await api.setSimulatorScene(n);
          setSimScene(n);
        }}
        onInjectEvent={(ev) => api.injectSimulatorEvent(ev)}
      />
      <ModuleCatalogModal isOpen={modal === 'modules'} onClose={() => setModal(null)} modules={modules} />
      <AlertsManagerModal
        key={modal === 'rules' ? 'rules' : 'closed'}
        isOpen={modal === 'rules'}
        initialTab="rules"
        onClose={() => setModal(null)}
        alerts={alerts}
        rules={alertRules}
        onAcknowledgeAlert={handleAcknowledgeAlert}
        onResolveAlert={handleResolveAlert}
        onUpdateRule={handleUpdateRule}
      />
      {modal === 'calib' && (
        <CalibrationModal
          isOpen
          onClose={() => setModal(null)}
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
      )}
      <ExportModal isOpen={modal === 'export'} onClose={() => setModal(null)} />
      {modal === 'recordings' && (
        <RecordingsModal
          mode={mode}
          playback={playback}
          onClose={() => setModal(null)}
          onPlaybackChange={(p) => {
            setPlayback(p);
            refreshAnalytics();
          }}
          onStop={() => changeMode('live')}
        />
      )}
      {justifying && (
        <JustifyStopModal
          stop={justifying}
          reasons={stopReasons}
          onClose={() => setJustifying(null)}
          onSaved={async () => {
            setJustifying(null);
            setStops(await api.listStops());
            refreshAnalytics();
          }}
        />
      )}
    </div>
  );
};
