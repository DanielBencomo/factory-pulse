import React, { useState } from 'react';
import { Ruler, X, CheckCircle2 } from 'lucide-react';
import { ScaleCalibration } from '../types';

interface CalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  calibration: ScaleCalibration;
  onSave: (calib: ScaleCalibration) => Promise<void>;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({
  isOpen,
  onClose,
  calibration,
  onSave,
}) => {
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
              <Ruler className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Calibración de Escala del Plano</h3>
              <p className="text-xs text-slate-400">Conversión estricta de coordenadas [0..1] a metros</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="py-4 space-y-4 text-xs">
          <div className="flex items-center gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
            <input
              type="checkbox"
              id="isCalib"
              checked={isCalibrated}
              onChange={(e) => setIsCalibrated(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
            />
            <label htmlFor="isCalib" className="text-slate-200 font-semibold cursor-pointer">
              Habilitar Conversión a Metros Calibrados
            </label>
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">
              Distancia Real de Referencia (Metros entre P1 y P2):
            </label>
            <input
              type="number"
              step="0.5"
              value={realMeters}
              onChange={(e) => setRealMeters(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white font-mono"
              required
            />
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300">Puntos de Referencia Fijos:</div>
            <div>• Punto 1: (0.05, 0.50) [Extremo Oeste Línea 1]</div>
            <div>• Punto 2: (0.95, 0.50) [Extremo Este Línea 1]</div>
            <div className="text-indigo-400 pt-1 font-mono">
              Factor Resultante: {(realMeters / 0.9).toFixed(1)} metros por unidad normalizada
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow"
            >
              {isSaving ? 'Guardando...' : 'Aplicar Calibración'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
