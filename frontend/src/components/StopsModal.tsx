import React, { useState } from 'react';
import { AlertOctagon, Clock, ShieldCheck, X } from 'lucide-react';
import { Stop, StopScope, StopReason } from '../types';

interface StopsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (stopData: Partial<Stop>) => Promise<void>;
  stopReasons: StopReason[];
}

export const StopsModal: React.FC<StopsModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  stopReasons,
}) => {
  const [scopeType, setScopeType] = useState<StopScope>('line');
  const [scopeId, setScopeId] = useState<string>('line-1');
  const [reasonCode, setReasonCode] = useState<string>('MAN-01');
  const [reason, setReason] = useState<string>('Mantenimiento preventivo programado');
  const [author, setAuthor] = useState<string>('Supervisor Turno');
  const [isAuthorized, setIsAuthorized] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleReasonChange = (code: string) => {
    setReasonCode(code);
    const found = stopReasons.find((r) => r.code === code);
    if (found) {
      setReason(found.description);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        scope_type: scopeType,
        scope_id: scopeId,
        reason_code: reasonCode,
        reason: reason,
        author: author,
        started_at: new Date().toISOString(),
        is_authorized: isAuthorized,
        notes: notes,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-rose-500/20 text-rose-400 rounded-lg">
              <AlertOctagon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Declarar Paro de Operación</h3>
              <p className="text-xs text-slate-400">Exclusión auditable del tiempo planificado ajustado</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="py-4 space-y-4 text-xs">
          {/* Scope Type and ID */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Alcance del Paro:</label>
              <select
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value as StopScope)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-rose-500"
              >
                <option value="line">Línea de Producción</option>
                <option value="station">Estación Específica</option>
                <option value="zone">Zona de Planta</option>
                <option value="plant">Planta Completa</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">Identificador de Alcance:</label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-rose-500"
              >
                <option value="line-1">Línea 1 (Principal)</option>
                <option value="st-1">Estación 1 (SMT)</option>
                <option value="st-2">Estación 2 (Reflow)</option>
                <option value="st-3">Estación 3 (AOI)</option>
                <option value="st-4">Estación 4 (Empaque)</option>
                <option value="zone-storage">Almacén de Materiales</option>
              </select>
            </div>
          </div>

          {/* Reason Code and Description */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Motivo Estandarizado:</label>
            <select
              value={reasonCode}
              onChange={(e) => handleReasonChange(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-rose-500"
            >
              {stopReasons.map((r) => (
                <option key={r.code} value={r.code}>
                  [{r.code}] {r.category}: {r.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">Descripción / Justificación:</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-rose-500"
              required
            />
          </div>

          {/* Author and Authorization */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Autor / Responsable:</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-rose-500"
                required
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAuthorized}
                  onChange={(e) => setIsAuthorized(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-rose-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">Paro Autorizado (Deducción)</span>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Notas Adicionales:</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Detalle técnico de la falla o requerimiento..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg text-slate-400 flex items-start gap-2">
            <Clock className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
            <span>
              <b>Regla de Auditoría:</b> Al declarar este paro, se restará su duración del <i>Tiempo Planificado Ajustado</i> mediante la unión de intervalos sin borrar ningún evento crudo de telemetría.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold shadow-lg shadow-rose-600/30 flex items-center gap-1.5"
            >
              <AlertOctagon className="h-4 w-4" />
              <span>{isSubmitting ? 'Registrando...' : 'Iniciar Paro Ahora'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
