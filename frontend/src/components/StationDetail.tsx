import React from 'react';
import { Device, EquipmentType, InteriorItem, InteriorKind, PolygonZone, Station, StationMetric, Stop, SystemMode, TrackPoint, ZoneSignals } from '../types';
import { api } from '../services/api';
import { C, FONT_MONO, FONT_SANS, statusOf, trackColor } from '../theme';
import { PLAN_W, bbox, pointInPolygon } from '../layout/geometry';
import { KINDS, SENSOR_KINDS } from '../layout/interior';

/*
 * Vista de detalle de un área (zoom desde el plano).
 *
 * El interior (equipos y sensores) es configuración editable por área; nadie lo
 * "mide". Los sensores llevan la letra de la tabla de fuentes del panel lateral:
 *   A · RFID RC522 en checkpoint   B · ESP32 Wi‑Fi CSI   C · Cámara cenital
 *   D · Pulsador de paro           E · Sensor de proceso (fuera del kit; piloto)
 */

export { pointInPolygon };

export type Track = { x: number; y: number; name: string };
export type ZoneLogEntry = { t: number; trackId: string; zoneId: string; kind: 'entrada' | 'salida' };
export type CsiState = 'actividad' | 'quietud' | 'sin_presencia';
export type StationKind = EquipmentType;

export const bboxOf = (zone: PolygonZone) => bbox(zone.polygon);

export const stationKind = (st?: Station): StationKind => {
  if (!st) return 'generic';
  if (st.equipment_type) return st.equipment_type;
  const n = `${st.station_id} ${st.name}`.toLowerCase();
  if (n.includes('smt')) return 'smt';
  if (n.includes('reflow') || n.includes('reflujo')) return 'reflow';
  if (n.includes('aoi')) return 'aoi';
  if (n.includes('empaque') || n.includes('pack')) return 'pack';
  return 'generic';
};

export const KIND_LABEL: Record<StationKind, string> = {
  smt: 'Pick & place SMT',
  reflow: 'Horno de reflujo',
  aoi: 'Inspección óptica',
  pack: 'Prueba y empaque',
  manual: 'Mesa de ensamble manual',
  generic: 'Equipo genérico',
};

export const EQUIPMENT_OPTIONS: { value: EquipmentType; label: string }[] = (
  ['manual', 'smt', 'reflow', 'aoi', 'pack', 'generic'] as EquipmentType[]
).map((value) => ({ value, label: KIND_LABEL[value] }));

// Deriva el estado "CSI" a partir del movimiento de los tracks en la zona.
// En el demo no hay nodo CSI conectado: esto emula la señal que daría uno.
export const deriveCsi = (
  inside: string[],
  histories: Record<string, TrackPoint[]>,
  mPerX: number,
  mPerY: number,
): { state: CsiState; motion: number } => {
  if (inside.length === 0) return { state: 'sin_presencia', motion: 0 };
  let motion = 0;
  inside.forEach((id) => {
    const h = (histories[id] ?? []).slice(-6);
    let d = 0;
    for (let i = 1; i < h.length; i++) d += Math.hypot((h[i][0] - h[i - 1][0]) * mPerX, (h[i][1] - h[i - 1][1]) * mPerY);
    motion = Math.max(motion, h.length > 1 ? d / (h.length - 1) : 0);
  });
  return { state: motion > 0.12 ? 'actividad' : 'quietud', motion };
};

const CSI_META: Record<CsiState, { label: string; color: string }> = {
  actividad: { label: 'Actividad', color: C.ok },
  quietud: { label: 'Quietud', color: C.warn },
  sin_presencia: { label: 'Sin presencia', color: C.ink4 },
};

// Tag RFID ficticio y estable por track (el demo no tiene tarjetas reales).
export const tagFor = (trackId: string) => {
  let h = 0;
  for (const ch of trackId) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  const hex = h.toString(16).toUpperCase().padStart(4, '0');
  return `04:${hex.slice(0, 2)}:··:${hex.slice(2)}`;
};

const hhmmss = (t: number) => new Date(t).toLocaleTimeString('es-MX', { hour12: false });

