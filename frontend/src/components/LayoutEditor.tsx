import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Undo2, Trash2, Save } from 'lucide-react';
import { EquipmentType, Layout, Line, PolygonZone, Station, ZoneType } from '../types';
import { C, FONT_MONO, FONT_SANS, ZONE_TINT } from '../theme';
import { api } from '../services/api';
import { PLAN_W, Poly, bbox, rect, planHeight, lineArea, lineOfZone, shortStationName } from '../layout/geometry';
import { EQUIPMENT_OPTIONS } from './StationDetail';

/*
 * Editor del layout de planta. Todo se edita sobre un borrador local y se guarda
 * de una sola vez (PUT /api/layout). Zonas y áreas de línea son rectángulos
 * alineados a los ejes; una estación siempre es una zona de trabajo + su registro.
 */

interface LayoutEditorProps {
  initial: Layout;
  onCancel: () => void;
  onSaved: (layout: Layout) => void;
  onEditInterior?: (zoneId: string) => void;
}

type Sel = { kind: 'zone'; id: string } | { kind: 'line'; id: string } | null;
type Drag = { kind: 'zone' | 'line'; id: string; mode: 'move' | number; start: [number, number]; orig: { x0: number; y0: number; x1: number; y1: number }; stationRel?: [number, number] };

const ZONE_TYPES: { value: ZoneType; label: string }[] = [
  { value: 'storage', label: 'Almacén / supermercado' },
  { value: 'transit', label: 'Pasillo' },
  { value: 'rest', label: 'Descanso' },
  { value: 'bathroom', label: 'Sanitarios (privada)' },
  { value: 'restricted', label: 'Restringida' },
];
const TYPE_LABEL: Record<ZoneType, string> = {
  work: 'Estación',
  storage: 'Almacén',
  transit: 'Pasillo',
  rest: 'Descanso',
  bathroom: 'Sanitarios',
  restricted: 'Restringida',
};
/**
 * Escenario de demostración del documento del hackathon: 3 zonas en flujo
 * (Materiales → Producción → Calidad) en un área de 10 × 6 m, con pasillo.
 */
