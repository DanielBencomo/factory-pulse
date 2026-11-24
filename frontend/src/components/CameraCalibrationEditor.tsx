import React, { useEffect, useState } from 'react';
import { CameraConfig, FloorPlan } from '../types';
import { Modal } from './Modal';

type Point = [number, number];
type Mark = { image?: Point; x: string; y: string };
type Snapshot = { url: string; session: string; time: string; width: number; height: number };
type Registration = { saved_at: string; max_error_m: number; check_errors_m: number[]; revision: string };

const blank = (): Mark => ({ x: '', y: '' });
const initialMarks = () => Array.from({ length: 5 }, blank);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function CameraCalibrationEditor({ camera, floor, onClose, onSaved }: {
  camera: CameraConfig; floor: FloorPlan; onClose: () => void; onSaved: () => void;
}) {
  const [request, setRequest] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [marks, setMarks] = useState(initialMarks);
  const [selected, setSelected] = useState(0);
  const [tolerance, setTolerance] = useState('0.25');
  const [result, setResult] = useState<Registration | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [error, setError] = useState('');
  const calibrationUrl = `/api/cameras/${encodeURIComponent(camera.camera_id)}/calibration`;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const load = async () => {
      try {
        const response = await fetch(`${camera.snapshot_url}?raw=true`, {
          signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw new Error('No hay una captura reciente. Revisa el video y reintenta.');
        const session = response.headers.get('X-Frame-Session');
        const time = response.headers.get('X-Frame-Time');
        const width = Number(response.headers.get('X-Frame-Width'));
        const height = Number(response.headers.get('X-Frame-Height'));
        if (!session || !time || width <= 0 || height <= 0) throw new Error('El proveedor no publicó los datos de la captura.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSnapshot({ url: objectUrl, session, time, width, height });
      } catch (err: unknown) {
        if (!controller.signal.aborted) setError(message(err));
      }
    };
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [camera.snapshot_url, request]);

  const retake = () => {
    setSnapshot(null);
    setImageReady(false);
    setMarks(initialMarks());
    setSelected(0);
    setError('');
    setResult(null);
    setRequest((value) => value + 1);
  };

  const markPoint = (event: React.MouseEvent<HTMLImageElement>) => {
    if (busy || !imageReady) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const image: Point = [(event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height];
    setMarks((rows) => rows.map((row, index) => index === selected ? { ...row, image } : row));
    setSelected(Math.min(selected + 1, marks.length - 1));
    setResult(null);
  };

  const complete = marks.every((row) => row.image && row.x.trim() && row.y.trim()
    && Number.isFinite(Number(row.x)) && Number.isFinite(Number(row.y))
    && Number(row.x) >= 0 && Number(row.x) <= floor.width_meters
    && Number(row.y) >= 0 && Number(row.y) <= floor.height_meters);
  const validTolerance = Number(tolerance) >= 0.01 && Number(tolerance) <= 1;

  const save = async () => {
    if (!snapshot || !complete || !validTolerance || busy) return;
    setBusy(true);
    setError('');
    try {
      const points = marks.map((row) => ({ image: row.image, floor_m: [Number(row.x), Number(row.y)] }));
      const response = await fetch(calibrationUrl, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frame_revision: floor.calibration.frame_revision,
          snapshot_session: snapshot.session, snapshot_at: snapshot.time,
          image_width: snapshot.width, image_height: snapshot.height,
          anchors: points.slice(0, 4), checks: points.slice(4), tolerance_m: Number(tolerance),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Revisa los puntos y sus coordenadas.');
      setResult(body);
      onSaved();
    } catch (err: unknown) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const invalidate = async () => {
    if (busy || !window.confirm('¿Invalidar la calibración guardada de esta cámara? El video seguirá activo sin medir posiciones.')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(calibrationUrl, { method: 'DELETE' });
      if (!response.ok) throw new Error('No se pudo invalidar la calibración.');
      setResult(null);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`Calibrar piso · ${camera.name}`}
    subtitle="Usa puntos físicos en el suelo. No marques esquinas de mesas, paredes altas ni objetos elevados."
    onClose={onClose} width="max-w-6xl" bodyClassName="p-4"
    footer={<>
      <button type="button" className="btn btn-ghost mr-auto" disabled={busy} onClick={invalidate}>Invalidar anterior</button>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button type="button" className="btn btn-primary" onClick={save} disabled={!imageReady || !complete || !validTolerance || busy || !!result}>
        {busy ? 'Validando…' : 'Validar y guardar'}
      </button>
    </>}>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_350px]">
      <div>
        {snapshot ? <div className="relative">
          <img className="block w-full cursor-crosshair" src={snapshot.url} alt="Captura congelada de la cámara"
            onClick={markPoint} onLoad={() => setImageReady(true)} onError={() => setError('No se pudo decodificar la captura.')}
            draggable={false} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {marks.map(({ image }, index) => image && <g key={index}>
              <circle cx={image[0] * 100} cy={image[1] * 100} r="1.1" fill={index < 4 ? '#f59e0b' : '#10b981'} stroke="white" strokeWidth=".3" />
              <text x={image[0] * 100 + 1.5} y={image[1] * 100 - 1} fill="white" fontSize="2.5">{index + 1}</text>
            </g>)}
          </svg>
        </div> : <p className="text-ink-3 p-4">{error ? 'Captura no disponible.' : 'Cargando captura…'}</p>}
        <button type="button" className="btn btn-sm mt-2" onClick={retake} disabled={busy}>Nueva captura</button>
      </div>
      <div className="space-y-3">
        <p className="text-[12px] text-ink-2">
          Plano: {floor.width_meters} × {floor.height_meters} m. Mide desde el origen del plano: X derecha, Y abajo.
          Marca las cuatro esquinas en orden de perímetro y al menos un control interior medido de forma independiente.
        </p>
        <div className="grid grid-cols-[1fr_5rem_5rem] gap-1.5 items-center text-[12px]">
          <span>Punto activo</span><span>X (m)</span><span>Y (m)</span>
          {marks.map((row, index) => <React.Fragment key={index}>
            <button type="button" className={`btn btn-sm ${selected === index ? 'btn-primary' : ''}`} aria-pressed={selected === index}
              onClick={() => setSelected(index)} disabled={busy}>
              {index + 1} · {index < 4 ? 'Ancla' : 'Control'} {row.image ? '✓' : ''}
            </button>
            {(['x', 'y'] as const).map((axis) => <input key={axis} className="field num" type="number" step="any" min="0"
              max={axis === 'x' ? floor.width_meters : floor.height_meters} value={row[axis]} disabled={busy}
              aria-label={`Punto ${index + 1}, ${axis.toUpperCase()} en metros`} onChange={(e) => {
                const value = e.target.value;
                setMarks((rows) => rows.map((item, i) => i === index ? { ...item, [axis]: value } : item));
                setResult(null);
              }} />)}
          </React.Fragment>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" disabled={busy || marks.length >= 12} onClick={() => {
            setSelected(marks.length); setMarks((rows) => [...rows, blank()]); setResult(null);
          }}>Otro control</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy || marks.length <= 5} onClick={() => {
            setSelected(Math.min(selected, marks.length - 2)); setMarks((rows) => rows.slice(0, -1)); setResult(null);
          }}>Quitar último</button>
        </div>
        <label className="text-[12px] flex items-center gap-2">Tolerancia máxima (m)
          <input className="field num !w-24" type="number" min="0.01" max="1" step="0.01" value={tolerance}
            disabled={busy} onChange={(e) => { setTolerance(e.target.value); setResult(null); }} />
        </label>
        {error && <p role="alert" className="text-[12px] text-bad">{error}</p>}
        {result && <p role="status" className="text-[12px] text-ok">
          Guardada · error máximo {result.max_error_m.toFixed(3)} m.
          Controles: {result.check_errors_m.map((value) => value.toFixed(3)).join(', ')} m.
        </p>}
      </div>
    </div>
  </Modal>;
}