export const DEVICE_STATUS: Record<string, { label: string; chip: string; color: string }> = {
  online: { label: 'conectado', chip: 'chip-ok', color: C.ok },
  waiting: { label: 'esperando conexión', chip: 'chip-warn', color: C.warn },
  offline: { label: 'sin señal', chip: 'chip-bad', color: C.bad },
  warning: { label: 'intermitente', chip: 'chip-warn', color: C.warn },
  none: { label: 'sin vincular', chip: 'chip-muted', color: C.ink3 },
};

/* ───────────────────────── Dibujo de máquinas ───────────────────────── */

// Las máquinas se dibujan en un marco local propio; MACHINE_ART_BOX es su huella
// dentro de ese marco para poder ajustarlas a la caja del elemento.
const MACHINE_ART_BOX: Record<StationKind, [number, number, number, number]> = {
  smt: [18, 15, 64, 45],
  reflow: [6, 19, 88, 30],
  aoi: [28, 16, 44, 40],
  pack: [12, 16, 80, 30],
  manual: [14, 35, 72, 25],
  generic: [25, 18, 50, 26],
};

const Label: React.FC<{ x: number; y: number; children: React.ReactNode; anchor?: 'start' | 'middle' | 'end'; size?: number; color?: string; mono?: boolean }> = ({
  x,
  y,
  children,
  anchor = 'middle',
  size = 3,
  color = C.ink2,
  mono,
}) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={size} fontFamily={mono ? FONT_MONO : FONT_SANS} fill={color} style={{ fontStretch: '85%' }}>
    {children}
  </text>
);

const MachineArt: React.FC<{ kind: StationKind; running: boolean }> = ({ kind, running }) => {
  const body = { fill: C.surface, stroke: C.ink, strokeWidth: 0.45 };
  const detail = { fill: 'none', stroke: C.ink3, strokeWidth: 0.3 };
  switch (kind) {
    case 'smt':
      return (
        <g>
          <rect x={18} y={16} width={64} height={30} rx={1} {...body} />
          <line x1={21} y1={24} x2={79} y2={24} {...detail} />
          <line x1={21} y1={38} x2={79} y2={38} {...detail} />
          <g transform="translate(30,0)">
            <rect x={-3} y={21} width={6} height={20} fill={C.sunken} stroke={C.ink2} strokeWidth={0.3} />
            <circle cx={0} cy={31} r={1.6} fill="none" stroke={C.ink2} strokeWidth={0.3} />
            {running && <animateTransform attributeName="transform" type="translate" values="30;68;46;30" dur="3.2s" repeatCount="indefinite" />}
          </g>
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={i} x={21 + i * 4.8} y={46} width={3.6} height={7} fill={C.sunken} stroke={C.ink3} strokeWidth={0.25} />
          ))}
          <Label x={50} y={58.5} size={2.6} color={C.ink3}>feeders</Label>
        </g>
      );
    case 'reflow':
      return (
        <g>
          <rect x={6} y={19} width={88} height={24} rx={1} {...body} />
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={i} x1={6 + (i + 1) * (88 / 6)} y1={19} x2={6 + (i + 1) * (88 / 6)} y2={43} {...detail} />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <Label key={i} x={6 + (i + 0.5) * (88 / 6)} y={23.5} size={2.4} color={C.ink3} mono>
              Z{i + 1}
            </Label>
          ))}
          <rect x={10} y={44} width={12} height={5} fill={C.sunken} stroke={C.ink3} strokeWidth={0.25} />
          <Label x={16} y={47.6} size={2.2} color={C.ink3} mono>HMI</Label>
        </g>
      );
    case 'aoi':
      return (
        <g>
          <rect x={28} y={16} width={44} height={30} rx={1} {...body} />
          <circle cx={50} cy={31} r={6} fill="none" stroke={C.ink2} strokeWidth={0.35} />
          <line x1={42} y1={31} x2={58} y2={31} {...detail} />
          <line x1={50} y1={23} x2={50} y2={39} {...detail} />
          <rect x={41} y={49} width={18} height={6} fill={C.sunken} stroke={C.ink3} strokeWidth={0.25} />
          <Label x={50} y={53} size={2.3} color={C.ink3}>monitor</Label>
        </g>
      );
    case 'pack':
      return (
        <g>
          <rect x={12} y={18} width={32} height={26} rx={1} {...body} />
          <rect x={17} y={23} width={22} height={9} fill="none" stroke={C.ink3} strokeWidth={0.3} />
          <Label x={28} y={39} size={2.4} color={C.ink3}>fixture</Label>
          <rect x={52} y={16} width={40} height={30} rx={1} fill={C.sunken} stroke={C.ink2} strokeWidth={0.35} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={56 + i * 11.5} y={24} width={9} height={9} fill={C.surface} stroke={C.ink3} strokeWidth={0.3} />
          ))}
          <Label x={72} y={41} size={2.4} color={C.ink3}>mesa de empaque</Label>
        </g>
      );
    case 'manual':
      return (
        <g>
          <rect x={14} y={40} width={72} height={20} rx={1} fill={C.sunken} stroke={C.ink} strokeWidth={0.45} />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={18 + i * 13.6} y={43} width={9} height={6} fill={C.surface} stroke={C.ink3} strokeWidth={0.3} />
          ))}
          <rect x={40} y={51} width={20} height={7} fill={C.surface} stroke={C.ink2} strokeWidth={0.35} />
          <Label x={50} y={55.8} size={2.3} color={C.ink3}>fixture</Label>
          <Label x={50} y={38} size={2.4} color={C.ink3}>gavetas</Label>
        </g>
      );
    default:
      return <rect x={25} y={18} width={50} height={26} rx={1} {...body} />;
  }
};

