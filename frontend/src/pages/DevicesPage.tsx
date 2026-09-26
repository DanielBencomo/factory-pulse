import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Check, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { ConnectInfo, Device, Station, SystemMode } from '../types';
import { api } from '../services/api';
import { DEVICE_STATUS } from '../components/StationDetail';
import { Panel } from '../components/DashboardGrid';
import { shortStationName } from '../layout/geometry';
import { BadgesPanel } from './BadgesPanel';

/*
 * Preparación para ESP32: el servidor queda escuchando y cada dispositivo
 * registrado aparece como "esperando conexión" hasta su primer latido.
 */

const ago = (iso?: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`;
};

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label }) => {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
      title="Copiar"
    >
      {ok ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
};

const Code: React.FC<{ children: string }> = ({ children }) => (
  <div className="relative">
    <pre className="num text-[11.5px] leading-relaxed bg-paper border border-line rounded-[2px] px-3 py-2.5 overflow-x-auto whitespace-pre">{children}</pre>
    <div className="absolute top-1 right-1">
      <CopyButton text={children} />
    </div>
  </div>
);

const firmwareConfig = (d: Device, info: ConnectInfo | null) => `// Factory Pulse · configuración de ${d.name}
#define WIFI_SSID    "NOMBRE_DE_TU_RED"
#define WIFI_PASS    "CLAVE_DE_TU_RED"
#define SERVER_BASE  "${info?.base_url ?? 'http://IP_DEL_SERVIDOR:8000'}"
#define DEVICE_ID    "${d.device_id}"
#define STATION_ID   "${d.station_id ?? ''}"
// Latido cada ${info?.heartbeat_interval_seconds ?? 10} s:  POST SERVER_BASE/api/devices/DEVICE_ID/heartbeat
// Eventos:              POST SERVER_BASE/api/events  (mode: "live")`;

const curlTest = (d: Device, info: ConnectInfo | null) =>
  `curl -X POST ${info?.base_url ?? 'http://IP_DEL_SERVIDOR:8000'}/api/devices/${d.device_id}/heartbeat -H "Content-Type: application/json" -d "{\\"firmware\\":\\"prueba\\"}"`;

export const DevicesPage: React.FC<{
  devices: Device[];
  stations: Station[];
  mode: SystemMode;
  onModeChange: (m: SystemMode) => void;
  onChanged: () => void;
}> = ({ devices, stations, mode, onModeChange, onChanged }) => {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [types, setTypes] = useState<{ value: string; label: string }[]>([]);
  const [form, setForm] = useState({ device_id: '', name: '', type: 'esp32_rfid', station_id: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    api.getConnectInfo().then(setInfo).catch(() => setInfo(null));
    api.listDeviceTypes().then(setTypes).catch(() => setTypes([]));
    const id = setInterval(() => tick((n) => n + 1), 1000); // refresca los "hace X s"
    return () => clearInterval(id);
  }, [mode]);

  const real = devices.filter((d) => !d.simulated && d.is_active);
  const discovered = devices.filter((d) => !d.simulated && !d.is_active);
  const demo = devices.filter((d) => d.simulated);
  const connected = real.filter((d) => d.status === 'online').length;
  const typeLabel = (t: string) => types.find((x) => x.value === t)?.label ?? t;
  const stationName = (id?: string) => {
    const s = stations.find((x) => x.station_id === id);
    return s ? `${s.order_in_line} · ${shortStationName(s.name)}` : '—';
  };

  const suggestedId = useMemo(() => {
    const st = stations.find((s) => s.station_id === form.station_id);
    const suffix = form.type.replace('esp32_', '').replace('camera_vision', 'cam');
    return `esp32-${st ? st.station_id : 'nodo'}-${suffix}`;
  }, [form.station_id, form.type, stations]);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const device_id = form.device_id.trim() || suggestedId;
      const existing = devices.find((d) => d.device_id === device_id);
      if (existing && !existing.is_active) {
        await api.updateDevice(device_id, { name: form.name || device_id, type: form.type, station_id: form.station_id || undefined, is_active: true } as any);
      } else {
        await api.registerDevice({ device_id, name: form.name || device_id, type: form.type, station_id: form.station_id || null });
      }
      setForm({ device_id: '', name: '', type: form.type, station_id: '' });
      setFormOpen(false);
      setExpanded(device_id);
      onChanged();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  };

  const remove = async (d: Device) => {
    try {
      await api.deleteDevice(d.device_id);
      onChanged();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* Estado de la conexión */}
      <section className="panel">
        <div className="p-4 flex flex-wrap items-start gap-x-8 gap-y-3">
          <div className="min-w-[240px] flex-1">
            <div className="eyebrow">Estado</div>
            {mode === 'live' ? (
              <>
                <h2 className="text-[17px] font-semibold mt-1">
                  {real.length === 0 ? 'Listo para recibir dispositivos' : connected === real.length ? 'Todos los dispositivos conectados' : 'Esperando conexión'}
                </h2>
                <p className="text-[12.5px] text-ink-2 mt-1">
                  <span className="num">{connected}</span> de <span className="num">{real.length}</span> registrados en línea
                  {discovered.length > 0 && (
                    <>
                      {' '}· <span className="text-warn">{discovered.length} detectado{discovered.length > 1 ? 's' : ''} sin registrar</span>
                    </>
                  )}
                  . Sin latido en {info?.device_timeout_seconds ?? 30} s un dispositivo pasa a “sin señal”.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-[17px] font-semibold mt-1">Modo demo: el simulador está generando los datos</h2>
                <p className="text-[12.5px] text-ink-2 mt-1">
                  Puedes registrar dispositivos desde ahora; quedarán esperando conexión. Al pasar a En vivo se apaga el simulador y solo cuentan los datos reales.
                </p>
                <button className="btn btn-primary btn-sm mt-2" onClick={() => onModeChange('live')}>
                  Pasar a En vivo
                </button>
              </>
            )}
          </div>

          <div className="min-w-[280px] flex-[1.3]">
            <div className="eyebrow mb-1">Dirección del servidor para el firmware</div>
            {info ? (
              <dl className="text-[12.5px]">
                <div className="kv">
                  <dt>Base</dt>
                  <dd className="num flex items-center gap-1">
                    {info.base_url}
                    <CopyButton text={info.base_url} />
                  </dd>
                </div>
                <div className="kv">
                  <dt>Eventos</dt>
                  <dd className="num text-[11.5px]">POST /api/events</dd>
                </div>
                <div className="kv">
                  <dt>Latido</dt>
                  <dd className="num text-[11.5px]">POST /api/devices/&lt;ID&gt;/heartbeat · cada {info.heartbeat_interval_seconds} s</dd>
                </div>
                {info.lan_ips.length > 1 && (
                  <div className="kv">
                    <dt>Otras IP</dt>
                    <dd className="num text-[11.5px]">{info.lan_ips.slice(1).join(' · ')}</dd>
                  </div>
                )}
                <div className="kv">
                  <dt>MQTT</dt>
                  <dd className="text-[11.5px]">
                    {info.mqtt.enabled ? <span className="num">{`${info.mqtt.host}:${info.mqtt.port} · ${info.mqtt.topic_template}`}</span> : 'desactivado (MQTT_ENABLED=false)'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-[12.5px] text-ink-3">No se pudo leer la dirección del servidor.</p>
            )}
            <p className="text-[11.5px] text-ink-3 mt-2 leading-snug">
              El ESP32 debe estar en la misma red y el servidor escuchando en todas las interfaces (<span className="num">--host 0.0.0.0</span>).
            </p>
          </div>
        </div>
      </section>

      {/* Detectados sin registrar */}
      {discovered.length > 0 && (
        <Panel title="Detectados sin registrar" subtitle="Enviaron latido o eventos con un ID que no estaba dado de alta. Asígnalos a una estación.">
          <ul className="divide-y divide-line">
            {discovered.map((d) => (
              <li key={d.device_id} className="py-2 flex items-center gap-3 text-[12.5px]">
                <span className={`chip ${DEVICE_STATUS[d.status].chip}`}>{DEVICE_STATUS[d.status].label}</span>
                <span className="num">{d.device_id}</span>
                <span className="text-ink-3">{ago(d.last_heartbeat)}</span>
                <span className="ml-auto flex gap-1.5">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setForm({ device_id: d.device_id, name: '', type: 'esp32_rfid', station_id: '' });
                      setFormOpen(true);
                    }}
                  >
                    Registrar
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(d)} title="Descartar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Registrados */}
      <Panel
        title="Dispositivos registrados"
        subtitle="Cada uno queda esperando conexión hasta su primer latido. Vincúlalos a sensores desde “Editar interior” de cada área."
        meta={
          <button className="btn btn-sm btn-primary" onClick={() => setFormOpen((o) => !o)}>
            <Plus className="h-3.5 w-3.5" /> Registrar dispositivo
          </button>
        }
      >
        {formOpen && (
          <form onSubmit={register} className="mb-4 border border-ink rounded-[2px] p-3.5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="label">Tipo</label>
              <select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Estación</label>
              <select className="field" value={form.station_id} onChange={(e) => setForm({ ...form, station_id: e.target.value })}>
                <option value="">Sin asignar</option>
                {stations.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {s.line_id} · {s.order_in_line} · {shortStationName(s.name)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">ID del dispositivo</label>
              <input className="field num" placeholder={suggestedId} value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })} />
            </div>
            <div>
              <label className="label">Nombre</label>
              <input className="field" placeholder="p. ej. Lector entrada SMT" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="md:col-span-4 flex items-center gap-2">
              <button type="submit" className="btn btn-primary">
                Registrar y esperar conexión
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>
                Cancelar
              </button>
              {error && <span className="text-[12px] text-bad">{error}</span>}
            </div>
          </form>
        )}

        {real.length === 0 ? (
          <p className="text-[12.5px] text-ink-3 py-6 text-center">
            Aún no hay dispositivos reales. Registra el primero; cualquier ESP32 que mande latido con un ID nuevo también aparecerá arriba como detectado.
          </p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-ink-3 border-b border-line">
                <th className="font-normal pb-1.5 w-6" />
                <th className="font-normal pb-1.5">Estado</th>
                <th className="font-normal pb-1.5">Dispositivo</th>
                <th className="font-normal pb-1.5 hidden md:table-cell">Tipo</th>
                <th className="font-normal pb-1.5 hidden md:table-cell">Estación</th>
                <th className="font-normal pb-1.5">Último latido</th>
                <th className="font-normal pb-1.5 hidden lg:table-cell">Firmware</th>
                <th className="pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {real.map((d) => (
                <React.Fragment key={d.device_id}>
                  <tr className="border-b border-line align-middle">
                    <td className="py-2">
                      <button className="btn btn-ghost btn-icon !w-6 !h-6" onClick={() => setExpanded(expanded === d.device_id ? null : d.device_id)} aria-label="Configuración">
                        {expanded === d.device_id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                    <td className="py-2 pr-2">
                      <span className={`chip ${DEVICE_STATUS[d.status].chip}`}>{DEVICE_STATUS[d.status].label}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{d.name}</div>
                      <div className="num text-[11px] text-ink-3">{d.device_id}</div>
                    </td>
                    <td className="py-2 pr-2 text-ink-2 hidden md:table-cell">{typeLabel(d.type)}</td>
                    <td className="py-2 pr-2 text-ink-2 hidden md:table-cell">
                      <select
                        className="field !h-[26px] !w-auto !text-[12px]"
                        value={d.station_id ?? ''}
                        onChange={(e) => api.updateDevice(d.device_id, { station_id: e.target.value || null } as any).then(onChanged)}
                      >
                        <option value="">—</option>
                        {stations.map((s) => (
                          <option key={s.station_id} value={s.station_id}>
                            {stationName(s.station_id)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2 num text-[11.5px] text-ink-2">{d.status === 'waiting' ? `registrado ${ago(d.created_at)}` : ago(d.last_heartbeat)}</td>
                    <td className="py-2 pr-2 num text-[11.5px] text-ink-3 hidden lg:table-cell">{d.status === 'waiting' ? '—' : d.firmware_version ?? '—'}</td>
                    <td className="py-2 text-right">
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(d)} title="Eliminar">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                  {expanded === d.device_id && (
                    <tr className="border-b border-line bg-paper/50">
                      <td />
                      <td colSpan={7} className="py-3 pr-2">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div>
                            <div className="eyebrow mb-1">Configuración para el firmware</div>
                            <Code>{firmwareConfig(d, info)}</Code>
                          </div>
                          <div>
                            <div className="eyebrow mb-1">Probar sin ESP32 (simula un latido)</div>
                            <Code>{curlTest(d, info)}</Code>
                            <p className="text-[11.5px] text-ink-3 mt-1.5 leading-snug">
                              Si el estado cambia a “conectado”, el servidor es alcanzable. El firmware de referencia está en{' '}
                              <span className="num">hardware/esp32_firmware.ino</span>.
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <BadgesPanel />

      {/* Demo */}
      <section className="panel">
        <button className="w-full panel-head !border-b-0 text-left" onClick={() => setShowDemo((v) => !v)}>
          <span className="flex items-center gap-2">
            {showDemo ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="panel-title">Nodos de demostración</span>
            <span className="text-[11.5px] text-ink-3">{demo.length} simulados · no representan hardware real</span>
          </span>
        </button>
        {showDemo && (
          <div className="px-3.5 pb-3.5">
            <table className="w-full text-[12.5px]">
              <tbody>
                {demo.map((d) => (
                  <tr key={d.device_id} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <span className={`chip ${DEVICE_STATUS[d.status].chip}`}>{DEVICE_STATUS[d.status].label}</span>
                    </td>
                    <td className="py-1.5 pr-2">{d.name}</td>
                    <td className="py-1.5 pr-2 num text-[11px] text-ink-3">{d.device_id}</td>
                    <td className="py-1.5 text-right num text-[11.5px] text-ink-3">{ago(d.last_heartbeat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
