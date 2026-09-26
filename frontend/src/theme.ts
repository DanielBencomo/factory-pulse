// Valores del sistema visual para SVG y ECharts (que no leen clases de Tailwind).
// Mantener sincronizado con el bloque @theme de index.css.
import { AnalyticsState, StationStatus } from './types';

export const C = {
  paper: '#f1f0ec',
  surface: '#ffffff',
  sunken: '#ebeae5',
  ink: '#17212b',
  ink2: '#3d4853',
  ink3: '#5d6974',
  ink4: '#7c8690',
  line: '#dcdad3',
  line2: '#bdbab1',
  brand: '#1f4e73',
  brandDeep: '#173a57',
  brandSoft: '#e4edf4',
  accent: '#b34a14',
  ok: '#2d7a4b',
  warn: '#935d0f',
  bad: '#b3261e',
  info: '#2a6199',
  plum: '#6a4a8c',
};

// Tinte de fondo por tipo de zona en el plano: suficiente para distinguirlas
// de un vistazo sin competir con tracks, spaghetti ni estados.
export const ZONE_TINT: Record<string, { fill: string; stroke: string; pattern: string }> = {
  work: { fill: '#eef4f9', stroke: '#6f8ca6', pattern: '#c9d8e6' },
  storage: { fill: '#fbf4e6', stroke: '#a88a55', pattern: '#e3cfa6' },
  transit: { fill: '#f4f3ef', stroke: '#bdbab1', pattern: '#dcdad3' },
  rest: { fill: '#eef6f0', stroke: '#6f9a7d', pattern: '#bfd9c6' },
  bathroom: { fill: '#f1eff5', stroke: '#8a82a0', pattern: '#d3cee0' },
  restricted: { fill: '#fbeeec', stroke: '#b36b63', pattern: '#ebc4be' },
};

export const FONT_SANS = 'Archivo, ui-sans-serif, system-ui, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';

// Colores de tracks: distinguibles entre sí y legibles sobre papel.
export const TRACK_COLORS: Record<string, string> = {
  'TRK-OP1': C.info,
  'TRK-OP2': C.ok,
  'TRK-OP3': C.plum,
  'TRK-OP4': C.warn,
  'TRK-MAT': C.accent,
};
export const trackColor = (id: string) => TRACK_COLORS[id] ?? C.ink2;

export const STATUS: Record<StationStatus, { label: string; color: string; chip: string }> = {
  active: { label: 'Operando', color: C.ok, chip: 'chip-ok' },
  waiting_material: { label: 'En espera', color: C.warn, chip: 'chip-warn' },
  unattended: { label: 'Desatendida', color: C.bad, chip: 'chip-bad' },
  stopped: { label: 'Paro', color: C.bad, chip: 'chip-bad' },
  present: { label: 'Presente', color: C.info, chip: 'chip-info' },
  idle: { label: 'Inactiva', color: C.ink3, chip: 'chip-muted' },
  unknown: { label: 'Sin dato', color: C.ink3, chip: 'chip-muted' },
};
export const statusOf = (s: string | undefined) => STATUS[(s as StationStatus) ?? 'unknown'] ?? STATUS.unknown;

// Base común para todas las gráficas ECharts.
export const chartBase = {
  backgroundColor: 'transparent',
  textStyle: { fontFamily: FONT_SANS, color: C.ink2 },
  tooltip: {
    backgroundColor: C.surface,
    borderColor: C.line2,
    borderWidth: 1,
    padding: [6, 9],
    textStyle: { color: C.ink, fontSize: 12, fontFamily: FONT_SANS },
    extraCssText: 'box-shadow:none;border-radius:3px;',
  },
};

export const axisCategory = {
  axisLabel: { color: C.ink2, fontSize: 11, fontFamily: FONT_SANS },
  axisLine: { lineStyle: { color: C.line2 } },
  axisTick: { show: false },
};

export const axisValue = {
  axisLabel: { color: C.ink3, fontSize: 10.5, fontFamily: FONT_MONO },
  splitLine: { lineStyle: { color: C.line, type: 'dashed' as const } },
  axisLine: { show: false },
};

// Estados reconstruidos por la analítica (misma paleta en KPIs, tablas y gráficas).
export const STATE_META: Record<AnalyticsState, { label: string; short: string; color: string; help: string }> = {
  productivo: { label: 'Productivo', short: 'Prod.', color: C.ok, help: 'Hay operador y la máquina reporta marcha o ciclo reciente' },
  espera: { label: 'Espera', short: 'Esp.', color: C.warn, help: 'Hay operador, hay sensor de proceso y no hay marcha ni ciclo' },
  presente: { label: 'Presente sin dato de proceso', short: 'Pres.', color: C.info, help: 'Hay operador pero la estación no tiene sensor de proceso' },
  ausencia: { label: 'Ausencia', short: 'Aus.', color: C.plum, help: 'Ningún track de la cámara dentro de la estación' },
  paro: { label: 'Paro justificado', short: 'Paro', color: C.ink2, help: 'Paro autorizado activo; no cuenta como espera' },
  sin_datos: { label: 'Sin datos', short: 'S/D', color: C.line2, help: 'La cámara no reportó ningún track; no se sabe si había alguien' },
};
export const STATE_ORDER: AnalyticsState[] = ['productivo', 'espera', 'presente', 'ausencia', 'paro', 'sin_datos'];
