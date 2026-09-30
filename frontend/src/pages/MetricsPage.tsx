import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Analytics, SpatialSummary } from '../types';
import { C, FONT_MONO, STATE_META, STATE_ORDER, axisCategory, axisValue, chartBase, trackColor } from '../theme';
import { shortStationName } from '../layout/geometry';
import { KpiStrip, Panel, StateLegend } from '../components/DashboardGrid';
import { Popover } from '../components/Popover';

/*
 * Métricas de la línea seleccionada. Cada gráfica responde una pregunta concreta
 * de supervisión y todas salen de la misma reconstrucción por eventos (/api/analytics).
 */

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
const minLabel = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${(s / 60).toFixed(1)} min`);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-full min-h-[180px] flex items-center justify-center text-center text-[12.5px] text-ink-3 px-6">{children}</div>
);

const Chart: React.FC<{ option: any; height: number }> = ({ option, height }) => (
  <div style={{ height }}>
    <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
  </div>
);

type ModuleId =
  | 'kpis'
  | 'spatial_kpis'
  | 'timeline'
  | 'time_split'
  | 'bottleneck'
  | 'output'
  | 'quality'
  | 'occupancy'
  | 'movement'
  | 'routes'
  | 'distance'
  | 'dwell'
  | 'stops'
  | 'methodology';

const MODULES: { id: ModuleId; category: string; label: string; question: string }[] = [
  { id: 'kpis', category: 'Supervisión', label: 'KPIs de línea', question: '¿Cómo va la línea?' },
  { id: 'timeline', category: 'Supervisión', label: 'Cronología de estados', question: '¿Cuándo cambió cada estación?' },
  { id: 'time_split', category: 'Supervisión', label: 'Reparto del tiempo', question: '¿Dónde se va el tiempo?' },
  { id: 'bottleneck', category: 'Supervisión', label: 'Cuello de botella', question: '¿Qué estación limita la salida?' },
  { id: 'output', category: 'Supervisión', label: 'Salida vs. meta', question: '¿Se sostiene el ritmo?' },
  { id: 'quality', category: 'Supervisión', label: 'Calidad observada', question: '¿Dónde cae el rendimiento bueno?' },
  { id: 'stops', category: 'Supervisión', label: 'Pareto de paros', question: '¿Qué paros cuestan más?' },
  { id: 'spatial_kpis', category: 'Flujo y layout', label: 'KPIs espaciales', question: '¿Cuánto movimiento y cobertura hubo?' },
  { id: 'occupancy', category: 'Flujo y layout', label: 'Ocupación y capacidad', question: '¿Dónde se concentra la gente?' },
  { id: 'movement', category: 'Flujo y layout', label: 'Movimiento observado', question: '¿Dónde hay tránsito o quietud?' },
  { id: 'routes', category: 'Flujo y layout', label: 'Rutas y retornos', question: '¿Qué recorridos se repiten?' },
  { id: 'distance', category: 'Flujo y layout', label: 'Distancia por track', question: '¿Cuándo aumenta el recorrido?' },
  { id: 'dwell', category: 'Flujo y layout', label: 'Tiempo por zona', question: '¿Dónde permanece la gente?' },
  { id: 'methodology', category: 'Confianza', label: 'Método y límites', question: '¿Qué se puede concluir?' },
];

const PRESETS: Record<string, ModuleId[]> = {
  Supervisor: ['kpis', 'timeline', 'bottleneck', 'output', 'quality', 'stops'],
  'Ingeniería industrial': ['spatial_kpis', 'occupancy', 'movement', 'routes', 'distance', 'dwell'],
  Balanceo: ['kpis', 'time_split', 'bottleneck', 'output', 'occupancy'],
};
const DEFAULT_MODULES: ModuleId[] = ['kpis', 'timeline', 'bottleneck', 'output', 'spatial_kpis', 'occupancy', 'movement', 'routes'];
const STORAGE_KEY = 'factory-pulse.analytics.visible.v1';

function initialModules(): ModuleId[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(stored)) {
      const valid = stored.filter((id): id is ModuleId => MODULES.some((module) => module.id === id));
      if (valid.length) return valid;
    }
  } catch {
    // Un valor local inválido no debe impedir abrir la página.
  }
  return DEFAULT_MODULES;
}

export const MetricsPage: React.FC<{ analytics: Analytics | null; spatial: SpatialSummary | null; lineName?: string }> = ({ analytics: a, spatial, lineName }) => {
  const [visibleModules, setVisibleModules] = useState<ModuleId[]>(initialModules);
  const setModules = (ids: ModuleId[]) => {
    const next = MODULES.map((module) => module.id).filter((id) => ids.includes(id));
    setVisibleModules(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };
  const shown = (id: ModuleId) => visibleModules.includes(id);
  const stations = a?.stations ?? [];
  const names = stations.map((s) => `${s.order} · ${shortStationName(s.name)}`);
  const bucketMin = a ? a.window.bucket_s / 60 : 5;

  /* 1 · Línea de tiempo de estados */
  const timeline = useMemo(() => {
    if (!a) return null;
    const data: any[] = [];
    a.timeline.forEach((row, yi) =>
      row.segments.forEach(([s, e, st]) =>
        data.push({ value: [yi, s, e, STATE_ORDER.indexOf(st)], itemStyle: { color: STATE_META[st].color } }),
      ),
    );
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        formatter: (p: any) => {
          const [yi, s, e, si] = p.value;
          const st = STATE_ORDER[si];
          return `<b>${names[yi]}</b><br/>${STATE_META[st].label}<br/>${hhmm(s)}–${hhmm(e)} · ${minLabel((e - s) / 1000)}`;
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 24, containLabel: true },
      xAxis: {
        type: 'time',
        min: a.window.start_ms,
        max: a.window.end_ms,
        ...axisValue,
        splitLine: { show: true, lineStyle: { color: C.line, type: 'dashed' } },
        axisLabel: { ...axisValue.axisLabel, formatter: (v: number) => hhmm(v) },
      },
      yAxis: { type: 'category', data: names, inverse: true, ...axisCategory },
      series: [
        {
          type: 'custom',
          encode: { x: [1, 2], y: 0 },
          data,
          renderItem: (params: any, api: any) => {
            const yi = api.value(0);
            const start = api.coord([api.value(1), yi]);
            const end = api.coord([api.value(2), yi]);
            const h = api.size([0, 1])[1] * 0.56;
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - h / 2, width: Math.max(1, end[0] - start[0]), height: h },
              style: api.style(),
            };
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 2 · Reparto del tiempo por estación */
  const split = useMemo(() => {
    if (!a) return null;
    const totals = stations.map((s) => STATE_ORDER.reduce((acc, k) => acc + s.seconds[k], 0) || 1);
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) =>
          `<b>${ps[0].name}</b><br/>` +
          ps
            .filter((p) => p.value > 0)
            .map((p) => `${p.marker}${p.seriesName}: ${p.value.toFixed(0)}% · ${minLabel(stations[p.dataIndex].seconds[STATE_ORDER[p.seriesIndex]])}`)
            .join('<br/>'),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', max: 100, ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value}%' } },
      yAxis: { type: 'category', data: names, inverse: true, ...axisCategory },
      series: STATE_ORDER.map((k) => ({
        name: STATE_META[k].label,
        type: 'bar',
        stack: 't',
        barWidth: 14,
        itemStyle: { color: STATE_META[k].color },
        data: stations.map((s, i) => +((100 * s.seconds[k]) / totals[i]).toFixed(1)),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 3 · Ritmo por estación vs meta (cuello de botella) */
  const measured = stations.filter((s) => s.has_process_data && s.available_s >= 60);
  const rate = useMemo(() => {
    if (!a || measured.length === 0) return null;
    const bn = a.summary.bottleneck_station_id;
    const labels = measured.map((s) => `${s.order} · ${shortStationName(s.name)}`);
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => {
          const s = measured[ps[0].dataIndex];
          return `<b>${ps[0].name}</b><br/>Real: ${s.pieces_per_hour} pzs/h<br/>Meta: ${s.target_pph} pzs/h<br/>Ciclo medio: ${s.avg_cycle_s ?? '—'} s (ideal ${s.ideal_cycle_s} s)`;
        },
      },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labels, ...axisCategory },
      yAxis: { type: 'value', name: 'pzs/h', nameTextStyle: { color: C.ink3, fontSize: 10.5 }, ...axisValue },
      series: [
        {
          name: 'Real',
          type: 'bar',
          barWidth: 26,
          data: measured.map((s) => ({ value: s.pieces_per_hour, itemStyle: { color: s.station_id === bn ? C.accent : C.brand } })),
          label: { show: true, position: 'top', fontFamily: FONT_MONO, fontSize: 10.5, color: C.ink2 },
        },
        {
          name: 'Meta',
          type: 'scatter',
          symbol: 'rect',
          symbolSize: [38, 2.5],
          itemStyle: { color: C.ink },
          data: measured.map((s) => s.target_pph),
          z: 3,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 4 · Salida de la línea por intervalo */
  const output = useMemo(() => {
    if (!a || !a.summary.has_process_data) return null;
    const target = a.line_target_per_bucket;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => `<b>${ps[0].name}</b><br/>${ps[0].value} pzs · meta ${target.toFixed(1)}`,
      },
      grid: { left: 8, right: 40, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: a.buckets_ms.map(hhmm), ...axisCategory, axisLabel: { ...axisCategory.axisLabel, fontFamily: FONT_MONO, fontSize: 10.5 } },
      yAxis: { type: 'value', name: 'pzs', nameTextStyle: { color: C.ink3, fontSize: 10.5 }, minInterval: 1, ...axisValue },
      series: [
        {
          type: 'bar',
          barMaxWidth: 22,
          data: a.line_output_by_bucket.map((v, i) => ({
            value: v,
            // el último intervalo va en curso: se atenúa para no leerlo como caída
            itemStyle: { color: v < target * 0.85 ? C.warn : C.brand, opacity: i === a.line_output_by_bucket.length - 1 ? 0.45 : 1 },
          })),
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: C.ink, type: 'dashed', width: 1 },
            label: { formatter: 'meta', color: C.ink2, fontSize: 10.5 },
            data: [{ yAxis: target }],
          },
        },
      ],
    };
  }, [a]);

  /* 5 · Distancia caminada dentro de la línea */
  const distTracks = a ? Object.keys(a.distance_by_bucket) : [];
  const distance = useMemo(() => {
    if (!a || distTracks.length === 0) return null;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        formatter: (ps: any[]) =>
          `<b>${ps[0].name}</b><br/>` +
          [...ps]
            .sort((x, y) => y.value - x.value)
            .map((p) => `${p.marker}${p.seriesName}: ${p.value} m`)
            .join('<br/>'),
      },
      legend: { bottom: 0, icon: 'rect', itemWidth: 10, itemHeight: 3, textStyle: { color: C.ink2, fontSize: 11, fontFamily: FONT_MONO } },
      grid: { left: 8, right: 16, top: 16, bottom: 30, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: a.buckets_ms.map(hhmm), ...axisCategory, axisLabel: { ...axisCategory.axisLabel, fontFamily: FONT_MONO, fontSize: 10.5 } },
      yAxis: { type: 'value', name: 'm', nameTextStyle: { color: C.ink3, fontSize: 10.5 }, ...axisValue },
      series: distTracks.map((t) => ({
        name: t,
        type: 'line',
        showSymbol: false,
        lineStyle: { width: 1.6, color: trackColor(t) },
        itemStyle: { color: trackColor(t) },
        data: a.distance_by_bucket[t],
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 5b · Tiempo por zona (toda la planta) */
  const dwellRows = (a?.zone_dwell ?? []).filter((z) => z.person_s > 0);
  const dwell = useMemo(() => {
    if (!a || dwellRows.length === 0) return null;
    const winS = (a.window.end_ms - a.window.start_ms) / 1000;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => {
          const z = dwellRows[ps[0].dataIndex];
          return `<b>${z.name}</b><br/>${(z.person_s / 60).toFixed(1)} persona·min<br/>Ocupada ${Math.round((100 * z.occupied_s) / winS)}% del tiempo${
            z.visits !== null ? `<br/>${z.visits} entradas` : '<br/>Zona privada: solo agregado'
          }`;
        },
      },
      grid: { left: 8, right: 110, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value} min' } },
      yAxis: { type: 'category', inverse: true, data: dwellRows.map((z) => (z.name.length > 34 ? z.name.slice(0, 33) + '…' : z.name)), ...axisCategory },
      series: [
        {
          type: 'bar',
          barWidth: 12,
          data: dwellRows.map((z) => ({
            value: +(z.person_s / 60).toFixed(1),
            itemStyle: { color: z.type === 'work' ? C.brand : z.is_aggregated_only ? C.ink4 : C.accent },
          })),
          label: {
            show: true,
            position: 'right',
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: C.ink2,
            formatter: (p: any) => `${p.value} · ${Math.round((100 * dwellRows[p.dataIndex].occupied_s) / winS)}% ocup.`,
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 6 · Pareto de paros */
  const pareto = useMemo(() => {
    if (!a || a.stops_pareto.length === 0) return null;
    const total = a.stops_pareto.reduce((s, r) => s + r.minutes, 0) || 1;
    let acc = 0;
    const cum = a.stops_pareto.map((r) => +((100 * (acc += r.minutes)) / total).toFixed(0));
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => {
          const r = a.stops_pareto[ps[0].dataIndex];
          return `<b>${r.reason}</b><br/>${r.minutes} min en ${r.count} paro${r.count > 1 ? 's' : ''}<br/>Acumulado: ${cum[ps[0].dataIndex]}%`;
        },
      },
      // Barras horizontales: las causas conservan su texto completo y se leen de mayor a menor.
      grid: { left: 8, right: 120, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value} min' } },
      yAxis: {
        type: 'category',
        inverse: true,
        data: a.stops_pareto.map((r) => (r.reason.length > 42 ? r.reason.slice(0, 41) + '…' : r.reason)),
        ...axisCategory,
      },
      series: [
        {
          type: 'bar',
          barWidth: 14,
          data: a.stops_pareto.map((r, i) => ({ value: r.minutes, itemStyle: { color: i === 0 || cum[i - 1] < 80 ? C.ink2 : C.ink4 } })),
          label: {
            show: true,
            position: 'right',
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: C.ink2,
            formatter: (p: any) => `${p.value} min · ${cum[p.dataIndex]}% acum.`,
          },
        },
      ],
    };
  }, [a]);

  /* 7 · Ocupación promedio, pico y capacidad configurada */
  const occupancyRows = useMemo(
    () => [...(spatial?.zones ?? [])].filter((z) => z.person_minutes > 0 || z.peak_occupancy > 0).sort((x, y) => y.peak_occupancy - x.peak_occupancy),
    [spatial],
  );
  const occupancy = useMemo(() => {
    if (!spatial || occupancyRows.length === 0) return null;
    const labels = occupancyRows.map((z) => (z.name.length > 30 ? `${z.name.slice(0, 29)}…` : z.name));
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          const z = occupancyRows[ps[0].dataIndex];
          return `<b>${z.name}</b><br/>Ahora: ${z.current_count}<br/>Promedio: ${z.average_occupancy}<br/>Pico: ${z.peak_occupancy}<br/>Capacidad: ${z.max_capacity ?? 'no configurada'}<br/>Densidad pico: ${z.peak_density_person_m2} pers/m²`;
        },
      },
      legend: { bottom: 0, textStyle: { color: C.ink2, fontSize: 11 } },
      grid: { left: 8, right: 18, top: 8, bottom: 34, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, ...axisValue },
      yAxis: { type: 'category', inverse: true, data: labels, ...axisCategory },
      series: [
        { name: 'Promedio', type: 'bar', barWidth: 11, data: occupancyRows.map((z) => z.average_occupancy), itemStyle: { color: C.brand } },
        { name: 'Pico', type: 'bar', barWidth: 11, data: occupancyRows.map((z) => z.peak_occupancy), itemStyle: { color: C.accent } },
        {
          name: 'Capacidad',
          type: 'scatter',
          symbol: 'rect',
          symbolSize: [2.5, 22],
          data: occupancyRows.map((z) => z.max_capacity ?? null),
          itemStyle: { color: C.ink },
        },
      ],
    };
  }, [spatial, occupancyRows]);

  /* 8 · Movimiento observado; lo desconocido queda visible, no se imputa. */
  const movementRows = useMemo(
    () => [...(spatial?.zones ?? [])].filter((z) => z.person_minutes > 0).sort((x, y) => y.person_minutes - x.person_minutes),
    [spatial],
  );
  const movement = useMemo(() => {
    if (!spatial || movementRows.length === 0) return null;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => `<b>${movementRows[ps[0].dataIndex].name}</b><br/>${ps.map((p) => `${p.marker}${p.seriesName}: ${p.value}%`).join('<br/>')}`,
      },
      legend: { bottom: 0, textStyle: { color: C.ink2, fontSize: 11 } },
      grid: { left: 8, right: 16, top: 8, bottom: 34, containLabel: true },
      xAxis: { type: 'value', max: 100, ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value}%' } },
      yAxis: {
        type: 'category',
        inverse: true,
        data: movementRows.map((z) => (z.name.length > 30 ? `${z.name.slice(0, 29)}…` : z.name)),
        ...axisCategory,
      },
      series: [
        { name: 'En movimiento', type: 'bar', stack: 'motion', barWidth: 13, data: movementRows.map((z) => z.moving_pct), itemStyle: { color: C.info } },
        { name: 'Quietud', type: 'bar', stack: 'motion', barWidth: 13, data: movementRows.map((z) => z.stationary_pct), itemStyle: { color: C.plum } },
        { name: 'Desconocido', type: 'bar', stack: 'motion', barWidth: 13, data: movementRows.map((z) => z.unknown_motion_pct), itemStyle: { color: C.line2 } },
      ],
    };
  }, [spatial, movementRows]);

  /* 9 · Rutas agregadas (sin exponer secuencias individuales). */
  const routeRows = spatial?.transitions.slice(0, 10) ?? [];
  const routes = useMemo(() => {
    if (!spatial || routeRows.length === 0) return null;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          const r = routeRows[ps[0].dataIndex];
          return `<b>${r.from_name} → ${r.to_name}</b><br/>${r.count} transiciones agregadas`;
        },
      },
      grid: { left: 8, right: 45, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, ...axisValue },
      yAxis: {
        type: 'category',
        inverse: true,
        data: routeRows.map((r) => `${r.from_name.slice(0, 18)} → ${r.to_name.slice(0, 18)}`),
        ...axisCategory,
      },
      series: [{
        type: 'bar',
        barWidth: 13,
        data: routeRows.map((r) => r.count),
        itemStyle: { color: C.accent },
        label: { show: true, position: 'right', color: C.ink2, fontFamily: FONT_MONO, fontSize: 10.5 },
      }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatial]);

  /* 10 · Rendimiento de calidad cuando el sensor reporta piezas buenas. */
  const qualityRows = stations.filter((s) => s.good_pct !== null);
  const quality = useMemo(() => {
    if (!a || qualityRows.length === 0) return null;
    return {
      ...chartBase,
      tooltip: { ...chartBase.tooltip, trigger: 'axis', formatter: (ps: any[]) => `<b>${ps[0].name}</b><br/>Piezas buenas: ${ps[0].value}%` },
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: qualityRows.map((s) => `${s.order} · ${shortStationName(s.name)}`), ...axisCategory },
      yAxis: { type: 'value', min: 80, max: 100, ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value}%' } },
      series: [{
        type: 'bar',
        barMaxWidth: 32,
        data: qualityRows.map((s) => ({ value: s.good_pct, itemStyle: { color: (s.good_pct ?? 0) >= 95 ? C.ok : C.warn } })),
        label: { show: true, position: 'top', formatter: '{c}%', color: C.ink2, fontFamily: FONT_MONO, fontSize: 10.5 },
      }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  if (!a) return <div className="panel p-10 text-center text-ink-3 text-[13px]">Calculando métricas…</div>;

  const spatialKpis = spatial
    ? [
        ['Ocupación ahora', spatial.summary.current_people?.toFixed(0) ?? '—', 'personas'],
        ['Tiempo observado', spatial.summary.observed_person_minutes.toFixed(1), 'persona·min'],
        ['Recorrido agregado', spatial.summary.distance_m.toFixed(0), 'm'],
        ['Retorno inmediato', spatial.summary.backtrack_ratio_pct.toFixed(0), '% A→B→A'],
        ['Cobertura', spatial.summary.coverage_pct.toFixed(0), '% de ventana'],
        ['Exceso de capacidad', spatial.summary.congestion_excess_person_minutes.toFixed(1), 'persona·min'],
      ]
    : [];

  return (
    <div className="space-y-4">
      <section className="panel px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <div className="panel-title">Vista analítica personalizable</div>
          <p className="text-[11.5px] text-ink-3 mt-0.5">Muestra solo las preguntas necesarias para la decisión actual. La selección se guarda en este navegador.</p>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Vistas rápidas">
          {Object.entries(PRESETS).map(([name, ids]) => (
            <button key={name} className="btn btn-sm" onClick={() => setModules(ids)}>{name}</button>
          ))}
        </div>
        <Popover
          label={<><SlidersHorizontal className="h-3.5 w-3.5" /> Analíticas · {visibleModules.length}/{MODULES.length}</>}
          width={360}
        >
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            {[...new Set(MODULES.map((module) => module.category))].map((category) => (
              <div key={category} className="mb-3 last:mb-0">
                <div className="eyebrow mb-1.5">{category}</div>
                {MODULES.filter((module) => module.category === category).map((module) => (
                  <label key={module.id} className="flex items-start gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={shown(module.id)}
                      onChange={(e) => setModules(e.target.checked ? [...visibleModules, module.id] : visibleModules.filter((id) => id !== module.id))}
                    />
                    <span>
                      <span className="block text-[12.5px] text-ink">{module.label}</span>
                      <span className="block text-[10.5px] text-ink-3">{module.question}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
            <div className="pt-2 mt-2 border-t border-line flex justify-between">
              <button className="btn btn-sm btn-ghost" onClick={() => setModules(DEFAULT_MODULES)}><RotateCcw className="h-3.5 w-3.5" /> Recomendada</button>
              <button className="btn btn-sm" onClick={() => setModules(MODULES.map((module) => module.id))}>Mostrar todas</button>
            </div>
          </div>
        </Popover>
      </section>

      {shown('kpis') && <KpiStrip analytics={a} />}

      {shown('spatial_kpis') && (
        <Panel
          title="¿Qué volumen de movimiento se observó?"
          subtitle="Agregados anónimos de la planta. Los porcentajes solo usan intervalos con datos válidos; la cobertura se muestra para evitar falsas conclusiones."
          meta={<span className={`chip ${spatial?.summary.fresh ? 'chip-ok' : 'chip-warn'}`}>{spatial?.summary.fresh ? 'dato reciente' : 'sin dato reciente'}</span>}
        >
          {spatial ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 -m-3.5 mb-3 border-b border-line">
                {spatialKpis.map(([label, value, unit]) => (
                  <div key={label} className="p-3.5 border-r border-line last:border-r-0">
                    <div className="text-[11px] text-ink-3">{label}</div>
                    <div className="mt-1"><span className="num text-[22px]">{value}</span> <span className="text-[10.5px] text-ink-3">{unit}</span></div>
                  </div>
                ))}
              </div>
              <div className="grid md:grid-cols-3 gap-2">
                {spatial.insights.slice(0, 3).map((insight) => (
                  <div key={insight.id} className="bg-sunken border border-line p-2.5">
                    <div className="text-[12px] font-medium">{insight.title}</div>
                    <p className="text-[10.5px] text-ink-3 mt-1 leading-snug">{insight.evidence}</p>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty>Calculando agregados espaciales…</Empty>}
        </Panel>
      )}

      {shown('timeline') && (
        <Panel
          title="¿Cuándo produjo, esperó o se detuvo cada estación?"
          subtitle="Estado reconstruido cada pocos segundos a partir de presencia, proceso y paros registrados."
          meta={<span className="eyebrow">{lineName}</span>}
        >
          {stations.length === 0 ? <Empty>Esta línea no tiene estaciones.</Empty> : (
            <><Chart option={timeline} height={Math.max(140, 44 * stations.length + 40)} /><StateLegend className="mt-2" /></>
          )}
        </Panel>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {shown('time_split') && (
          <Panel title="¿Dónde se va el tiempo de cada estación?" subtitle="Porcentaje de la ventana por estado. Una diferencia orienta dónde investigar; no prueba por sí sola una causa.">
            <Chart option={split} height={Math.max(160, 38 * stations.length + 30)} />
          </Panel>
        )}

        {shown('bottleneck') && (
          <Panel title="¿Qué estación limita la salida?" subtitle="Piezas por hora contra meta. Se marca la estación con menor ritmo medido, no una causa raíz.">
            {rate ? <Chart option={rate} height={240} /> : (
              <Empty>{stations.some((s) => s.has_process_data) ? 'No hubo tiempo disponible para medir el ritmo.' : 'Falta un sensor de proceso vinculado a las estaciones.'}</Empty>
            )}
          </Panel>
        )}

        {shown('output') && (
          <Panel title="¿La línea va al ritmo de la meta?" subtitle={`Salida de la última estación cada ${bucketMin} min. Ámbar: menos de 85% de la meta; el último intervalo sigue abierto.`}>
            {output ? <Chart option={output} height={240} /> : <Empty>Sin sensor de proceso en la última estación.</Empty>}
          </Panel>
        )}

        {shown('quality') && (
          <Panel title="¿Qué porcentaje de piezas buenas reporta cada estación?" subtitle="Rendimiento de calidad observado. No se estima cuando el proceso no reporta pieza buena/rechazada.">
            {quality ? <Chart option={quality} height={240} /> : <Empty>Faltan eventos de calidad (pieza buena/rechazada) para esta ventana.</Empty>}
          </Panel>
        )}

        {shown('occupancy') && (
          <Panel title="¿Dónde se concentra la ocupación?" subtitle="Promedio y pico por zona frente a la capacidad configurada. Densidad y capacidad requieren un layout calibrado y límites validados.">
            {occupancy ? <Chart option={occupancy} height={Math.max(220, occupancyRows.length * 31 + 55)} /> : <Empty>Sin ocupación espacial válida en esta ventana.</Empty>}
          </Panel>
        )}

        {shown('movement') && (
          <Panel title="¿Dónde se observa movimiento o quietud?" subtitle="Composición del tiempo-persona por velocidad. Quietud es una observación neutral y nunca se etiqueta como improductividad.">
            {movement ? <Chart option={movement} height={Math.max(220, movementRows.length * 29 + 55)} /> : <Empty>Sin velocidad o posiciones suficientes.</Empty>}
          </Panel>
        )}

        {shown('routes') && (
          <Panel
            title="¿Qué rutas y retornos se repiten?"
            subtitle="Transiciones agregadas entre zonas públicas; no se publican secuencias individuales ni movimientos dentro de zonas sensibles."
            meta={spatial && <span className="chip chip-accent">{spatial.summary.backtrack_ratio_pct.toFixed(0)}% retorno</span>}
          >
            {routes ? (
              <>
                <div className="flex flex-wrap gap-2 mb-2 text-[10.5px]">
                  <span className="chip">{spatial!.summary.total_transitions} cambios</span>
                  <span className="chip">{spatial!.summary.route_concentration_pct.toFixed(0)}% ruta principal</span>
                  <span className="chip">{spatial!.summary.transition_entropy_pct.toFixed(0)}% diversidad</span>
                </div>
                <Chart option={routes} height={Math.max(190, routeRows.length * 27 + 20)} />
              </>
            ) : <Empty>Se requieren cambios entre dos o más zonas públicas.</Empty>}
          </Panel>
        )}

        {shown('distance') && (
          <Panel title="¿Qué tracks anónimos recorren más y cuándo?" subtitle={`Metros por ID temporal cada ${bucketMin} min dentro de la línea. Valida calibración y compara con producción o abastecimiento antes de interpretar.`}>
            {distance ? <Chart option={distance} height={240} /> : <Empty>Sin trayectorias calibradas dentro de la línea.</Empty>}
          </Panel>
        )}

        {shown('dwell') && (
          <Panel title="¿En qué zonas se acumula tiempo-persona?" subtitle="Persona·minuto por zona. Las zonas sensibles permanecen agregadas; un valor alto describe permanencia, no su motivo." className="xl:col-span-2">
            {dwell ? <Chart option={dwell} height={Math.max(140, 28 * dwellRows.length + 30)} /> : <Empty>Sin posiciones de cámara en esta ventana.</Empty>}
          </Panel>
        )}

        {shown('stops') && (
          <Panel title="¿Qué causas de paro cuestan más tiempo?" subtitle="Pareto de minutos por causa. En oscuro, las causas que acumulan el primer 80% del tiempo." className="xl:col-span-2">
            {pareto ? <Chart option={pareto} height={Math.max(120, 34 * a.stops_pareto.length + 30)} /> : <Empty>Sin paros en esta ventana.</Empty>}
          </Panel>
        )}
      </div>

      {shown('methodology') && (
        <section className="panel p-4 text-[12px] text-ink-2 leading-relaxed">
          <div className="font-medium text-ink mb-1.5">Método, confianza y límites</div>
          <ul className="grid md:grid-cols-2 gap-x-6 gap-y-1">
            {STATE_ORDER.map((k) => (
              <li key={k} className="flex gap-2">
                <span className="inline-block w-2.5 h-2.5 mt-1 rounded-[1px] shrink-0" style={{ background: STATE_META[k].color }} />
                <span><b className="font-medium">{STATE_META[k].label}:</b> {STATE_META[k].help}.</span>
              </li>
            ))}
          </ul>
          <div className="grid md:grid-cols-3 gap-3 mt-3 pt-3 border-t border-line">
            <div><b className="font-medium text-ink">Observado</b><p className="text-ink-3">Posición, ocupación, ciclos, calidad y paros recibidos por los sensores disponibles.</p></div>
            <div><b className="font-medium text-ink">Inferido</b><p className="text-ink-3">Estado, transiciones, quietud, cuello y congestión calculados con reglas documentadas.</p></div>
            <div><b className="font-medium text-ink">No disponible</b><p className="text-ink-3">OEE completo, causa raíz, WIP y tiempo de flujo si faltan identidad de pieza, calendario o eventos de falla.</p></div>
          </div>
          <p className="mt-3 text-ink-3">Quietud no equivale a improductividad. Los KPIs de proceso usan tiempo disponible y los espaciales publican agregados sin reconocimiento facial; la cobertura acompaña siempre la interpretación.</p>
        </section>
      )}

      {visibleModules.length === 0 && (
        <section className="panel p-10 text-center text-[12.5px] text-ink-3">No hay analíticas seleccionadas. Usa “Analíticas” o una vista rápida para añadirlas.</section>
      )}
    </div>
  );
};
