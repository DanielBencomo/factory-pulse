import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, MapPinned, RefreshCw, Video, WifiOff } from 'lucide-react';
import { FloorPlan, Line, PolygonZone, Station, SystemMode } from '../types';
import { CameraMapEditor } from './CameraMapEditor';

type VisionHealth = {
  ready: boolean;
  version?: string;
  source?: string;
  model?: string;
  fps?: number;
  tracks?: number;
  zones?: number;
  calibrated?: boolean;
  backend_ok?: boolean;
  updated_at?: string;
};

const streamUrl = import.meta.env.VITE_VISION_STREAM_URL || '/vision/annotated.mjpg';
const floorStreamUrl = import.meta.env.VITE_VISION_FLOOR_URL || '/vision/floor.mjpg';
const healthUrl = import.meta.env.VITE_VISION_HEALTH_URL || '/vision/health';

const openStream = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

interface VisionPanelProps {
  mode: SystemMode;
  enableMapping?: boolean;
  floorPlan?: FloorPlan | null;
  zones?: PolygonZone[];
  lines?: Line[];
  stations?: Station[];
  onLayoutChanged?: () => void | Promise<void>;
}

export const VisionPanel: React.FC<VisionPanelProps> = ({
  mode,
  enableMapping = false,
  floorPlan,
  zones = [],
  lines = [],
  stations = [],
  onLayoutChanged = () => undefined,
}) => {
  const [health, setHealth] = useState<VisionHealth | null>(null);
  const [reachable, setReachable] = useState(false);
  const [streamLoaded, setStreamLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mapping, setMapping] = useState(false);
  const wasOnline = useRef(false);
  const streamRetryTimer = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;

    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(healthUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as VisionHealth;
        if (!stopped) {
          setHealth(body);
          setReachable(true);
        }
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) {
          setReachable(false);
        }
      }
    };

    poll();
    const timer = window.setInterval(poll, 3_000);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [retry]);

  useEffect(() => () => {
    if (streamRetryTimer.current !== null) window.clearTimeout(streamRetryTimer.current);
  }, []);

  const liveStream = useMemo(() => {
    const separator = streamUrl.includes('?') ? '&' : '?';
    return `${streamUrl}${separator}session=${retry}`;
  }, [retry]);

  const updatedAt = Date.parse(health?.updated_at ?? '');
  const online = reachable && Boolean(health?.ready) && Number.isFinite(updatedAt) && Date.now() - updatedAt < 8_000;
  const statusLabel = online ? 'Visión activa' : reachable ? 'Sin cuadros recientes' : 'Visión sin conexión';

  useEffect(() => {
    if (online && !wasOnline.current) {
      setStreamLoaded(false);
      setRetry((value) => value + 1);
    }
    wasOnline.current = online;
  }, [online]);

  const restart = () => {
    if (streamRetryTimer.current !== null) {
      window.clearTimeout(streamRetryTimer.current);
      streamRetryTimer.current = null;
    }
    setStreamLoaded(false);
    setHealth(null);
    setRetry((value) => value + 1);
  };

  return (
    <section className="panel flex flex-col min-w-0 overflow-hidden">
      <header className="panel-head !items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Video size={15} aria-hidden="true" />
            <h2 className="panel-title">Cámara · visión artificial</h2>
          </div>
          <p className="text-[11.5px] text-ink-3 mt-0.5 leading-snug">
            YOLO + ByteTrack · IDs anónimos · el video no se almacena
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <span className={`chip ${online ? 'chip-ok' : 'chip-muted'}`}>
            <span className={`dot ${online ? 'bg-ok' : 'bg-ink-4'}`} />
            {statusLabel}
          </span>
          {online && <span className="chip chip-muted num">{health?.fps?.toFixed(1) ?? '—'} FPS</span>}
          {online && <span className="chip chip-brand num">{health?.tracks ?? 0} personas</span>}
        </div>
      </header>

      <div className="relative bg-[#111820] aspect-video min-h-[260px] flex items-center justify-center overflow-hidden">
        <img
          key={liveStream}
          src={liveStream}
          alt="Video de cámara con detecciones anónimas, zonas y bounding boxes"
          className={`w-full h-full object-contain transition-opacity ${streamLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => {
            setStreamLoaded(true);
            if (streamRetryTimer.current !== null) {
              window.clearTimeout(streamRetryTimer.current);
              streamRetryTimer.current = null;
            }
          }}
          onError={() => {
            setStreamLoaded(false);
            if (streamRetryTimer.current === null) {
              streamRetryTimer.current = window.setTimeout(() => {
                streamRetryTimer.current = null;
                setRetry((value) => value + 1);
              }, 2_000);
            }
          }}
        />
        {(!online || !streamLoaded) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111820] text-white/75 px-6 text-center">
            {online ? <RefreshCw size={30} strokeWidth={1.5} className="animate-spin" aria-hidden="true" /> : <WifiOff size={30} strokeWidth={1.5} aria-hidden="true" />}
            <div>
              <p className="text-[13px] font-medium text-white">{online ? 'Reconectando video…' : 'Proveedor de visión no disponible'}</p>
              <p className="text-[11.5px] mt-1 text-white/60">
                {online ? 'El proveedor responde; restableciendo la transmisión.' : <>Inicia <span className="font-mono">hardware/local_vision_provider.py</span> en el puerto 8001.</>}
              </p>
            </div>
            {!online && (
              <button type="button" className="btn btn-sm" onClick={restart}>
                <RefreshCw size={13} /> Reintentar
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="px-3.5 py-2.5 border-t border-line flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
        <span>{health?.calibrated ? `${health.zones ?? 0} zonas proyectadas` : 'Calibración de piso pendiente'}</span>
        {mode !== 'live' && online && (
          <span className="text-warn">El dashboard está en Demo; cambia a En vivo para recibir tracks.</span>
        )}
        {online && health?.backend_ok === false && (
          <span className="text-bad">La cámara funciona, pero no alcanza el backend.</span>
        )}
        <div className="ml-auto flex gap-1.5">
          {enableMapping && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!online || !health?.calibrated || !floorPlan}
              title={!health?.calibrated ? 'Primero calibra cuatro puntos del piso' : 'Dibujar departamentos, zonas o líneas'}
              onClick={() => setMapping(true)}
            >
              <MapPinned size={12} /> Mapear áreas
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => openStream(floorStreamUrl)}>
            Plano en otra ventana <ExternalLink size={12} />
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => openStream(streamUrl)}>
            Cámara en otra ventana <ExternalLink size={12} />
          </button>
        </div>
      </footer>
      {mapping && floorPlan && (
        <CameraMapEditor
          floorPlan={floorPlan}
          zones={zones}
          lines={lines}
          stations={stations}
          onClose={() => setMapping(false)}
          onSaved={onLayoutChanged}
        />
      )}
    </section>
  );
};
