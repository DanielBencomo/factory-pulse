import React, { useEffect, useState } from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import { Playback, Recording, SystemMode } from '../types';
import { api } from '../services/api';
import { Modal } from './Modal';

const fmtDur = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const fmtDate = (iso: string) =>
  new Date(iso.endsWith('Z') ? iso : `${iso}Z`).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Plan B de la demo: guarda un tramo real (o del simulador) y lo reproduce con la
 * hora actual si un sensor falla frente al jurado.
 */
export const RecordingsModal: React.FC<{
  mode: SystemMode;
  playback: Playback | null;
  onClose: () => void;
  onPlaybackChange: (p: Playback) => void;
  onStop: () => void;
}> = ({ mode, playback, onClose, onPlaybackChange, onStop }) => {
  const [recs, setRecs] = useState<Recording[]>([]);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listRecordings().then((r) => setRecs(r.recordings)).catch(() => setRecs([]));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Grabaciones · plan B" subtitle="Guarda un tramo y reprodúcelo si un sensor falla durante la demostración." onClose={onClose} width="max-w-2xl">
      <div className="space-y-5 text-[12.5px]">
        {mode === 'replay' && playback?.active && (
          <div className="border border-warn/40 bg-warn-soft rounded-[2px] p-3 flex items-center gap-3">
            <span className="flex-1">
              Reproduciendo <b>{playback.name}</b> a {playback.speed}× · {Math.round(playback.progress * 100)}%{playback.loop ? ' · en bucle' : ''}
            </span>
            <button className="btn btn-sm" onClick={onStop}>
              <Square className="h-3.5 w-3.5" /> Detener
            </button>
          </div>
        )}

        <form
          className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.saveRecording(name || `Respaldo ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, minutes)).then(() => setName(''));
          }}
        >
          <div>
            <label className="label">Nombre</label>
            <input className="field" placeholder="p. ej. Ensayo con 2 operadores" value={name} onChange={(e) => setName(e.target.value)} disabled={mode === 'replay'} />
          </div>
          <div>
            <label className="label">Guardar los últimos</label>
            <select className="field" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={mode === 'replay'}>
              {[5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" disabled={busy || mode === 'replay'}>
            Guardar
          </button>
          <p className="sm:col-span-3 text-[11.5px] text-ink-3">
            Se guardan los eventos del modo actual ({mode === 'live' ? 'en vivo' : mode === 'demo' ? 'demo' : 'reproducción'}): posiciones, lecturas RFID, CSI, pulsadores y ciclos.
            Consejo: graba un ensayo completo con los sensores funcionando antes de presentar.
          </p>
        </form>

        {error && <p className="text-bad">{error}</p>}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="eyebrow">Guardadas</span>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              Velocidad
              <select className="field !w-auto !h-[26px]" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {[1, 2, 5].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          {recs.length === 0 ? (
            <p className="text-ink-3 py-4 text-center border border-line rounded-[2px]">Aún no hay grabaciones.</p>
          ) : (
            <ul className="border border-line rounded-[2px] divide-y divide-line">
              {recs.map((r) => {
                const playing = playback?.active && playback.recording_id === r.id;
                return (
                  <li key={r.id} className="px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="num text-[11px] text-ink-3">
                        {fmtDate(r.started_at)} · {fmtDur(r.duration_s)} · {r.event_count} eventos · origen {r.source_mode}
                      </div>
                    </div>
                    {playing ? (
                      <span className="chip chip-warn">reproduciendo</span>
                    ) : (
                      <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => onPlaybackChange(await api.playRecording(r.id, speed, true)))}>
                        <Play className="h-3.5 w-3.5" /> Reproducir
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" disabled={busy || playing} onClick={() => run(() => api.deleteRecording(r.id))} aria-label="Eliminar">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
};
