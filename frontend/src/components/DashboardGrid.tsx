import React from 'react';
import { Alert, Analytics, Device, MetricsSummary, Stop, SystemMode } from '../types';
import { C, STATE_META, STATE_ORDER, statusOf } from '../theme';
import { shortStationName } from '../layout/geometry';

// Paneles compartidos entre páginas. Las cifras salen de /api/analytics (eventos),
// salvo el estado instantáneo de cada estación, que viene de /api/metrics.

export const Panel: React.FC<{ title: string; subtitle?: string; meta?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  meta,
  className = '',
  children,
}) => (
  <section className={`panel flex flex-col min-w-0 ${className}`}>
    <header className="panel-head !items-start">
      <div className="min-w-0">
        <h2 className="panel-title">{title}</h2>
        {subtitle && <p className="text-[11.5px] text-ink-3 mt-0.5 leading-snug">{subtitle}</p>}
      </div>
      {meta}
    </header>
    <div className="p-3.5 flex-1 min-h-0">{children}</div>
  </section>
);

const min = (s: number) => (s / 60).toFixed(1);
const fmtWindow = (a?: Analytics | null) => {
  if (!a) return '';
  const m = Math.round((a.window.end_ms - a.window.start_ms) / 60000);
  return m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)} h` : `${m} min`;
};

/* ───────────── KPIs ───────────── */

// Franja superior de cada KPI: el mismo color que ese concepto tiene en las gráficas.
const KPI_COLOR: Record<string, string> = {
  Productivo: STATE_META.productivo.color,
  Espera: STATE_META.espera.color,
  Ausencia: STATE_META.ausencia.color,
  'Paros justificados': STATE_META.paro.color,
  'Salida de la línea': C.brand,
  'Caminado en la línea': C.accent,
};

export const KpiStrip: React.FC<{ analytics: Analytics | null }> = ({ analytics: a }) => {
  const s = a?.summary;
  const noTime = s && s.available_s < 60; // todo fue paro o sin datos
  const noProcess = s && (!s.has_process_data || noTime);
  const noPos = s && (!s.has_position_data || noTime);
  const pct = (k: 'productivo' | 'espera' | 'ausencia') => (s ? s.pct_of_available[k] : 0);
  const outPct = s && s.line_output_target > 0 ? Math.round((100 * s.line_output) / s.line_output_target) : null;

  // Diferencia contra la ventana anterior del mismo largo (antes / después de una acción de mejora).
  const p = a?.previous_summary;
  const prevOk = !!p && p.available_s >= 60;
  const delta = (cur: number | undefined, prev: number | undefined, unit: string, higherIsBetter: boolean | null) =>
    cur === undefined || prev === undefined ? undefined : { d: cur - prev, unit, higherIsBetter };
  const deltas: Record<string, ReturnType<typeof delta>> = prevOk && s && !noTime
    ? {
        Productivo: s.has_process_data ? delta(s.pct_of_available.productivo, p!.pct_of_available.productivo, 'pp', true) : undefined,
        Espera: s.has_process_data ? delta(s.pct_of_available.espera, p!.pct_of_available.espera, 'pp', false) : undefined,
        Ausencia: delta(s.pct_of_available.ausencia, p!.pct_of_available.ausencia, 'pp', false),
        'Paros justificados': delta(s.stops_minutes, p!.stops_minutes, 'min', null),
        'Salida de la línea': delta(s.line_output, p!.line_output, 'pzs', true),
        'Caminado en la línea': delta(s.distance_m, p!.distance_m, 'm', false),
      }
    : {};

  const items: { label: string; value: string; unit: string; detail: string; tone?: string }[] = [
    {
      label: 'Productivo',
      value: !s || noProcess ? '—' : pct('productivo').toFixed(0),
      unit: noProcess ? '' : '%',
      detail: noTime
        ? 'Sin tiempo disponible: todo fue paro o sin datos'
        : noProcess
          ? 'Sin sensor de proceso no se afirma productividad'
          : 'del tiempo disponible (sin paros ni huecos de datos)',
      tone: C.ok,
    },
    {
      label: 'Espera',
      value: !s || noProcess ? '—' : pct('espera').toFixed(0),
      unit: noProcess ? '' : '%',
      detail: 'operador presente, máquina sin marcha',
      tone: s && pct('espera') > 15 ? C.warn : undefined,
    },
    {
      label: 'Ausencia',
      value: !s || noPos ? '—' : pct('ausencia').toFixed(0),
      unit: noPos ? '' : '%',
      detail: noPos ? 'Sin datos de la cámara' : 'estación sin nadie dentro',
    },
    { label: 'Paros justificados', value: s ? s.stops_minutes.toFixed(0) : '—', unit: 'min', detail: 'fuera del cálculo de espera' },
    {
      label: 'Salida de la línea',
      value: s ? String(s.line_output) : '—',
      unit: 'pzs',
      detail: outPct !== null ? `${outPct}% de la meta (${s!.line_output_target.toFixed(0)})` : 'última estación del flujo',
      tone: outPct !== null && outPct < 85 ? C.warn : undefined,
    },
    { label: 'Caminado en la línea', value: s ? s.distance_m.toFixed(0) : '—', unit: 'm', detail: 'suma de todos los tracks' },
  ];

  return (
    <section className="panel" aria-label="Indicadores">
      <div className="px-5 pt-3 flex items-baseline justify-between">
        <span className="eyebrow">Últimos {fmtWindow(a) || '…'} · reconstruido desde eventos</span>
        {a?.mode === 'live' && <span className="chip chip-info">en vivo</span>}
        {a?.mode === 'replay' && <span className="chip chip-warn">reproducción</span>}
      </div>
      <div className="overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 -ml-px -mt-px">
        {items.map((k) => (
          <div key={k.label} className="px-5 py-3.5 border-l border-t border-line" style={{ boxShadow: `inset 0 3px 0 ${KPI_COLOR[k.label] ?? C.line}` }}>
            <div className="text-[12px] text-ink-2 font-medium">{k.label}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="num text-[26px] leading-none font-medium tracking-tight" style={{ color: k.tone && k.value !== '—' ? k.tone : C.ink }}>
                {k.value}
              </span>
              <span className="text-[12.5px] text-ink-3">{k.unit}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] text-ink-3 leading-snug">{k.detail}</p>
            {(() => {
              const dl = deltas[k.label];
              if (!dl || k.value === '—' || Math.abs(dl.d) < 0.5) return null;
              const good = dl.higherIsBetter === null ? null : dl.d > 0 === dl.higherIsBetter;
              return (
                <p className="mt-1 num text-[11px]" style={{ color: good === null ? C.ink3 : good ? C.ok : C.bad }}>
                  {dl.d > 0 ? '▲' : '▼'} {Math.abs(dl.d).toFixed(dl.unit === 'pp' ? 0 : 0)} {dl.unit} vs. periodo anterior
                </p>
              );
            })()}
          </div>
        ))}
      </div>
      </div>
    </section>
  );
};

/* ───────────── Estaciones ───────────── */

export const StateBar: React.FC<{ seconds: Record<string, number>; height?: number }> = ({ seconds, height = 8 }) => {
  const total = STATE_ORDER.reduce((a, k) => a + (seconds[k] ?? 0), 0) || 1;
  return (
    <div className="flex w-full overflow-hidden rounded-[1px] bg-sunken" style={{ height }}>
      {STATE_ORDER.map((k) =>
        seconds[k] ? <div key={k} title={`${STATE_META[k].label}: ${min(seconds[k])} min`} style={{ width: `${(100 * seconds[k]) / total}%`, background: STATE_META[k].color }} /> : null,
      )}
    </div>
  );
};

export const StateLegend: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2 ${className}`}>
    {STATE_ORDER.map((k) => (
      <span key={k} className="flex items-center gap-1.5" title={STATE_META[k].help}>
        <span className="inline-block w-2.5 h-2.5 rounded-[1px]" style={{ background: STATE_META[k].color }} />
        {STATE_META[k].label}
      </span>
    ))}
  </div>
);

