// Geometría del plano: coordenadas normalizadas 0..1 respecto a la nave.
import { Line, PolygonZone, Station, TrackPoint } from '../types';

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
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

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

/** Tramos consecutivos de la trayectoria que caen dentro del polígono. */
export const runsInside = (pts: TrackPoint[], poly: Poly): TrackPoint[][] => {
  const runs: TrackPoint[][] = [];
  let cur: TrackPoint[] = [];
  for (const p of pts) {
    if (pointInPolygon(p[0], p[1], poly)) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
};

const MAX_DT = 10_000; // huecos mayores a 10 s no cuentan como tiempo continuo

export const statsInside = (pts: TrackPoint[], poly: Poly, mPerX: number, mPerY: number) => {
  let meters = 0;
  let ms = 0;
  let entries = 0;
  const runs = runsInside(pts, poly);
  for (const run of runs) {
    entries++;
    for (let i = 1; i < run.length; i++) {
      meters += Math.hypot((run[i][0] - run[i - 1][0]) * mPerX, (run[i][1] - run[i - 1][1]) * mPerY);
      ms += Math.min(MAX_DT, run[i][2] - run[i - 1][2]);
    }
  }
  return { meters, seconds: ms / 1000, entries };
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
