// Geometría del plano: coordenadas normalizadas 0..1 respecto a la nave.
import { Line, PolygonZone, Station, TrackPoint, TrackSamples, TrajectoryPolicy } from '../types';

export type Poly = [number, number][];

/** Ancho del plano en unidades SVG. El alto sigue la proporción real de la nave. */
export const PLAN_W = 1000;
export const planHeight = (widthM: number, heightM: number) => (PLAN_W * heightM) / widthM;

export const bbox = (poly: Poly) => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

export const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export const pointInPolygon = (x: number, y: number, poly: Poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (onSegment([xi, yi], [xj, yj], [x, y])) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

type XY = readonly [number, number, ...unknown[]];
const EPSILON = 1e-9;
const cross = (a: XY, b: XY, p: XY) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const onSegment = (a: XY, b: XY, p: XY) => Math.abs(cross(a, b, p)) <= EPSILON
  && p[0] >= Math.min(a[0], b[0]) - EPSILON && p[0] <= Math.max(a[0], b[0]) + EPSILON
  && p[1] >= Math.min(a[1], b[1]) - EPSILON && p[1] <= Math.max(a[1], b[1]) + EPSILON;
const straddles = (a: XY, b: XY, c: XY, d: XY) => cross(a, b, c) * cross(a, b, d) < 0;
const crossesBoundary = (a: XY, b: XY, poly: Poly, includeTouch: boolean) =>
  poly.some((c, i) => {
    const d = poly[(i + 1) % poly.length];
    return (straddles(a, b, c, d) && straddles(c, d, a, b))
      || (includeTouch && (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)));
  });

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/* ── Líneas ── */

export const stationOfZone = (zone: PolygonZone, stations: Station[]) => stations.find((s) => zone.station_ids.includes(s.station_id));

export const lineOfZone = (zone: PolygonZone, stations: Station[]): string | null =>
  zone.line_id ?? stationOfZone(zone, stations)?.line_id ?? null;

export const zonesOfLine = (lineId: string, zones: PolygonZone[], stations: Station[]) =>
  zones.filter((z) => lineOfZone(z, stations) === lineId);

/** Área de la línea: la dibujada por el usuario o, si no hay, la caja de sus zonas con margen. */
export const lineArea = (line: Line, zones: PolygonZone[], stations: Station[], pad = 0.02): Poly | null => {
  if (line.polygon && line.polygon.length >= 3) return line.polygon;
  const own = zonesOfLine(line.id, zones, stations);
  if (own.length === 0) return null;
  const all = own.flatMap((z) => z.polygon);
  const b = bbox(all);
  return rect(clamp01(b.x0 - pad), clamp01(b.y0 - pad), clamp01(b.x1 + pad), clamp01(b.y1 + pad));
};

/* ── Spaghetti ── */

export const observedStep = (a: TrackPoint, b: TrackPoint, width: number, height: number, policy: TrajectoryPolicy) => {
  const seconds = (b[2] - a[2]) / 1000;
  if (a[3] !== b[3] || !(seconds > 0 && seconds <= policy.max_gap_s)) return null;
  const meters = Math.hypot((b[0] - a[0]) * width, (b[1] - a[1]) * height);
  return meters / seconds <= policy.max_speed_m_s ? { seconds, meters: meters >= policy.jitter_m ? meters : 0 } : null;
};

