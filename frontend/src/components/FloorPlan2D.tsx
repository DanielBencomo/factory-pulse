import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, PencilRuler, SlidersHorizontal } from 'lucide-react';
import { Device, FloorPlan, Line, PolygonZone, SpatialLayer, Station, StationMetric, Stop, SystemMode, TrackPoint } from '../types';
import { Popover } from './Popover';
import { interiorOf } from '../layout/interior';
import { C, FONT_MONO, FONT_SANS, ZONE_TINT, statusOf, trackColor } from '../theme';
import { api } from '../services/api';
import {
  PLAN_W,
  Poly,
  bbox,
  planHeight,
  pointInPolygon,
  lineArea,
  lineOfZone,
  stationOfZone,
  runsInside,
  statsInside,
  stationTransitions,
  shortStationName,
} from '../layout/geometry';
import { Track, ZoneLogEntry, deriveCsi, StationDrawing, ZoneReadout } from './StationDetail';

interface FloorPlan2DProps {
  floorPlan: FloorPlan | null;
  zones: PolygonZone[];
  stations: Station[];
  lines: Line[];
  stationMetrics?: StationMetric[];
  stops?: Stop[];
  tracks: Record<string, Track>;
  /** Marca de tiempo (ms) del último tick recibido; si falta se usa el reloj local. */
  tickTime?: number;
  devices?: Device[];
  mode?: SystemMode;
  /** Pide al plano que abra una línea (p. ej. al cambiarla en el encabezado). */
  focusLineId?: string | null;
  /** Abre una zona desde una observación explicable del panel lateral. */
  focusZoneId?: string | null;
  /** Activa la capa relacionada con la observación seleccionada. */
  requestedLayer?: SpatialLayer | null;
  requestVersion?: number;
  onScopeLineChange?: (lineId: string) => void;
  onEditLayout?: () => void;
  onEditInterior?: (zoneId: string) => void;
}

type Scope = { kind: 'plant' } | { kind: 'line'; id: string } | { kind: 'zone'; id: string };
type VB = [number, number, number, number];

const ZOOM_MS = 480;
const HISTORY_MINUTES = 60;
const SPAGHETTI_WINDOWS = [5, 15, 30, 60];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const fmtMin = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);

