import React from 'react';
import { Map, BarChart3, Bell, Cpu, PencilRuler, Play, Ruler, Boxes, Download, History } from 'lucide-react';

export type Page = 'planta' | 'metricas' | 'eventos' | 'dispositivos' | 'layout';

export const PAGES: { id: Page; label: string; title: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'planta', label: 'Planta', title: 'Planta en vivo', icon: Map },
  { id: 'metricas', label: 'Métricas', title: 'Métricas de la línea', icon: BarChart3 },
  { id: 'eventos', label: 'Paros y alertas', title: 'Paros y alertas', icon: Bell },
  { id: 'dispositivos', label: 'Dispositivos', title: 'Dispositivos y conexión', icon: Cpu },
  { id: 'layout', label: 'Layout', title: 'Layout de planta', icon: PencilRuler },
];

interface SidebarProps {
  page: Page;
  onNavigate: (p: Page) => void;
  alertsNew: number;
  openStops: number;
  devicesOnline: number;
  devicesReal: number;
  devicesPending: number;
  simulatorAvailable: boolean;
  onOpenSimulator: () => void;
  onOpenRecordings: () => void;
  onOpenCalibration: () => void;
  onOpenModules: () => void;
  onOpenExport: () => void;
}

const Item: React.FC<{ active?: boolean; onClick: () => void; icon: React.FC<{ className?: string }>; children: React.ReactNode; badge?: React.ReactNode; disabled?: boolean; title?: string }> = ({
  active,
  onClick,
  icon: Icon,
  children,
  badge,
  disabled,
  title,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-current={active ? 'page' : undefined}
    className={`relative w-full flex items-center gap-2.5 px-3 h-9 rounded-[3px] text-[13px] text-left transition-colors ${
      active
        ? 'bg-white/[0.13] text-white font-medium'
        : disabled
          ? 'text-white/40 cursor-default'
          : 'text-white/75 hover:bg-white/[0.07] hover:text-white'
    }`}
  >
    {/* marca de la sección activa */}
    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-[#e8894f]" aria-hidden="true" />}
    <Icon className="h-4 w-4 shrink-0" />
    <span className="flex-1 truncate">{children}</span>
    {badge}
  </button>
);

const Badge: React.FC<{ tone: 'warn' | 'bad' | 'muted' | 'ok'; children: React.ReactNode; active?: boolean }> = ({ tone, children }) => (
  <span className={`chip chip-${tone} !h-[18px] !border-transparent`}>{children}</span>
);

export const Sidebar: React.FC<SidebarProps> = ({
  page,
  onNavigate,
  alertsNew,
  openStops,
  devicesOnline,
  devicesReal,
  devicesPending,
  simulatorAvailable,
  onOpenSimulator,
  onOpenRecordings,
  onOpenCalibration,
  onOpenModules,
  onOpenExport,
}) => (
  <aside className="lg:w-[216px] shrink-0 bg-brand-deep text-white lg:h-screen lg:sticky lg:top-0 flex lg:flex-col">
    <div className="hidden lg:flex items-center gap-2 px-4 h-14 border-b border-white/10">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="0.5" y="0.5" width="17" height="17" fill="none" stroke="rgba(255,255,255,0.85)" />
        <path d="M2 11h3.5l2-6 3 9 2-3H16" fill="none" stroke="#e8894f" strokeWidth="1.6" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-white" style={{ fontStretch: '85%' }}>
        Factory Pulse
      </span>
    </div>

    <nav className="flex lg:flex-col gap-0.5 p-2 overflow-x-auto lg:overflow-visible flex-1" aria-label="Secciones">
      {PAGES.map((p) => {
        const active = page === p.id;
        const badge =
          p.id === 'eventos' && (alertsNew || openStops) ? (
            <Badge tone={openStops ? 'bad' : 'warn'} active={active}>
              {openStops ? `${openStops} paro` : alertsNew}
            </Badge>
          ) : p.id === 'dispositivos' && (devicesReal || devicesPending) ? (
            <Badge tone={devicesPending ? 'warn' : devicesOnline === devicesReal ? 'ok' : 'muted'} active={active}>
              {devicesPending ? `+${devicesPending}` : `${devicesOnline}/${devicesReal}`}
            </Badge>
          ) : null;
        return (
          <div key={p.id} className="shrink-0 lg:shrink">
            <Item active={active} onClick={() => onNavigate(p.id)} icon={p.icon} badge={badge}>
              {p.label}
            </Item>
          </div>
        );
      })}

      <div className="hidden lg:block mt-auto pt-3">
        <div className="eyebrow px-3 pb-1.5 !text-white/55">Herramientas</div>
        <Item
          onClick={onOpenSimulator}
          icon={Play}
          disabled={!simulatorAvailable}
          title={simulatorAvailable ? undefined : 'Disponible solo en modo Demo'}
        >
          Simulador
        </Item>
        <Item onClick={onOpenRecordings} icon={History}>
          Grabaciones · plan B
        </Item>
        <Item onClick={onOpenCalibration} icon={Ruler}>
          Calibrar escala
        </Item>
        <Item onClick={onOpenModules} icon={Boxes}>
          Módulos
        </Item>
        <Item onClick={onOpenExport} icon={Download}>
          Exportar CSV
        </Item>
      </div>
    </nav>
  </aside>
);
