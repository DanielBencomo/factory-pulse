import React, { useState } from 'react';
import { Stop, StopReason } from '../types';
import { api } from '../services/api';
import { Modal } from './Modal';

/** Registrar la causa de un paro (típicamente el que abrió un pulsador). */
export const JustifyStopModal: React.FC<{
  stop: Stop;
  reasons: StopReason[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ stop, reasons, onClose, onSaved }) => {
  const options = reasons.filter((r) => r.code !== 'PEND-01');
  const [code, setCode] = useState(options[0]?.code ?? '');
  const [author, setAuthor] = useState('Supervisor');
  const [notes, setNotes] = useState(stop.notes ?? '');
  const [authorized, setAuthorized] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateStop(stop.id, { reason_code: code, author, notes, is_authorized: authorized });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  };

  return (
    <Modal
      title="Justificar paro"
      subtitle={`${stop.scope_id} · iniciado ${new Date(stop.started_at.endsWith('Z') ? stop.started_at : `${stop.started_at}Z`).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} por ${stop.author}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="justify-form" className="btn btn-primary">
            Guardar causa
          </button>
        </>
      }
    >
      <form id="justify-form" onSubmit={save} className="space-y-3">
        <div>
          <label className="label">Causa</label>
          <select className="field" value={code} onChange={(e) => setCode(e.target.value)}>
            {options.map((r) => (
              <option key={r.code} value={r.code}>
                {r.category}: {r.description}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Responsable</label>
          <input className="field" value={author} onChange={(e) => setAuthor(e.target.value)} required />
        </div>
        <div>
          <label className="label">Notas</label>
          <textarea className="field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
          <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
          Paro justificado: su tiempo no cuenta como espera
        </label>
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </form>
    </Modal>
  );
};