/* ───────────────────────── Elementos del interior (en metros) ───────────────────────── */

const SW = 0.035; // grosor de trazo en metros

export const InteriorItemShape: React.FC<{
  item: InteriorItem;
  running?: boolean;
  deviceStatus?: string;
  csi?: CsiState;
  selected?: boolean;
}> = ({ item, running = false, deviceStatus, csi, selected }) => {
  const { w, h } = item;
  const meta = KINDS[item.kind];
  let body: React.ReactNode;

  switch (item.kind) {
    case 'machine': {
      const kind = (item.variant as StationKind) || 'generic';
      const [bx, by, bw, bh] = MACHINE_ART_BOX[kind] ?? MACHINE_ART_BOX.generic;
      const s = Math.min(w / bw, h / bh);
      body = (
        <>
          <g transform={`translate(${(w - bw * s) / 2},${(h - bh * s) / 2}) scale(${s}) translate(${-bx},${-by})`}>
            <MachineArt kind={kind} running={running} />
          </g>
          <text x={w / 2} y={-0.12} textAnchor="middle" fontSize={0.34} fontFamily={FONT_SANS} fill={C.ink} style={{ fontStretch: '85%' }}>
            {item.label || KIND_LABEL[kind]}
          </text>
        </>
      );
      break;
    }
    case 'conveyor': {
      const n = Math.max(1, Math.floor(w / 0.3));
      body = (
        <>
          <rect width={w} height={h} fill={C.sunken} stroke={C.line2} strokeWidth={SW * 0.8} />
          {Array.from({ length: n }).map((_, i) => (
            <line key={i} x1={(i + 0.5) * (w / n)} y1={h * 0.08} x2={(i + 0.5) * (w / n)} y2={h * 0.92} stroke={C.line2} strokeWidth={SW * 0.6} />
          ))}
          <path d={`M${w * 0.05} ${h * 0.3} l${h * 0.25} ${h * 0.2} l${-h * 0.25} ${h * 0.2}`} fill="none" stroke={C.ink3} strokeWidth={SW} />
          <path d={`M${w * 0.95 - h * 0.25} ${h * 0.3} l${h * 0.25} ${h * 0.2} l${-h * 0.25} ${h * 0.2}`} fill="none" stroke={C.ink3} strokeWidth={SW} />
        </>
      );
      break;
    }
    case 'bench':
      body = (
        <>
          <rect width={w} height={h} fill={C.sunken} stroke={C.ink2} strokeWidth={SW} />
          {Array.from({ length: Math.max(1, Math.floor(w / 0.5)) }).map((_, i) => (
            <rect key={i} x={0.1 + i * 0.5} y={0.1} width={0.35} height={Math.min(0.3, h * 0.4)} fill={C.surface} stroke={C.ink3} strokeWidth={SW * 0.6} />
          ))}
        </>
      );
      break;
    case 'rack': {
      const shelves = Math.max(1, Math.floor(Math.max(w, h) / 0.6));
      const vertical = h >= w;
      body = (
        <>
          <rect width={w} height={h} fill={C.surface} stroke={C.ink2} strokeWidth={SW} />
          {Array.from({ length: shelves - 1 }).map((_, i) =>
            vertical ? (
              <line key={i} x1={0} y1={((i + 1) * h) / shelves} x2={w} y2={((i + 1) * h) / shelves} stroke={C.ink3} strokeWidth={SW * 0.6} />
            ) : (
              <line key={i} x1={((i + 1) * w) / shelves} y1={0} x2={((i + 1) * w) / shelves} y2={h} stroke={C.ink3} strokeWidth={SW * 0.6} />
            ),
          )}
          <text x={w / 2} y={h + 0.32} textAnchor="middle" fontSize={0.26} fontFamily={FONT_SANS} fill={C.ink3}>
            {item.label || 'rack'}
          </text>
        </>
      );
      break;
    }
    case 'workstation':
      body = (
        <>
          <rect width={w} height={h} fill="none" stroke={C.ink3} strokeWidth={SW * 0.8} strokeDasharray="0.12 0.08" />
          <text x={0.1} y={h - 0.1} fontSize={0.26} fontFamily={FONT_SANS} fill={C.ink3}>
            {item.label || 'puesto de trabajo'}
          </text>
        </>
      );
      break;
    case 'cart':
      body = (
        <>
          <rect width={w} height={h} fill={C.surface} stroke={C.ink2} strokeWidth={SW} />
          {[
            [0.12, 0.12],
            [w - 0.12, 0.12],
            [0.12, h - 0.12],
            [w - 0.12, h - 0.12],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={0.06} fill={C.ink3} />
          ))}
          <text x={w / 2} y={h / 2 + 0.09} textAnchor="middle" fontSize={0.24} fontFamily={FONT_SANS} fill={C.ink3}>
            {item.label || 'carro'}
          </text>
        </>
      );
      break;
    default: {
      // Sensores: cuadro con su letra; el borde indica el estado del dispositivo vinculado.
      const st = DEVICE_STATUS[deviceStatus ?? 'none'];
      const linked = !!item.device_id;
      const s = Math.min(w, h);
      body = (
        <>
          {item.kind === 'csi' && csi && (
            <g transform={`translate(${s / 2},0)`}>
              {[0.5, 0.85, 1.2].map((r, i) => (
                <path
                  key={r}
                  d={`M ${-r * 0.7} ${-r * 0.55} A ${r} ${r} 0 0 1 ${r * 0.7} ${-r * 0.55}`}
                  fill="none"
                  stroke={CSI_META[csi].color}
                  strokeWidth={SW * 1.3}
                  opacity={csi === 'sin_presencia' ? 0.5 : 1 - i * 0.22}
                />
              ))}
            </g>
          )}
          <rect
            width={s}
            height={s}
            fill={linked && deviceStatus === 'online' ? C.ink : C.surface}
            stroke={linked ? st.color : C.ink}
            strokeWidth={SW * (linked ? 2 : 1.2)}
            strokeDasharray={!linked && item.kind === 'process' ? '0.08 0.06' : undefined}
          />
          <text
            x={s / 2}
            y={s / 2 + 0.13}
            textAnchor="middle"
            fontSize={0.38}
            fontFamily={FONT_MONO}
            fontWeight={600}
            fill={linked && deviceStatus === 'online' ? C.paper : C.ink}
          >
            {meta.letter}
          </text>
        </>
      );
    }
  }

  return (
    <g transform={`translate(${item.x},${item.y}) rotate(${item.rot ?? 0} ${w / 2} ${h / 2})`}>
      {body}
      {selected && <rect x={-0.06} y={-0.06} width={w + 0.12} height={h + 0.12} fill="none" stroke={C.accent} strokeWidth={SW * 1.4} />}
    </g>
  );
};

