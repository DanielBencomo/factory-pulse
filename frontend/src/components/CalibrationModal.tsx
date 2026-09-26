import React, { useState } from 'react';
import { ScaleCalibration } from '../types';
import { Modal } from './Modal';

interface CalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  calibration: ScaleCalibration;
  onSave: (calib: ScaleCalibration) => Promise<void>;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({ isOpen, onClose, calibration, onSave }) => {
  const [realMeters, setRealMeters] = useState<number>(calibration.real_distance_meters || 36.0);
  const [isCalibrated, setIsCalibrated] = useState<boolean>(calibration.is_calibrated || true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const p1 = calibration.point1 || [0.05, 0.5];
      const p2 = calibration.point2 || [0.95, 0.5];
      const normDist = Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
      const metersPerNorm = normDist > 0 ? realMeters / normDist : 40.0;

      await onSave({
        is_calibrated: isCalibrated,
        point1: p1,
        point2: p2,
        real_distance_meters: realMeters,
        meters_per_norm_unit: Number(metersPerNorm.toFixed(2)),
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Calibrar escala"
      subtitle="Convierte coordenadas normalizadas de la cámara a metros."
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn">
            Cancelar
          </button>
          <button type="submit" form="calib-form" disabled={isSaving} className="btn btn-primary">
            {isSaving ? 'Guardando…' : 'Aplicar'}
          </button>
        </>
      }
    >
      <form id="calib-form" onSubmit={handleSave} className="space-y-4">
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
          <input type="checkbox" checked={isCalibrated} onChange={(e) => setIsCalibrated(e.target.checked)} />
          Reportar distancias en metros
        </label>

        <div>
          <label className="label" htmlFor="calib-m">
            Distancia real entre P1 y P2 (m)
          </label>
          <input id="calib-m" type="number" step="0.5" value={realMeters} onChange={(e) => setRealMeters(Number(e.target.value))} className="field num" required />
        </div>

        <dl className="text-[12.5px]">
          <div className="kv">
            <dt>P1 · extremo oeste de la línea</dt>
            <dd className="num">(0.05, 0.50)</dd>
          </div>
          <div className="kv">
            <dt>P2 · extremo este de la línea</dt>
            <dd className="num">(0.95, 0.50)</dd>
          </div>
          <div className="kv">
            <dt>Factor resultante</dt>
            <dd className="num">{(realMeters / 0.9).toFixed(1)} m / unidad</dd>
          </div>
        </dl>
      </form>
    </Modal>
  );
};