const hackathonPreset = (d: Layout): Layout => {
  const W = 10;
  const H = 6;
  const r = (x0: number, y0: number, x1: number, y1: number): Poly => rect(x0 / W, y0 / H, x1 / W, y1 / H);
  const lineId = 'line-demo';
  const defs: { sid: string; name: string; eq: EquipmentType; box: [number, number, number, number]; cycle: number; pph: number }[] = [
    { sid: 'st-mat', name: 'Materiales', eq: 'generic', box: [0.4, 0.4, 3.1, 3.9], cycle: 60, pph: 60 },
    { sid: 'st-prod', name: 'Producción', eq: 'manual', box: [3.6, 0.4, 6.4, 3.9], cycle: 45, pph: 80 },
    { sid: 'st-cal', name: 'Calidad', eq: 'aoi', box: [6.9, 0.4, 9.6, 3.9], cycle: 40, pph: 90 },
  ];
  const stations: Station[] = defs.map((s, i) => ({
    id: s.sid,
    station_id: s.sid,
    line_id: lineId,
    name: s.name,
    order_in_line: i + 1,
    ideal_cycle_seconds: s.cycle,
    position_x: round((s.box[0] + s.box[2]) / 2 / W, 4),
    position_y: round((s.box[1] + (s.box[3] - s.box[1]) * 0.6) / H, 4),
    current_status: 'unknown',
    target_pieces_per_hour: s.pph,
    parts_produced_shift: 0,
    equipment_type: s.eq,
  }));
  const zone = (id: string, name: string, type: ZoneType, poly: Poly, extra: Partial<PolygonZone> = {}): PolygonZone => ({
    id,
    zone_id: id,
    floor_plan_id: d.floor_plan.id,
    name,
    type,
    polygon: poly,
    color: C.ink,
    station_ids: [],
    max_stay_seconds: 600,
    is_aggregated_only: false,
    line_id: null,
    ...extra,
  });
  return {
    floor_plan: { ...d.floor_plan, width_meters: W, height_meters: H },
    lines: [{ id: lineId, name: 'Línea demo', order: 1, polygon: null }],
    stations,
    zones: [
      ...defs.map((s) => zone(`zone-${s.sid}`, s.name, 'work', r(...s.box), { station_ids: [s.sid], line_id: lineId })),
      zone('zone-demo-aisle', 'Pasillo', 'transit', r(0.4, 4.4, 9.6, 5.6), { max_stay_seconds: 60 }),
    ],
  };
};

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const LayoutEditor: React.FC<LayoutEditorProps> = ({ initial, onCancel, onSaved, onEditInterior }) => {
  const [draft, setDraft] = useState<Layout>(initial);
  const [undo, setUndo] = useState<Layout[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [snap, setSnap] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const W = draft.floor_plan.width_meters;
  const H = draft.floor_plan.height_meters;
  const planH = planHeight(W, H);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  /* ── mutaciones con historial ── */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const commit = (fn: (d: Layout) => Layout, record = true) => {
    if (record) setUndo((u) => [...u.slice(-99), draftRef.current]);
    setDraft((d) => fn(d));
  };
  const doUndo = () => {
    if (!undo.length) return;
    setDraft(undo[undo.length - 1]);
    setUndo(undo.slice(0, -1));
  };

  const zoneById = (id: string) => draft.zones.find((z) => z.id === id);
  const stationOf = (z?: PolygonZone) => (z ? draft.stations.find((s) => z.station_ids.includes(s.station_id)) : undefined);

  const patchZone = (id: string, patch: Partial<PolygonZone>, record = true) =>
    commit((d) => ({ ...d, zones: d.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }), record);
  const patchStation = (sid: string, patch: Partial<Station>) =>
    commit((d) => ({ ...d, stations: d.stations.map((s) => (s.station_id === sid ? { ...s, ...patch } : s)) }));
  const patchLine = (id: string, patch: Partial<Line>, record = true) =>
    commit((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }), record);

  // Mover o redimensionar un rectángulo; la estación conserva su posición relativa dentro de la zona.
  const setRect = (kind: 'zone' | 'line', id: string, r: { x0: number; y0: number; x1: number; y1: number }, rel?: [number, number], record = false) => {
    const poly = rect(round(r.x0, 4), round(r.y0, 4), round(r.x1, 4), round(r.y1, 4));
    if (kind === 'line') return patchLine(id, { polygon: poly }, record);
    commit((d) => {
      const zone = d.zones.find((z) => z.id === id)!;
      const st = d.stations.find((s) => zone.station_ids.includes(s.station_id));
      return {
        ...d,
        zones: d.zones.map((z) => (z.id === id ? { ...z, polygon: poly } : z)),
        stations: st
          ? d.stations.map((s) =>
              s.station_id === st.station_id
                ? { ...s, position_x: round(r.x0 + (r.x1 - r.x0) * (rel?.[0] ?? 0.5), 4), position_y: round(r.y0 + (r.y1 - r.y0) * (rel?.[1] ?? 0.6), 4) }
                : s,
            )
          : d.stations,
      };
    }, record);
  };

  /* ── altas y bajas ── */
  const ensureLine = (d: Layout): [Layout, string] => {
    if (d.lines.length) {
      const selZ = sel?.kind === 'zone' ? d.zones.find((z) => z.id === sel.id) : undefined;
      const preferred = sel?.kind === 'line' ? sel.id : selZ ? lineOfZone(selZ, d.stations) : null;
      return [d, preferred && d.lines.some((l) => l.id === preferred) ? preferred : d.lines[0].id];
    }
    const line: Line = { id: uid('line'), name: 'Línea 1', order: 1, polygon: null };
    return [{ ...d, lines: [line] }, line.id];
  };

  const newRectAtCenter = (wm: number, hm: number) => {
    const w = wm / W;
    const h = hm / H;
    const cx = 0.5 + (Math.random() - 0.5) * 0.1;
    const cy = 0.5 + (Math.random() - 0.5) * 0.1;
    return rect(round(cx - w / 2, 4), round(cy - h / 2, 4), round(cx + w / 2, 4), round(cy + h / 2, 4));
  };

  const addStation = () => {
    commit((d0) => {
      const [d, lineId] = ensureLine(d0);
      const inLine = d.stations.filter((s) => s.line_id === lineId);
      const order = Math.max(0, ...inLine.map((s) => s.order_in_line)) + 1;
      const sid = uid('st');
      const poly = newRectAtCenter(6, 7);
      const b = bbox(poly);
      const station: Station = {
        id: sid,
        station_id: sid,
        line_id: lineId,
        name: `Estación ${order}`,
        order_in_line: order,
        ideal_cycle_seconds: 45,
        position_x: round((b.x0 + b.x1) / 2, 4),
        position_y: round(b.y0 + (b.y1 - b.y0) * 0.6, 4),
        current_status: 'idle',
        target_pieces_per_hour: 60,
        parts_produced_shift: 0,
        equipment_type: 'manual',
      };
      const zid = uid('zone');
      const zone: PolygonZone = {
        id: zid,
        zone_id: zid,
        floor_plan_id: d.floor_plan.id,
        name: station.name,
        type: 'work',
        polygon: poly,
        color: C.ink,
        station_ids: [sid],
        max_stay_seconds: 600,
        is_aggregated_only: false,
        line_id: lineId,
      };
      setTimeout(() => setSel({ kind: 'zone', id: zid }));
      return { ...d, stations: [...d.stations, station], zones: [...d.zones, zone] };
    });
  };

  const addZone = (type: ZoneType) => {
    const zid = uid('zone');
    commit((d) => ({
      ...d,
      zones: [
        ...d.zones,
        {
          id: zid,
          zone_id: zid,
          floor_plan_id: d.floor_plan.id,
          name: ZONE_TYPES.find((t) => t.value === type)?.label ?? 'Zona',
          type,
          polygon: newRectAtCenter(type === 'transit' ? 20 : 8, type === 'transit' ? 2.5 : 6),
          color: C.ink,
          station_ids: [],
          max_stay_seconds: type === 'transit' ? 60 : 600,
          is_aggregated_only: type === 'bathroom',
          line_id: null,
        },
      ],
    }));
    setSel({ kind: 'zone', id: zid });
  };

  const addLine = () => {
    const id = uid('line');
    commit((d) => ({ ...d, lines: [...d.lines, { id, name: `Línea ${d.lines.length + 1}`, order: d.lines.length + 1, polygon: null }] }));
    setSel({ kind: 'line', id });
  };

  const deleteSel = () => {
    if (!sel) return;
    if (sel.kind === 'zone') {
      const z = zoneById(sel.id);
      commit((d) => ({
        ...d,
        zones: d.zones.filter((zz) => zz.id !== sel.id),
        stations: d.stations.filter((s) => !z?.station_ids.includes(s.station_id)),
      }));
    } else {
      if (draft.stations.some((s) => s.line_id === sel.id)) return;
      commit((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== sel.id), zones: d.zones.map((z) => (z.line_id === sel.id ? { ...z, line_id: null } : z)) }));
    }
    setSel(null);
  };

  // Cambiar medidas de la nave conservando el tamaño en metros de lo ya dibujado.
  const extent = useMemo(() => {
    const pts = [...draft.zones.flatMap((z) => z.polygon), ...draft.lines.flatMap((l) => l.polygon ?? [])];
    if (!pts.length) return { w: 1, h: 1 };
    const b = bbox(pts);
    return { w: b.x1 * W, h: b.y1 * H };
  }, [draft, W, H]);

  const resizePlant = (nw: number, nh: number) => {
    if (!(nw > 1 && nh > 1)) return;
    nw = Math.max(nw, Math.ceil(extent.w * 10) / 10);
    nh = Math.max(nh, Math.ceil(extent.h * 10) / 10);
    const kx = W / nw;
    const ky = H / nh;
    const sc = (p: Poly): Poly => p.map(([x, y]) => [round(x * kx, 4), round(y * ky, 4)]);
    commit((d) => ({
      ...d,
      floor_plan: { ...d.floor_plan, width_meters: nw, height_meters: nh },
      zones: d.zones.map((z) => ({ ...z, polygon: sc(z.polygon) })),
      lines: d.lines.map((l) => ({ ...l, polygon: l.polygon ? sc(l.polygon) : null })),
      stations: d.stations.map((s) => ({ ...s, position_x: round(s.position_x * kx, 4), position_y: round(s.position_y * ky, 4) })),
    }));
  };

  /* ── lienzo e interacción ── */
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const PAD = 30;
  const ppu = Math.min(size.w / (PLAN_W + PAD * 2), size.h / (planH + PAD * 2));
  const px = (n: number) => n / ppu;
  const unit = PLAN_W / W;

  const toNorm = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x / PLAN_W, p.y / planH];
  };
  const sx = (v: number) => (snap ? Math.round((v * W) / 0.5) * (0.5 / W) : v);
  const sy = (v: number) => (snap ? Math.round((v * H) / 0.5) * (0.5 / H) : v);
  const minW = 1 / W;
  const minH = 1 / H;

  const drag = useRef<Drag | null>(null);

  const startDrag = (e: React.PointerEvent, kind: 'zone' | 'line', id: string, mode: Drag['mode'], poly: Poly) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSel({ kind, id });
    const orig = bbox(poly);
    let stationRel: [number, number] | undefined;
    if (kind === 'zone') {
      const st = stationOf(zoneById(id));
      if (st) stationRel = [(st.position_x - orig.x0) / (orig.x1 - orig.x0 || 1), (st.position_y - orig.y0) / (orig.y1 - orig.y0 || 1)];
    }
    drag.current = { kind, id, mode, start: toNorm(e), orig, stationRel };
    setUndo((u) => [...u.slice(-99), draft]);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [nx, ny] = toNorm(e);
    const o = d.orig;
    let r = { ...o };
    if (d.mode === 'move') {
      const w = o.x1 - o.x0;
      const h = o.y1 - o.y0;
      const x0 = Math.min(1 - w, Math.max(0, sx(o.x0 + nx - d.start[0])));
      const y0 = Math.min(1 - h, Math.max(0, sy(o.y0 + ny - d.start[1])));
      r = { x0, y0, x1: x0 + w, y1: y0 + h };
    } else {
      const cx = Math.min(1, Math.max(0, sx(nx)));
      const cy = Math.min(1, Math.max(0, sy(ny)));
      if (d.mode === 0 || d.mode === 3) r.x0 = Math.min(cx, o.x1 - minW);
      else r.x1 = Math.max(cx, o.x0 + minW);
      if (d.mode === 0 || d.mode === 1) r.y0 = Math.min(cy, o.y1 - minH);
      else r.y1 = Math.max(cy, o.y0 + minH);
    }
    setRect(d.kind, d.id, r, d.stationRel);
  };
  const endDrag = () => {
    drag.current = null;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
        return;
      }
      if (!sel) return;
      if (e.key === 'Escape') setSel(null);
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSel();
      }
      const step = e.shiftKey ? 1 : 0.1;
      const dx = e.key === 'ArrowLeft' ? -step / W : e.key === 'ArrowRight' ? step / W : 0;
      const dy = e.key === 'ArrowUp' ? -step / H : e.key === 'ArrowDown' ? step / H : 0;
      if (dx || dy) {
        e.preventDefault();
        const poly = sel.kind === 'zone' ? zoneById(sel.id)?.polygon : draft.lines.find((l) => l.id === sel.id)?.polygon;
        if (!poly) return;
        const b = bbox(poly);
        const w = b.x1 - b.x0;
        const h = b.y1 - b.y0;
        const x0 = Math.min(1 - w, Math.max(0, b.x0 + dx));
        const y0 = Math.min(1 - h, Math.max(0, b.y0 + dy));
        const st = sel.kind === 'zone' ? stationOf(zoneById(sel.id)) : undefined;
        const rel: [number, number] | undefined = st ? [(st.position_x - b.x0) / w, (st.position_y - b.y0) / h] : undefined;
        setRect(sel.kind, sel.id, { x0, y0, x1: x0 + w, y1: y0 + h }, rel, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── validaciones visibles ── */
  const overlaps = useMemo(() => {
    const work = draft.zones.filter((z) => z.type === 'work');
    const bad = new Set<string>();
    for (let i = 0; i < work.length; i++)
      for (let j = i + 1; j < work.length; j++) {
        const a = bbox(work[i].polygon);
        const b = bbox(work[j].polygon);
        if (a.x0 < b.x1 - 1e-4 && b.x0 < a.x1 - 1e-4 && a.y0 < b.y1 - 1e-4 && b.y0 < a.y1 - 1e-4) {
          bad.add(work[i].id);
          bad.add(work[j].id);
        }
      }
    return bad;
  }, [draft.zones]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveLayout(draft);
      onSaved(saved);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const zoneFill = (z: PolygonZone) =>
    z.type === 'storage' ? 'url(#le-hatch)' : z.type === 'rest' ? 'url(#le-dots)' : z.type === 'bathroom' ? 'url(#le-cross)' : (ZONE_TINT[z.type] ?? ZONE_TINT.transit).fill;

  const selZone = sel?.kind === 'zone' ? zoneById(sel.id) : undefined;
  const selStation = stationOf(selZone);
  const selLine = sel?.kind === 'line' ? draft.lines.find((l) => l.id === sel.id) : undefined;

  // Funciones de render (no componentes) para no remontar nodos en cada cambio.
  const handles = (poly: Poly, kind: 'zone' | 'line', id: string) => {
    const b = bbox(poly);
    const corners: [number, number][] = [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x1, b.y1],
      [b.x0, b.y1],
    ];
    const s = px(9);
    return (
      <g>
        {corners.map(([x, y], i) => (
          <rect
            key={i}
            x={x * PLAN_W - s / 2}
            y={y * planH - s / 2}
            width={s}
            height={s}
            fill={C.surface}
            stroke={C.ink}
            strokeWidth={px(1.5)}
            style={{ cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }}
            onPointerDown={(e) => startDrag(e, kind, id, i, poly)}
          />
        ))}
        {/* cotas */}
        <text x={((b.x0 + b.x1) / 2) * PLAN_W} y={b.y0 * planH - px(8)} textAnchor="middle" fontSize={px(11)} fontFamily={FONT_MONO} fill={C.ink}>
          {((b.x1 - b.x0) * W).toFixed(1)} m
        </text>
        <text
          x={b.x0 * PLAN_W - px(8)}
          y={((b.y0 + b.y1) / 2) * planH}
          textAnchor="middle"
          fontSize={px(11)}
          fontFamily={FONT_MONO}
          fill={C.ink}
          transform={`rotate(-90 ${b.x0 * PLAN_W - px(8)} ${((b.y0 + b.y1) / 2) * planH})`}
        >
          {((b.y1 - b.y0) * H).toFixed(1)} m
        </text>
      </g>
    );
  };

  /* ── campos numéricos en metros para la selección ── */
  const selPoly = selZone?.polygon ?? selLine?.polygon ?? null;
  const selB = selPoly ? bbox(selPoly) : null;
  const setMeters = (field: 'x' | 'y' | 'w' | 'h', v: number) => {
    if (!selB || !sel || Number.isNaN(v)) return;
    let { x0, y0, x1, y1 } = selB;
    const w = x1 - x0;
    const h = y1 - y0;
    if (field === 'x') (x0 = Math.min(1 - w, Math.max(0, v / W))), (x1 = x0 + w);
    if (field === 'y') (y0 = Math.min(1 - h, Math.max(0, v / H))), (y1 = y0 + h);
    if (field === 'w') x1 = Math.min(1, x0 + Math.max(1, v) / W);
    if (field === 'h') y1 = Math.min(1, y0 + Math.max(1, v) / H);
    const st = sel.kind === 'zone' ? selStation : undefined;
    const rel: [number, number] | undefined = st ? [(st.position_x - selB.x0) / w, (st.position_y - selB.y0) / h] : undefined;
    setRect(sel.kind, sel.id, { x0, y0, x1, y1 }, rel, true);
  };

  const geometryFields = () =>
    selB ? (
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ['x', 'X', selB.x0 * W],
            ['y', 'Y', selB.y0 * H],
            ['w', 'Ancho', (selB.x1 - selB.x0) * W],
            ['h', 'Alto', (selB.y1 - selB.y0) * H],
          ] as const
        ).map(([f, label, val]) => (
          <div key={f}>
            <label className="label">{label} (m)</label>
            <input
              type="number"
              step="0.1"
              className="field num !px-1.5"
              value={round(val, 1)}
              onChange={(e) => setMeters(f, parseFloat(e.target.value))}
            />
          </div>
        ))}
      </div>
    ) : null;

  const lineOptions = [...draft.lines].sort((a, b) => a.order - b.order);

  return (
    <section className="panel flex flex-col h-full min-h-[600px]">
      {/* Barra de herramientas */}
      <header className="panel-head flex-wrap !justify-start gap-2">
        <h2 className="panel-title mr-2">Editar layout</h2>
        <button className="btn btn-sm" onClick={addStation}>
          <Plus className="h-3.5 w-3.5" /> Estación
        </button>
        <select
          className="field !w-auto !h-[24px] !text-[11.5px]"
          value=""
          onChange={(e) => e.target.value && addZone(e.target.value as ZoneType)}
          aria-label="Agregar zona"
        >
          <option value="">+ Zona…</option>
          {ZONE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={addLine}>
          <Plus className="h-3.5 w-3.5" /> Línea
        </button>
        <span className="w-px h-5 bg-line mx-1" />
        <button className="btn btn-sm btn-ghost" onClick={doUndo} disabled={!undo.length} title="Deshacer (Ctrl+Z)">
          <Undo2 className="h-3.5 w-3.5" /> Deshacer
        </button>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2 cursor-pointer ml-1">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Ajustar a 0.5 m
        </label>
        <span className="ml-auto flex items-center gap-2">
          {dirty && !error && <span className="text-[11.5px] text-ink-3">Cambios sin guardar</span>}
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>
            Descartar
          </button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !dirty}>
            <Save className="h-3.5 w-3.5" /> {saving ? 'Guardando…' : 'Guardar layout'}
          </button>
        </span>
      </header>
      {error && <div className="px-4 py-2 text-[12px] text-bad bg-bad-soft border-b border-line">{error}</div>}

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Lienzo */}
        <div ref={wrapRef} className="relative flex-1 min-h-[460px] bg-paper overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`${-PAD} ${-PAD} ${PLAN_W + PAD * 2} ${planH + PAD * 2}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 select-none touch-none"
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onPointerDown={() => setSel(null)}
          >
            <defs>
              <pattern id="le-grid" width={unit} height={unit} patternUnits="userSpaceOnUse">
                <path d={`M ${unit} 0 L 0 0 0 ${unit}`} fill="none" stroke={C.line} strokeWidth={px(0.6)} />
              </pattern>
              <pattern id="le-grid5" width={unit * 5} height={unit * 5} patternUnits="userSpaceOnUse">
                <rect width={unit * 5} height={unit * 5} fill="url(#le-grid)" />
                <path d={`M ${unit * 5} 0 L 0 0 0 ${unit * 5}`} fill="none" stroke={C.line2} strokeWidth={px(0.8)} />
              </pattern>
              <pattern id="le-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill={ZONE_TINT.storage.fill} />
                <line x1="0" y1="0" x2="0" y2="8" stroke={ZONE_TINT.storage.pattern} strokeWidth="1.2" />
              </pattern>
              <pattern id="le-dots" width="9" height="9" patternUnits="userSpaceOnUse">
                <rect width="9" height="9" fill={ZONE_TINT.rest.fill} />
                <circle cx="4.5" cy="4.5" r="0.9" fill={ZONE_TINT.rest.pattern} />
              </pattern>
              <pattern id="le-cross" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill={ZONE_TINT.bathroom.fill} />
                <line x1="0" y1="0" x2="0" y2="8" stroke={ZONE_TINT.bathroom.pattern} strokeWidth="0.8" />
                <line x1="0" y1="0" x2="8" y2="0" stroke={ZONE_TINT.bathroom.pattern} strokeWidth="0.8" />
              </pattern>
            </defs>

            <rect x={0} y={0} width={PLAN_W} height={planH} fill="url(#le-grid5)" stroke={C.ink} strokeWidth={px(1.5)} />
            <text x={0} y={-px(10)} fontSize={px(11)} fontFamily={FONT_MONO} fill={C.ink3}>
              {W} × {H} m
            </text>

            {/* zonas */}
            {draft.zones.map((z) => {
              const b = bbox(z.polygon);
              const st = stationOf(z);
              const selected = sel?.kind === 'zone' && sel.id === z.id;
              return (
                <g key={z.id}>
                  <polygon
                    points={z.polygon.map(([x, y]) => `${x * PLAN_W},${y * planH}`).join(' ')}
                    fill={zoneFill(z)}
                    stroke={overlaps.has(z.id) ? C.bad : selected ? C.ink : (ZONE_TINT[z.type] ?? ZONE_TINT.transit).stroke}
                    strokeWidth={px(selected ? 2 : 1)}
                    strokeDasharray={z.type === 'transit' || z.is_aggregated_only ? `${px(5)} ${px(3)}` : undefined}
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => startDrag(e, 'zone', z.id, 'move', z.polygon)}
                  />
                  <text
                    x={b.x0 * PLAN_W + px(6)}
                    y={b.y0 * planH + px(14)}
                    fontSize={px(11)}
                    fontFamily={FONT_SANS}
                    fontWeight={500}
                    fill={C.ink2}
                    pointerEvents="none"
                    style={{ fontStretch: '85%' }}
                  >
                    {z.name}
                  </text>
                  {st && (
                    <>
                      <text x={b.x0 * PLAN_W + px(6)} y={b.y0 * planH + px(28)} fontSize={px(10)} fontFamily={FONT_MONO} fill={C.ink3} pointerEvents="none">
                        #{st.order_in_line} · {(EQUIPMENT_OPTIONS.find((o) => o.value === st.equipment_type)?.label ?? '').split(' ').slice(0, 2).join(' ')}
                      </text>
                      {/* puesto del operador */}
                      <circle cx={st.position_x * PLAN_W} cy={st.position_y * planH} r={px(4)} fill="none" stroke={C.ink2} strokeWidth={px(1.2)} pointerEvents="none" />
                      <circle cx={st.position_x * PLAN_W} cy={st.position_y * planH} r={px(1.4)} fill={C.ink2} pointerEvents="none" />
                    </>
                  )}
                </g>
              );
            })}

            {/* áreas de línea */}
            {draft.lines.map((l) => {
              const a = lineArea(l, draft.zones, draft.stations);
              if (!a) return null;
              const b = bbox(a);
              const selected = sel?.kind === 'line' && sel.id === l.id;
              const custom = !!l.polygon;
              return (
                <g key={l.id}>
                  <polygon
                    points={a.map(([x, y]) => `${x * PLAN_W},${y * planH}`).join(' ')}
                    fill="none"
                    stroke={selected ? C.ink : C.accent}
                    strokeWidth={px(selected ? 2 : 1.2)}
                    strokeDasharray={`${px(8)} ${px(4)}`}
                    pointerEvents={custom ? 'stroke' : 'none'}
                    style={{ cursor: custom ? 'move' : undefined }}
                    onPointerDown={custom ? (e) => startDrag(e, 'line', l.id, 'move', a) : undefined}
                  />
                  <g
                    transform={`translate(${b.x0 * PLAN_W},${b.y0 * planH - px(18)})`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSel({ kind: 'line', id: l.id });
                    }}
                  >
                    <rect width={px(l.name.length * 6.4 + 16)} height={px(18)} fill={selected ? C.ink : C.accent} />
                    <text x={px(7)} y={px(12.5)} fontSize={px(11)} fontFamily={FONT_SANS} fontWeight={600} fill="#fff" style={{ fontStretch: '88%' }}>
                      {l.name}
                    </text>
                  </g>
                </g>
              );
            })}

            {selZone && handles(selZone.polygon, 'zone', selZone.id)}
            {selLine?.polygon && handles(selLine.polygon, 'line', selLine.id)}
          </svg>
          <div className="absolute left-3 bottom-3 text-[11px] text-ink-3 pointer-events-none">
            Arrastra para mover · esquinas para redimensionar · flechas: 10 cm (Shift: 1 m) · Supr: eliminar
          </div>
        </div>

        {/* Propiedades */}
        <aside className="lg:w-[330px] shrink-0 border-t lg:border-t-0 lg:border-l border-line bg-surface overflow-y-auto lg:max-h-[700px] text-[12.5px]">
          {selZone ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{selStation ? 'Estación' : `Zona · ${TYPE_LABEL[selZone.type]}`}</span>
                <button className="btn btn-sm btn-ghost text-bad" onClick={deleteSel}>
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              </div>
              <div>
                <label className="label">Nombre</label>
                <input
                  className="field"
                  value={selZone.name}
                  onChange={(e) => {
                    patchZone(selZone.id, { name: e.target.value });
                    if (selStation) patchStation(selStation.station_id, { name: e.target.value });
                  }}
                />
              </div>
              {!selStation && (
                <div>
                  <label className="label">Tipo</label>
                  <select
                    className="field"
                    value={selZone.type}
                    onChange={(e) => {
                      const type = e.target.value as ZoneType;
                      patchZone(selZone.id, { type, is_aggregated_only: type === 'bathroom' ? true : selZone.is_aggregated_only });
                    }}
                  >
                    {ZONE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Línea</label>
                <select
                  className="field"
                  value={(selStation?.line_id ?? selZone.line_id) || ''}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    if (selStation) {
                      if (!v) return;
                      const order = Math.max(0, ...draft.stations.filter((s) => s.line_id === v).map((s) => s.order_in_line)) + 1;
                      patchStation(selStation.station_id, { line_id: v, order_in_line: v === selStation.line_id ? selStation.order_in_line : order });
                    }
                    patchZone(selZone.id, { line_id: v });
                  }}
                >
                  {!selStation && <option value="">Compartida (sin línea)</option>}
                  {lineOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              {geometryFields()}
              {overlaps.has(selZone.id) && <p className="text-[12px] text-bad">Se encima con otra estación.</p>}

              {onEditInterior && selZone.type !== 'bathroom' && (
                <div className="border border-line rounded-[2px] p-2.5 flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-ink-3 leading-snug">
                    {dirty || !initial.zones.some((z) => z.id === selZone.id) ? 'Guarda el layout para editar el interior.' : 'Máquinas, puestos y sensores dentro del área.'}
                  </span>
                  <button
                    className="btn btn-sm shrink-0"
                    disabled={dirty || !initial.zones.some((z) => z.id === selZone.id)}
                    onClick={() => onEditInterior(selZone.id)}
                  >
                    Editar interior
                  </button>
                </div>
              )}

              {selStation && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label">Orden en la línea</label>
                      <input
                        type="number"
                        min={1}
                        className="field num"
                        value={selStation.order_in_line}
                        onChange={(e) => patchStation(selStation.station_id, { order_in_line: Math.max(1, parseInt(e.target.value) || 1) })}
                      />
                    </div>
                    <div>
                      <label className="label">Equipo</label>
                      <select
                        className="field"
                        value={selStation.equipment_type ?? 'generic'}
                        onChange={(e) => patchStation(selStation.station_id, { equipment_type: e.target.value as EquipmentType })}
                      >
                        {EQUIPMENT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Ciclo ideal (s)</label>
                      <input
                        type="number"
                        min={1}
                        className="field num"
                        value={selStation.ideal_cycle_seconds}
                        onChange={(e) => patchStation(selStation.station_id, { ideal_cycle_seconds: Math.max(1, parseFloat(e.target.value) || 1) })}
                      />
                    </div>
                    <div>
                      <label className="label">Meta (pzs/h)</label>
                      <input
                        type="number"
                        min={1}
                        className="field num"
                        value={selStation.target_pieces_per_hour}
                        onChange={(e) => patchStation(selStation.station_id, { target_pieces_per_hour: Math.max(1, parseInt(e.target.value) || 1) })}
                      />
                    </div>
                  </div>
                  <p className="text-[11.5px] text-ink-3">
                    El círculo marca el puesto del operador; se mueve con la zona. ID <span className="num">{selStation.station_id}</span>
                  </p>
                </>
              )}

              {!selStation && (
                <div className="grid grid-cols-2 gap-2 items-end">
                  <div>
                    <label className="label">Permanencia máx. (min)</label>
                    <input
                      type="number"
                      min={0}
                      className="field num"
                      value={round((selZone.max_stay_seconds ?? 0) / 60, 1)}
                      onChange={(e) => patchZone(selZone.id, { max_stay_seconds: Math.round((parseFloat(e.target.value) || 0) * 60) })}
                    />
                  </div>
                  <label className="flex items-center gap-2 h-[30px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selZone.is_aggregated_only}
                      disabled={selZone.type === 'bathroom'}
                      onChange={(e) => patchZone(selZone.id, { is_aggregated_only: e.target.checked })}
                    />
                    Solo conteo agregado
                  </label>
                </div>
              )}
            </div>
          ) : selLine ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Línea de producción</span>
                <button
                  className="btn btn-sm btn-ghost text-bad"
                  onClick={deleteSel}
                  disabled={draft.stations.some((s) => s.line_id === selLine.id)}
                  title={draft.stations.some((s) => s.line_id === selLine.id) ? 'Mueve o elimina sus estaciones primero' : undefined}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              </div>
              <div className="grid grid-cols-[1fr_70px] gap-2">
                <div>
                  <label className="label">Nombre</label>
                  <input className="field" value={selLine.name} onChange={(e) => patchLine(selLine.id, { name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Orden</label>
                  <input type="number" min={1} className="field num" value={selLine.order} onChange={(e) => patchLine(selLine.id, { order: Math.max(1, parseInt(e.target.value) || 1) })} />
                </div>
              </div>

              <div>
                <label className="label">Área para spaghetti</label>
                {selLine.polygon ? (
                  <div className="space-y-2">
                    {geometryFields()}
                    <button className="btn btn-sm" onClick={() => patchLine(selLine.id, { polygon: null })}>
                      Usar área automática
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-ink-3 leading-snug">
                      Automática: la caja que envuelve sus estaciones y zonas, más 2% de margen. Dibújala si el pasillo o el supermercado de la línea quedan
                      fuera.
                    </p>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        const a = lineArea(selLine, draft.zones, draft.stations) ?? newRectAtCenter(20, 10);
                        patchLine(selLine.id, { polygon: a });
                      }}
                    >
                      Dibujar área
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="eyebrow mb-1">Estaciones</div>
                {draft.stations.filter((s) => s.line_id === selLine.id).length === 0 ? (
                  <p className="text-ink-3">Sin estaciones. Usa “+ Estación” con esta línea seleccionada.</p>
                ) : (
                  <ul className="border border-line divide-y divide-line">
                    {draft.stations
                      .filter((s) => s.line_id === selLine.id)
                      .sort((a, b) => a.order_in_line - b.order_in_line)
                      .map((s) => {
                        const z = draft.zones.find((zz) => zz.station_ids.includes(s.station_id));
                        return (
                          <li key={s.station_id}>
                            <button className="w-full text-left px-2.5 py-1.5 hover:bg-sunken flex gap-2" onClick={() => z && setSel({ kind: 'zone', id: z.id })}>
                              <span className="num text-ink-3 w-5">{s.order_in_line}</span>
                              {shortStationName(s.name)}
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div>
                <div className="eyebrow mb-2">Nave</div>
                <label className="label">Nombre</label>
                <input
                  className="field"
                  value={draft.floor_plan.name}
                  onChange={(e) => commit((d) => ({ ...d, floor_plan: { ...d.floor_plan, name: e.target.value } }))}
                />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="label">Ancho (m)</label>
                    <input type="number" step="0.5" min={Math.ceil(extent.w)} className="field num" defaultValue={W} key={`w${W}`} onBlur={(e) => resizePlant(parseFloat(e.target.value), H)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  </div>
                  <div>
                    <label className="label">Largo (m)</label>
                    <input type="number" step="0.5" min={Math.ceil(extent.h)} className="field num" defaultValue={H} key={`h${H}`} onBlur={(e) => resizePlant(W, parseFloat(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  </div>
                </div>
                <p className="text-[11.5px] text-ink-3 leading-snug mt-1.5">
                  Lo dibujado conserva su tamaño en metros. Después de cambiar medidas, recalibra la cámara.
                </p>
              </div>

              <div className="border border-line rounded-[2px] p-3">
                <div className="eyebrow mb-1">Plantilla</div>
                <p className="text-[11.5px] text-ink-3 leading-snug mb-2">
                  Escenario del documento del hackathon: área de 10 × 6 m con Materiales → Producción → Calidad y un pasillo. Reemplaza el borrador
                  actual; no se guarda hasta presionar “Guardar layout” y se puede deshacer.
                </p>
                <button className="btn btn-sm" onClick={() => commit(() => hackathonPreset(draft))}>
                  Cargar escenario del hackathon
                </button>
              </div>

              <div>
                <div className="eyebrow mb-1">Líneas</div>
                <ul className="border border-line divide-y divide-line">
                  {lineOptions.map((l) => (
                    <li key={l.id}>
                      <button className="w-full text-left px-2.5 py-1.5 hover:bg-sunken flex justify-between" onClick={() => setSel({ kind: 'line', id: l.id })}>
                        {l.name}
                        <span className="num text-ink-3">{draft.stations.filter((s) => s.line_id === l.id).length} est.</span>
                      </button>
                    </li>
                  ))}
                  {!lineOptions.length && <li className="px-2.5 py-1.5 text-ink-3">Sin líneas</li>}
                </ul>
              </div>

              <div>
                <div className="eyebrow mb-1">Zonas ({draft.zones.length})</div>
                <ul className="border border-line divide-y divide-line max-h-[240px] overflow-y-auto">
                  {draft.zones.map((z) => (
                    <li key={z.id}>
                      <button className="w-full text-left px-2.5 py-1.5 hover:bg-sunken flex justify-between gap-2" onClick={() => setSel({ kind: 'zone', id: z.id })}>
                        <span className="truncate">{z.name}</span>
                        <span className={`text-[11px] shrink-0 ${overlaps.has(z.id) ? 'text-bad' : 'text-ink-3'}`}>{TYPE_LABEL[z.type]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};
