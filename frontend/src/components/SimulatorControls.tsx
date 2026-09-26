import React, { useState } from 'react';
import { Play, Pause, RotateCcw, Send, Check } from 'lucide-react';
import { Modal } from './Modal';

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

const SCENES = [
  { num: 1, title: 'Operación normal', desc: 'Flujo balanceado entre las cuatro estaciones con abastecimiento continuo.' },
  { num: 2, title: 'Estación en espera', desc: 'Operador presente en la estación 2 con la máquina detenida.' },
  { num: 3, title: 'Estación desatendida', desc: 'Operador ausente en la estación 3 mientras hay material en tránsito.' },
  { num: 4, title: 'Falta de material', desc: 'Recorrido excesivo del materialista entre almacén y línea.' },
  { num: 5, title: 'Flujo atípico', desc: 'El operador 1 entra a una zona restringida y dispara una alerta.' },
  { num: 6, title: 'Paro justificado', desc: 'Paro declarado en la línea 1; se descuenta sin borrar eventos.' },
  { num: 7, title: 'Pérdida de sensor', desc: 'El ESP32 de la estación 4 pierde latido y se marca desconectado.' },
  { num: 8, title: 'Inyección externa', desc: 'Evento externo por HTTP o MQTT reflejado de inmediato en el tablero.' },
];

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
  const [injectType, setInjectType] = useState<string>('button_press');
  const [injectStation, setInjectStation] = useState<string>('st-2');
  const [injectButtonAction, setInjectButtonAction] = useState<string>('request_material');
  const [injectPresence, setInjectPresence] = useState<boolean>(true);
  const [injectTemp, setInjectTemp] = useState<number>(34.5);
  const [isInjecting, setIsInjecting] = useState<boolean>(false);
  const [injectSuccess, setInjectSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

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
      payload = { station_id: injectStation, present: injectPresence, confidence: 0.98, device_id: `esp32-line1-${injectStation}` };
    } else if (injectType === 'environment') {
      payload = { temperature_c: injectTemp, humidity_pct: 62.0, co2_ppm: 680.0, lux: 520.0, station_id: injectStation };
    } else if (injectType === 'cycle') {
      payload = { station_id: injectStation, cycle_time_seconds: 42.5, is_good_piece: true, total_parts: 1 };
    }

    try {
      await onInjectEvent({
        event_id: `inj-${Date.now()}`,
        device_id: `esp32-line1-${injectStation}`,
        source_id: 'manual_ui_injector',
        occurred_at: new Date().toISOString(),
        type: injectType,
        payload,
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
    <Modal title="Simulador" subtitle="Escenas deterministas del guion de demo e inyección manual de eventos." onClose={onClose} width="max-w-4xl" bodyClassName="">
      {/* Controles de reproducción */}
      <div className="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3 bg-paper/60">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <button onClick={onPause} className="btn">
              <Pause className="h-3.5 w-3.5" /> Pausar
            </button>
          ) : (
            <button onClick={() => onStart(speed)} className="btn btn-primary">
              <Play className="h-3.5 w-3.5" /> Reanudar
            </button>
          )}
          <button onClick={onReset} className="btn btn-ghost">
            <RotateCcw className="h-3.5 w-3.5" /> Reiniciar datos demo
          </button>
          <span className="flex items-center gap-1.5 text-[12px] text-ink-3 ml-2">
            <span className="dot" style={{ background: isRunning ? 'var(--color-ok)' : 'var(--color-ink-4)' }} />
            {isRunning ? 'Corriendo' : 'En pausa'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-ink-3">Velocidad</span>
          <div className="seg">
            {[0.5, 1.0, 2.0, 5.0].map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => onStart(s)} className="num">
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        {/* Escenas */}
        <div className="p-5 lg:border-r border-line">
          <div className="eyebrow mb-2">Escenas</div>
          <ol className="border border-line rounded-[2px] divide-y divide-line">
            {SCENES.map((sc) => {
              const active = currentScene === sc.num;
              return (
                <li key={sc.num}>
                  <button
                    onClick={() => onSetScene(sc.num)}
                    className={`w-full text-left px-3 py-2.5 flex gap-3 items-start cursor-pointer ${active ? 'bg-accent-soft' : 'hover:bg-sunken'}`}
                    aria-current={active}
                  >
                    <span className={`num text-[11.5px] w-5 pt-px ${active ? 'text-accent font-semibold' : 'text-ink-3'}`}>{String(sc.num).padStart(2, '0')}</span>
                    <span className="flex-1">
                      <span className="block text-[13px] font-medium">{sc.title}</span>
                      <span className="block text-[12px] text-ink-2 leading-snug mt-0.5">{sc.desc}</span>
                    </span>
                    {active && <span className="chip chip-accent mt-0.5">activa</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Inyector */}
        <div className="p-5">
          <div className="eyebrow mb-2">Inyectar evento</div>
          <form onSubmit={handleSendManualEvent} className="space-y-3">
            <div>
              <label className="label" htmlFor="inj-type">Tipo</label>
              <select id="inj-type" value={injectType} onChange={(e) => setInjectType(e.target.value)} className="field">
                <option value="button_press">Pulsador andon</option>
                <option value="presence">Presencia (PIR)</option>
                <option value="cycle">Ciclo de producción</option>
                <option value="environment">Ambiental (temperatura / humedad)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="inj-station">Estación</label>
              <select id="inj-station" value={injectStation} onChange={(e) => setInjectStation(e.target.value)} className="field">
                <option value="st-1">Estación 1 · SMT</option>
                <option value="st-2">Estación 2 · Reflow</option>
                <option value="st-3">Estación 3 · AOI</option>
                <option value="st-4">Estación 4 · Empaque</option>
              </select>
            </div>

            {injectType === 'button_press' && (
              <div>
                <label className="label" htmlFor="inj-action">Acción</label>
                <select id="inj-action" value={injectButtonAction} onChange={(e) => setInjectButtonAction(e.target.value)} className="field">
                  <option value="request_material">Solicitar material</option>
                  <option value="supervisor_call">Llamar a supervisor</option>
                  <option value="sos">Emergencia</option>
                  <option value="stop_line">Paro de línea</option>
                </select>
              </div>
            )}

            {injectType === 'presence' && (
              <fieldset className="flex gap-4 text-[12.5px] pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="presence" checked={injectPresence} onChange={() => setInjectPresence(true)} />
                  Presente
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="presence" checked={!injectPresence} onChange={() => setInjectPresence(false)} />
                  Ausente
                </label>
              </fieldset>
            )}

            {injectType === 'environment' && (
              <div>
                <label className="label" htmlFor="inj-temp">Temperatura (°C)</label>
                <input id="inj-temp" type="number" step="0.5" value={injectTemp} onChange={(e) => setInjectTemp(Number(e.target.value))} className="field num" />
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={isInjecting} className="btn btn-primary">
                <Send className="h-3.5 w-3.5" />
                {isInjecting ? 'Enviando…' : 'Enviar a la API'}
              </button>
              {injectSuccess && (
                <span className="flex items-center gap-1 text-[12px] text-ok">
                  <Check className="h-3.5 w-3.5" /> Evento registrado
                </span>
              )}
            </div>
          </form>

          <p className="mt-5 text-[12px] text-ink-3 leading-snug">
            El evento viaja por <code className="num text-ink-2">POST /api/events</code>, se guarda en SQLite y se difunde por{' '}
            <code className="num text-ink-2">/ws</code>.
          </p>
        </div>
      </div>
    </Modal>
  );
};
