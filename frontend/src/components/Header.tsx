import React from 'react';
import { OctagonAlert } from 'lucide-react';
import { Line, Playback, SystemMode } from '../types';

interface HeaderProps {
  title: string;
  lines: Line[];
  lineId: string;
  onLineChange: (id: string) => void;
  windowMinutes: number;
  onWindowChange: (minutes: number) => void;
  mode: SystemMode;
  onModeChange: (mode: SystemMode) => void;
  playback?: Playback | null;
  isWsConnected: boolean;
  openStopsCount: number;
  onDeclareStop: () => void;
  showContext?: boolean;
}

// Encabezado de página: contexto (línea, ventana, fuente de datos) y la única
// acción urgente, declarar un paro. Todo lo demás vive en la barra lateral.
export const Header: React.FC<HeaderProps> = ({
  title,
  lines,
  lineId,
  onLineChange,
  windowMinutes,
  onWindowChange,
  mode,
  onModeChange,
  playback,
  isWsConnected,
  openStopsCount,
  onDeclareStop,
  showContext = true,
}) => (
  <header className="bg-surface border-b border-line sticky top-0 z-30">
    <div className="px-4 lg:px-6 min-h-14 py-2 flex flex-wrap items-center gap-x-5 gap-y-2">
      <h1 className="text-[17px] font-semibold tracking-tight mr-auto" style={{ fontStretch: '88%' }}>
        {title}
      </h1>

      {showContext && (
        <div className="flex items-center gap-2">
          <select className="field !w-auto" value={lineId} onChange={(e) => onLineChange(e.target.value)} aria-label="Línea">
            {[...lines]
              .sort((a, b) => a.order - b.order)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
          <select className="field !w-auto" value={windowMinutes} onChange={(e) => onWindowChange(Number(e.target.value))} aria-label="Ventana de análisis">
            <option value={15}>Últimos 15 min</option>
            <option value={30}>Últimos 30 min</option>
            <option value={60}>Última hora</option>
            <option value={240}>Últimas 4 h</option>
            <option value={480}>Turno (8 h)</option>
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="seg" role="group" aria-label="Fuente de datos">
          <button aria-pressed={mode === 'demo'} onClick={() => onModeChange('demo')} title="El simulador genera datos de ejemplo">
            Demo
          </button>
          <button aria-pressed={mode === 'live'} onClick={() => onModeChange('live')} title="Solo datos de dispositivos reales">
            En vivo
          </button>
          {mode === 'replay' && (
            <button aria-pressed title={playback?.name ? `Reproduciendo “${playback.name}”` : 'Reproduciendo una grabación'}>
              Reproducción{playback?.active ? ` ${Math.round(playback.progress * 100)}%` : ''}
            </button>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3" title="Conexión con el servidor">
          <span className="dot" style={{ background: isWsConnected ? 'var(--color-ok)' : 'var(--color-bad)' }} />
          <span className="hidden sm:inline">{isWsConnected ? 'Servidor' : 'Sin servidor'}</span>
        </span>
      </div>

      <button onClick={onDeclareStop} className="btn btn-danger">
        <OctagonAlert className="h-3.5 w-3.5" />
        Declarar paro
        {openStopsCount > 0 && <span className="num text-[11px] bg-white/20 px-1.5 rounded-sm">{openStopsCount}</span>}
      </button>
    </div>
  </header>
);