/** Interior de un área dibujado dentro del plano (1 m = `unit` unidades SVG). */
export const StationDrawing: React.FC<{
  zone: PolygonZone;
  items: InteriorItem[];
  status?: string;
  csi: CsiState;
  planH: number;
  unit: number;
  devices: Device[];
}> = ({ zone, items, status, csi, planH, unit, devices }) => {
  const b = bboxOf(zone);
  const devStatus = (id?: string | null) => (id ? devices.find((d) => d.device_id === id)?.status ?? 'none' : undefined);
  return (
    <g transform={`translate(${b.x0 * PLAN_W},${b.y0 * planH}) scale(${unit})`} className="fp-fade" style={{ pointerEvents: 'none' }}>
      {items.map((it) => (
        <InteriorItemShape key={it.id} item={it} running={status === 'active'} deviceStatus={devStatus(it.device_id)} csi={csi} />
      ))}
    </g>
  );
};

/* ───────────────────────── Panel lateral ───────────────────────── */

const SourceRow: React.FC<{
  letter: string;
  dashed?: boolean;
  name: string;
  chips: { label: string; chip: string; title?: string }[];
  children: React.ReactNode;
  note: string;
}> = ({ letter, dashed, name, chips, children, note }) => (
  <li className="py-2.5 border-b border-line last:border-0">
    <div className="flex items-center gap-2">
      <span
        className={`num inline-flex items-center justify-center w-[18px] h-[18px] text-[10.5px] font-semibold ${
          dashed ? 'border border-dashed border-ink text-ink' : 'bg-ink text-paper'
        }`}
      >
        {letter}
      </span>
      <span className="text-[12.5px] font-medium whitespace-nowrap">{name}</span>
      <span className="ml-auto flex gap-1 flex-wrap justify-end">
        {chips.map((c) => (
          <span key={c.label} className={`chip ${c.chip}`} title={c.title}>
            {c.label}
          </span>
        ))}
      </span>
    </div>
    <div className="mt-1.5 pl-[26px] text-[12.5px] text-ink">{children}</div>
    <p className="mt-1 pl-[26px] text-[11.5px] leading-snug text-ink-3">{note}</p>
  </li>
);

