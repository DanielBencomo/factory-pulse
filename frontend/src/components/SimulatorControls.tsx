import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Radio,
  Send,
  Zap,
  Activity,
  X,
  AlertTriangle,
  Flame,
  CheckCircle2
} from 'lucide-react';

interface SimulatorControlsProps {
  isOpen: boolean;
  onClose: () => void;
  isRunning: boolean;
  currentScene: number;
  speed: number;
  onStart: (speed: number) => void;
  onPause: () => void;
  onReset: () => void;
  onSetScene: (scene: number) => void;
  onInjectEvent: (eventData: Record<string, any>) => Promise<void>;
}

export const SimulatorControls: React.FC<SimulatorControlsProps> = ({
  isOpen,
  onClose,
  isRunning,
  currentScene,
  speed,
  onStart,
  onPause,
  onReset,
  onSetScene,
  onInjectEvent,
}) => {
  // Manual Ingestion Form State
  const [injectType, setInjectType] = useState<string>('button_press');
  const [injectStation, setInjectStation] = useState<string>('st-2');
  const [injectButtonAction, setInjectButtonAction] = useState<string>('request_material');
  const [injectPresence, setInjectPresence] = useState<boolean>(true);
  const [injectTemp, setInjectTemp] = useState<number>(34.5);
  const [isInjecting, setIsInjecting] = useState<boolean>(false);
  const [injectSuccess, setInjectSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const scenes = [
    { num: 1, title: 'Escena 1: Operación Normal', desc: 'Flujo balanceado entre estaciones 1 a 4 con abastecimiento continuo.' },
    { num: 2, title: 'Escena 2: Estación en Espera', desc: 'Operador presente en Estación 2 pero máquina detenida por falta de balanceo.' },
    { num: 3, title: 'Escena 3: Estación Desatendida', desc: 'Operador ausente en Estación 3 mientras hay órdenes en tránsito.' },
    { num: 4, title: 'Escena 4: Falta de Material', desc: 'Cuello de botella en almacén y recorrido excesivo del materialista.' },
    { num: 5, title: 'Escena 5: Flujo Atípico / Cruce', desc: 'Operador 1 ingresa a zona restringida disparando alerta en motor de reglas.' },
    { num: 6, title: 'Escena 6: Paro Autorizado', desc: 'Administrador declara paro en Línea 1 deduciendo tiempo planificado sin borrar eventos.' },
    { num: 7, title: 'Escena 7: Pérdida de Sensor', desc: 'ESP32 de Estación 4 pierde latido; se marca desconectado sin datos inventados.' },
    { num: 8, title: 'Escena 8: Inyección Externa', desc: 'Envío de evento externo por HTTP / MQTT con actualización instantánea en el tablero.' },
  ];

  const handleSendManualEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsInjecting(true);
    setInjectSuccess(false);

    let payload: Record<string, any> = {};

    if (injectType === 'button_press') {
      payload = {
        station_id: injectStation,
        button_name: 'andon_physical_button',
        action: injectButtonAction,
        notes: 'Pulsación manual inyectada desde panel de control',
      };
    } else if (injectType === 'presence') {
      payload = {
        station_id: injectStation,
        present: injectPresence,
        confidence: 0.98,
        device_id: `esp32-line1-${injectStation}`,
      };
    } else if (injectType === 'environment') {
      payload = {
        temperature_c: injectTemp,
        humidity_pct: 62.0,
        co2_ppm: 680.0,
        lux: 520.0,
        station_id: injectStation,
      };
    } else if (injectType === 'cycle') {
      payload = {
        station_id: injectStation,
        cycle_time_seconds: 42.5,
        is_good_piece: true,
        total_parts: 1,
      };
    }

    try {
      await onInjectEvent({
        event_id: `inj-${Date.now()}`,
        device_id: `esp32-line1-${injectStation}`,
        source_id: 'manual_ui_injector',
        occurred_at: new Date().toISOString(),
        type: injectType,
        payload: payload,
        quality: 1.0,
        mode: 'live',
      });
      setInjectSuccess(true);
      setTimeout(() => setInjectSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsInjecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl">
              <Activity className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Simulador Determinista & Inyección de Telemetría</h3>
              <p className="text-xs text-slate-400">
                Control de las 8 escenas obligatorias y banco de pruebas de eventos IoT
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Playback Controls Bar */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                onClick={onPause}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow"
              >
                <Pause className="h-4 w-4" /> Pausar Simulación
              </button>
            ) : (
              <button
                onClick={() => onStart(speed)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/30"
              >
                <Play className="h-4 w-4" /> Iniciar Simulación
              </button>
            )}

            <button
              onClick={onReset}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold text-xs flex items-center gap-1.5"
            >
              <RotateCcw className="h-4 w-4" /> Reiniciar Dataset Demo
            </button>
          </div>

          {/* Speed Selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold">Velocidad:</span>
            {[0.5, 1.0, 2.0, 5.0].map((s) => (
              <button
                key={s}
                onClick={() => onStart(s)}
                className={`px-2.5 py-1 rounded font-mono text-xs ${
                  speed === s
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left Column: 8 Scenes Quick Jump */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-cyan-400" />
              Guion de 8 Escenas Preconfiguradas
            </h4>

            <div className="space-y-2">
              {scenes.map((sc) => (
                <div
                  key={sc.num}
                  onClick={() => onSetScene(sc.num)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                    currentScene === sc.num
                      ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-500/10'
                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white">{sc.title}</span>
                    {currentScene === sc.num && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                        ACTIVA
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-[11px]">{sc.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Inyección Manual de Eventos */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-amber-400" />
                Inyector Manual de Telemetría (ESP32 / Sensor)
              </h4>

              <form onSubmit={handleSendManualEvent} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Tipo de Evento:</label>
                  <select
                    value={injectType}
                    onChange={(e) => setInjectType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none"
                  >
                    <option value="button_press">Pulsación de Botón Andon / SOS</option>
                    <option value="presence">Sensor de Presencia / PIR</option>
                    <option value="cycle">Ciclo de Producción (Pieza Terminada)</option>
                    <option value="environment">Sensor Ambiental (Temperatura/Humedad)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Estación Destino:</label>
                  <select
                    value={injectStation}
                    onChange={(e) => setInjectStation(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none"
                  >
                    <option value="st-1">Estación 1 (SMT)</option>
                    <option value="st-2">Estación 2 (Reflow)</option>
                    <option value="st-3">Estación 3 (AOI)</option>
                    <option value="st-4">Estación 4 (Empaque)</option>
                  </select>
                </div>

                {injectType === 'button_press' && (
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Acción del Botón:</label>
                    <select
                      value={injectButtonAction}
                      onChange={(e) => setInjectButtonAction(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none"
                    >
                      <option value="request_material">Solicitar Material (Andon Amarillo)</option>
                      <option value="supervisor_call">Llamar a Supervisor (Andon Azul)</option>
                      <option value="sos">Emergencia / SOS (Andon Rojo)</option>
                      <option value="stop_line">Paro de Línea Inmediato</option>
                    </select>
                  </div>
                )}

                {injectType === 'presence' && (
                  <div className="flex items-center gap-3 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={injectPresence === true}
                        onChange={() => setInjectPresence(true)}
                        name="presence"
                        className="text-cyan-500"
                      />
                      <span className="text-slate-300">Operador Detectado (Presente)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={injectPresence === false}
                        onChange={() => setInjectPresence(false)}
                        name="presence"
                        className="text-rose-500"
                      />
                      <span className="text-slate-300">Estación Vacía (Ausente)</span>
                    </label>
                  </div>
                )}

                {injectType === 'environment' && (
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Temperatura Simulada (°C):</label>
                    <input
                      type="number"
                      step="0.5"
                      value={injectTemp}
                      onChange={(e) => setInjectTemp(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none font-mono"
                    />
                  </div>
                )}

                {injectSuccess && (
                  <div className="p-2.5 bg-emerald-950/40 border border-emerald-800 rounded-lg text-emerald-300 flex items-center gap-1.5 font-semibold text-[11px]">
                    <CheckCircle2 className="h-4 w-4" />
                    ¡Evento inyectado con éxito! Se refleja en el tablero por WebSocket.
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isInjecting}
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-amber-600/20"
                  >
                    <Send className="h-4 w-4" />
                    <span>{isInjecting ? 'Emitiendo...' : 'Inyectar Evento a la API'}</span>
                  </button>
                </div>
              </form>
            </div>

            <div className="mt-4 p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-400">
              💡 <b>Nota:</b> La inyección viaja por <code>POST /api/events</code>, se guarda en SQLite y se emite de inmediato por <code>WebSocket /ws</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
