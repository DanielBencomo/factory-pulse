import React from 'react';
import {
  Activity,
  AlertOctagon,
  Layers,
  Sliders,
  Play,
  Download,
  Ruler,
  Radio,
  Clock,
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { EventMode } from '../types';

interface HeaderProps {
  mode: EventMode;
  onModeChange: (mode: EventMode) => void;
  windowMinutes: number;
  onWindowChange: (minutes: number) => void;
  shiftName: string;
  onShiftChange: (shift: string) => void;
  onOpenStopsModal: () => void;
  onOpenSimulatorModal: () => void;
  onOpenCatalogModal: () => void;
  onOpenAlertsModal: () => void;
  onOpenExportModal: () => void;
  onOpenCalibrationModal: () => void;
  onToggleEditDashboard: () => void;
  isEditingDashboard: boolean;
  activeAlertsCount: number;
  openStopsCount: number;
  isWsConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  onModeChange,
  windowMinutes,
  onWindowChange,
  shiftName,
  onShiftChange,
  onOpenStopsModal,
  onOpenSimulatorModal,
  onOpenCatalogModal,
  onOpenAlertsModal,
  onOpenExportModal,
  onOpenCalibrationModal,
  onToggleEditDashboard,
  isEditingDashboard,
  activeAlertsCount,
  openStopsCount,
  isWsConnected,
}) => {
  return (
    <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40 px-4 py-2.5">
      <div className="max-w-[1920px] mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Logo and Brand */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="h-5 w-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white">FACTORY<span className="text-cyan-400">PULSE</span></span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">v1.0 Hackathon</span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">IoT & Flow Analytics en Línea de Ensamble</p>
          </div>
        </div>

        {/* Status Mode Switcher & Real-time Indicator */}
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => onModeChange('demo')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === 'demo'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ● DEMO SIMULADA
          </button>
          <button
            onClick={() => onModeChange('live')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === 'live'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="inline-block h-3 w-3 mr-1 text-cyan-400 animate-pulse" /> EN VIVO (ESP32)
          </button>
          <button
            onClick={() => onModeChange('replay')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === 'replay'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            REPRODUCCIÓN
          </button>
        </div>

        {/* Window & Shift Filters */}
        <div className="flex items-center gap-2">
          {/* Shift */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-md text-xs border border-slate-700">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={shiftName}
              onChange={(e) => onShiftChange(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="Turno 1 - Matutino" className="bg-slate-900">Turno 1 (06:00 - 14:30)</option>
              <option value="Turno 2 - Vespertino" className="bg-slate-900">Turno 2 (14:30 - 22:30)</option>
            </select>
          </div>

          {/* Time Window */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-md text-xs border border-slate-700">
            <span className="text-slate-400">Ventana:</span>
            <select
              value={windowMinutes}
              onChange={(e) => onWindowChange(Number(e.target.value))}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer font-medium"
            >
              <option value={15} className="bg-slate-900">15 min</option>
              <option value={30} className="bg-slate-900">30 min</option>
              <option value={60} className="bg-slate-900">1 hora</option>
              <option value={240} className="bg-slate-900">4 horas</option>
              <option value={480} className="bg-slate-900">8 horas</option>
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Paros Button */}
          <button
            onClick={onOpenStopsModal}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              openStopsCount > 0
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 animate-pulse'
                : 'bg-rose-950/40 text-rose-300 border border-rose-800/60 hover:bg-rose-900/40'
            }`}
          >
            <AlertOctagon className="h-3.5 w-3.5" />
            <span>Declarar Paro {openStopsCount > 0 && `(${openStopsCount} Activo)`}</span>
          </button>

          {/* Alertas Button */}
          <button
            onClick={onOpenAlertsModal}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeAlertsCount > 0
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30'
                : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
            <span>Alertas ({activeAlertsCount})</span>
          </button>

          {/* Simulator & Escenas */}
          <button
            onClick={onOpenSimulatorModal}
            className="px-3 py-1.5 bg-cyan-950/40 text-cyan-300 border border-cyan-800/60 hover:bg-cyan-900/40 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <Play className="h-3.5 w-3.5 text-cyan-400" />
            <span>Simulador & 8 Escenas</span>
          </button>

          {/* Modulos Catalog */}
          <button
            onClick={onOpenCatalogModal}
            className="px-3 py-1.5 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            <span>Catálogo (8 Familias)</span>
          </button>

          {/* Edit Dashboard */}
          <button
            onClick={onToggleEditDashboard}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isEditingDashboard
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>{isEditingDashboard ? 'Guardar Tablero' : 'Editar Tablero'}</span>
          </button>

          {/* Calibrate scale */}
          <button
            onClick={onOpenCalibrationModal}
            className="p-1.5 bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 rounded-md transition-all"
            title="Calibrar Escala en Metros del Plano"
          >
            <Ruler className="h-3.5 w-3.5" />
          </button>

          {/* Export CSV */}
          <button
            onClick={onOpenExportModal}
            className="p-1.5 bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 rounded-md transition-all"
            title="Exportar Datos a CSV"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
