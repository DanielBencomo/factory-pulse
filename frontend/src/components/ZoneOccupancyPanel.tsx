import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck, Users } from 'lucide-react';
import { api } from '../services/api';
import { OccupancySnapshot, SystemMode } from '../types';

export const ZoneOccupancyPanel: React.FC<{ mode: SystemMode }> = ({ mode }) => {
  const [snapshot, setSnapshot] = useState<OccupancySnapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => api.getZoneOccupancy()
      .then((value) => { if (active) { setSnapshot(value); setError(false); } })
      .catch(() => { if (active) setError(true); });
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [mode]);

  const at = snapshot?.at ? Date.parse(snapshot.at.endsWith('Z') ? snapshot.at : `${snapshot.at}Z`) : NaN;
  const fresh = Number.isFinite(at) && Date.now() - at < 20_000;
  const total = snapshot?.total_people ?? 0;

  return (
    <section className="panel">
      <header className="panel-head !items-start">
        <div>
          <div className="flex items-center gap-2"><Users size={15} /><h2 className="panel-title">Personas por área</h2></div>
          <p className="text-[11.5px] text-ink-3 mt-0.5">Conteo actual anónimo · actualización cada 2 s</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`chip ${fresh && !error ? 'chip-ok' : 'chip-muted'}`}>
            <span className={`dot ${fresh && !error ? 'bg-ok' : 'bg-ink-4'}`} />
            {error ? 'Sin backend' : mode === 'live' ? 'En vivo' : mode === 'replay' ? 'Reproducción' : 'Demo'}
          </span>
          <span className="chip chip-brand num">{total} en planta</span>
        </div>
      </header>
      {!snapshot ? (
        <div className="p-5 text-[12.5px] text-ink-3">{error ? 'No se pudo consultar la ocupación.' : 'Leyendo ocupación…'}</div>
      ) : (
        <div className="p-3.5">
          {mode === 'live' && snapshot.zones.every((zone) => zone.count === 0) && (
            <p className="text-[11.5px] text-ink-3 mb-2">Sin señal agregada reciente; los conteos aparecerán al publicar la cámara.</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {snapshot.zones.map((zone) => {
              const over = zone.max_capacity != null && zone.count > zone.max_capacity;
              return (
                <div key={zone.zone_id} className={`border p-2.5 rounded-[2px] ${over ? 'border-bad bg-bad-soft' : 'border-line bg-paper'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11.5px] text-ink-2 leading-tight min-h-[29px]">{zone.name}</div>
                    {zone.is_aggregated_only && <ShieldCheck className="h-3.5 w-3.5 text-ink-3 shrink-0" aria-label="Solo conteo agregado" />}
                  </div>
                  <div className="flex items-end gap-1 mt-1">
                    <span className="num text-[23px] leading-none font-semibold">{zone.count}</span>
                    <span className="text-[10.5px] text-ink-3 mb-0.5">personas</span>
                  </div>
                  {over && <div className="text-[10.5px] text-bad mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> supera capacidad {zone.max_capacity}</div>}
                  {zone.is_aggregated_only && <div className="text-[10px] text-ink-3 mt-1">sin IDs ni trayectorias</div>}
                </div>
              );
            })}
          </div>
          {snapshot.unassigned > 0 && <p className="text-[11px] text-ink-3 mt-2 num">Fuera de áreas marcadas: {snapshot.unassigned}</p>}
        </div>
      )}
    </section>
  );
};
