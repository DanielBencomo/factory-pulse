import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, RotateCcw, Save, ShieldCheck, Undo2 } from 'lucide-react';
import { api } from '../services/api';
import { FloorPlan, Line, PolygonZone, Station, ZoneType } from '../types';
import { Modal } from './Modal';

type Point = [number, number];
type DrawTarget = 'zone' | 'line';

interface Props {
  floorPlan: FloorPlan;
  zones: PolygonZone[];
  lines: Line[];
  stations: Station[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

type Overlay = { id: string; name: string; color: string; points: Point[]; kind: DrawTarget };

const snapshotBase = import.meta.env.VITE_VISION_SNAPSHOT_URL || '/vision/snapshot.jpg';
const mapUrl = import.meta.env.VITE_VISION_MAP_URL || '/vision/map-points';

const project = async (points: Point[], direction: 'camera_to_floor' | 'floor_to_camera'): Promise<Point[]> => {
  const response = await fetch(mapUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points, direction }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || 'No se pudo proyectar el polígono');
  return body.points as Point[];
};

const slug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'area';

export const CameraMapEditor: React.FC<Props> = ({ floorPlan, zones, lines, stations, onClose, onSaved }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [capture, setCapture] = useState(Date.now());
  const [points, setPoints] = useState<Point[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [target, setTarget] = useState<DrawTarget>('zone');
  const [name, setName] = useState('Nueva área');
  const [zoneType, setZoneType] = useState<ZoneType>('work');
  const [lineId, setLineId] = useState(lines[0]?.id ?? '');
  const [stationId, setStationId] = useState('');
  const [capacity, setCapacity] = useState('');
  const [privateOnly, setPrivateOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const candidates = [
          ...lines.filter((line) => line.polygon).map((line) => ({
            id: line.id, name: line.name, color: '#0f766e', points: line.polygon!, kind: 'line' as const,
          })),
          ...zones.map((zone) => ({
            id: zone.zone_id, name: zone.name, color: zone.color, points: zone.polygon, kind: 'zone' as const,
          })),
        ];
        const mapped = await Promise.all(candidates.map(async (item) => ({
          ...item, points: await project(item.points, 'floor_to_camera'),
        })));
        if (active) setOverlays(mapped);
      } catch (err: any) {
        if (active) setError(err.message ?? String(err));
      }
    };
    load();
    return () => { active = false; };
  }, [capture, lines, zones]);

  const filteredStations = useMemo(
    () => stations.filter((station) => !lineId || station.line_id === lineId),
    [stations, lineId],
  );

  const chooseTarget = (next: DrawTarget) => {
    setTarget(next);
    setError(null);
    if (next === 'line' && !lineId && lines[0]) setLineId(lines[0].id);
  };

  const addPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (busy) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPoints((current) => [
      ...current,
      [
        Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      ],
    ]);
  };

  const save = async () => {
    if (points.length < 3) {
      setError('Marca al menos tres vértices sobre la imagen.');
      return;
    }
    if (target === 'zone' && !name.trim()) {
      setError('Escribe un nombre para el área.');
      return;
    }
    if (target === 'line' && !lineId) {
      setError('Selecciona la línea que deseas delimitar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const floorPoints = await project(points, 'camera_to_floor');
      if (target === 'line') {
        await api.updateLinePolygon(lineId, floorPoints);
      } else {
        const aggregated = privateOnly || zoneType === 'bathroom';
        const parsedCapacity = capacity.trim() ? Number(capacity) : undefined;
        await api.createZone({
          zone_id: `${slug(name)}-${Date.now().toString(36)}`,
          floor_plan_id: floorPlan.id,
          name: name.trim(),
          type: zoneType,
          polygon: floorPoints,
          color: zoneType === 'bathroom' ? '#ec4899' : '#2563eb',
          station_ids: stationId ? [stationId] : [],
          max_capacity: parsedCapacity && parsedCapacity > 0 ? parsedCapacity : undefined,
          is_aggregated_only: aggregated,
          line_id: lineId || null,
        });
      }
      await onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Mapear áreas sobre la cámara"
      subtitle="Congela una imagen, marca el perímetro y guárdalo en el plano mediante la homografía."
      onClose={onClose}
      width="max-w-6xl"
      bodyClassName="p-4"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || points.length < 3}>
            <Save className="h-3.5 w-3.5" /> {busy ? 'Guardando…' : 'Guardar polígono'}
          </button>
        </>
      )}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_290px] gap-4">
        <div>
          <div
            ref={canvasRef}
            onClick={addPoint}
            className="relative bg-[#111820] overflow-hidden cursor-crosshair border border-line select-none"
          >
            <img src={`${snapshotBase}?capture=${capture}`} alt="Imagen congelada para delimitar áreas" className="w-full block" draggable={false} />
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {overlays.map((overlay) => (
                <polygon
                  key={`${overlay.kind}-${overlay.id}`}
                  points={overlay.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')}
                  fill={overlay.color}
                  fillOpacity="0.08"
                  stroke={overlay.color}
                  strokeWidth="0.35"
                  strokeDasharray={overlay.kind === 'line' ? '1.4 0.8' : undefined}
                />
              ))}
              {points.length > 1 && (
                <polyline
                  points={points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')}
                  fill={points.length > 2 ? 'rgba(245,158,11,0.16)' : 'none'}
                  stroke="#f59e0b"
                  strokeWidth="0.55"
                />
              )}
              {points.map(([x, y], index) => (
                <g key={`${x}-${y}-${index}`}>
                  <circle cx={x * 100} cy={y * 100} r="0.8" fill="#f59e0b" stroke="white" strokeWidth="0.25" />
                  <text x={x * 100 + 1} y={y * 100 - 1} fill="white" fontSize="2.2">{index + 1}</text>
                </g>
              ))}
            </svg>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-[12px] text-ink-3">{points.length} vértices · haz clic siguiendo el perímetro</span>
            <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setPoints((value) => value.slice(0, -1))} disabled={!points.length}>
              <Undo2 className="h-3.5 w-3.5" /> Deshacer
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setPoints([])} disabled={!points.length}>
              <RotateCcw className="h-3.5 w-3.5" /> Limpiar
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setPoints([]); setCapture(Date.now()); }}>
              <Camera className="h-3.5 w-3.5" /> Nueva captura
            </button>
          </div>
        </div>

        <aside className="space-y-3">
          <div>
            <label className="label">Qué vas a delimitar</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button className={`btn btn-sm ${target === 'zone' ? 'btn-primary' : ''}`} onClick={() => chooseTarget('zone')}>Zona / depto.</button>
              <button className={`btn btn-sm ${target === 'line' ? 'btn-primary' : ''}`} onClick={() => chooseTarget('line')}>Línea completa</button>
            </div>
          </div>
          {target === 'zone' && (
            <>
              <div><label className="label">Nombre</label><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div>
                <label className="label">Tipo</label>
                <select className="field" value={zoneType} onChange={(e) => { const value = e.target.value as ZoneType; setZoneType(value); if (value === 'bathroom') setPrivateOnly(true); }}>
                  <option value="work">Producción / estación</option>
                  <option value="transit">Tránsito</option>
                  <option value="storage">Materiales / almacén</option>
                  <option value="rest">Descanso / espera</option>
                  <option value="bathroom">Acceso sanitario</option>
                  <option value="restricted">Restringida</option>
                </select>
              </div>
            </>
          )}
          <div>
            <label className="label">Línea</label>
            <select className="field" value={lineId} onChange={(e) => { setLineId(e.target.value); setStationId(''); }}>
              {target === 'zone' && <option value="">Sin línea</option>}
              {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
            </select>
          </div>
          {target === 'zone' && (
            <>
              <div>
                <label className="label">Estación específica (opcional)</label>
                <select className="field" value={stationId} onChange={(e) => setStationId(e.target.value)}>
                  <option value="">Ninguna</option>
                  {filteredStations.map((station) => <option key={station.station_id} value={station.station_id}>{station.name}</option>)}
                </select>
              </div>
              <div><label className="label">Capacidad de alerta (opcional)</label><input className="field num" type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
              <label className="flex items-start gap-2 text-[12.5px] cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={privateOnly || zoneType === 'bathroom'} disabled={zoneType === 'bathroom'} onChange={(e) => setPrivateOnly(e.target.checked)} />
                <span><span className="flex items-center gap-1 font-medium"><ShieldCheck className="h-3.5 w-3.5" /> Solo conteo agregado</span><span className="text-ink-3">No conserva IDs ni spaghetti individual dentro del área.</span></span>
              </label>
            </>
          )}
          <div className="text-[11.5px] text-ink-3 border-t border-line pt-3">
            Las áreas existentes aparecen como referencia. La cámara debe permanecer fija después de calibrarla.
          </div>
          {error && <div className="text-[12px] text-bad bg-bad-soft p-2 border border-bad/20">{error}</div>}
        </aside>
      </div>
    </Modal>
  );
};
