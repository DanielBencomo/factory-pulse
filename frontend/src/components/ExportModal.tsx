import React from 'react';
import { Download, FileText, Database, X } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Exportación de Datos CSV</h3>
              <p className="text-xs text-slate-400">Descarga auditable con marcas de tiempo UTC y unidades</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="py-4 space-y-3 text-xs">
          {/* Export Events CSV */}
          <a
            href="/api/export/events.csv?hours=24"
            download
            className="flex items-center justify-between p-3.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl transition-all group"
          >
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-cyan-400" />
              <div>
                <div className="font-bold text-white group-hover:text-cyan-400">Telemetría de Eventos Crudos (CSV)</div>
                <div className="text-[11px] text-slate-400">Posiciones, ciclos, presencia y estados (24h)</div>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-500 group-hover:text-white" />
          </a>

          {/* Export Stops CSV */}
          <a
            href="/api/export/stops.csv"
            download
            className="flex items-center justify-between p-3.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl transition-all group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-rose-400" />
              <div>
                <div className="font-bold text-white group-hover:text-rose-400">Registro Histórico de Paros (CSV)</div>
                <div className="text-[11px] text-slate-400">Motivos, autores, alcance y duración en segundos</div>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-500 group-hover:text-white" />
          </a>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