const SOURCE_TEXT: Record<string, { name: string; note: string }> = {
  rfid: { name: 'RFID · checkpoint', note: 'RC522: identidad y hora de paso. No da posición entre lecturas.' },
  csi: { name: 'ESP32 · CSI', note: 'Wi‑Fi CSI: un estado para toda la zona. No identifica ni ubica a la persona.' },
  camera: { name: 'Cámara · XY', note: 'Cámara cenital: un punto por persona, ±20–50 cm. Alimenta spaghetti y distancia.' },
  button: { name: 'Pulsador de paro', note: 'El supervisor registra causa; el intervalo sale de la espera improductiva.' },
  process: { name: 'Sensor de proceso', note: 'Ciclos y piezas. No está en la lista de compra del hackathon (piloto).' },
};

export const ZoneReadout: React.FC<{
  zone: PolygonZone;
  station?: Station;
  stationMetric?: StationMetric;
  items: InteriorItem[];
  devices: Device[];
  mode: SystemMode;
  insideIds: string[];
  tracks: Record<string, Track>;
  histories: Record<string, TrackPoint[]>;
  log: ZoneLogEntry[];
  stops: Stop[];
  mPerX: number;
  mPerY: number;
  spaghetti?: React.ReactNode;
  onEditInterior?: () => void;
}> = ({ zone, station, stationMetric, items, devices, mode, insideIds, tracks, histories, log, stops, mPerX, mPerY, spaghetti, onEditInterior }) => {
  const b = bboxOf(zone);
  const now = Date.now();

  // Señales reales del área (RFID, CSI/PIR, pulsador, ciclos). En demo, lo que no
  // llegue de un dispositivo se emula a partir de los tracks y se marca "simulado".
  const [signals, setSignals] = React.useState<ZoneSignals | null>(null);
  React.useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getZoneSignals(zone.zone_id)
        .then((sg) => alive && setSignals(sg))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [zone.zone_id, mode]);
  const ageS = (iso?: string) => (iso ? (now - Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)) / 1000 : Infinity);
  const realRfid = signals?.rfid ?? [];
  const realCsi = signals?.csi && ageS(signals.csi.at) <= 60 ? signals.csi : null;
  const realPir = signals?.pir && ageS(signals.pir.at) <= 60 ? signals.pir : null;
  const realCycles = signals?.process.cycles_last_hour ?? 0;
  const emulate = mode === 'demo';
  const isReal: Partial<Record<InteriorKind, boolean>> = {
    rfid: realRfid.length > 0,
    csi: !!realCsi,
    button: !!signals?.button,
    process: realCycles > 0,
    camera: mode !== 'demo',
  };

  const zoneLog = log.filter((e) => e.zoneId === zone.id);
  const lastRead = zoneLog[zoneLog.length - 1];
  const csi = deriveCsi(insideIds, histories, mPerX, mPerY);
  const st = statusOf(stationMetric?.current_status ?? station?.current_status);
  const openStops = stops.filter(
    (s) => s.status === 'open' && (s.scope_id === station?.station_id || s.scope_id === station?.line_id || s.scope_id === zone.id || s.scope_type === 'plant'),
  );
  const entrySince = (id: string) => {
    for (let i = zoneLog.length - 1; i >= 0; i--) if (zoneLog[i].trackId === id) return zoneLog[i].kind === 'entrada' ? zoneLog[i].t : null;
    return null;
  };

  // Chips de una fuente según lo instalado en el área y el dispositivo vinculado.
  const sensorsOf = (kind: InteriorKind) => items.filter((i) => i.kind === kind);
  const chipsFor = (kind: InteriorKind) => {
    const list = sensorsOf(kind);
    const linked = list.filter((i) => i.device_id);
    const statuses = linked.map((i) => devices.find((d) => d.device_id === i.device_id)?.status ?? 'none');
    const best = statuses.includes('online') ? 'online' : statuses.includes('waiting') ? 'waiting' : statuses.includes('offline') ? 'offline' : 'none';
    const chips = [{ ...DEVICE_STATUS[best], title: linked.map((i) => i.device_id).join(', ') || 'Sin ESP32 vinculado' }];
    if (list.length > 1) chips.unshift({ label: `×${list.length}`, chip: 'chip-muted', color: C.ink3, title: `${list.length} instalados` });
    if (mode === 'demo' && !isReal[kind]) chips.push({ label: 'simulado', chip: 'chip-warn', color: C.warn, title: 'El valor lo genera el simulador' });
    if (mode === 'replay') chips.push({ label: 'grabación', chip: 'chip-warn', color: C.warn, title: 'Datos de una grabación reproducida' });
    return chips;
  };
  const installed = SENSOR_KINDS.filter((k) => sensorsOf(k).length > 0);
  const missing = SENSOR_KINDS.filter((k) => sensorsOf(k).length === 0);

  const editBtn = onEditInterior && (
    <button className="btn btn-sm" onClick={onEditInterior}>
      Editar interior
    </button>
  );

  if (zone.is_aggregated_only) {
    return (
      <div className="p-4 text-[12.5px]">
        <div className="eyebrow">Zona privada</div>
        <h3 className="text-[15px] font-semibold mt-1">{zone.name}</h3>
        <dl className="mt-3">
          <div className="kv"><dt>Personas ahora</dt><dd className="num">{insideIds.length}</dd></div>
          <div className="kv"><dt>Tratamiento</dt><dd>Solo conteo agregado</dd></div>
        </dl>
        <p className="mt-3 text-ink-3 leading-snug">
          Aquí no se guardan trayectorias, identidades ni tiempos individuales. No hay cámara ni lector dentro del perímetro.
        </p>
      </div>
    );
  }

  const values: Partial<Record<InteriorKind, React.ReactNode>> = {
    rfid: realRfid.length ? (
      <ul className="space-y-0.5">
        {realRfid.slice(0, 3).map((r, i) => (
          <li key={i} className="flex items-baseline gap-2 text-[12px]">
            <span className={i === 0 ? 'font-medium' : 'text-ink-2'}>{r.person ?? 'Tarjeta sin registrar'}</span>
            <span className="num text-[11px] text-ink-3">
              {r.tag_id} · {r.kind} · {hhmmss(Date.parse(r.at.endsWith('Z') ? r.at : `${r.at}Z`))}
            </span>
          </li>
        ))}
      </ul>
    ) : emulate && lastRead ? (
      <span className="num text-[12px]">
        {tagFor(lastRead.trackId)} · {lastRead.kind} · {hhmmss(lastRead.t)}
      </span>
    ) : (
      <span className="text-ink-3">Sin lecturas en la última hora</span>
    ),
    csi: realCsi ? (
      <span className="flex items-center gap-2">
        <span className="dot" style={{ background: CSI_META[realCsi.state]?.color ?? C.ink4 }} />
        {CSI_META[realCsi.state]?.label ?? realCsi.state}
        <span className="num text-[11px] text-ink-3">
          confianza {realCsi.confidence != null ? `${Math.round(realCsi.confidence * 100)}%` : '—'} · hace {Math.round(ageS(realCsi.at))} s
        </span>
      </span>
    ) : emulate ? (
      <span className="flex items-center gap-2">
        <span className="dot" style={{ background: CSI_META[csi.state].color }} />
        {CSI_META[csi.state].label}
        <span className="num text-[11px] text-ink-3">índice {csi.motion.toFixed(2)}</span>
      </span>
    ) : (
      <span className="text-ink-3">Sin datos del nodo CSI{realPir ? ` · PIR: ${realPir.present ? 'presente' : 'sin presencia'}` : ''}</span>
    ),
    camera:
      insideIds.length === 0 ? (
        <span className="text-ink-3">Nadie dentro del área</span>
      ) : (
        <ul className="space-y-0.5">
          {insideIds.map((id) => {
            const t = tracks[id];
            const since = entrySince(id);
            return (
              <li key={id} className="flex items-center gap-2 num text-[11.5px]">
                <span className="dot" style={{ background: trackColor(id) }} />
                <span>{id}</span>
                <span className="text-ink-3">
                  x {((t.x - b.x0) * mPerX).toFixed(1)} · y {((t.y - b.y0) * mPerY).toFixed(1)} m
                </span>
                {since && <span className="ml-auto text-ink-3">{Math.round((now - since) / 1000)} s</span>}
              </li>
            );
          })}
        </ul>
      ),
    button: (
      <span className="flex flex-wrap items-baseline gap-x-2">
        {openStops.length > 0 ? <span className="text-bad">Paro en curso</span> : <span className="text-ink-2">Sin paro activo</span>}
        {signals?.button && (
          <span className="num text-[11px] text-ink-3">
            última pulsación {signals.button.action} · hace {Math.round(ageS(signals.button.at))} s
          </span>
        )}
      </span>
    ),
    process: realCycles > 0 ? (
      <span className="num text-[12px]">
        {realCycles} pzs en la última hora
        {signals?.process.last_cycle?.cycle_time_seconds != null && ` · último ciclo ${signals.process.last_cycle.cycle_time_seconds}s`}
        {station && ` · ideal ${station.ideal_cycle_seconds}s`}
      </span>
    ) : station ? (
      <span className="num text-[12px]">
        {station.parts_produced_shift} pzs · meta {station.target_pieces_per_hour}/h · ciclo ideal {station.ideal_cycle_seconds}s
      </span>
    ) : null,
  };

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-3.5 pb-3 border-b border-line">
        <div className="flex items-center justify-between gap-2">
          <div className="eyebrow">{station ? `${station.line_id} · orden ${station.order_in_line}` : `Zona · ${zone.type}`}</div>
          {editBtn}
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <h3 className="text-[15px] font-semibold leading-tight">{zone.name}</h3>
          {station && <span className={`chip ${st.chip}`}>{st.label}</span>}
        </div>
        {openStops.length > 0 && (
          <p className="mt-2 text-[12px] text-bad">
            Paro abierto: {openStops[0].reason} ({openStops[0].author})
          </p>
        )}
      </div>

      {spaghetti}

      <div className="px-4">
        <div className="eyebrow pt-3">Sensores instalados en el área</div>
        {installed.length === 0 ? (
          <p className="py-3 text-[12px] text-ink-3">Ninguno. Usa “Editar interior” para colocar lectores, nodos o pulsadores.</p>
        ) : (
          <ul>
            {installed.map((k) => (
              <SourceRow key={k} letter={KINDS[k].letter!} dashed={k === 'process'} name={SOURCE_TEXT[k].name} chips={chipsFor(k)} note={SOURCE_TEXT[k].note}>
                {values[k]}
              </SourceRow>
            ))}
          </ul>
        )}
        {missing.length > 0 && (
          <p className="pb-3 text-[11.5px] text-ink-3">No instalado aquí: {missing.map((k) => KINDS[k].label).join(', ')}.</p>
        )}
      </div>

      <div className="mx-4 mb-3 p-3 bg-sunken rounded-[2px] text-[11.5px] leading-snug text-ink-2">
        <div className="font-medium text-ink mb-1">Lo que este kit no puede ver</div>
        Qué hace el operador con las manos, el estado interno de la máquina ni en qué punto del puesto hay movimiento: la cámara da un
        punto por persona y el CSI un solo estado por zona.
      </div>
    </div>
  );
};
