import React, { useState, useRef, useEffect } from 'react';
import {
  Layers,
  Eye,
  EyeOff,
  Flame,
  Route,
  MapPin,
  Maximize2,
  Lock,
  Ruler,
  Info,
  Radio,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { FloorPlan, PolygonZone, Station, DistanceMetric, ScaleCalibration } from '../types';

interface FloorPlan2DProps {
  floorPlan: FloorPlan | null;
  zones: PolygonZone[];
  stations: Station[];
  tracks: Record<string, { x: number; y: number; name: string }>;
  distances: DistanceMetric[];
  onUpdateCalibration?: (calib: ScaleCalibration) => void;
  onSelectZone?: (zone: PolygonZone) => void;
}

export const FloorPlan2D: React.FC<FloorPlan2DProps> = ({
  floorPlan,
  zones,
  stations,
  tracks,
  distances,
  onUpdateCalibration,
  onSelectZone
}) => {
  // Layer visibility toggles
  const [showSpaghetti, setShowSpaghetti] = useState<boolean>(true);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showZones, setShowZones] = useState<boolean>(true);
  const [showStations, setShowStations] = useState<boolean>(true);
  const [showDevices, setShowDevices] = useState<boolean>(true);

  // Selected track filter
  const [selectedTrack, setSelectedTrack] = useState<string>('all');
  
  // Track history accumulator for spaghetti lines
  const [trackHistories, setTrackHistories] = useState<Record<string, [number, number][]>>({});
  
  // Zone detail modal
  const [activeZoneDetail, setActiveZoneDetail] = useState<PolygonZone | null>(null);

  // Update track history
  useEffect(() => {
    setTrackHistories((prev) => {
      const next = { ...prev };
      Object.entries(tracks).forEach(([id, pt]) => {
        if (!next[id]) next[id] = [];
        const last = next[id][next[id].length - 1];
        if (!last || Math.abs(last[0] - pt.x) > 0.002 || Math.abs(last[1] - pt.y) > 0.002) {
          next[id] = [...next[id].slice(-50), [pt.x, pt.y]];
        }
      });
      return next;
    });
  }, [tracks]);

  // Color map for ephemeral tracks
  const trackColors: Record<string, string> = {
    'TRK-OP1': '#38bdf8', // Light Blue
    'TRK-OP2': '#34d399', // Emerald
    'TRK-OP3': '#a78bfa', // Purple
    'TRK-OP4': '#fbbf24', // Amber
    'TRK-MAT': '#f43f5e', // Rose
  };

  const getStationStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-500 border-emerald-400 text-white';
      case 'waiting_material':
        return 'bg-amber-500 border-amber-400 text-slate-950';
      case 'unattended':
        return 'bg-rose-500 border-rose-400 text-white';
      case 'stopped':
        return 'bg-red-600 border-red-500 text-white';
      default:
        return 'bg-slate-700 border-slate-600 text-slate-300';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col h-full shadow-xl">
      {/* Top Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white tracking-wide">PLANO INDUSTRIAL 2D — LÍNEA 1</h3>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Escala: {floorPlan?.calibration?.is_calibrated ? `${floorPlan.calibration.meters_per_norm_unit} m / ancho` : 'Sin calibrar'}
          </span>
        </div>

        {/* Layer Toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setShowSpaghetti(!showSpaghetti)}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 transition-all ${
              showSpaghetti
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800/60 text-slate-400 border border-slate-700'
            }`}
          >
            <Route className="h-3 w-3" /> Spaghetti
          </button>
          
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 transition-all ${
              showHeatmap
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800/60 text-slate-400 border border-slate-700'
            }`}
          >
            <Flame className="h-3 w-3" /> Heatmap
          </button>

          <button
            onClick={() => setShowZones(!showZones)}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 transition-all ${
              showZones
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                : 'bg-slate-800/60 text-slate-400 border border-slate-700'
            }`}
          >
            Zonas
          </button>

          <button
            onClick={() => setShowStations(!showStations)}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 transition-all ${
              showStations
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                : 'bg-slate-800/60 text-slate-400 border border-slate-700'
            }`}
          >
            Estaciones
          </button>

          {/* Track Filter */}
          <select
            value={selectedTrack}
            onChange={(e) => setSelectedTrack(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none cursor-pointer"
          >
            <option value="all">Todos los Tracks ({Object.keys(tracks).length})</option>
            {Object.keys(tracks).map((t) => (
              <option key={t} value={t}>{t} - {tracks[t]?.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* SVG Canvas Map Container */}
      <div className="relative flex-1 w-full min-h-[360px] bg-slate-950 rounded-lg overflow-hidden border border-slate-800 select-none flex items-center justify-center">
        {/* Subtle Plant Grid Texture */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40"></div>

        <svg
          viewBox="0 0 1000 625"
          className="w-full h-full max-h-[550px]"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Defs: Gradient for Heatmap & Markers */}
          <defs>
            <radialGradient id="heatGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(239, 68, 68, 0.45)" />
              <stop offset="50%" stopColor="rgba(245, 158, 11, 0.25)" />
              <stop offset="100%" stopColor="rgba(59, 130, 246, 0.0)" />
            </radialGradient>
            
            <marker
              id="arrowhead"
              markerWidth="6"
              markerHeight="6"
              refX="4"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 6 3, 0 6" fill="#38bdf8" opacity="0.8" />
            </marker>
          </defs>

          {/* 1. Polygon Zones Layer */}
          {showZones &&
            zones.map((zone) => {
              const pointsStr = zone.polygon
                .map(([x, y]) => `${x * 1000},${y * 625}`)
                .join(' ');
              
              const isBathroom = zone.type === 'bathroom';

              return (
                <g key={zone.id} className="cursor-pointer group" onClick={() => setActiveZoneDetail(zone)}>
                  <polygon
                    points={pointsStr}
                    fill={zone.color}
                    fillOpacity={isBathroom ? 0.08 : 0.12}
                    stroke={zone.color}
                    strokeWidth={isBathroom ? 1.5 : 1.2}
                    strokeDasharray={isBathroom ? '4 3' : undefined}
                    className="transition-all hover:fill-opacity-25"
                  />
                  {/* Zone Label */}
                  {zone.polygon.length > 0 && (
                    <text
                      x={zone.polygon[0][0] * 1000 + 12}
                      y={zone.polygon[0][1] * 625 + 20}
                      fill={zone.color}
                      fontSize="13"
                      fontWeight="600"
                      className="opacity-90 pointer-events-none drop-shadow"
                    >
                      {zone.name}
                      {isBathroom && ' [🔒 Privacidad Agregada]'}
                    </text>
                  )}
                </g>
              );
            })}

          {/* 2. Heatmap Density Layer */}
          {showHeatmap &&
            Object.entries(trackHistories).map(([trkId, pts]) => {
              if (selectedTrack !== 'all' && selectedTrack !== trkId) return null;
              return pts.map(([px, py], idx) => (
                <circle
                  key={`heat-${trkId}-${idx}`}
                  cx={px * 1000}
                  cy={py * 625}
                  r="35"
                  fill="url(#heatGradient)"
                  className="pointer-events-none"
                />
              ));
            })}

          {/* 3. Spaghetti Trajectories Layer with directional path */}
          {showSpaghetti &&
            Object.entries(trackHistories).map(([trkId, pts]) => {
              if (selectedTrack !== 'all' && selectedTrack !== trkId) return null;
              if (pts.length < 2) return null;
              
              const color = trackColors[trkId] || '#38bdf8';
              const pathD = pts.reduce((acc, [px, py], i) => {
                return i === 0 ? `M ${px * 1000} ${py * 625}` : `${acc} L ${px * 1000} ${py * 625}`;
              }, '');

              return (
                <g key={`spag-${trkId}`}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={color}
                    strokeWidth="2.2"
                    strokeOpacity="0.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd="url(#arrowhead)"
                  />
                  {/* Directional Dots along path */}
                  {pts.filter((_, idx) => idx % 4 === 0).map(([dx, dy], didx) => (
                    <circle
                      key={`dot-${trkId}-${didx}`}
                      cx={dx * 1000}
                      cy={dy * 625}
                      r="2"
                      fill={color}
                      opacity="0.8"
                    />
                  ))}
                </g>
              );
            })}

          {/* 4. Production Stations Layer */}
          {showStations &&
            stations.map((st) => {
              const sx = st.position_x * 1000;
              const sy = st.position_y * 625;
              const statusColor = getStationStatusColor(st.current_status);

              return (
                <g key={st.id} transform={`translate(${sx - 50}, ${sy - 30})`} className="cursor-pointer">
                  {/* Station base box */}
                  <rect
                    width="100"
                    height="60"
                    rx="8"
                    className="fill-slate-900/90 stroke-slate-700 stroke-1"
                  />
                  
                  {/* Status indicator bar */}
                  <rect
                    width="100"
                    height="6"
                    rx="3"
                    className={st.current_status === 'active' ? 'fill-emerald-500' : st.current_status === 'waiting_material' ? 'fill-amber-500' : st.current_status === 'unattended' ? 'fill-rose-500' : 'fill-red-600'}
                  />

                  {/* Station Name */}
                  <text
                    x="50"
                    y="24"
                    textAnchor="middle"
                    fill="#e2e8f0"
                    fontSize="11"
                    fontWeight="bold"
                  >
                    {st.name}
                  </text>

                  {/* Status badge text */}
                  <text
                    x="50"
                    y="40"
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="9.5"
                    fontWeight="500"
                  >
                    {st.current_status === 'active'
                      ? '● OPERANDO'
                      : st.current_status === 'waiting_material'
                      ? '▲ EN ESPERA'
                      : st.current_status === 'unattended'
                      ? '✖ DESATENDIDA'
                      : '■ PARO'}
                  </text>

                  {/* Pieces Counter */}
                  <text
                    x="50"
                    y="52"
                    textAnchor="middle"
                    fill="#38bdf8"
                    fontSize="9"
                    fontWeight="600"
                  >
                    {st.parts_produced_shift} / {st.target_pieces_per_hour} pzs
                  </text>
                </g>
              );
            })}

          {/* 5. Live Position Markers (Anonymous Tracks) */}
          {Object.entries(tracks).map(([trkId, pos]) => {
            if (selectedTrack !== 'all' && selectedTrack !== trkId) return null;
            const color = trackColors[trkId] || '#38bdf8';
            const cx = pos.x * 1000;
            const cy = pos.y * 625;

            return (
              <g key={`live-${trkId}`} transform={`translate(${cx}, ${cy})`} className="transition-all duration-300">
                {/* Ripple ring animation */}
                <circle r="14" fill={color} fillOpacity="0.2" className="animate-ping" />
                
                {/* Central point */}
                <circle r="8" fill={color} stroke="#0f172a" strokeWidth="2" className="shadow-lg" />
                
                {/* Track label bubble */}
                <rect
                  x="-35"
                  y="-26"
                  width="70"
                  height="16"
                  rx="4"
                  fill="#090d16"
                  stroke={color}
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="-14"
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {trkId}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Privacy Banner on Bottom */}
        <div className="absolute bottom-2 left-2 bg-slate-900/90 backdrop-blur border border-slate-800 text-[11px] text-slate-300 px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-lg">
          <Lock className="h-3.5 w-3.5 text-pink-400" />
          <span><b>Privacidad:</b> Rastreo anónimo de IDs efímeros. Zonas sanitarias con conteo agregado sin expediente individual.</span>
        </div>
      </div>

      {/* Zone Details Modal / Slide-in */}
      {activeZoneDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: activeZoneDetail.color }}></div>
                <h4 className="text-base font-bold text-white">{activeZoneDetail.name}</h4>
              </div>
              <button
                onClick={() => setActiveZoneDetail(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Tipo de Zona:</span>
                <span className="font-semibold text-slate-200 capitalize">{activeZoneDetail.type}</span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Tiempo Límite de Permanencia:</span>
                <span className="font-semibold text-slate-200">{activeZoneDetail.max_stay_seconds} segundos ({activeZoneDetail.max_stay_seconds ? (activeZoneDetail.max_stay_seconds / 60).toFixed(1) : 0} min)</span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Tratamiento de Privacidad:</span>
                <span className="font-semibold text-pink-400">
                  {activeZoneDetail.is_aggregated_only ? 'Conteo Agregado Anónimo' : 'Flujo Estándar de Operación'}
                </span>
              </div>

              {activeZoneDetail.is_aggregated_only && (
                <div className="p-3 bg-pink-950/30 border border-pink-900/50 rounded-lg text-pink-300">
                  ℹ️ Esta zona aplica agregación total. No se almacenan trayectorias personales ni identificadores individuales dentro de este perímetro.
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActiveZoneDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
              >
                Cerrar Detalle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
