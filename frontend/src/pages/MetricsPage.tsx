import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Analytics } from '../types';
import { C, FONT_MONO, STATE_META, STATE_ORDER, axisCategory, axisValue, chartBase, trackColor } from '../theme';
import { shortStationName } from '../layout/geometry';
import { KpiStrip, Panel, StateLegend } from '../components/DashboardGrid';

/*
 * Métricas de la línea seleccionada. Cada gráfica responde una pregunta concreta
 * de supervisión y todas salen de la misma reconstrucción por eventos (/api/analytics).
 */

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
const minLabel = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${(s / 60).toFixed(1)} min`);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-full min-h-[180px] flex items-center justify-center text-center text-[12.5px] text-ink-3 px-6">{children}</div>
);

const Chart: React.FC<{ option: any; height: number }> = ({ option, height }) => (
  <div style={{ height }}>
    <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
  </div>
);

export const MetricsPage: React.FC<{ analytics: Analytics | null; lineName?: string }> = ({ analytics: a, lineName }) => {
  const stations = a?.stations ?? [];
  const names = stations.map((s) => `${s.order} · ${shortStationName(s.name)}`);
  const bucketMin = a ? a.window.bucket_s / 60 : 5;

  /* 1 · Línea de tiempo de estados */
  const timeline = useMemo(() => {
    if (!a) return null;
    const data: any[] = [];
    a.timeline.forEach((row, yi) =>
      row.segments.forEach(([s, e, st]) =>
        data.push({ value: [yi, s, e, STATE_ORDER.indexOf(st)], itemStyle: { color: STATE_META[st].color } }),
      ),
    );
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        formatter: (p: any) => {
          const [yi, s, e, si] = p.value;
          const st = STATE_ORDER[si];
          return `<b>${names[yi]}</b><br/>${STATE_META[st].label}<br/>${hhmm(s)}–${hhmm(e)} · ${minLabel((e - s) / 1000)}`;
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 24, containLabel: true },
      xAxis: {
        type: 'time',
        min: a.window.start_ms,
        max: a.window.end_ms,
        ...axisValue,
        splitLine: { show: true, lineStyle: { color: C.line, type: 'dashed' } },
        axisLabel: { ...axisValue.axisLabel, formatter: (v: number) => hhmm(v) },
      },
      yAxis: { type: 'category', data: names, inverse: true, ...axisCategory },
      series: [
        {
          type: 'custom',
          encode: { x: [1, 2], y: 0 },
          data,
          renderItem: (params: any, api: any) => {
            const yi = api.value(0);
            const start = api.coord([api.value(1), yi]);
            const end = api.coord([api.value(2), yi]);
            const h = api.size([0, 1])[1] * 0.56;
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - h / 2, width: Math.max(1, end[0] - start[0]), height: h },
              style: api.style(),
            };
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 2 · Reparto del tiempo por estación */
  const split = useMemo(() => {
    if (!a) return null;
    const totals = stations.map((s) => STATE_ORDER.reduce((acc, k) => acc + s.seconds[k], 0) || 1);
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) =>
          `<b>${ps[0].name}</b><br/>` +
          ps
            .filter((p) => p.value > 0)
            .map((p) => `${p.marker}${p.seriesName}: ${p.value.toFixed(0)}% · ${minLabel(stations[p.dataIndex].seconds[STATE_ORDER[p.seriesIndex]])}`)
            .join('<br/>'),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', max: 100, ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value}%' } },
      yAxis: { type: 'category', data: names, inverse: true, ...axisCategory },
      series: STATE_ORDER.map((k) => ({
        name: STATE_META[k].label,
        type: 'bar',
        stack: 't',
        barWidth: 14,
        itemStyle: { color: STATE_META[k].color },
        data: stations.map((s, i) => +((100 * s.seconds[k]) / totals[i]).toFixed(1)),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 3 · Ritmo por estación vs meta (cuello de botella) */
  const measured = stations.filter((s) => s.has_process_data && s.available_s >= 60);
  const rate = useMemo(() => {
    if (!a || measured.length === 0) return null;
    const bn = a.summary.bottleneck_station_id;
    const labels = measured.map((s) => `${s.order} · ${shortStationName(s.name)}`);
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => {
          const s = measured[ps[0].dataIndex];
          return `<b>${ps[0].name}</b><br/>Real: ${s.pieces_per_hour} pzs/h<br/>Meta: ${s.target_pph} pzs/h<br/>Ciclo medio: ${s.avg_cycle_s ?? '—'} s (ideal ${s.ideal_cycle_s} s)`;
        },
      },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labels, ...axisCategory },
      yAxis: { type: 'value', name: 'pzs/h', nameTextStyle: { color: C.ink3, fontSize: 10.5 }, ...axisValue },
      series: [
        {
          name: 'Real',
          type: 'bar',
          barWidth: 26,
          data: measured.map((s) => ({ value: s.pieces_per_hour, itemStyle: { color: s.station_id === bn ? C.accent : C.brand } })),
          label: { show: true, position: 'top', fontFamily: FONT_MONO, fontSize: 10.5, color: C.ink2 },
        },
        {
          name: 'Meta',
          type: 'scatter',
          symbol: 'rect',
          symbolSize: [38, 2.5],
          itemStyle: { color: C.ink },
          data: measured.map((s) => s.target_pph),
          z: 3,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 4 · Salida de la línea por intervalo */
  const output = useMemo(() => {
    if (!a || !a.summary.has_process_data) return null;
    const target = a.line_target_per_bucket;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => `<b>${ps[0].name}</b><br/>${ps[0].value} pzs · meta ${target.toFixed(1)}`,
      },
      grid: { left: 8, right: 40, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: a.buckets_ms.map(hhmm), ...axisCategory, axisLabel: { ...axisCategory.axisLabel, fontFamily: FONT_MONO, fontSize: 10.5 } },
      yAxis: { type: 'value', name: 'pzs', nameTextStyle: { color: C.ink3, fontSize: 10.5 }, minInterval: 1, ...axisValue },
      series: [
        {
          type: 'bar',
          barMaxWidth: 22,
          data: a.line_output_by_bucket.map((v, i) => ({
            value: v,
            // el último intervalo va en curso: se atenúa para no leerlo como caída
            itemStyle: { color: v < target * 0.85 ? C.warn : C.brand, opacity: i === a.line_output_by_bucket.length - 1 ? 0.45 : 1 },
          })),
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: C.ink, type: 'dashed', width: 1 },
            label: { formatter: 'meta', color: C.ink2, fontSize: 10.5 },
            data: [{ yAxis: target }],
          },
        },
      ],
    };
  }, [a]);

  /* 5 · Distancia caminada dentro de la línea */
  const distTracks = a ? Object.keys(a.distance_by_bucket) : [];
  const distance = useMemo(() => {
    if (!a || distTracks.length === 0) return null;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        formatter: (ps: any[]) =>
          `<b>${ps[0].name}</b><br/>` +
          [...ps]
            .sort((x, y) => y.value - x.value)
            .map((p) => `${p.marker}${p.seriesName}: ${p.value} m`)
            .join('<br/>'),
      },
      legend: { bottom: 0, icon: 'rect', itemWidth: 10, itemHeight: 3, textStyle: { color: C.ink2, fontSize: 11, fontFamily: FONT_MONO } },
      grid: { left: 8, right: 16, top: 16, bottom: 30, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: a.buckets_ms.map(hhmm), ...axisCategory, axisLabel: { ...axisCategory.axisLabel, fontFamily: FONT_MONO, fontSize: 10.5 } },
      yAxis: { type: 'value', name: 'm', nameTextStyle: { color: C.ink3, fontSize: 10.5 }, ...axisValue },
      series: distTracks.map((t) => ({
        name: t,
        type: 'line',
        showSymbol: false,
        lineStyle: { width: 1.6, color: trackColor(t) },
        itemStyle: { color: trackColor(t) },
        data: a.distance_by_bucket[t],
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 5b · Tiempo por zona (toda la planta) */
  const dwellRows = (a?.zone_dwell ?? []).filter((z) => z.person_s > 0);
  const dwell = useMemo(() => {
    if (!a || dwellRows.length === 0) return null;
    const winS = (a.window.end_ms - a.window.start_ms) / 1000;
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => {
          const z = dwellRows[ps[0].dataIndex];
          return `<b>${z.name}</b><br/>${(z.person_s / 60).toFixed(1)} persona·min<br/>Ocupada ${Math.round((100 * z.occupied_s) / winS)}% del tiempo${
            z.visits !== null ? `<br/>${z.visits} entradas` : '<br/>Zona privada: solo agregado'
          }`;
        },
      },
      grid: { left: 8, right: 110, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value} min' } },
      yAxis: { type: 'category', inverse: true, data: dwellRows.map((z) => (z.name.length > 34 ? z.name.slice(0, 33) + '…' : z.name)), ...axisCategory },
      series: [
        {
          type: 'bar',
          barWidth: 12,
          data: dwellRows.map((z) => ({
            value: +(z.person_s / 60).toFixed(1),
            itemStyle: { color: z.type === 'work' ? C.brand : z.is_aggregated_only ? C.ink4 : C.accent },
          })),
          label: {
            show: true,
            position: 'right',
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: C.ink2,
            formatter: (p: any) => `${p.value} · ${Math.round((100 * dwellRows[p.dataIndex].occupied_s) / winS)}% ocup.`,
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  /* 6 · Pareto de paros */
  const pareto = useMemo(() => {
    if (!a || a.stops_pareto.length === 0) return null;
    const total = a.stops_pareto.reduce((s, r) => s + r.minutes, 0) || 1;
    let acc = 0;
    const cum = a.stops_pareto.map((r) => +((100 * (acc += r.minutes)) / total).toFixed(0));
    return {
      ...chartBase,
      tooltip: {
        ...chartBase.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (ps: any[]) => {
          const r = a.stops_pareto[ps[0].dataIndex];
          return `<b>${r.reason}</b><br/>${r.minutes} min en ${r.count} paro${r.count > 1 ? 's' : ''}<br/>Acumulado: ${cum[ps[0].dataIndex]}%`;
        },
      },
      // Barras horizontales: las causas conservan su texto completo y se leen de mayor a menor.
      grid: { left: 8, right: 120, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', ...axisValue, axisLabel: { ...axisValue.axisLabel, formatter: '{value} min' } },
      yAxis: {
        type: 'category',
        inverse: true,
        data: a.stops_pareto.map((r) => (r.reason.length > 42 ? r.reason.slice(0, 41) + '…' : r.reason)),
        ...axisCategory,
      },
      series: [
        {
          type: 'bar',
          barWidth: 14,
          data: a.stops_pareto.map((r, i) => ({ value: r.minutes, itemStyle: { color: i === 0 || cum[i - 1] < 80 ? C.ink2 : C.ink4 } })),
          label: {
            show: true,
            position: 'right',
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: C.ink2,
            formatter: (p: any) => `${p.value} min · ${cum[p.dataIndex]}% acum.`,
          },
        },
      ],
    };
  }, [a]);

  if (!a) return <div className="panel p-10 text-center text-ink-3 text-[13px]">Calculando métricas…</div>;

  return (
    <div className="space-y-4">
      <KpiStrip analytics={a} />

      <Panel
        title="¿Cuándo produjo, esperó o se detuvo cada estación?"
        subtitle="Estado reconstruido cada pocos segundos a partir de la cámara (presencia), el sensor de proceso (marcha y ciclos) y los paros registrados."
        meta={<span className="eyebrow">{lineName}</span>}
      >
        {stations.length === 0 ? (
          <Empty>Esta línea no tiene estaciones.</Empty>
        ) : (
          <>
            <Chart option={timeline} height={Math.max(140, 44 * stations.length + 40)} />
            <StateLegend className="mt-2" />
          </>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="¿Dónde se va el tiempo de cada estación?" subtitle="Porcentaje de la ventana en cada estado. La espera alta con presencia apunta a falta de material o balanceo.">
          <Chart option={split} height={Math.max(160, 38 * stations.length + 30)} />
        </Panel>

        <Panel
          title="¿Qué estación limita la salida?"
          subtitle="Piezas por hora reales contra la meta. La barra naranja es el cuello de botella: la de menor ritmo medido."
        >
          {rate ? (
            <Chart option={rate} height={240} />
          ) : (
            <Empty>
              {stations.some((s) => s.has_process_data)
                ? 'No hubo tiempo disponible en la ventana (paro o sin datos), así que no se puede medir el ritmo.'
                : 'Ninguna estación de esta línea tiene sensor de proceso, así que no hay piezas medidas. Vincula un ESP32 de proceso en el interior del área.'}
            </Empty>
          )}
        </Panel>

        <Panel
          title="¿La línea va al ritmo de la meta?"
          subtitle={`Piezas que salen de la última estación cada ${bucketMin} min contra la meta del intervalo. Ámbar: por debajo del 85%. El último intervalo sigue en curso.`}
        >
          {output ? <Chart option={output} height={240} /> : <Empty>Sin sensor de proceso en la última estación: no se puede medir la salida.</Empty>}
        </Panel>

        <Panel
          title="¿Quién camina más dentro de la línea y cuándo?"
          subtitle={`Metros recorridos por track cada ${bucketMin} min, solo dentro del área de la línea. Picos repetidos suelen ser surtido de material.`}
        >
          {distance ? <Chart option={distance} height={240} /> : <Empty>Sin trayectorias dentro del área de la línea en esta ventana.</Empty>}
        </Panel>

        <Panel
          title="¿En qué zonas se pasa el tiempo?"
          subtitle="Persona·minuto por zona en toda la planta. Azul: estaciones; naranja: zonas de apoyo (almacén, pasillo, descanso). Mucho tiempo en apoyo suele ser traslado o búsqueda de material."
          className="xl:col-span-2"
        >
          {dwell ? (
            <Chart option={dwell} height={Math.max(140, 28 * dwellRows.length + 30)} />
          ) : (
            <Empty>Sin posiciones de la cámara en esta ventana.</Empty>
          )}
        </Panel>

        <Panel
          title="¿Qué causas de paro cuestan más tiempo?"
          subtitle="Pareto de minutos por causa en la ventana (justificados y no justificados). En oscuro, las causas que suman el 80% del tiempo."
          className="xl:col-span-2"
        >
          {pareto ? <Chart option={pareto} height={Math.max(120, 34 * a.stops_pareto.length + 30)} /> : <Empty>Sin paros en esta ventana.</Empty>}
        </Panel>
      </div>

      <section className="panel p-4 text-[12px] text-ink-2 leading-relaxed">
        <div className="font-medium text-ink mb-1.5">Cómo se clasifica el tiempo</div>
        <ul className="grid md:grid-cols-2 gap-x-6 gap-y-1">
          {STATE_ORDER.map((k) => (
            <li key={k} className="flex gap-2">
              <span className="inline-block w-2.5 h-2.5 mt-1 rounded-[1px] shrink-0" style={{ background: STATE_META[k].color }} />
              <span>
                <b className="font-medium">{STATE_META[k].label}:</b> {STATE_META[k].help}.
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-ink-3">
          Estar quieto en la estación no se interpreta como improductividad: sin sensor de proceso el tiempo queda como “presente”. Los porcentajes de productivo,
          espera y ausencia, y las piezas por hora, se calculan sobre el tiempo disponible: sin paros justificados ni huecos en los que la cámara no
          reportó datos.
        </p>
      </section>
    </div>
  );
};
