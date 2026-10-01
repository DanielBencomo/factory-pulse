import React, { useEffect, useMemo, useState } from 'react';
import { Camera, Grid2X2, Pencil, Play, Plus, RefreshCw, Square, TestTube2, Trash2 } from 'lucide-react';
import { VisionPanel } from '../components/VisionPanel';
import { api } from '../services/api';
import {
  CameraConfig, CameraInput, CameraProfile, CameraSourceType,
  DetectionProfile, FloorPlan, Line, PolygonZone, Station, SystemMode,
} from '../types';

type CameraForm = {
  camera_id: string;
  name: string;
  source_type: CameraSourceType;
  scheme: 'rtsp' | 'rtsps' | 'http' | 'https';
  host: string;
  port: string;
  path: string;
  username: string;
  password: string;
  webcam_index: string;
  rtsp_transport: 'tcp' | 'udp';
  provider_url: string;
  calibration_path: string;
  profile: DetectionProfile;
  auto_start: boolean;
  show_annotations: boolean;
};

const emptyForm = (): CameraForm => ({
  camera_id: '', name: '', source_type: 'rtsp', scheme: 'rtsp', host: '', port: '554', path: '/stream1',
  username: '', password: '', webcam_index: '0', rtsp_transport: 'tcp', provider_url: '',
  calibration_path: '',
  profile: 'balanced', auto_start: true, show_annotations: true,
});

const slug = (value: string) => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const formFromCamera = (camera: CameraConfig): CameraForm => {
  const form = emptyForm();
  form.camera_id = camera.camera_id;
  form.name = camera.name;
  form.source_type = camera.source_type ?? 'rtsp';
  form.username = camera.username ?? '';
  form.profile = camera.profile;
  form.webcam_index = String(camera.webcam_index ?? 0);
  form.rtsp_transport = camera.rtsp_transport ?? 'tcp';
  form.provider_url = camera.provider_url ?? '';
  form.calibration_path = camera.calibration_path ?? '';
  form.auto_start = camera.auto_start;
  form.show_annotations = camera.show_annotations;
  if (camera.source_url) {
    try {
      const parsed = new URL(camera.source_url);
      form.scheme = parsed.protocol.replace(':', '') as CameraForm['scheme'];
      form.host = parsed.hostname;
      form.port = parsed.port || (parsed.protocol.startsWith('rtsp') ? '554' : parsed.protocol === 'https:' ? '443' : '80');
      form.path = `${parsed.pathname}${parsed.search}` || '/';
    } catch { /* conserva campos vacíos para que el usuario corrija la URL */ }
  }
  return form;
};

const sourceUrl = (form: CameraForm) => {
  const host = form.host.includes(':') && !form.host.startsWith('[') ? `[${form.host}]` : form.host;
  const path = form.path.startsWith('/') ? form.path : `/${form.path}`;
  return `${form.scheme}://${host}${form.port ? `:${form.port}` : ''}${path || '/'}`;
};

interface Props {
  cameras: CameraConfig[];
  mode: SystemMode;
  floorPlan: FloorPlan | null;
  zones: PolygonZone[];
  lines: Line[];
  stations: Station[];
  onChanged: () => void | Promise<void>;
  onLayoutChanged: () => void | Promise<void>;
}