export const StationTablePanel: React.FC<{ analytics: Analytics | null; metrics: MetricsSummary | null; lineName?: string }> = ({ analytics, metrics, lineName }) => {
  const rows = analytics?.stations ?? [];
  const bottleneck = analytics?.summary.bottleneck_station_id;
  return (
    <Panel title="Estaciones" subtitle="Estado ahora y reparto del tiempo en la ventana" meta={<span className="eyebrow">{lineName ?? 'Línea'}</span>}>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-3 py-6 text-center">Sin estaciones en esta línea.</p>
      ) : (
        <>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-ink-3 border-b border-line">
                <th className="font-normal pb-1.5">Estación</th>
                <th className="font-normal pb-1.5">Ahora</th>
                <th className="font-normal pb-1.5 w-[34%]">Tiempo</th>
                <th className="font-normal pb-1.5 text-right">pzs/h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const now = statusOf(metrics?.stations.find((m) => m.station_id === r.station_id)?.current_status);
                return (
                  <tr key={r.station_id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2 leading-tight">
                      {r.order} · {shortStationName(r.name)}
                      {r.station_id === bottleneck && <span className="chip chip-accent ml-1.5 !h-[17px]">cuello</span>}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="flex items-center gap-1.5 text-ink-2">
                        <span className="dot" style={{ background: now.color }} />
                        {now.label}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <StateBar seconds={r.seconds} />
                    </td>
                    <td className="py-2 text-right num text-ink-2">
                      {r.has_process_data ? (
                        <>
                          {r.pieces_per_hour.toFixed(0)}
                          <span className="text-ink-4">/{r.target_pph}</span>
                        </>
                      ) : (
                        <span className="text-ink-4" title="Sin sensor de proceso">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <StateLegend className="mt-3" />
        </>
      )}
    </Panel>
  );
};

/* ───────────── Alertas ───────────── */

export const AlertsPanel: React.FC<{
  alerts: Alert[];
  onAcknowledgeAlert: (id: string) => void;
  onResolveAlert: (id: string) => void;
  limit?: number;
  action?: React.ReactNode;
}> = ({ alerts, onAcknowledgeAlert, onResolveAlert, limit = 6, action }) => {
  const fresh = alerts.filter((a) => a.status === 'new').length;
  return (
    <Panel
      title="Alertas"
      meta={
        <span className="flex items-center gap-2">
          {fresh > 0 ? <span className="chip chip-warn">{fresh} sin atender</span> : <span className="chip chip-muted">al día</span>}
          {action}
        </span>
      }
    >
      {alerts.length === 0 ? (
        <p className="text-[12.5px] text-ink-3 py-6 text-center">Sin alertas en la ventana actual.</p>
      ) : (
        <ul className="-my-1 max-h-[420px] overflow-y-auto">
          {alerts.slice(0, limit).map((a) => (
            <li key={a.id} className="py-2.5 border-b border-line last:border-0">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 dot" style={{ background: a.status !== 'new' ? C.ink4 : a.severity === 'critical' ? C.bad : C.warn }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-[12.5px] font-medium ${a.status === 'new' ? 'text-ink' : 'text-ink-3'}`}>{a.title}</span>
                    <span className="num text-[10.5px] text-ink-3 shrink-0">
                      {new Date(a.triggered_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-2 leading-snug line-clamp-2 mt-0.5">{a.description}</p>
                  {a.status === 'new' && (
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => onAcknowledgeAlert(a.id)} className="btn btn-sm">
                        Reconocer
                      </button>
                      <button onClick={() => onResolveAlert(a.id)} className="btn btn-sm btn-ghost">
                        Resolver
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

/* ───────────── Paros ───────────── */

export const StopsPanel: React.FC<{
  stops: Stop[];
  onCloseStop: (id: string) => void;
  onJustify?: (stop: Stop) => void;
  limit?: number;
  action?: React.ReactNode;
}> = ({ stops, onCloseStop, onJustify, limit = 12, action }) => {
  const open = stops.filter((s) => s.status === 'open').length;
  const pending = stops.filter((s) => s.reason_code === 'PEND-01').length;
  return (
    <Panel
      title="Registro de paros"
      subtitle="Cada paro justificado se descuenta del tiempo disponible sin borrar eventos"
      meta={
        <span className="flex items-center gap-2">
          {pending > 0 && <span className="chip chip-warn">{pending} sin causa</span>}
          {open > 0 && <span className="chip chip-bad">{open} abierto{open > 1 ? 's' : ''}</span>}
          {action}
        </span>
      }
    >
      {stops.length === 0 ? (
        <p className="text-[12.5px] text-ink-3 py-6 text-center">Sin paros registrados.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-ink-3 border-b border-line">
              <th className="font-normal pb-1.5">Causa</th>
              <th className="font-normal pb-1.5">Alcance</th>
              <th className="font-normal pb-1.5 hidden md:table-cell">Registró</th>
              <th className="font-normal pb-1.5 hidden md:table-cell">Inicio</th>
              <th className="font-normal pb-1.5 text-right">Duración</th>
            </tr>
          </thead>
          <tbody>
            {stops.slice(0, limit).map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0 align-middle">
                <td className="py-2 pr-2">
                  <span className="flex items-center gap-2">
                    {s.status === 'open' && <span className="dot" style={{ background: C.bad }} />}
                    <span className={s.status === 'open' ? 'font-medium' : ''}>{s.reason}</span>
                    {!s.is_authorized && <span className="chip chip-muted">no justificado</span>}
                  </span>
                </td>
                <td className="py-2 pr-2 num text-[11.5px] text-ink-2">{s.scope_id}</td>
                <td className="py-2 pr-2 text-ink-2 hidden md:table-cell">{s.author}</td>
                <td className="py-2 pr-2 num text-[11.5px] text-ink-3 hidden md:table-cell">
                  {new Date(s.started_at.endsWith('Z') ? s.started_at : `${s.started_at}Z`).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {s.reason_code === 'PEND-01' && onJustify && (
                    <button onClick={() => onJustify(s)} className="btn btn-sm btn-primary mr-1.5">
                      Justificar
                    </button>
                  )}
                  {s.status === 'open' ? (
                    <button onClick={() => onCloseStop(s.id)} className="btn btn-sm">
                      Finalizar
                    </button>
                  ) : (
                    <span className="num text-ink-2">{s.duration_seconds ? `${min(s.duration_seconds)} min` : '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
};

/* ───────────── Estado de las fuentes ───────────── */

const SOURCES: { type: string; label: string; letter: string }[] = [
  { type: 'esp32_rfid', label: 'RFID', letter: 'A' },
  { type: 'esp32_csi', label: 'Wi‑Fi CSI', letter: 'B' },
  { type: 'camera_vision', label: 'Cámara', letter: 'C' },
  { type: 'esp32_button', label: 'Pulsadores', letter: 'D' },
  { type: 'esp32_process', label: 'Proceso', letter: 'E' },
];

// Muestra en una línea si cada fuente del documento está aportando datos ahora.
export const SourcesStrip: React.FC<{ devices: Device[]; tracksCount: number; mode: SystemMode }> = ({ devices, tracksCount, mode }) => {
  const real = devices.filter((d) => !d.simulated && d.is_active);
  return (
    <section className="panel px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Estado de las fuentes">
      <span className="eyebrow">Fuentes</span>
      {SOURCES.map((s) => {
        const list = real.filter((d) => d.type === s.type);
        const online = list.filter((d) => d.status === 'online').length;
        const cameraLive = s.type === 'camera_vision' && tracksCount > 0 && mode !== 'demo';
        const tone = online > 0 || cameraLive ? C.ok : list.some((d) => d.status === 'waiting') ? C.warn : list.length ? C.bad : C.ink4;
        const text =
          mode === 'demo'
            ? 'simulado'
            : mode === 'replay'
              ? 'grabación'
              : list.length === 0 && !cameraLive
                ? 'sin registrar'
                : s.type === 'camera_vision' && cameraLive
                  ? `${tracksCount} track${tracksCount === 1 ? '' : 's'}`
                  : `${online}/${list.length} en línea`;
        return (
          <span key={s.type} className="flex items-center gap-1.5 text-[12.5px]">
            <span className="num inline-flex items-center justify-center w-[18px] h-[18px] text-[10.5px] font-semibold bg-ink text-paper">{s.letter}</span>
            <span className="font-medium">{s.label}</span>
            <span className="dot" style={{ background: mode === 'live' ? tone : C.warn }} />
            <span className="text-ink-3 text-[11.5px]">{text}</span>
          </span>
        );
      })}
    </section>
  );
};
