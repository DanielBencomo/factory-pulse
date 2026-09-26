// Interior de un área: catálogo de elementos y plantilla por tipo de equipo.
// Todas las medidas en metros desde la esquina superior izquierda de la zona.
import { EquipmentType, InteriorItem, InteriorKind, PolygonZone, Station } from '../types';
import { bbox } from './geometry';

export type KindMeta = {
  label: string;
  group: 'equipo' | 'sensor';
  /** Letra que se usa en el plano y en el panel de fuentes. */
  letter?: string;
  /** Tipo de dispositivo que alimenta a este sensor (para vincularlo). */
  deviceType?: string;
  size: [number, number];
};

export const KINDS: Record<InteriorKind, KindMeta> = {
  machine: { label: 'Máquina / equipo', group: 'equipo', size: [3, 2] },
  conveyor: { label: 'Banda transportadora', group: 'equipo', size: [6, 0.7] },
  bench: { label: 'Mesa de trabajo', group: 'equipo', size: [2.4, 0.9] },
  rack: { label: 'Rack / kanban', group: 'equipo', size: [0.9, 2.4] },
  workstation: { label: 'Puesto de trabajo', group: 'equipo', size: [3, 1.6] },
  cart: { label: 'Carro de material', group: 'equipo', size: [1.2, 0.8] },
  rfid: { label: 'Lector RFID (RC522)', group: 'sensor', letter: 'A', deviceType: 'esp32_rfid', size: [0.6, 0.6] },
  csi: { label: 'Nodo ESP32 CSI', group: 'sensor', letter: 'B', deviceType: 'esp32_csi', size: [0.6, 0.6] },
  camera: { label: 'Cámara cenital', group: 'sensor', letter: 'C', deviceType: 'camera_vision', size: [0.6, 0.6] },
  button: { label: 'Pulsador de paro', group: 'sensor', letter: 'D', deviceType: 'esp32_button', size: [0.6, 0.6] },
  process: { label: 'Sensor de proceso', group: 'sensor', letter: 'E', deviceType: 'esp32_process', size: [0.6, 0.6] },
};

export const SENSOR_KINDS = (Object.keys(KINDS) as InteriorKind[]).filter((k) => KINDS[k].group === 'sensor');
export const EQUIPMENT_KINDS = (Object.keys(KINDS) as InteriorKind[]).filter((k) => KINDS[k].group === 'equipo');

export const zoneSizeM = (zone: PolygonZone, widthM: number, heightM: number) => {
  const b = bbox(zone.polygon);
  return { w: (b.x1 - b.x0) * widthM, h: (b.y1 - b.y0) * heightM };
};

let seq = 0;
export const itemId = (kind: string) => `${kind}-${Date.now().toString(36)}${(seq++).toString(36)}`;

// Huella de cada tipo de máquina como fracción del área (x, y, w, h).
const MACHINE_BOX: Record<EquipmentType, [number, number, number, number]> = {
  smt: [0.18, 0.12, 0.64, 0.36],
  reflow: [0.06, 0.15, 0.88, 0.25],
  aoi: [0.28, 0.13, 0.44, 0.32],
  pack: [0.12, 0.13, 0.8, 0.25],
  manual: [0.14, 0.3, 0.72, 0.2],
  generic: [0.25, 0.15, 0.5, 0.22],
};

/**
 * Arreglo por omisión cuando el área no tiene interior guardado. Reproduce la
 * vista de estación original: banda, máquina, puesto, rack y los cinco sensores
 * del documento del hackathon.
 */
export const defaultInterior = (zone: PolygonZone, station: Station | undefined, widthM: number, heightM: number): InteriorItem[] => {
  const { w: W, h: H } = zoneSizeM(zone, widthM, heightM);
  const r = (v: number) => Math.round(v * 100) / 100;
  const box = (kind: InteriorKind, fx: number, fy: number, fw: number, fh: number, extra: Partial<InteriorItem> = {}): InteriorItem => ({
    id: itemId(kind),
    kind,
    x: r(fx * W),
    y: r(fy * H),
    w: r(Math.max(0.2, fw * W)),
    h: r(Math.max(0.2, fh * H)),
    rot: 0,
    ...extra,
  });
  const sensor = (kind: InteriorKind, fx: number, fy: number): InteriorItem => ({
    id: itemId(kind),
    kind,
    x: r(Math.min(W - 0.6, Math.max(0, fx * W - 0.3))),
    y: r(Math.min(H - 0.6, Math.max(0, fy * H - 0.3))),
    w: 0.6,
    h: 0.6,
    rot: 0,
  });

  if (!station) return [];
  const eq: EquipmentType = station.equipment_type ?? 'generic';
  const [mx, my, mw, mh] = MACHINE_BOX[eq];
  const items: InteriorItem[] = [];
  if (eq !== 'manual') items.push(box('conveyor', 0, 0.21, 1, 0.08));
  items.push(box('machine', mx, my, mw, mh, { variant: eq }));
  items.push(box('workstation', 0.24, 0.52, 0.52, 0.2));
  items.push(box('rack', 0.83, 0.51, 0.13, 0.3, { label: 'Kanban' }));
  items.push(sensor('camera', 0.5, 0.04));
  items.push(sensor('button', 0.28, 0.55));
  items.push(sensor('rfid', 0.66, 0.95));
  items.push(sensor('csi', 0.07, 0.9));
  items.push(sensor('process', mx + mw - 0.03, my + mh - 0.03));
  return items;
};

export const interiorOf = (zone: PolygonZone, station: Station | undefined, widthM: number, heightM: number) =>
  zone.interior && zone.interior.length ? zone.interior : defaultInterior(zone, station, widthM, heightM);
