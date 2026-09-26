import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2, Sliders, X, RefreshCw } from 'lucide-react';
import { Alert, AlertRuleConfig } from '../types';

interface AlertsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: Alert[];
  rules: AlertRuleConfig[];
  onAcknowledgeAlert: (alertId: string) => void;
  onResolveAlert: (alertId: string) => void;
  onUpdateRule: (ruleId: string, ruleData: AlertRuleConfig) => Promise<void>;
}

export const AlertsManagerModal: React.FC<AlertsManagerModalProps> = ({
  isOpen,
  onClose,
  alerts,
  rules,
  onAcknowledgeAlert,
  onResolveAlert,
  onUpdateRule,
}) => {
  const [activeTab, setActiveTab] = useState<'feed' | 'rules'>('feed');
  const [editingRule, setEditingRule] = useState<AlertRuleConfig | null>(null);

  if (!isOpen) return null;

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRule) {
      await onUpdateRule(editingRule.rule_id, editingRule);
      setEditingRule(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-xl">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Centro de Alertas & Motor de Reglas</h3>
              <p className="text-xs text-slate-400">
                Detección determinista de anomalías de flujo, permanencia, sensores y paros
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-5 pt-3 border-b border-slate-800 flex gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('feed')}
            className={`pb-2.5 border-b-2 transition-all ${
              activeTab === 'feed'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Historial de Alertas ({alerts.length})
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`pb-2.5 border-b-2 transition-all ${
              activeTab === 'rules'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Configuración de Umbrales & Reglas ({rules.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {activeTab === 'feed' ? (
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  ✓ No hay registros de alertas en el sistema
                </div>
              ) : (
                alerts.map((alt) => (
                  <div
                    key={alt.id}
                    className={`p-4 rounded-xl border text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      alt.status === 'new'
                        ? 'bg-amber-950/30 border-amber-800/80'
                        : 'bg-slate-950/40 border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-white text-sm">{alt.title}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            alt.severity === 'critical'
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {alt.severity.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(alt.triggered_at).toLocaleString()}
                        </span>
                      </div>

                      <p className="text-slate-300 text-xs mb-1">{alt.description}</p>
                      
                      {alt.evidence && Object.keys(alt.evidence).length > 0 && (
                        <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded border border-slate-800">
                          Evidencia: {JSON.stringify(alt.evidence)}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {alt.status === 'new' && (
                        <>
                          <button
                            onClick={() => onAcknowledgeAlert(alt.id)}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold"
                          >
                            Reconocer
                          </button>
                          <button
                            onClick={() => onResolveAlert(alt.id)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold"
                          >
                            Resolver
                          </button>
                        </>
                      )}
                      {alt.status === 'acknowledged' && (
                        <button
                          onClick={() => onResolveAlert(alt.id)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold"
                        >
                          Cerrar / Resuelto
                        </button>
                      )}
                      {alt.status === 'resolved' && (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4" /> Resuelta
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rules.map((rule) => (
                  <div key={rule.rule_id} className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-xs flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-white text-sm">{rule.name}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${rule.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                          {rule.enabled ? 'ACTIVA' : 'INACTIVA'}
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs mb-2">{rule.description}</p>
                      
                      <div className="space-y-1 bg-slate-900 p-2 rounded border border-slate-800 font-mono text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Umbral de Disparo:</span>
                          <span className="text-cyan-300 font-bold">{rule.threshold}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Ventana Temporal:</span>
                          <span className="text-slate-300">{rule.window_seconds} seg</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Tiempo de Enfriamiento:</span>
                          <span className="text-slate-300">{rule.cooldown_seconds} seg</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => setEditingRule(rule)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold flex items-center gap-1"
                      >
                        <Sliders className="h-3.5 w-3.5" /> Editar Umbral
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Editing Rule Dialog */}
              {editingRule && (
                <div className="p-4 bg-slate-800 border border-cyan-500/50 rounded-xl text-xs space-y-3">
                  <h4 className="font-bold text-white text-sm">Editar Regla: {editingRule.name}</h4>
                  
                  <form onSubmit={handleSaveRule} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-slate-400 font-semibold mb-1">Nuevo Umbral:</label>
                      <input
                        type="number"
                        step="0.5"
                        value={editingRule.threshold}
                        onChange={(e) => setEditingRule({ ...editingRule, threshold: Number(e.target.value) })}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 font-semibold mb-1">Ventana (seg):</label>
                      <input
                        type="number"
                        value={editingRule.window_seconds}
                        onChange={(e) => setEditingRule({ ...editingRule, window_seconds: Number(e.target.value) })}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 font-semibold mb-1">Enfriamiento (seg):</label>
                      <input
                        type="number"
                        value={editingRule.cooldown_seconds}
                        onChange={(e) => setEditingRule({ ...editingRule, cooldown_seconds: Number(e.target.value) })}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono"
                      />
                    </div>

                    <div className="col-span-full flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingRule(null)}
                        className="px-3 py-1.5 bg-slate-900 text-slate-300 rounded font-semibold"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold"
                      >
                        Guardar Regla
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
