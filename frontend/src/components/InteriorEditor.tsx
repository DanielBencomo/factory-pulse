import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, Save, Trash2, Undo2 } from 'lucide-react';
import { Device, InteriorItem, InteriorKind, PolygonZone, Station } from '../types';
import { C, FONT_MONO } from '../theme';
import { api } from '../services/api';
import { bbox } from '../layout/geometry';
import { EQUIPMENT_KINDS, KINDS, SENSOR_KINDS, defaultInterior, interiorOf, itemId, zoneSizeM } from '../layout/interior';
import { DEVICE_STATUS, EQUIPMENT_OPTIONS, InteriorItemShape } from './StationDetail';

/*
 * Editor del interior de un área. Coordenadas en metros desde la esquina superior
 * izquierda de la zona. El círculo del operador es la posición de la estación.
 */

interface InteriorEditorProps {
  zone: PolygonZone;
  station?: Station;
  widthM: number;
  heightM: number;
  devices: Device[];
  onCancel: () => void;
  onSaved: () => void;
}

type Drag = { id: string; mode: 'move' | 'resize'; start: [number, number]; orig: InteriorItem } | { id: '__operator'; mode: 'move'; start: [number, number]; orig: { x: number; y: number } };

const r2 = (v: number) => Math.round(v * 100) / 100;

