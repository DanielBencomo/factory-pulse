import React from 'react';
import ReactECharts from 'echarts-for-react';
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  Cpu,
  Activity,
  CheckCircle,
  HelpCircle,
  XCircle,
  ShieldAlert,
  Server,
  Zap,
  Radio,
  UserX,
  Gauge
} from 'lucide-react';
import {
  MetricsSummary,
  WidgetConfig,
  Alert,
  Stop,
  Station,
  Device
} from '../types';

interface DashboardGridProps {
  widgets: WidgetConfig[];
  metrics: MetricsSummary | null;
  alerts: Alert[];
  stops: Stop[];
  stations: Station[];
  devices: Device[];
  isEditing: boolean;
  onAcknowledgeAlert: (alertId: string) => void;
  onResolveAlert: (alertId: string) => void;
  onCloseStop: (stopId: string) => void;
}

export const DashboardGrid: React.FC<DashboardGridProps> = ({
  widgets,
  metrics,
  alerts,
  stops,
  stations,
  devices,
  isEditing,
  onAcknowledgeAlert,
  onResolveAlert,
  onCloseStop,
}) => {
  const timeUniv = metrics?.time_universe || {
    gross_planned_seconds: 3600,
    authorized_stops_union_seconds: 0,
    adjusted_planned_seconds: 3600,
    productive_seconds: 2800,
    waiting_seconds: 500,
    absent_seconds: 300,
    unknown_seconds: 0,
    conservation_check_error_seconds: 0,
  };

  const adjPlannedMin = (timeUniv.adjusted_planned_seconds / 60).toFixed(1);
  const prodPct = timeUniv.adjusted_planned_seconds > 0
    ? ((timeUniv.productive_seconds / timeUniv.adjusted_planned_seconds) * 100).toFixed(1)
    : '0.0';
  const waitPct = timeUniv.adjusted_planned_seconds > 0
    ? ((timeUniv.waiting_seconds / timeUniv.adjusted_planned_seconds) * 100).toFixed(1)
    : '0.0';
  const stopMin = (timeUniv.authorized_stops_union_seconds / 60).toFixed(1);

  // --- ECharts Options Builders ---

  // 1. Donut Time Split Chart
  const getDonutOption = () => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} s ({d}%)',
    },
    legend: {
      orient: 'vertical',
      right: '2%',
      top: 'center',
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    color: ['#10b981', '#f59e0b', '#ec4899', '#64748b', '#ef4444'],
    series: [
      {
        name: 'Universo Temporal',
        type: 'pie',
        radius: ['50%', '75%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        emphasis: {
          label: {
            show: true,
            fontSize: 12,
            fontWeight: 'bold',
            color: '#ffffff',
          },
        },
        data: [
          { value: Math.round(timeUniv.productive_seconds), name: 'Productivo' },
          { value: Math.round(timeUniv.waiting_seconds), name: 'Espera' },
          { value: Math.round(timeUniv.absent_seconds), name: 'Ausencia' },
          { value: Math.round(timeUniv.unknown_seconds), name: 'Desconocido' },
          { value: Math.round(timeUniv.authorized_stops_union_seconds), name: 'Paro Autorizado' },
        ],
      },
    ],
  });

  // 2. Zone Dwell Horizontal Bar Chart
  const getZoneDwellOption = () => {
    const zoneData = metrics?.zones || [];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const item = params[0];
          return `${item.name}<br/>Permanencia: ${item.value} seg (${(item.value / 60).toFixed(1)} min)`;
        },
      },
      grid: { left: '3%', right: '8%', bottom: '5%', top: '8%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        data: zoneData.map((z) => z.zone_name.length > 20 ? z.zone_name.slice(0, 18) + '...' : z.zone_name),
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      series: [
        {
          name: 'Segundos Acumulados',
          type: 'bar',
          data: zoneData.map((z) => Math.round(z.total_dwell_seconds)),
          itemStyle: {
            color: (params: any) => {
              const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#6366f1', '#64748b', '#06b6d4', '#ec4899'];
              return colors[params.dataIndex % colors.length];
            },
            borderRadius: [0, 4, 4, 0],
          },
        },
      ],
    };
  };

  // 3. Station Comparison Chart
  const getStationCompOption = () => {
    const stData = metrics?.stations || [];
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { color: '#94a3b8', fontSize: 11 }, top: 0 },
      grid: { left: '3%', right: '4%', bottom: '5%', top: '25%', containLabel: true },
      xAxis: {
        type: 'category',
        data: stData.map((s) => s.name),
        axisLabel: { color: '#94a3b8', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          name: 'Disponibilidad (%)',
          type: 'bar',
          data: stData.map((s) => Math.round(s.availability_ratio * 100)),
          itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Piezas Producidas',
          type: 'bar',
          data: stData.map((s) => s.parts_produced),
          itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  };

  // 4. Calibrated Distance Bars Chart
  const getDistanceOption = () => {
    const distData = metrics?.distances || [];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const item = params[0];
          return `Track ${item.name}<br/>Distancia: ${item.value} m<br/>${item.data.is_calibrated ? '✓ Calibrada con escala real' : '⚠ Sin calibrar'}`;
        },
      },
      grid: { left: '3%', right: '5%', bottom: '5%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: distData.map((d) => d.track_id),
        axisLabel: { color: '#94a3b8', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: 'Metros (m)',
        nameTextStyle: { color: '#64748b', fontSize: 10 },
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          name: 'Distancia Recorrida (m)',
          type: 'bar',
          data: distData.map((d) => ({
            value: d.calibrated_meters ?? (d.raw_distance_norm * 40),
            is_calibrated: d.is_calibrated,
          })),
          itemStyle: {
            color: '#a78bfa',
            borderRadius: [4, 4, 0, 0],
          },
        },
      ],
    };
  };

  return (
    <div className="space-y-4">
      {/* Dynamic Grid Container */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Productivo */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Tiempo Productivo</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black text-white">{prodPct}%</div>
            <p className="text-xs text-slate-400 mt-0.5">
              {(timeUniv.productive_seconds / 60).toFixed(1)} min de {adjPlannedMin} min planificados
            </p>
          </div>
          <div className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 rounded px-2 py-0.5 font-mono">
            Fórmula: T_Prod / T_Plan_Ajustado
          </div>
        </div>

        {/* KPI 2: Espera */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Tiempo de Espera</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black text-amber-400">{waitPct}%</div>
            <p className="text-xs text-slate-400 mt-0.5">
              {(timeUniv.waiting_seconds / 60).toFixed(1)} min en cuello de botella o falta de material
            </p>
          </div>
          <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-900/60 rounded px-2 py-0.5 font-mono">
            Presencia detectada sin ciclo activo
          </div>
        </div>

        {/* KPI 3: Paros Autorizados */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Paros Autorizados</span>
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black text-rose-400">{stopMin} min</div>
            <p className="text-xs text-slate-400 mt-0.5">
              {metrics?.total_open_stops ?? 0} paros activos • Unión de intervalos
            </p>
          </div>
          <div className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded px-2 py-0.5 font-mono">
            Excluido del denominador sin borrar datos
          </div>
        </div>

        {/* KPI 4: Disponibilidad / OEE Parcial */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Disponibilidad Operativa</span>
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Gauge className="h-4 w-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black text-cyan-400">{prodPct}%</div>
            <p className="text-xs text-slate-400 mt-0.5">
              OEE Parcial (Faltan piezas clasificadas para OEE completo)
            </p>
          </div>
          <div className="text-[10px] text-cyan-300 bg-cyan-950/40 border border-cyan-900/60 rounded px-2 py-0.5 font-mono truncate" title="Disponibilidad = T_Operativo / T_Planificado_Ajustado">
            Disponibilidad = T_Op / T_Plan_Adj
          </div>
        </div>
      </div>

      {/* Main Charts & Analytics Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Donut Time Split */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            Distribución del Universo Temporal (Sin Fugas)
          </h4>
          <div className="h-[230px] w-full">
            <ReactECharts option={getDonutOption()} style={{ height: '100%', width: '100%' }} />
          </div>
        </div>

        {/* Zone Dwell Times */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-indigo-400" />
            Permanencia y Ocupación por Zonas
          </h4>
          <div className="h-[230px] w-full">
            <ReactECharts option={getZoneDwellOption()} style={{ height: '100%', width: '100%' }} />
          </div>
        </div>

        {/* Station Productivity & Parts */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Comparativa de Estaciones (Línea 1)
          </h4>
          <div className="h-[230px] w-full">
            <ReactECharts option={getStationCompOption()} style={{ height: '100%', width: '100%' }} />
          </div>
        </div>
      </div>

      {/* Lower Row: Distances, Live Alerts Feed, Stops Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Calibrated Distances */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-purple-400" />
            Distancia Recorrida por Track (Calibrada)
          </h4>
          <div className="h-[210px] w-full">
            <ReactECharts option={getDistanceOption()} style={{ height: '100%', width: '100%' }} />
          </div>
        </div>

        {/* Live Alerts Stream */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              Alertas y Anomalías en Vivo
            </h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-mono">
              {alerts.filter((a) => a.status === 'new').length} Nuevas
            </span>
          </div>

          <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                ✓ No hay anomalías activas en este momento
              </div>
            ) : (
              alerts.slice(0, 4).map((alt) => (
                <div
                  key={alt.id}
                  className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between gap-1.5 ${
                    alt.status === 'new'
                      ? 'bg-amber-950/30 border-amber-800/60 text-slate-200'
                      : 'bg-slate-800/40 border-slate-700/60 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{alt.title}</span>
                    <span className="text-[10px] text-slate-400">{new Date(alt.triggered_at).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 line-clamp-2">{alt.description}</p>
                  
                  {alt.status === 'new' && (
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={() => onAcknowledgeAlert(alt.id)}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-semibold"
                      >
                        Reconocer
                      </button>
                      <button
                        onClick={() => onResolveAlert(alt.id)}
                        className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[10px] font-semibold"
                      >
                        Resolver
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Stops History & Active Stops */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
              Paros Registrados (Auditoría)
            </h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-mono">
              {stops.filter((s) => s.status === 'open').length} Abiertos
            </span>
          </div>

          <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
            {stops.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                Sin paros registrados en el periodo
              </div>
            ) : (
              stops.slice(0, 4).map((s) => (
                <div
                  key={s.id}
                  className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                    s.status === 'open'
                      ? 'bg-rose-950/40 border-rose-800/80 text-rose-200'
                      : 'bg-slate-800/30 border-slate-800 text-slate-400'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-white">{s.reason}</div>
                    <div className="text-[10px] text-slate-400">
                      Alcance: {s.scope_type} ({s.scope_id}) • Por: {s.author}
                    </div>
                  </div>

                  {s.status === 'open' ? (
                    <button
                      onClick={() => onCloseStop(s.id)}
                      className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold rounded shadow shrink-0"
                    >
                      Finalizar Paro
                    </button>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-400">
                      {s.duration_seconds ? `${(s.duration_seconds / 60).toFixed(1)} min` : 'Cerrado'}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Device Health & Sensor Status Row */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" />
            Salud, Latencia y Frescura de Sensores & Nodos ESP32
          </h4>
          <span className="text-xs text-slate-400 font-mono">
            {devices.filter((d) => d.status === 'online').length} de {devices.length} Nodos Conectados
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {devices.map((dev) => (
            <div
              key={dev.id}
              className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                dev.status === 'online'
                  ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  : 'bg-rose-950/30 border-rose-800/80 animate-pulse'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 truncate" title={dev.name}>{dev.name.split(' ')[0]} {dev.name.split(' ')[1]}</span>
                <span className={`h-2 w-2 rounded-full ${dev.status === 'online' ? 'bg-emerald-400' : 'bg-rose-500'}`}></span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-1 truncate">
                {dev.device_id}
              </div>
              <div className="flex items-center justify-between text-[10px] mt-2 text-slate-400">
                <span>Modo: {dev.ingest_mode}</span>
                <span className="font-mono text-cyan-300">{dev.last_latency_ms ? `${dev.last_latency_ms}ms` : '--'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
