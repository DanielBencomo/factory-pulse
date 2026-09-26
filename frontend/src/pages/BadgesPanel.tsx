import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge } from '../types';
import { api } from '../services/api';
import { Panel } from '../components/DashboardGrid';

type Unknown = { tag_id: string; last_seen: string; station_id?: string; reads: number };

/**
 * Tarjetas RFID → persona. La identidad solo aparece en las lecturas de checkpoint;
 * las trayectorias de la cámara siguen siendo anónimas.
 */
export const BadgesPanel: React.FC = () => {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [unknown, setUnknown] = useState<Unknown[]>([]);
  const [form, setForm] = useState<Badge>({ tag_id: '', person: '', role: '' });
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .listBadges()
      .then((r) => {
        setBadges(r.badges);
        setUnknown(r.unknown);
      })
      .catch(() => undefined);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000); // una tarjeta nueva aparece sola al leerse
    return () => clearInterval(id);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.saveBadge({ ...form, role: form.role || null });
      setForm({ tag_id: '', person: '', role: '' });
      load();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  };

  return (
    <Panel
      title="Tarjetas RFID"
      subtitle="Asocia cada tarjeta a una persona. La identidad solo se usa al pasar por un checkpoint; las trayectorias de la cámara siguen anónimas."
    >
      {unknown.length > 0 && (
        <div className="mb-3 border border-warn/40 bg-warn-soft rounded-[2px] p-2.5">
          <div className="text-[12px] font-medium text-warn mb-1.5">Tarjetas leídas sin dueño</div>
          <ul className="space-y-1">
            {unknown.map((u) => (
              <li key={u.tag_id} className="flex items-center gap-2 text-[12px]">
                <span className="num">{u.tag_id}</span>
                <span className="text-ink-3">
                  {u.reads} lectura{u.reads > 1 ? 's' : ''}
                  {u.station_id ? ` · ${u.station_id}` : ''}
                </span>
                <button className="btn btn-sm ml-auto" onClick={() => setForm({ tag_id: u.tag_id, person: '', role: '' })}>
                  Asignar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_1fr_auto] gap-2 items-end mb-3">
        <div>
          <label className="label">UID de la tarjeta</label>
          <input className="field num" placeholder="04:A1:B2:C3" value={form.tag_id} onChange={(e) => setForm({ ...form, tag_id: e.target.value })} required />
        </div>
        <div>
          <label className="label">Persona</label>
          <input className="field" placeholder="Nombre" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} required />
        </div>
        <div>
          <label className="label">Rol</label>
          <input className="field" placeholder="Operador, materialista…" value={form.role ?? ''} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        </div>
        <button className="btn btn-primary">Guardar</button>
        {error && <p className="md:col-span-4 text-[12px] text-bad">{error}</p>}
      </form>

      {badges.length === 0 ? (
        <p className="text-[12.5px] text-ink-3 py-3 text-center">Sin tarjetas registradas.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-ink-3 border-b border-line">
              <th className="font-normal pb-1.5">Tarjeta</th>
              <th className="font-normal pb-1.5">Persona</th>
              <th className="font-normal pb-1.5">Rol</th>
              <th className="pb-1.5" />
            </tr>
          </thead>
          <tbody>
            {badges.map((b) => (
              <tr key={b.tag_id} className="border-b border-line last:border-0">
                <td className="py-1.5 num text-[11.5px]">{b.tag_id}</td>
                <td className="py-1.5">{b.person}</td>
                <td className="py-1.5 text-ink-2">{b.role ?? '—'}</td>
                <td className="py-1.5 text-right">
                  <button className="btn btn-sm btn-ghost" onClick={() => api.deleteBadge(b.tag_id).then(load)} aria-label="Eliminar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
};