export const InteriorEditor: React.FC<InteriorEditorProps> = ({ zone, station, widthM, heightM, devices, onCancel, onSaved }) => {
  const { w: W, h: H } = zoneSizeM(zone, widthM, heightM);
  const zb = bbox(zone.polygon);
  const initialItems = useMemo(() => interiorOf(zone, station, widthM, heightM), [zone, station, widthM, heightM]);
  const initialOp = useMemo(
    () => (station ? { x: r2((station.position_x - zb.x0) * widthM), y: r2((station.position_y - zb.y0) * heightM) } : null),
    [station, zb.x0, zb.y0, widthM, heightM],
  );

  const [items, setItems] = useState<InteriorItem[]>(initialItems);
  const [op, setOp] = useState(initialOp);
  const [undo, setUndo] = useState<{ items: InteriorItem[]; op: typeof op }[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify({ items, op }) !== JSON.stringify({ items: initialItems, op: initialOp }) || !zone.interior?.length;

  const stateRef = useRef({ items, op });
  stateRef.current = { items, op };
  const snapshot = () => setUndo((u) => [...u.slice(-99), stateRef.current]);
  const doUndo = () => {
    if (!undo.length) return;
    const last = undo[undo.length - 1];
    setItems(last.items);
    setOp(last.op);
    setUndo(undo.slice(0, -1));
  };

  const update = (id: string, patch: Partial<InteriorItem>, record = true) => {
    if (record) snapshot();
    setItems((its) => its.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const add = (kind: InteriorKind) => {
    snapshot();
    const [w, h] = KINDS[kind].size;
    const it: InteriorItem = {
      id: itemId(kind),
      kind,
      x: r2(Math.max(0, W / 2 - Math.min(w, W) / 2)),
      y: r2(Math.max(0, H / 2 - Math.min(h, H) / 2)),
      w: Math.min(w, W),
      h: Math.min(h, H),
      rot: 0,
      variant: kind === 'machine' ? station?.equipment_type ?? 'generic' : undefined,
    };
    setItems((its) => [...its, it]);
    setSel(it.id);
  };

  const remove = (id: string) => {
    snapshot();
    setItems((its) => its.filter((i) => i.id !== id));
    setSel(null);
  };

  /* ── lienzo ── */
  const svgRef = useRef<SVGSVGElement>(null);
  const PAD = 0.9;
  const toM = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };
  const q = (v: number) => (snap ? Math.round(v / 0.1) * 0.1 : v);
  const drag = useRef<Drag | null>(null);

  const startItem = (e: React.PointerEvent, it: InteriorItem, mode: 'move' | 'resize') => {
    e.stopPropagation();
    setSel(it.id);
    snapshot();
    drag.current = { id: it.id, mode, start: toM(e), orig: it };
  };
  const startOp = (e: React.PointerEvent) => {
    if (!op) return;
    e.stopPropagation();
    setSel('__operator');
    snapshot();
    drag.current = { id: '__operator', mode: 'move', start: toM(e), orig: op };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [mx, my] = toM(e);
    const dx = mx - d.start[0];
    const dy = my - d.start[1];
    if (d.id === '__operator') {
      setOp({ x: r2(Math.min(W, Math.max(0, q(d.orig.x + dx)))), y: r2(Math.min(H, Math.max(0, q(d.orig.y + dy)))) });
      return;
    }
    const o = d.orig as InteriorItem;
    if (d.mode === 'move') {
      update(o.id, { x: r2(Math.min(W - o.w, Math.max(0, q(o.x + dx)))), y: r2(Math.min(H - o.h, Math.max(0, q(o.y + dy)))) }, false);
    } else {
      update(o.id, { w: r2(Math.min(W - o.x, Math.max(0.2, q(o.w + dx)))), h: r2(Math.min(H - o.y, Math.max(0.2, q(o.h + dy)))) }, false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
      } else if (sel && sel !== '__operator' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        remove(sel);
      } else if (sel && sel !== '__operator' && e.key.toLowerCase() === 'r') {
        const it = items.find((i) => i.id === sel);
        if (it) update(it.id, { rot: (((it.rot ?? 0) + 90) % 360) as InteriorItem['rot'] });
      } else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveInterior(zone.zone_id, items, op ?? undefined);
      onSaved();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const selItem = items.find((i) => i.id === sel);
  const devStatus = (id?: string | null) => (id ? devices.find((d) => d.device_id === id)?.status ?? 'none' : undefined);
  const setNum = (field: 'x' | 'y' | 'w' | 'h', v: number) => {
    if (!selItem || Number.isNaN(v)) return;
    const next = { ...selItem, [field]: Math.max(field === 'w' || field === 'h' ? 0.2 : 0, v) };
    next.w = Math.min(next.w, W);
    next.h = Math.min(next.h, H);
    next.x = Math.min(next.x, W - next.w);
    next.y = Math.min(next.y, H - next.h);
    update(selItem.id, { x: r2(next.x), y: r2(next.y), w: r2(next.w), h: r2(next.h) });
  };

  const linkable = selItem ? KINDS[selItem.kind].deviceType : undefined;
  const deviceOptions = useMemo(() => {
    const real = devices.filter((d) => !d.simulated);
    return [...real].sort((a, b) => Number(b.type === linkable) - Number(a.type === linkable));
  }, [devices, linkable]);

  return (
    <section className="panel flex flex-col h-full min-h-[600px]">
      <header className="panel-head flex-wrap !justify-start gap-2">
        <div className="mr-2">
          <div className="eyebrow">Interior del área · {W.toFixed(1)} × {H.toFixed(1)} m</div>
          <h2 className="panel-title">{zone.name}</h2>
        </div>
        <select className="field !w-auto !h-[26px] !text-[12px]" value="" onChange={(e) => e.target.value && add(e.target.value as InteriorKind)} aria-label="Agregar equipo">
          <option value="">+ Equipo…</option>
          {EQUIPMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KINDS[k].label}
            </option>
          ))}
        </select>
        <select className="field !w-auto !h-[26px] !text-[12px]" value="" onChange={(e) => e.target.value && add(e.target.value as InteriorKind)} aria-label="Agregar sensor">
          <option value="">+ Sensor…</option>
          {SENSOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {KINDS[k].letter} · {KINDS[k].label}
            </option>
          ))}
        </select>
        <span className="w-px h-5 bg-line mx-1" />
        <button className="btn btn-sm btn-ghost" onClick={doUndo} disabled={!undo.length} title="Deshacer (Ctrl+Z)">
          <Undo2 className="h-3.5 w-3.5" /> Deshacer
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            snapshot();
            setItems(defaultInterior(zone, station, widthM, heightM));
            setSel(null);
          }}
          title="Volver al arreglo por omisión del tipo de equipo"
        >
          Plantilla
        </button>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2 cursor-pointer ml-1">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Ajustar a 10 cm
        </label>
        <span className="ml-auto flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>
            Descartar
          </button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !dirty}>
            <Save className="h-3.5 w-3.5" /> {saving ? 'Guardando…' : 'Guardar interior'}
          </button>
        </span>
      </header>
      {error && <div className="px-4 py-2 text-[12px] text-bad bg-bad-soft border-b border-line">{error}</div>}

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="relative flex-1 min-h-[460px] bg-paper overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 select-none touch-none"
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
            onPointerDown={() => setSel(null)}
          >
            <defs>
              <pattern id="ie-grid" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
                <path d="M 0.5 0 L 0 0 0 0.5" fill="none" stroke={C.line} strokeWidth={0.012} />
              </pattern>
            </defs>
            <rect x={0} y={0} width={W} height={H} fill={C.surface} />
            <rect x={0} y={0} width={W} height={H} fill="url(#ie-grid)" stroke={C.ink} strokeWidth={0.04} />
            {/* cotas del área */}
            <text x={W / 2} y={-0.3} textAnchor="middle" fontSize={0.3} fontFamily={FONT_MONO} fill={C.ink3}>
              {W.toFixed(1)} m
            </text>
            <text x={-0.3} y={H / 2} textAnchor="middle" fontSize={0.3} fontFamily={FONT_MONO} fill={C.ink3} transform={`rotate(-90 ${-0.3} ${H / 2})`}>
              {H.toFixed(1)} m
            </text>

            {items.map((it) => (
              <g key={it.id} style={{ cursor: 'move' }} onPointerDown={(e) => startItem(e, it, 'move')}>
                {/* área de agarre invisible del tamaño del elemento */}
                <rect
                  x={it.x}
                  y={it.y}
                  width={it.w}
                  height={it.h}
                  fill="transparent"
                  transform={`rotate(${it.rot ?? 0} ${it.x + it.w / 2} ${it.y + it.h / 2})`}
                />
                <InteriorItemShape item={it} deviceStatus={devStatus(it.device_id)} selected={it.id === sel} />
              </g>
            ))}

            {selItem && (
              <rect
                x={selItem.x + selItem.w - 0.12}
                y={selItem.y + selItem.h - 0.12}
                width={0.24}
                height={0.24}
                fill={C.surface}
                stroke={C.accent}
                strokeWidth={0.04}
                style={{ cursor: 'nwse-resize' }}
                onPointerDown={(e) => startItem(e, selItem, 'resize')}
              />
            )}

            {op && (
              <g style={{ cursor: 'move' }} onPointerDown={startOp}>
                <circle cx={op.x} cy={op.y} r={0.3} fill={sel === '__operator' ? C.accent : C.surface} fillOpacity={sel === '__operator' ? 0.2 : 1} stroke={C.accent} strokeWidth={0.05} />
                <circle cx={op.x} cy={op.y} r={0.08} fill={C.accent} />
                <text x={op.x + 0.4} y={op.y + 0.1} fontSize={0.26} fontFamily={FONT_MONO} fill={C.accent}>
                  operador
                </text>
              </g>
            )}
          </svg>
          <div className="absolute left-3 bottom-3 text-[11px] text-ink-3 pointer-events-none">
            Arrastra para mover · esquina para redimensionar · R: rotar · Supr: eliminar
          </div>
        </div>

        <aside className="lg:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l border-line bg-surface overflow-y-auto lg:max-h-[700px] text-[12.5px]">
          {selItem ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="eyebrow">
                  {KINDS[selItem.kind].letter ? `${KINDS[selItem.kind].letter} · ` : ''}
                  {KINDS[selItem.kind].label}
                </span>
                <button className="btn btn-sm btn-ghost text-bad" onClick={() => remove(selItem.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              </div>
              <div>
                <label className="label">Etiqueta</label>
                <input className="field" value={selItem.label ?? ''} placeholder={KINDS[selItem.kind].label} onChange={(e) => update(selItem.id, { label: e.target.value })} />
              </div>
              {selItem.kind === 'machine' && (
                <div>
                  <label className="label">Tipo de máquina</label>
                  <select className="field" value={selItem.variant ?? 'generic'} onChange={(e) => update(selItem.id, { variant: e.target.value })}>
                    {EQUIPMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2">
                {(['x', 'y', 'w', 'h'] as const).map((f) => (
                  <div key={f}>
                    <label className="label">{{ x: 'X', y: 'Y', w: 'Ancho', h: 'Alto' }[f]} (m)</label>
                    <input type="number" step="0.1" className="field num !px-1.5" value={selItem[f]} onChange={(e) => setNum(f, parseFloat(e.target.value))} />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="label !mb-0">Rotación</span>
                <div className="seg">
                  {[0, 90, 180, 270].map((r) => (
                    <button key={r} aria-pressed={(selItem.rot ?? 0) === r} onClick={() => update(selItem.id, { rot: r as InteriorItem['rot'] })} className="num">
                      {r}°
                    </button>
                  ))}
                </div>
                <button className="btn btn-sm btn-ghost btn-icon" title="Rotar 90° (R)" onClick={() => update(selItem.id, { rot: (((selItem.rot ?? 0) + 90) % 360) as InteriorItem['rot'] })}>
                  <RotateCw className="h-3.5 w-3.5" />
                </button>
              </div>

              {KINDS[selItem.kind].group === 'sensor' && (
                <div>
                  <label className="label">Dispositivo que lo alimenta</label>
                  <select className="field" value={selItem.device_id ?? ''} onChange={(e) => update(selItem.id, { device_id: e.target.value || null })}>
                    <option value="">Sin vincular</option>
                    {deviceOptions.map((d) => (
                      <option key={d.device_id} value={d.device_id}>
                        {d.name} · {d.device_id} {d.type !== linkable ? '(otro tipo)' : ''}
                      </option>
                    ))}
                  </select>
                  {selItem.device_id && (
                    <p className="mt-1.5">
                      <span className={`chip ${DEVICE_STATUS[devStatus(selItem.device_id) ?? 'none'].chip}`}>{DEVICE_STATUS[devStatus(selItem.device_id) ?? 'none'].label}</span>
                    </p>
                  )}
                  {deviceOptions.length === 0 && (
                    <p className="mt-1.5 text-[11.5px] text-ink-3">Aún no hay dispositivos reales. Regístralos en la sección Dispositivos.</p>
                  )}
                </div>
              )}
            </div>
          ) : sel === '__operator' ? (
            <div className="p-4 space-y-2">
              <div className="eyebrow">Posición del operador</div>
              <p className="text-ink-2 leading-snug">
                Punto donde normalmente trabaja el operador. El simulador lo usa como base y la vista de estación lo toma como referencia del puesto.
              </p>
              {op && (
                <p className="num">
                  x {op.x.toFixed(1)} m · y {op.y.toFixed(1)} m
                </p>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div>
                <div className="eyebrow mb-1">Elementos ({items.length})</div>
                <ul className="border border-line divide-y divide-line max-h-[260px] overflow-y-auto">
                  {items.map((i) => (
                    <li key={i.id}>
                      <button className="w-full text-left px-2.5 py-1.5 hover:bg-sunken flex justify-between gap-2" onClick={() => setSel(i.id)}>
                        <span className="truncate">
                          {KINDS[i.kind].letter && <span className="num text-ink-3 mr-1.5">{KINDS[i.kind].letter}</span>}
                          {i.label || KINDS[i.kind].label}
                        </span>
                        {KINDS[i.kind].group === 'sensor' && (
                          <span className={`chip ${DEVICE_STATUS[devStatus(i.device_id) ?? 'none'].chip}`}>{DEVICE_STATUS[devStatus(i.device_id) ?? 'none'].label}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[11.5px] text-ink-3 leading-snug">
                Los sensores con borde de color están vinculados a un ESP32: verde conectado, ámbar esperando conexión, rojo sin señal. El sensor de proceso
                punteado indica que no hay dispositivo.
              </p>
              {!zone.interior?.length && <p className="text-[11.5px] text-warn">Esta área usa la plantilla automática; al guardar queda fija.</p>}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};