/** No se une a través de huecos, polígonos privados ni salidas de alcance. */
export const runsInside = (
  pts: TrackPoint[], poly: Poly | null, privatePolys: Poly[], width: number, height: number, policy: TrajectoryPolicy,
): TrackPoint[][] => {
  const runs: TrackPoint[][] = [];
  let cur: TrackPoint[] = [];
  for (const p of pts) {
    const allowed = (!poly || pointInPolygon(p[0], p[1], poly))
      && !privatePolys.some((z) => pointInPolygon(p[0], p[1], z));
    const prev = cur[cur.length - 1];
    if (prev && (!allowed || !observedStep(prev, p, width, height, policy)
      || (poly && (crossesBoundary(prev, p, poly, false) || !pointInPolygon((p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2, poly)))
      || privatePolys.some((z) => crossesBoundary(prev, p, z, true)))) {
      runs.push(cur);
      cur = [];
    }
    if (allowed) cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
};

export const statsInside = (runs: TrackPoint[][], mPerX: number, mPerY: number, policy: TrajectoryPolicy) => {
  let meters = 0;
  let seconds = 0;
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const step = observedStep(run[i - 1], run[i], mPerX, mPerY, policy);
      if (step) {
        meters += step.meters;
        seconds += step.seconds;
      }
    }
  }
  return { meters, seconds, entries: runs.length };
};

/** Merge actual capture samples. A re-sent sample never extends the observed time. */
export const mergeTrackSamples = (base: TrackSamples, updates: TrackSamples, cutoff: number): TrackSamples => {
  const result: [string, TrackPoint[]][] = [];
  for (const id of new Set([...Object.keys(base), ...Object.keys(updates)])) {
    const prior = Object.prototype.hasOwnProperty.call(base, id) ? base[id] : [];
    const next = Object.prototype.hasOwnProperty.call(updates, id) ? updates[id] : [];
    if (prior.length && prior[0][2] >= cutoff && next.length === 0) {
      result.push([id, prior]);
      continue;
    }
    const merged = new Map<number, TrackPoint>();
    for (const p of prior) if (p[2] >= cutoff) merged.set(p[2], p);
    for (const p of next) if (p[2] >= cutoff) merged.set(p[2], p);
    if (merged.size) result.push([id, [...merged.values()].sort((a, b) => a[2] - b[2]).slice(-12000)]);
  }
  return Object.fromEntries(result);
};

/** Grid weights are actual sample counts or seconds between adjacent valid captures. */
export const heatCells = (
  runs: Record<string, TrackPoint[][]>, mode: 'traffic' | 'dwell', selectedTrack: string,
  width: number, height: number, policy: TrajectoryPolicy,
) => {
  const size = 24;
  const cells = new Map<number, { x: number; y: number; weight: number }>();
  for (const [id, parts] of Object.entries(runs)) {
    if (selectedTrack !== 'all' && selectedTrack !== id) continue;
    for (const part of parts) {
      for (let i = 0; i < part.length; i++) {
        const [x, y] = part[i];
        const next = part[i + 1];
        const step = mode === 'dwell' && next ? observedStep(part[i], next, width, height, policy) : null;
        const weight = mode === 'traffic' ? 1 : step?.seconds ?? 0;
        if (!weight) continue;
        const cx = step ? (x + next[0]) / 2 : x;
        const cy = step ? (y + next[1]) / 2 : y;
        const key = Math.min(size - 1, Math.floor(cx * size)) + size * Math.min(size - 1, Math.floor(cy * size));
        const prior = cells.get(key);
        if (prior) {
          prior.x += cx * weight;
          prior.y += cy * weight;
          prior.weight += weight;
        } else cells.set(key, { x: cx * weight, y: cy * weight, weight });
      }
    }
  }
  return [...cells.entries()].map(([key, { x, y, weight }]) => ({ key, x: x / weight, y: y / weight, weight }));
};

/**
 * Viajes entre estaciones (diagrama de-a): cuenta cada cambio de estación en la
 * secuencia de estaciones visitadas, ignorando el tiempo en pasillo.
 */
export const stationTransitions = (pts: TrackPoint[], stationZones: PolygonZone[]) => {
  const counts: Record<string, number> = {};
  let last: string | null = null;
  for (const p of pts) {
    const z = stationZones.find((zz) => pointInPolygon(p[0], p[1], zz.polygon));
    if (!z) continue;
    if (last && last !== z.id) counts[`${last}>${z.id}`] = (counts[`${last}>${z.id}`] ?? 0) + 1;
    last = z.id;
  }
  return counts;
};

export const shortStationName = (name: string) => name.replace(/^Estación \d+ \((.+)\)$/, '$1');