export const CamerasPage: React.FC<Props> = ({
  cameras, mode, floorPlan, zones, lines, stations, onChanged, onLayoutChanged,
}) => {
  const [profiles, setProfiles] = useState<CameraProfile[]>([]);
  const [form, setForm] = useState<CameraForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<'auto' | '1' | '2' | '3' | '4'>('auto');

  useEffect(() => {
    api.listCameraProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, []);

  const configured = cameras.filter((camera) => camera.configured).length;
  const running = cameras.filter((camera) => camera.runtime.process === 'running' || camera.provider_mode === 'external').length;
  const autoColumns = cameras.length <= 1 ? 1 : cameras.length <= 4 ? 2 : cameras.length <= 6 ? 3 : 4;
  const columns = layout === 'auto' ? autoColumns : Number(layout);
  const gridClass = ({ 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4' } as Record<number, string>)[columns];

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.value === form.profile), [profiles, form.profile]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setError(null);
    setMessage(null);
    setFormOpen(true);
  };

  const openEdit = (camera: CameraConfig) => {
    setEditing(camera.configured ? camera.camera_id : null);
    setForm(formFromCamera(camera));
    setError(null);
    setMessage(null);
    setFormOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const cameraId = form.camera_id.trim() || `cam-${slug(form.name) || Date.now().toString(36)}`;
    const payload: CameraInput = {
      camera_id: cameraId,
      name: form.name.trim(),
      source_type: form.source_type,
      source_url: ['rtsp', 'http'].includes(form.source_type) ? sourceUrl(form) : null,
      username: form.username.trim() || null,
      webcam_index: Number(form.webcam_index || 0),
      rtsp_transport: form.rtsp_transport,
      provider_url: form.source_type === 'provider' ? form.provider_url.trim() : null,
      calibration_path: form.source_type === 'provider' ? null : form.calibration_path.trim() || null,
      profile: form.profile,
      auto_start: form.auto_start,
      show_annotations: form.show_annotations,
      enabled: true,
    };
    if (form.password) payload.password = form.password;
    setBusy(cameraId);
    try {
      if (editing) await api.updateCamera(editing, payload);
      else await api.registerCamera(payload);
      await onChanged();
      setFormOpen(false);
      setMessage(`Cámara ${editing ? 'actualizada' : 'registrada'}; el proveedor se conectará automáticamente.`);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  const action = async (camera: CameraConfig, kind: 'start' | 'stop' | 'probe' | 'delete') => {
    setBusy(`${kind}-${camera.camera_id}`);
    setError(null);
    setMessage(null);
    try {
      if (kind === 'start') await api.startCamera(camera.camera_id);
      if (kind === 'stop') await api.stopCamera(camera.camera_id);
      if (kind === 'probe') {
        const result = await api.probeCamera(camera.camera_id);
        const details = result.details ?? {};
        setMessage(`Conexión correcta: ${details.width ?? '—'} × ${details.height ?? '—'} · ${details.fps ?? '—'} FPS de origen.`);
      }
      if (kind === 'delete') {
        if (!window.confirm(`¿Eliminar la cámara “${camera.name}”?`)) return;
        await api.deleteCamera(camera.camera_id);
      }
      await onChanged();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title flex items-center gap-2"><Camera size={15} /> Cámaras registradas</h2>
            <p className="text-[11.5px] text-ink-3 mt-0.5">Cada fuente tiene su propia conexión y proveedor; ningún mosaico depende del puerto 8001.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip chip-muted"><span className="num">{configured}</span> configuradas</span>
            <span className="chip chip-ok"><span className="num">{running}</span> proveedores</span>
            <button className="btn btn-sm btn-primary" onClick={openNew}><Plus size={13} /> Agregar cámara</button>
          </div>
        </div>

        {formOpen && (
          <form onSubmit={save} className="p-4 border-t border-line space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div>
                <label className="label">Nombre visible</label>
                <input className="field" required placeholder="Cámara acceso norte" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">ID de cámara</label>
                <input className="field num" disabled={Boolean(editing)} placeholder={`cam-${slug(form.name) || 'area-1'}`} value={form.camera_id} onChange={(e) => setForm({ ...form, camera_id: e.target.value })} />
              </div>
              <div>
                <label className="label">Tipo de conexión</label>
                <select className="field" value={form.source_type} onChange={(e) => {
                  const source_type = e.target.value as CameraSourceType;
                  const scheme = source_type === 'http' ? 'http' : 'rtsp';
                  setForm({ ...form, source_type, scheme, port: source_type === 'http' ? '80' : '554' });
                }}>
                  <option value="rtsp">Cámara IP / teléfono RTSP</option>
                  <option value="http">HTTP / MJPEG</option>
                  <option value="webcam">Webcam USB local</option>
                  <option value="provider">Proveedor de visión existente</option>
                </select>
              </div>
              <div>
                <label className="label">Perfil YOLO</label>
                <select className="field" value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value as DetectionProfile })} disabled={form.source_type === 'provider'}>
                  {(profiles.length ? profiles : [
                    { value: 'fast', label: 'Rápido' }, { value: 'balanced', label: 'Equilibrado' }, { value: 'precision', label: 'Alta precisión' },
                  ]).map((profile: any) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
                </select>
              </div>
            </div>

            {['rtsp', 'http'].includes(form.source_type) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 border border-line bg-paper p-3 rounded-[2px]">
                <div>
                  <label className="label">Protocolo</label>
                  <select className="field" value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value as CameraForm['scheme'] })}>
                    {form.source_type === 'rtsp' ? <><option>rtsp</option><option>rtsps</option></> : <><option>http</option><option>https</option></>}
                  </select>
                </div>
                <div className="xl:col-span-2">
                  <label className="label">IP o nombre de host</label>
                  <input className="field num" required placeholder="192.168.1.50" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value.trim() })} />
                </div>
                <div>
                  <label className="label">Puerto</label>
                  <input className="field num" inputMode="numeric" required placeholder="554" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value.replace(/\D/g, '') })} />
                </div>
                <div className="xl:col-span-2">
                  <label className="label">Ruta del stream</label>
                  <input className="field num" required placeholder="/stream1" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
                </div>
                <div className="xl:col-span-2">
                  <label className="label">Usuario</label>
                  <input className="field" autoComplete="username" placeholder="admin" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
                <div className="xl:col-span-2">
                  <label className="label">Contraseña {editing && '(vacía = conservar)'}</label>
                  <input className="field" type="password" autoComplete="new-password" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
                {form.source_type === 'rtsp' && (
                  <div className="xl:col-span-2">
                    <label className="label">Transporte RTSP</label>
                    <select className="field" value={form.rtsp_transport} onChange={(e) => setForm({ ...form, rtsp_transport: e.target.value as 'tcp' | 'udp' })}>
                      <option value="tcp">TCP · estable (recomendado)</option><option value="udp">UDP · menor latencia</option>
                    </select>
                  </div>
                )}
                <div className="sm:col-span-2 xl:col-span-6 text-[11px] text-ink-3">
                  URL resultante: <span className="num">{sourceUrl(form)}</span> · la contraseña se cifra y nunca vuelve al navegador.
                </div>
              </div>
            )}

            {form.source_type === 'webcam' && (
              <div className="max-w-xs"><label className="label">Índice de webcam</label><input className="field num" type="number" min="0" max="32" value={form.webcam_index} onChange={(e) => setForm({ ...form, webcam_index: e.target.value })} /></div>
            )}
            {form.source_type === 'provider' && (
              <div className="max-w-xl"><label className="label">URL HTTP del proveedor</label><input className="field num" required placeholder="http://192.168.1.64:8101" value={form.provider_url} onChange={(e) => setForm({ ...form, provider_url: e.target.value })} /></div>
            )}

            {form.source_type !== 'provider' && (
              <div className="max-w-xl">
                <label className="label">Archivo de calibración (opcional)</label>
                <input className="field num" placeholder="calib-planta.json" value={form.calibration_path} onChange={(e) => setForm({ ...form, calibration_path: e.target.value })} />
                <p className="text-[11px] text-ink-3 mt-1">Necesario para proyectar zonas y posiciones con precisión sobre el plano.</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.auto_start} onChange={(e) => setForm({ ...form, auto_start: e.target.checked })} /> Iniciar automáticamente</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.show_annotations} onChange={(e) => setForm({ ...form, show_annotations: e.target.checked })} /> Mostrar detecciones al abrir</label>
              {selectedProfile && <span className="text-ink-3">{selectedProfile.description} · {selectedProfile.model} · {selectedProfile.image_size}px · confianza {selectedProfile.confidence}</span>}
              <div className="ml-auto flex gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>{busy ? 'Guardando…' : 'Guardar y conectar'}</button>
              </div>
            </div>
            {error && <p className="text-[12px] text-bad">{error}</p>}
          </form>
        )}
      </section>

      {(message || (!formOpen && error)) && (
        <div className={`panel px-4 py-3 text-[12.5px] ${error ? 'text-bad' : 'text-ok'}`}>{error ?? message}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Mosaico</span>
        <Grid2X2 size={14} className="text-ink-3" />
        {(['auto', '1', '2', '3', '4'] as const).map((value) => (
          <button key={value} className={`btn btn-sm ${layout === value ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLayout(value)}>
            {value === 'auto' ? 'Automático' : `${value} col.`}
          </button>
        ))}
      </div>

      {cameras.length === 0 ? (
        <section className="panel py-14 text-center">
          <Camera className="mx-auto h-9 w-9 text-ink-4" strokeWidth={1.4} />
          <h2 className="text-[16px] font-semibold mt-3">Aún no hay cámaras</h2>
          <p className="text-[12.5px] text-ink-3 mt-1">Agrega una webcam, teléfono RTSP o cámara IP; el puerto del proveedor se asignará automáticamente.</p>
          <button className="btn btn-primary mt-4" onClick={openNew}><Plus size={14} /> Agregar primera cámara</button>
        </section>
      ) : (
        <div className={`grid grid-cols-1 ${gridClass} gap-4`}>
          {cameras.map((camera) => (
            <div key={camera.camera_id} className="min-w-0 space-y-2">
              <VisionPanel
                mode={mode} camera={camera} compact={columns >= 3}
                enableMapping={camera.configured} floorPlan={floorPlan} zones={zones} lines={lines} stations={stations}
                onLayoutChanged={onLayoutChanged}
              />
              <div className="panel px-2.5 py-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                <span className="num mr-auto">{camera.camera_id}{camera.provider_port ? ` · proveedor automático ${camera.provider_port}` : ''}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => openEdit(camera)}><Pencil size={12} /> {camera.configured ? 'Configurar' : 'Completar'}</button>
                {camera.configured && <button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => action(camera, 'probe')}><TestTube2 size={12} /> Probar</button>}
                {camera.configured && camera.runtime.process === 'running'
                  ? <button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => action(camera, 'stop')}><Square size={11} /> Detener</button>
                  : camera.configured && camera.provider_mode !== 'external' && <button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => action(camera, 'start')}><Play size={12} /> Iniciar</button>}
                <button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => action(camera, 'delete')} title="Eliminar"><Trash2 size={12} /></button>
                {busy?.endsWith(camera.camera_id) && <RefreshCw size={12} className="animate-spin" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
