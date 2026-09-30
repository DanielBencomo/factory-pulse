import React from 'react';
import { Activity, ChevronRight, MapPin, Route, ShieldCheck, Users } from 'lucide-react';
import { SpatialLayer, SpatialSummary } from '../types';
import { C } from '../theme';

interface Props {
  data: SpatialSummary | null;
  error?: string | null;
  onRetry?: () => void;
  onExplore: (zoneId: string | null, layer: SpatialLayer) => void;
}

const fmt = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? '—' : value.toLocaleString('es-MX', { maximumFractionDigits: digits });

const toneClass = (tone: 'good' | 'info' | 'attention') =>
  tone === 'good' ? 'chip-ok' : tone === 'attention' ? 'chip-warn' : 'chip-info';

export const SpatialInsightsPanel: React.FC<Props> = ({ data, error, onRetry, onExplore }) => {
  if (error) {
    return (
      <section className="panel h-full min-h-[560px] flex items-center justify-center p-7 text-center">
        <div>
          <div className="text-[13px] font-medium text-bad">No se pudo leer la analítica espacial</div>
          <p className="text-[12px] text-ink-3 mt-1.5">{error}</p>
          {onRetry && <button className="btn btn-sm mt-3" onClick={onRetry}>Reintentar</button>}
        </div>
      </section>
    );
  }
  if (!data) {
    return <section className="panel h-full min-h-[560px] flex items-center justify-center text-[12.5px] text-ink-3">Calculando flujo espacial…</section>;
  }

  const s = data.summary;
  const visibleZones = data.zones.slice(0, 5);
  const cards = [
    { label: 'Personas ahora', value: fmt(s.current_people), detail: `pico ${fmt(s.peak_occupancy)}`, icon: Users, color: C.brand },
    { label: 'Persona·min', value: fmt(s.observed_person_minutes, 1), detail: `promedio ${fmt(s.average_occupancy, 1)}`, icon: Activity, color: C.info },
    { label: 'Distancia', value: `${fmt(s.distance_m, 0)} m`, detail: s.distance_per_person_hour_m == null ? 'sin base suficiente' : `${fmt(s.distance_per_person_hour_m, 0)} m/persona·h`, icon: Route, color: C.accent },
    { label: 'Cobertura', value: `${fmt(s.coverage_pct, 0)}%`, detail: s.fresh ? 'dato reciente' : 'dato no reciente', icon: ShieldCheck, color: s.coverage_pct >= 80 ? C.ok : C.warn },
  ];

  return (
    <section className="panel h-full min-h-[560px] flex flex-col">
      <header className="panel-head">
        <div>
          <h2 className="panel-title">Pulso espacial</h2>
          <p className="text-[11.5px] text-ink-3 mt-0.5">{data.scope.label} · últimos {data.window.minutes} min</p>
        </div>
        <span className={`chip ${s.fresh ? 'chip-ok' : 'chip-warn'}`}>{s.fresh ? 'actualizado' : 'sin dato reciente'}</span>
      </header>

      <div className="grid grid-cols-2 border-b border-line">
        {cards.map(({ label, value, detail, icon: Icon, color }) => (
          <div key={label} className="px-3.5 py-3 border-r border-b border-line even:border-r-0 last:border-b-0 [&:nth-last-child(2)]:border-b-0">
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <Icon className="h-3.5 w-3.5" style={{ color }} /> {label}
            </div>
            <div className="num text-[22px] leading-none mt-1.5" style={{ color }}>{value}</div>
            <div className="text-[10.5px] text-ink-3 mt-1">{detail}</div>
          </div>
        ))}
      </div>

      <div className="px-3.5 pt-3 pb-2 border-b border-line">
        <div className="flex items-baseline justify-between gap-2">
          <div className="eyebrow">Ocupación por zona</div>
          <button className="text-[11px] text-brand hover:underline" onClick={() => onExplore(null, 'dwell')}>ver permanencia</button>
        </div>
        {visibleZones.length === 0 ? (
          <p className="text-[12px] text-ink-3 py-3">No hay zonas dentro de este alcance.</p>
        ) : (
          <table className="w-full text-[11.5px] mt-1.5">
            <thead>
              <tr className="text-ink-3 border-b border-line">
                <th className="font-normal text-left pb-1">Zona</th>
                <th className="font-normal text-right pb-1">ahora</th>
                <th className="font-normal text-right pb-1">prom.</th>
                <th className="font-normal text-right pb-1">pico/cap.</th>
              </tr>
            </thead>
            <tbody>
              {visibleZones.map((zone) => {
                const over = zone.max_capacity != null && zone.peak_occupancy > zone.max_capacity;
                return (
                  <tr key={zone.zone_id} className="border-b border-line last:border-0 cursor-pointer hover:bg-sunken" onClick={() => onExplore(zone.zone_id, 'zones')}>
                    <td className="py-1.5 pr-2 max-w-[150px] truncate" title={zone.name}>
                      <span className="inline-flex items-center gap-1.5"><MapPin className="h-3 w-3 text-ink-4" />{zone.name}</span>
                    </td>
                    <td className="py-1.5 text-right num">{zone.current_count ?? '—'}</td>
                    <td className="py-1.5 text-right num text-ink-3">{fmt(zone.average_occupancy, 1)}</td>
                    <td className={`py-1.5 text-right num ${over ? 'text-bad font-medium' : 'text-ink-3'}`}>
                      {zone.peak_occupancy}/{zone.max_capacity ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-3.5 py-3 flex-1 min-h-0">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <div className="eyebrow">Qué conviene revisar</div>
          <span className="text-[10.5px] text-ink-4">observaciones, no diagnósticos</span>
        </div>
        {data.insights.length === 0 ? (
          <p className="text-[12px] text-ink-3 py-2">Aún no hay evidencia suficiente para generar observaciones.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.insights.slice(0, 4).map((insight) => (
              <li key={insight.id}>
                <button className="w-full text-left py-2.5 group" onClick={() => onExplore(insight.scope_id ?? null, insight.layer)}>
                  <div className="flex items-start gap-2">
                    <span className={`chip ${toneClass(insight.tone)} !h-[18px] mt-0.5`}>{insight.tone === 'attention' ? 'revisar' : insight.tone === 'good' ? 'estable' : 'dato'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-[12.5px] font-medium">
                        <span>{insight.title}</span><ChevronRight className="h-3.5 w-3.5 text-ink-4 group-hover:text-brand" />
                      </div>
                      <p className="text-[11px] leading-snug text-ink-3 mt-0.5">{insight.evidence}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-3.5 py-2.5 border-t border-line text-[10.5px] text-ink-3 leading-snug">
        Sin rostro ni identidad. Quietud y permanencia describen movimiento observado; no califican productividad.
      </div>
    </section>
  );
};
