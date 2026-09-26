import React, { useState } from 'react';
import { Layers, Search, CheckCircle2, Clock, Cpu, FlaskConical, X, DollarSign, Wrench } from 'lucide-react';
import { CatalogModule, ModuleAvailability } from '../types';

interface ModuleCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  modules: CatalogModule[];
}

export const ModuleCatalogModal: React.FC<ModuleCatalogModalProps> = ({
  isOpen,
  onClose,
  modules,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeModulesState, setActiveModulesState] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  const categories = Array.from(new Set(modules.map((m) => m.category)));

  const filteredModules = modules.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || m.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getAvailabilityBadge = (avail: ModuleAvailability) => {
    switch (avail) {
      case 'active':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> ACTIVO
          </span>
        );
      case 'simulated':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40 flex items-center gap-1">
            <Clock className="h-3 w-3" /> SIMULADO
          </span>
        );
      case 'needs_device':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-1">
            <Cpu className="h-3 w-3" /> REQUIERE HARDWARE
          </span>
        );
      case 'experimental':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/40 flex items-center gap-1">
            <FlaskConical className="h-3 w-3" /> EXPERIMENTAL
          </span>
        );
    }
  };

  const toggleModule = (id: string) => {
    setActiveModulesState((prev) => ({
      ...prev,
      [id]: prev[id] !== undefined ? !prev[id] : false,
    }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Catálogo Completo de Módulos (8 Familias)</h3>
              <p className="text-xs text-slate-400">
                Arquitectura desacoplada: active o desactive módulos según disponibilidad física de sensores
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por módulo, tecnología, costo o sensor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none cursor-pointer"
          >
            <option value="all">Todas las Categorías ({modules.length} Módulos)</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Modules Grid */}
        <div className="p-5 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredModules.map((mod) => {
            const isEnabled = activeModulesState[mod.id] ?? mod.toggle_enabled;

            return (
              <div
                key={mod.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                  mod.availability === 'active'
                    ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-950/50 border-slate-800/60'
                }`}
              >
                <div>
                  {/* Top line with Category & Availability */}
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">{mod.category}</span>
                    {getAvailabilityBadge(mod.availability)}
                  </div>

                  <h4 className="text-sm font-bold text-white mb-1">{mod.name}</h4>
                  <p className="text-xs text-slate-400 line-clamp-2 mb-3">{mod.description}</p>

                  {/* Technical Meta Specs */}
                  <div className="space-y-1.5 text-[11px] bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Tipo de Señal:</span>
                      <span className="text-slate-200 font-mono">{mod.signal_type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Resolución Esperable:</span>
                      <span className="text-slate-200 font-mono">{mod.expected_resolution}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Costo Relativo:</span>
                      <span className="text-emerald-400 font-bold">{mod.relative_cost}</span>
                    </div>
                    <div className="text-slate-400 pt-1 border-t border-slate-900">
                      <b>Despliegue:</b> {mod.deployment_requirements}
                    </div>
                  </div>
                </div>

                {/* Footer with Data Requirements & Toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <div className="text-[10px] text-slate-400">
                    Requisitos: <span className="text-cyan-300">{mod.data_requirements.join(', ')}</span>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-[11px] text-slate-400">{isEnabled ? 'Habilitado' : 'Desactivado'}</span>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => toggleModule(mod.id)}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <span>✓ Los módulos dependientes de sensores no presentes quedan rotulados sin inventar telemetría.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold"
          >
            Aceptar y Volver
          </button>
        </div>
      </div>
    </div>
  );
};
