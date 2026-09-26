import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Alert, AlertRuleConfig } from '../types';
import { Modal } from './Modal';
import { C } from '../theme';

interface AlertsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: Alert[];
  rules: AlertRuleConfig[];
  onAcknowledgeAlert: (alertId: string) => void;
  onResolveAlert: (alertId: string) => void;
  onUpdateRule: (ruleId: string, ruleData: AlertRuleConfig) => Promise<void>;
  initialTab?: 'feed' | 'rules';
}

export const AlertsManagerModal: React.FC<AlertsManagerModalProps> = ({
  isOpen,
  onClose,
  alerts,
  rules,
  onAcknowledgeAlert,
  onResolveAlert,
  onUpdateRule,
  initialTab = 'feed',
}) => {
  const [activeTab, setActiveTab] = useState<'feed' | 'rules'>(initialTab);
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
    <Modal title="Alertas y reglas" subtitle="Detección de flujo anormal, permanencia, sensores y paros." onClose={onClose} width="max-w-4xl" bodyClassName="">
      <div className="px-5 pt-3 border-b border-line flex gap-5 text-[12.5px]" role="tablist">
        {(
          [
            ['feed', `Historial (${alerts.length})`],
            ['rules', `Reglas (${rules.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`pb-2.5 -mb-px border-b-2 cursor-pointer ${activeTab === key ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {activeTab === 'feed' ? (
          alerts.length === 0 ? (
            <p className="text-center py-12 text-ink-3 text-[12.5px]">Sin alertas registradas.</p>
          ) : (
            <ul className="border border-line rounded-[2px] divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.id} className="p-3.5 flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="flex gap-2.5 min-w-0">
                    <span className="dot mt-1.5" style={{ background: a.status !== 'new' ? C.ink4 : a.severity === 'critical' ? C.bad : C.warn }} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium">{a.title}</span>
                        <span className={`chip ${a.severity === 'critical' ? 'chip-bad' : a.severity === 'warning' ? 'chip-warn' : 'chip-info'}`}>
                          {a.severity === 'critical' ? 'crítica' : a.severity === 'warning' ? 'advertencia' : 'info'}
                        </span>
                        <span className="num text-[11px] text-ink-3">{new Date(a.triggered_at).toLocaleString('es-MX')}</span>
                      </div>
                      <p className="text-[12.5px] text-ink-2 mt-1">{a.description}</p>
                      {a.evidence && Object.keys(a.evidence).length > 0 && (
                        <pre className="num text-[11px] text-ink-3 bg-paper border border-line rounded-[2px] px-2 py-1.5 mt-2 whitespace-pre-wrap break-all">
                          {JSON.stringify(a.evidence)}
                        </pre>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {a.status === 'new' && (
                      <>
                        <button onClick={() => onAcknowledgeAlert(a.id)} className="btn btn-sm">
                          Reconocer
                        </button>
                        <button onClick={() => onResolveAlert(a.id)} className="btn btn-sm btn-ghost">
                          Resolver
                        </button>
                      </>
                    )}
                    {a.status === 'acknowledged' && (
                      <button onClick={() => onResolveAlert(a.id)} className="btn btn-sm">
                        Marcar resuelta
                      </button>
                    )}
                    {a.status === 'resolved' && (
                      <span className="flex items-center gap-1 text-[12px] text-ok">
                        <Check className="h-3.5 w-3.5" /> Resuelta
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-4">
            <table className="w-full text-[12.5px] border border-line">
              <thead>
                <tr className="text-left text-ink-3 bg-paper border-b border-line">
                  <th className="font-normal px-3 py-2">Regla</th>
                  <th className="font-normal px-3 py-2 text-right">Umbral</th>
                  <th className="font-normal px-3 py-2 text-right">Ventana</th>
                  <th className="font-normal px-3 py-2 text-right">Enfriamiento</th>
                  <th className="font-normal px-3 py-2">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.rule_id} className={`border-b border-line last:border-0 align-top ${editingRule?.rule_id === r.rule_id ? 'bg-accent-soft' : ''}`}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[12px] text-ink-3 mt-0.5">{r.description}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right num">{r.threshold}</td>
                    <td className="px-3 py-2.5 text-right num">{r.window_seconds} s</td>
                    <td className="px-3 py-2.5 text-right num">{r.cooldown_seconds} s</td>
                    <td className="px-3 py-2.5">
                      <span className={`chip ${r.enabled ? 'chip-ok' : 'chip-muted'}`}>{r.enabled ? 'activa' : 'inactiva'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setEditingRule(r)} className="btn btn-sm">
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {editingRule && (
              <form onSubmit={handleSaveRule} className="border border-ink rounded-[2px] p-4">
                <div className="text-[13px] font-medium mb-3">Editar: {editingRule.name}</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label" htmlFor="r-th">Umbral</label>
                    <input id="r-th" type="number" step="0.5" value={editingRule.threshold} onChange={(e) => setEditingRule({ ...editingRule, threshold: Number(e.target.value) })} className="field num" />
                  </div>
                  <div>
                    <label className="label" htmlFor="r-win">Ventana (s)</label>
                    <input id="r-win" type="number" value={editingRule.window_seconds} onChange={(e) => setEditingRule({ ...editingRule, window_seconds: Number(e.target.value) })} className="field num" />
                  </div>
                  <div>
                    <label className="label" htmlFor="r-cd">Enfriamiento (s)</label>
                    <input id="r-cd" type="number" value={editingRule.cooldown_seconds} onChange={(e) => setEditingRule({ ...editingRule, cooldown_seconds: Number(e.target.value) })} className="field num" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button type="button" onClick={() => setEditingRule(null)} className="btn">
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Guardar regla
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
