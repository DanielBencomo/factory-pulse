import React, { useState } from 'react';
import { OctagonAlert } from 'lucide-react';
import { Line, PolygonZone, Station, Stop, StopScope, StopReason } from '../types';
import { Modal } from './Modal';
import { shortStationName } from '../layout/geometry';

interface StopsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (stopData: Partial<Stop>) => Promise<void>;
  stopReasons: StopReason[];
  lines: Line[];
  stations: Station[];
  zones: PolygonZone[];
  defaultLineId?: string;
}

export const StopsModal: React.FC<StopsModalProps> = ({ isOpen, onClose, onSubmit, stopReasons, lines, stations, zones, defaultLineId }) => {
  const [scopeType, setScopeType] = useState<StopScope>('line');
  const [scopeId, setScopeId] = useState<string>(defaultLineId ?? 'line-1');
  const otherZones = zones.filter((z) => z.type !== 'work');
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
    if (found) setReason(found.description);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        scope_type: scopeType,
        scope_id: scopeId,
        reason_code: reasonCode,
        reason,
        author,
        started_at: new Date().toISOString(),
        is_authorized: isAuthorized,
        notes,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title="Declarar paro"
      subtitle="El intervalo se excluye del tiempo planificado sin borrar eventos."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn">
            Cancelar
          </button>
          <button type="submit" form="stop-form" disabled={isSubmitting} className="btn btn-danger">
            <OctagonAlert className="h-3.5 w-3.5" />
            {isSubmitting ? 'Registrando…' : 'Iniciar paro'}
          </button>
        </>
      }
    >
      <form id="stop-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="stop-scope">Alcance</label>
            <select
              id="stop-scope"
              value={scopeType}
              onChange={(e) => {
                const t = e.target.value as StopScope;
                setScopeType(t);
                setScopeId(
                  t === 'line' ? defaultLineId ?? lines[0]?.id ?? '' : t === 'station' ? stations[0]?.station_id ?? '' : t === 'zone' ? otherZones[0]?.zone_id ?? '' : 'plant',
                );
              }}
              className="field"
            >
              <option value="line">Línea de producción</option>
              <option value="station">Estación</option>
              <option value="zone">Zona de planta</option>
              <option value="plant">Planta completa</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="stop-target">Identificador</label>
            <select id="stop-target" value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="field" disabled={scopeType === 'plant'}>
              {scopeType === 'plant' && <option value="plant">Toda la planta</option>}
              {scopeType === 'line' &&
                lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              {scopeType === 'station' &&
                stations.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {lines.find((l) => l.id === s.line_id)?.name ?? s.line_id} · {s.order_in_line} · {shortStationName(s.name)}
                  </option>
                ))}
              {scopeType === 'zone' &&
                otherZones.map((z) => (
                  <option key={z.zone_id} value={z.zone_id}>
                    {z.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="stop-reason">Causa</label>
          <select id="stop-reason" value={reasonCode} onChange={(e) => handleReasonChange(e.target.value)} className="field">
            {stopReasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} — {r.category}: {r.description}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="stop-desc">Justificación</label>
          <input id="stop-desc" type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="field" required />
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="label" htmlFor="stop-author">Responsable</label>
            <input id="stop-author" type="text" value={author} onChange={(e) => setAuthor(e.target.value)} className="field" required />
          </div>
          <label className="flex items-center gap-2 h-[30px] text-[12.5px] cursor-pointer">
            <input type="checkbox" checked={isAuthorized} onChange={(e) => setIsAuthorized(e.target.checked)} />
            Paro justificado (se descuenta)
          </label>
        </div>

        <div>
          <label className="label" htmlFor="stop-notes">Notas</label>
          <textarea
            id="stop-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Detalle técnico o requerimiento"
            className="field"
          />
        </div>

        <p className="text-[12px] text-ink-3 leading-snug border-l-2 border-line-2 pl-3">
          La duración se resta del tiempo planificado ajustado mediante unión de intervalos; si dos paros se traslapan no se
          descuenta dos veces.
        </p>
      </form>
    </Modal>
  );
};