export const FloorPlan2D: React.FC<FloorPlan2DProps> = ({
  floorPlan,
  zones,
  stations,
  lines,
  stationMetrics = [],
  stops = [],
  tracks,
  tickTime,
  devices = [],
  mode = 'demo',
  focusLineId,
  focusZoneId,
  requestedLayer,
  requestVersion = 0,
  onScopeLineChange,
  onEditLayout,
  onEditInterior,
}) => {
  const [showSpaghetti, setShowSpaghetti] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatMode, setHeatMode] = useState<'traffic' | 'dwell'>('traffic');
  const [showZones, setShowZones] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState<string>('all');
  const [spaghettiMin, setSpaghettiMin] = useState(15);
  const [history, setHistory] = useState<Record<string, TrackPoint[]>>({});
  const [zoneLog, setZoneLog] = useState<ZoneLogEntry[]>([]);
  const [scope, setScope] = useState<Scope>({ kind: 'plant' });

  const mPerX = floorPlan?.width_meters ?? 40;
  const mPerY = floorPlan?.height_meters ?? 25;
  const planH = planHeight(mPerX, mPerY);
  const FULL: VB = useMemo(() => [0, 0, PLAN_W, planH], [planH]);

  /* ── historial de trayectorias: carga inicial + ticks en vivo ── */
  useEffect(() => {
    api.getTrackHistory(HISTORY_MINUTES).then((h) => setHistory((prev) => ({ ...h, ...mergeLive(prev, h) })));
  }, []);

  // Al cambiar entre demo y en vivo no se mezclan trayectorias: se recarga el historial del modo nuevo.
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    setHistory({});
    setZoneLog([]);
    membership.current = {};
    api.getTrackHistory(HISTORY_MINUTES).then((h) => setHistory((prev) => ({ ...h, ...mergeLive(prev, h) })));
  }, [mode]);

  // Si cambian las medidas de la nave, el historial viejo queda en otro marco de coordenadas.
  const dimsKey = floorPlan ? `${floorPlan.width_meters}x${floorPlan.height_meters}` : null;
  const lastDims = useRef(dimsKey);
  useEffect(() => {
    if (!dimsKey || lastDims.current === null || lastDims.current === dimsKey) {
      lastDims.current = dimsKey;
      return;
    }
    lastDims.current = dimsKey;
    setHistory({});
    api.getTrackHistory(HISTORY_MINUTES).then((h) => setHistory((prev) => ({ ...h, ...mergeLive(prev, h) })));
  }, [dimsKey]);

  const membership = useRef<Record<string, string | null>>({});

  useEffect(() => {
    const t = tickTime ?? Date.now();
    setHistory((prev) => {
      const next = { ...prev };
      Object.entries(tracks).forEach(([id, pt]) => {
        const h = next[id] ?? [];
        const last = h[h.length - 1];
        if (last && t <= last[2]) return;
        if (!last || Math.abs(last[0] - pt.x) > 0.002 || Math.abs(last[1] - pt.y) > 0.002 || t - last[2] > 10_000) {
          const cutoff = t - HISTORY_MINUTES * 60_000;
          next[id] = [...h.filter((p) => p[2] >= cutoff).slice(-2000), [pt.x, pt.y, t]];
        }
      });
      return next;
    });

    // Bitácora de entradas/salidas por estación (emula las lecturas del RC522)
    if (zones.length === 0) return;
    const now = Date.now();
    const events: ZoneLogEntry[] = [];
    Object.entries(tracks).forEach(([id, pt]) => {
      const z = zones.find((zz) => zz.type === 'work' && pointInPolygon(pt.x, pt.y, zz.polygon));
      const prev = membership.current[id];
      const cur = z?.id ?? null;
      if (prev === undefined) {
        membership.current[id] = cur;
        if (cur) events.push({ t: now, trackId: id, zoneId: cur, kind: 'entrada' });
        return;
      }
      if (prev !== cur) {
        if (prev) events.push({ t: now, trackId: id, zoneId: prev, kind: 'salida' });
        if (cur) events.push({ t: now, trackId: id, zoneId: cur, kind: 'entrada' });
        membership.current[id] = cur;
      }
    });
    if (events.length) setZoneLog((l) => [...l.slice(-200), ...events]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, zones]);

  /* ── alcance: planta → línea → estación ── */
  const areas = useMemo(() => {
    const m: Record<string, Poly> = {};
    lines.forEach((l) => {
      const a = lineArea(l, zones, stations);
      if (a) m[l.id] = a;
    });
    return m;
  }, [lines, zones, stations]);

  const scopeZone = scope.kind === 'zone' ? zones.find((z) => z.id === scope.id) ?? null : null;
  const scopeLineId = scope.kind === 'line' ? scope.id : scopeZone ? lineOfZone(scopeZone, stations) : null;
  const scopeLine = lines.find((l) => l.id === scopeLineId) ?? null;
  const scopePoly: Poly | null = scopeZone ? scopeZone.polygon : scope.kind === 'line' ? areas[scope.id] ?? null : null;

  useEffect(() => {
    if (focusLineId && focusLineId !== scopeLineId && areas[focusLineId]) setScope({ kind: 'line', id: focusLineId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLineId]);

  useEffect(() => {
    if (!focusZoneId) return;
    if (focusZoneId === '__plant__') {
      setScope({ kind: 'plant' });
      return;
    }
    const zone = zones.find((z) => z.id === focusZoneId || z.zone_id === focusZoneId);
    if (zone) setScope({ kind: 'zone', id: zone.id });
  }, [focusZoneId, zones, requestVersion]);

  useEffect(() => {
    if (!requestedLayer) return;
    if (requestedLayer === 'zones') setShowZones(true);
    if (requestedLayer === 'routes') {
      setShowSpaghetti(true);
      setShowHeatmap(false);
    }
    if (requestedLayer === 'traffic' || requestedLayer === 'dwell') {
      setShowHeatmap(true);
      setHeatMode(requestedLayer);
    }
  }, [requestedLayer, requestVersion]);

  // Si el layout cambia y el alcance ya no existe, volver a planta.
  useEffect(() => {
    if (scope.kind === 'zone' && !scopeZone) setScope({ kind: 'plant' });
    if (scope.kind === 'line' && !areas[scope.id]) setScope({ kind: 'plant' });
  }, [scope, scopeZone, areas]);

  useEffect(() => {
    if (scopeLineId) onScopeLineChange?.(scopeLineId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLineId]);

  const lineStationZones = useCallback(
    (lineId: string) =>
      zones
        .filter((z) => z.type === 'work' && lineOfZone(z, stations) === lineId)
        .map((z) => ({ z, st: stationOfZone(z, stations) }))
        .sort((a, b) => (a.st?.order_in_line ?? 99) - (b.st?.order_in_line ?? 99)),
    [zones, stations],
  );

  /* ── viewBox animado ── */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const target = useMemo((): VB => {
    if (!scopePoly) return FULL;
    const b = bbox(scopePoly);
    const pad = 14;
    let w = (b.x1 - b.x0) * PLAN_W + pad * 2;
    let h = (b.y1 - b.y0) * planH + pad * 2;
    const aspect = size.w / Math.max(size.h, 1);
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    const cx = ((b.x0 + b.x1) / 2) * PLAN_W;
    const cy = ((b.y0 + b.y1) / 2) * planH;
    return [cx - w / 2, cy - h / 2, w, h];
  }, [scopePoly, size.w, size.h, planH, FULL]);

  const [vb, setVb] = useState<VB>(FULL);
  const vbRef = useRef<VB>(FULL);
  const scopeKey = scope.kind === 'plant' ? 'plant' : `${scope.kind}:${scope.id}`;
  const lastScopeKey = useRef(scopeKey);

  useEffect(() => {
    const from = vbRef.current;
    const animate = lastScopeKey.current !== scopeKey && !prefersReducedMotion();
    lastScopeKey.current = scopeKey;
    if (!animate) {
      vbRef.current = target;
      setVb(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = ease(Math.min(1, (t - t0) / ZOOM_MS));
      const v = from.map((f, i) => f + (target[i] - f) * k) as VB;
      vbRef.current = v;
      setVb(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const ppu = Math.min(size.w / vb[2], size.h / vb[3]);
  const px = (n: number) => n / ppu;
  const unit = PLAN_W / mPerX; // unidades del plano por metro
  const scaleM = [1, 2, 5, 10, 20].find((m) => ppu * unit * m >= 48) ?? 20;

  /* ── navegación ── */
  const siblings: string[] = useMemo(() => {
    if (scope.kind === 'line') return [...lines].sort((a, b) => a.order - b.order).filter((l) => areas[l.id]).map((l) => l.id);
    if (scope.kind === 'zone' && scopeZone?.type === 'work' && scopeLineId) return lineStationZones(scopeLineId).map((x) => x.z.id);
    return [];
  }, [scope, scopeZone, scopeLineId, lines, areas, lineStationZones]);
  const sibIdx = scope.kind === 'plant' ? -1 : siblings.indexOf(scope.id);

  const go = (d: number) => {
    if (sibIdx < 0 || scope.kind === 'plant') return;
    const id = siblings[(sibIdx + d + siblings.length) % siblings.length];
    setScope({ kind: scope.kind, id } as Scope);
  };
  const up = () => {
    if (scope.kind === 'zone' && scopeLineId && areas[scopeLineId]) setScope({ kind: 'line', id: scopeLineId });
    else setScope({ kind: 'plant' });
  };

  useEffect(() => {
    if (scope.kind === 'plant') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea,[role=dialog]')) return;
      if (e.key === 'Escape') up();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── datos derivados ── */
  const metricFor = (st?: Station) => (st ? stationMetrics.find((m) => m.station_id === st.station_id) : undefined);
  const statusFor = (st: Station) => metricFor(st)?.current_status ?? st.current_status;
  const privateZones = zones.filter((z) => z.is_aggregated_only);
  const isPrivate = (x: number, y: number) => privateZones.some((z) => pointInPolygon(x, y, z.polygon));
  const visibleTrack = (id: string) => selectedTrack === 'all' || selectedTrack === id;

  const windowed = useMemo(() => {
    let maxT = 0;
    Object.values(history).forEach((pts) => pts.length && (maxT = Math.max(maxT, pts[pts.length - 1][2])));
    const from = maxT - spaghettiMin * 60_000;
    const out: Record<string, TrackPoint[]> = {};
    Object.entries(history).forEach(([id, pts]) => (out[id] = pts.filter((p) => p[2] >= from)));
    return out;
  }, [history, spaghettiMin]);

  const runs = useMemo(() => {
    if (!scopePoly) return {};
    const out: Record<string, TrackPoint[][]> = {};
    Object.entries(windowed).forEach(([id, pts]) => (out[id] = runsInside(pts, scopePoly).filter((r) => r.length > 1)));
    return out;
  }, [windowed, scopePoly]);

  const scopeStats = useMemo(() => {
    if (!scopePoly) return [];
    return Object.entries(windowed)
      .map(([id, pts]) => ({ id, ...statsInside(pts, scopePoly, mPerX, mPerY) }))
      .filter((r) => r.entries > 0)
      .sort((a, b) => b.meters - a.meters);
  }, [windowed, scopePoly, mPerX, mPerY]);

  const insideScope = scopeZone ? Object.keys(tracks).filter((id) => pointInPolygon(tracks[id].x, tracks[id].y, scopeZone.polygon)) : [];
  const scopeStation = scopeZone ? stationOfZone(scopeZone, stations) : undefined;
  const scopeCsi = deriveCsi(insideScope, history, mPerX, mPerY).state;
  const scopeItems = useMemo(
    () => (scopeZone ? interiorOf(scopeZone, scopeStation, mPerX, mPerY) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeZone?.id, scopeZone?.interior, scopeStation?.equipment_type, mPerX, mPerY],
  );

  const zoneFill = (z: PolygonZone) =>
    z.type === 'storage' ? 'url(#fp-hatch)' : z.type === 'rest' ? 'url(#fp-dots)' : z.type === 'bathroom' ? 'url(#fp-cross)' : (ZONE_TINT[z.type] ?? ZONE_TINT.transit).fill;

  const zoneInScope = (z: PolygonZone) =>
    scope.kind === 'plant' ? true : scope.kind === 'zone' ? z.id === scope.id : lineOfZone(z, stations) === scope.id;

  /* ───────────── render ───────────── */
  return (
    <section className="panel flex flex-col h-full min-h-[560px]">
      <header className="panel-head flex-wrap">
        <nav className="flex items-center gap-1.5 min-w-0 text-[13px]" aria-label="Alcance">
          {scope.kind !== 'plant' && (
            <button className="btn btn-sm btn-icon !w-7 mr-1" onClick={up} aria-label="Subir un nivel">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <button className={`panel-title ${scope.kind === 'plant' ? '' : 'text-ink-3 hover:text-ink font-medium'}`} onClick={() => setScope({ kind: 'plant' })}>
            Planta
          </button>
          {scopeLine && (
            <>
              <span className="text-ink-4">/</span>
              <button
                className={`panel-title truncate ${scope.kind === 'line' ? '' : 'text-ink-3 hover:text-ink font-medium'}`}
                onClick={() => areas[scopeLine.id] && setScope({ kind: 'line', id: scopeLine.id })}
              >
                {scopeLine.name}
              </button>
            </>
          )}
          {scopeZone && (
            <>
              <span className="text-ink-4">/</span>
              <span className="panel-title truncate">{scopeZone.name}</span>
            </>
          )}
          {sibIdx >= 0 && (
            <span className="flex items-center ml-1">
              <button className="btn btn-sm btn-ghost btn-icon !w-6" onClick={() => go(-1)} aria-label="Anterior">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="num text-[11px] text-ink-3">
                {sibIdx + 1}/{siblings.length}
              </span>
              <button className="btn btn-sm btn-ghost btn-icon !w-6" onClick={() => go(1)} aria-label="Siguiente">
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          )}
          {scope.kind === 'plant' && <span className="text-[11.5px] text-ink-3 ml-2 hidden md:inline">Elige una línea o estación</span>}
        </nav>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="seg" role="group" aria-label="Capas principales del plano">
            <button aria-pressed={showZones} onClick={() => setShowZones((v) => !v)}>Zonas</button>
            <button
              aria-pressed={showSpaghetti && !showHeatmap}
              onClick={() => { setShowSpaghetti(true); setShowHeatmap(false); }}
              title="Selecciona una línea o zona para evitar saturar toda la planta"
            >Rutas</button>
            <button aria-pressed={showHeatmap && heatMode === 'traffic'} onClick={() => { setShowHeatmap(true); setHeatMode('traffic'); }}>Tránsito</button>
            <button aria-pressed={showHeatmap && heatMode === 'dwell'} onClick={() => { setShowHeatmap(true); setHeatMode('dwell'); }}>Permanencia</button>
          </div>
          <Popover
            label={
              <>
                <SlidersHorizontal className="h-3.5 w-3.5" /> Vista
              </>
            }
            width={250}
          >
            <div className="p-3 space-y-3 text-[12.5px]">
              <div>
                <div className="eyebrow mb-1.5">Capas</div>
                {(
                  [
                    ['Spaghetti (línea o estación)', showSpaghetti, setShowSpaghetti],
                    ['Mapa de calor', showHeatmap, setShowHeatmap],
                    ['Zonas', showZones, setShowZones],
                    ['Tarjetas de estación', showStations, setShowStations],
                  ] as const
                ).map(([label, on, set]) => (
                  <label key={label} className="flex items-center gap-2 py-0.5 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
              <div>
                <label className="label">Ventana de recorrido y calor</label>
                <select value={spaghettiMin} onChange={(e) => setSpaghettiMin(Number(e.target.value))} className="field">
                  {SPAGHETTI_WINDOWS.map((m) => (
                    <option key={m} value={m}>
                      {m === 60 ? 'Última hora' : `Últimos ${m} min`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Track</label>
                <select value={selectedTrack} onChange={(e) => setSelectedTrack(e.target.value)} className="field">
                  <option value="all">Todos ({Object.keys(tracks).length})</option>
                  {Object.keys(tracks).map((t) => (
                    <option key={t} value={t}>
                      {t} · {tracks[t]?.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Popover>
          {scope.kind === 'zone' && onEditInterior && scopeZone && !scopeZone.is_aggregated_only ? (
            <button className="btn btn-sm" onClick={() => onEditInterior(scopeZone.id)}>
              <PencilRuler className="h-3.5 w-3.5" /> Editar interior
            </button>
          ) : (
            onEditLayout && (
              <button className="btn btn-sm" onClick={onEditLayout}>
                <PencilRuler className="h-3.5 w-3.5" /> Editar layout
              </button>
            )
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="relative flex-1 min-h-[420px] bg-paper overflow-hidden">
          <div ref={wrapRef} className="absolute inset-0">
            <svg viewBox={vb.join(' ')} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" className="select-none block" role="img" aria-label="Plano de planta">
              <defs>
                <pattern id="fp-grid" width={unit} height={unit} patternUnits="userSpaceOnUse">
                  <path d={`M ${unit} 0 L 0 0 0 ${unit}`} fill="none" stroke={C.line} strokeWidth={px(0.6)} />
                </pattern>
                <pattern id="fp-grid5" width={unit * 5} height={unit * 5} patternUnits="userSpaceOnUse">
                  <rect width={unit * 5} height={unit * 5} fill="url(#fp-grid)" />
                  <path d={`M ${unit * 5} 0 L 0 0 0 ${unit * 5}`} fill="none" stroke={C.line2} strokeWidth={px(0.8)} />
                </pattern>
                <pattern id="fp-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill={ZONE_TINT.storage.fill} />
                  <line x1="0" y1="0" x2="0" y2="8" stroke={ZONE_TINT.storage.pattern} strokeWidth="1.2" />
                </pattern>
                <pattern id="fp-dots" width="9" height="9" patternUnits="userSpaceOnUse">
                  <rect width="9" height="9" fill={ZONE_TINT.rest.fill} />
                  <circle cx="4.5" cy="4.5" r="0.9" fill={ZONE_TINT.rest.pattern} />
                </pattern>
                <pattern id="fp-cross" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill={ZONE_TINT.bathroom.fill} />
                  <line x1="0" y1="0" x2="0" y2="8" stroke={ZONE_TINT.bathroom.pattern} strokeWidth="0.8" />
                  <line x1="0" y1="0" x2="8" y2="0" stroke={ZONE_TINT.bathroom.pattern} strokeWidth="0.8" />
                </pattern>
                <radialGradient id="fp-heat-traffic">
                  <stop offset="0%" stopColor={C.accent} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
                </radialGradient>
                <radialGradient id="fp-heat-dwell">
                  <stop offset="0%" stopColor={C.plum} stopOpacity="0.30" />
                  <stop offset="100%" stopColor={C.plum} stopOpacity="0" />
                </radialGradient>
              </defs>

              <rect x={-PLAN_W} y={-planH} width={PLAN_W * 3} height={planH * 3} fill="url(#fp-grid5)" />
              <rect x={0} y={0} width={PLAN_W} height={planH} fill="none" stroke={C.ink3} strokeWidth={px(1)} />

              {/* Zonas */}
              {showZones &&
                zones.map((zone) => {
                  const pts = zone.polygon.map(([x, y]) => `${x * PLAN_W},${y * planH}`).join(' ');
                  const b = bbox(zone.polygon);
                  const focused = scope.kind === 'zone' && zone.id === scope.id;
                  const dim = !zoneInScope(zone);
                  return (
                    <g
                      key={zone.id}
                      className="fp-fade cursor-pointer"
                      opacity={dim ? 0.4 : 1}
                      onClick={() => !focused && setScope({ kind: 'zone', id: zone.id })}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setScope({ kind: 'zone', id: zone.id })}
                      tabIndex={0}
                      role="button"
                      aria-label={`Ver detalle de ${zone.name}`}
                    >
                      <polygon
                        points={pts}
                        fill={zoneFill(zone)}
                        stroke={focused ? C.ink : (ZONE_TINT[zone.type] ?? ZONE_TINT.transit).stroke}
                        strokeWidth={px(focused ? 1.6 : 1)}
                        strokeDasharray={zone.type === 'transit' || zone.is_aggregated_only ? `${px(5)} ${px(3)}` : undefined}
                      />
                      {!focused && (
                        <text
                          x={b.x0 * PLAN_W + px(7)}
                          y={b.y0 * planH + px(15)}
                          fontSize={px(11)}
                          fontFamily={FONT_SANS}
                          fontWeight={500}
                          fill={C.ink2}
                          style={{ fontStretch: '85%', paintOrder: 'stroke' }}
                          stroke={C.paper}
                          strokeWidth={px(3)}
                          pointerEvents="none"
                        >
                          {zone.name}
                        </text>
                      )}
                    </g>
                  );
                })}

              {/* Áreas de línea */}
              {lines.map((l) => {
                const a = areas[l.id];
                if (!a) return null;
                const b = bbox(a);
                const active = scope.kind === 'line' && scope.id === l.id;
                if (scope.kind === 'zone') return null;
                if (scope.kind === 'line' && !active) return null;
                const tabW = px(l.name.length * 6.4 + 22);
                return (
                  <g key={`line-${l.id}`} className="cursor-pointer" onClick={() => setScope({ kind: 'line', id: l.id })} role="button" aria-label={`Ver ${l.name}`}>
                    <polygon
                      points={a.map(([x, y]) => `${x * PLAN_W},${y * planH}`).join(' ')}
                      fill="none"
                      stroke={active ? C.ink : C.accent}
                      strokeWidth={px(active ? 1.4 : 1.2)}
                      strokeDasharray={`${px(8)} ${px(4)}`}
                      pointerEvents="stroke"
                    />
                    {!active && (
                      <g transform={`translate(${b.x0 * PLAN_W},${b.y0 * planH - px(18)})`}>
                        <rect width={tabW} height={px(18)} fill={C.accent} />
                        <text x={px(7)} y={px(12.5)} fontSize={px(11)} fontFamily={FONT_SANS} fontWeight={600} fill="#fff" style={{ fontStretch: '88%' }}>
                          {l.name} ›
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Calor */}
              {showHeatmap &&
                Object.entries(windowed).map(([id, pts]) =>
                  visibleTrack(id)
                    ? pts
                        .filter((p, i) => i % 3 === 0 && !isPrivate(p[0], p[1]) && (!scopePoly || pointInPolygon(p[0], p[1], scopePoly)))
                        .map(([x, y, t], i, samples) => {
                          const dwellSeconds = Math.max(0, Math.min(10, ((samples[i + 1]?.[2] ?? t) - t) / 1000));
                          const radius = heatMode === 'dwell' ? 24 + dwellSeconds * 2.2 : 32;
                          return (
                            <circle
                              key={`h-${id}-${i}`}
                              cx={x * PLAN_W}
                              cy={y * planH}
                              r={radius}
                              fill={`url(#fp-heat-${heatMode})`}
                              pointerEvents="none"
                            />
                          );
                        })
                    : null,
                )}

              {/* Detalle de estación */}
              {scopeZone && !scopeZone.is_aggregated_only && scopeItems.length > 0 && (
                <StationDrawing
                  zone={scopeZone}
                  items={scopeItems}
                  status={scopeStation ? statusFor(scopeStation) : undefined}
                  csi={scopeCsi}
                  planH={planH}
                  unit={unit}
                  devices={devices}
                />
              )}

              {/* Tarjetas de estación */}
              {showStations &&
                stations.map((st) => {
                  const zone = zones.find((z) => z.station_ids.includes(st.station_id));
                  if (zone && scopeZone?.id === zone.id) return null;
                  const s = statusOf(statusFor(st));
                  const b = zone ? bbox(zone.polygon) : null;
                  const x = b ? ((b.x0 + b.x1) / 2) * PLAN_W : st.position_x * PLAN_W;
                  const y = b ? b.y0 * planH + px(24) + 22 : st.position_y * planH;
                  const dim = zone ? !zoneInScope(zone) : scope.kind !== 'plant';
                  return (
                    <g
                      key={st.id}
                      transform={`translate(${x - 46},${y - 22})`}
                      className="fp-fade cursor-pointer"
                      opacity={dim ? 0.4 : 1}
                      onClick={() => zone && setScope({ kind: 'zone', id: zone.id })}
                    >
                      <rect width={92} height={44} fill={C.surface} stroke={C.ink2} strokeWidth={px(1)} />
                      <rect width={4} height={44} fill={s.color} />
                      <text x={11} y={17} fontSize={12} fontFamily={FONT_SANS} fontWeight={600} fill={C.ink} style={{ fontStretch: '85%' }}>
                        {st.order_in_line} · {shortStationName(st.name).slice(0, 12)}
                      </text>
                      <text x={11} y={31} fontSize={9.5} fontFamily={FONT_SANS} fill={s.color}>
                        {s.label}
                      </text>
                      <text x={84} y={31} fontSize={9.5} fontFamily={FONT_MONO} fill={C.ink3} textAnchor="end">
                        {st.parts_produced_shift} pz
                      </text>
                    </g>
                  );
                })}

              {/* Spaghetti: solo dentro de la línea o estación seleccionada */}
              {showSpaghetti &&
                Object.entries(runs).map(([id, rs]) =>
                  visibleTrack(id)
                    ? rs.map((r, i) => (
                        <path
                          key={`s-${id}-${i}`}
                          d={r.map(([x, y], j) => `${j ? 'L' : 'M'}${x * PLAN_W} ${y * planH}`).join(' ')}
                          fill="none"
                          stroke={trackColor(id)}
                          strokeWidth={1.6}
                          strokeOpacity={0.7}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      ))
                    : null,
                )}

              {/* Posición actual */}
              {Object.entries(tracks).map(([id, p]) => {
                if (!visibleTrack(id)) return null;
                const priv = isPrivate(p.x, p.y);
                const outOfScope = scopePoly && !pointInPolygon(p.x, p.y, scopePoly);
                const color = trackColor(id);
                return (
                  <g key={`t-${id}`} transform={`translate(${p.x * PLAN_W},${p.y * planH})`} pointerEvents="none" opacity={outOfScope ? 0.35 : 1}>
                    <circle r={px(6)} fill={priv ? C.ink4 : color} stroke={C.surface} strokeWidth={px(2)} />
                    {!priv && (
                      <text
                        y={-px(10)}
                        textAnchor="middle"
                        fontSize={px(10)}
                        fontFamily={FONT_MONO}
                        fontWeight={500}
                        fill={color}
                        stroke={C.paper}
                        strokeWidth={px(3)}
                        style={{ paintOrder: 'stroke' }}
                      >
                        {id}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="absolute left-3 bottom-3 flex flex-col items-start pointer-events-none">
            <span className="num text-[10.5px] text-ink-2 mb-0.5">{scaleM} m</span>
            <div className="h-[5px] border border-ink border-t-0" style={{ width: ppu * unit * scaleM }} />
          </div>
          <div className="absolute right-3 bottom-3 text-[11px] text-ink-3 pointer-events-none text-right max-w-[65%]">
            {showHeatmap
              ? `Calor de ${heatMode === 'traffic' ? 'tránsito (posiciones)' : 'permanencia (tiempo)'} · sin zonas sensibles`
              : scope.kind === 'plant' && showSpaghetti
                ? 'El spaghetti se segmenta por línea o zona para evitar saturación'
                : 'Tracks anónimos · zonas sensibles solo en conteo agregado'}
          </div>
        </div>

        {scope.kind !== 'plant' && (
          <aside className="lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-line bg-surface overflow-y-auto lg:max-h-[660px]">
            {scope.kind === 'line' && scopeLine ? (
              <LineReadout
                line={scopeLine}
                area={areas[scopeLine.id]}
                stationZones={lineStationZones(scopeLine.id)}
                stats={scopeStats}
                windowed={windowed}
                minutes={spaghettiMin}
                tracks={tracks}
                mPerX={mPerX}
                mPerY={mPerY}
              />
            ) : scopeZone ? (
              <ZoneReadout
                zone={scopeZone}
                station={scopeStation}
                stationMetric={metricFor(scopeStation)}
                items={scopeItems}
                devices={devices}
                mode={mode}
                insideIds={insideScope}
                tracks={tracks}
                histories={history}
                log={zoneLog}
                stops={stops}
                mPerX={mPerX}
                mPerY={mPerY}
                spaghetti={
                  !scopeZone.is_aggregated_only && (
                    <div className="px-4 pt-3 pb-1 border-b border-line">
                      <div className="eyebrow">Spaghetti en esta zona · {spaghettiMin} min</div>
                      <TrackStatsTable rows={scopeStats} tracks={tracks} empty="Nadie ha pasado por aquí en la ventana." />
                    </div>
                  )
                }
              />
            ) : null}
          </aside>
        )}
      </div>
    </section>
  );
};

// La carga inicial no debe borrar puntos en vivo que llegaron mientras tanto.
function mergeLive(prev: Record<string, TrackPoint[]>, loaded: Record<string, TrackPoint[]>) {
  const out: Record<string, TrackPoint[]> = {};
  Object.entries(prev).forEach(([id, live]) => {
    const base = loaded[id] ?? [];
    const lastT = base.length ? base[base.length - 1][2] : -Infinity;
    out[id] = [...base, ...live.filter((p) => p[2] > lastT)];
  });
  return out;
}

/* ───────────── tablas del panel lateral ───────────── */

const TrackStatsTable: React.FC<{
  rows: { id: string; meters: number; seconds: number; entries: number }[];
  tracks: Record<string, Track>;
  empty: string;
}> = ({ rows, tracks, empty }) =>
  rows.length === 0 ? (
    <p className="text-[12px] text-ink-3 py-2">{empty}</p>
  ) : (
    <table className="w-full text-[12px] mt-1.5 mb-2">
      <thead>
        <tr className="text-left text-ink-3 border-b border-line">
          <th className="font-normal pb-1">Track</th>
          <th className="font-normal pb-1 text-right">Distancia</th>
          <th className="font-normal pb-1 text-right">Tiempo</th>
          <th className="font-normal pb-1 text-right">Entradas</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-line last:border-0" title={tracks[r.id]?.name}>
            <td className="py-1">
              <span className="flex items-center gap-1.5 num text-[11.5px]">
                <span className="dot" style={{ background: trackColor(r.id) }} />
                {r.id}
              </span>
            </td>
            <td className="py-1 text-right num">{r.meters.toFixed(1)} m</td>
            <td className="py-1 text-right num text-ink-2">{fmtMin(r.seconds)}</td>
            <td className="py-1 text-right num text-ink-2">{r.entries}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

const LineReadout: React.FC<{
  line: Line;
  area: Poly;
  stationZones: { z: PolygonZone; st?: Station }[];
  stats: { id: string; meters: number; seconds: number; entries: number }[];
  windowed: Record<string, TrackPoint[]>;
  minutes: number;
  tracks: Record<string, Track>;
  mPerX: number;
  mPerY: number;
}> = ({ line, area, stationZones, stats, windowed, minutes, tracks, mPerX, mPerY }) => {
  const b = bbox(area);
  const zonesOnly = stationZones.map((x) => x.z);

  const matrix = useMemo(() => {
    const total: Record<string, number> = {};
    Object.values(windowed).forEach((pts) => {
      Object.entries(stationTransitions(pts, zonesOnly)).forEach(([k, v]) => (total[k] = (total[k] ?? 0) + v));
    });
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowed, stationZones]);

  const totalTrips = Object.values(matrix).reduce((a, v) => a + v, 0);
  const maxCell = Math.max(1, ...Object.values(matrix));

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-3.5 pb-3 border-b border-line">
        <div className="eyebrow">
          {stationZones.length} estaciones · {((b.x1 - b.x0) * mPerX).toFixed(1)} × {((b.y1 - b.y0) * mPerY).toFixed(1)} m ·{' '}
          {line.polygon ? 'área dibujada' : 'área automática'}
        </div>
        <h3 className="text-[15px] font-semibold leading-tight mt-1">{line.name}</h3>
      </div>

      <div className="px-4 pt-3 border-b border-line">
        <div className="eyebrow">Recorrido dentro de la línea · {minutes} min</div>
        <TrackStatsTable rows={stats} tracks={tracks} empty="Sin trayectorias dentro del área en esta ventana." />
      </div>

      <div className="px-4 pt-3 pb-3 border-b border-line">
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Viajes entre estaciones</div>
          <span className="num text-[11px] text-ink-3">{totalTrips} en total</span>
        </div>
        {stationZones.length < 2 ? (
          <p className="text-[12px] text-ink-3 py-2">Se necesitan al menos dos estaciones.</p>
        ) : (
          <table className="mt-2 text-[11.5px] num border-collapse">
            <thead>
              <tr>
                <th className="font-normal text-ink-4 text-left pr-2 pb-1">de \ a</th>
                {stationZones.map(({ z, st }) => (
                  <th key={z.id} className="font-normal text-ink-3 w-8 pb-1" title={z.name}>
                    {st?.order_in_line ?? '·'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stationZones.map(({ z: from, st: sf }) => (
                <tr key={from.id}>
                  <th className="font-normal text-ink-3 text-left pr-2 py-0.5 max-w-[110px] truncate" title={from.name}>
                    {sf?.order_in_line ?? '·'} {sf ? shortStationName(sf.name).slice(0, 10) : from.name.slice(0, 10)}
                  </th>
                  {stationZones.map(({ z: to }) => {
                    const v = from.id === to.id ? null : matrix[`${from.id}>${to.id}`] ?? 0;
                    return (
                      <td
                        key={to.id}
                        className="w-8 h-7 text-center border border-line"
                        style={{
                          background: v ? `color-mix(in srgb, ${C.accent} ${Math.round(15 + (v / maxCell) * 55)}%, ${C.surface})` : undefined,
                          color: v && v / maxCell > 0.6 ? '#fff' : v ? C.ink : C.ink4,
                        }}
                      >
                        {v === null ? '—' : v || ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11.5px] text-ink-3 leading-snug mt-2">
          Cada cambio de estación en la secuencia de un track cuenta como un viaje; el tiempo en pasillo no interrumpe la secuencia.
        </p>
      </div>

      <p className="px-4 py-3 text-[11.5px] text-ink-3 leading-snug">
        Fuente: cámara cenital (XY). Solo se dibujan y miden los tramos dentro del área de la línea; lo que pasa fuera no se mezcla.
      </p>
    </div>
  );
};
