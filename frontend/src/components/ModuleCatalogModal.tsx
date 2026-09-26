import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { CatalogModule, ModuleAvailability } from '../types';
import { Modal } from './Modal';

interface ModuleCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  modules: CatalogModule[];
}

const AVAIL: Record<ModuleAvailability, { label: string; chip: string }> = {
  active: { label: 'activo', chip: 'chip-ok' },
  simulated: { label: 'simulado', chip: 'chip-info' },
  needs_device: { label: 'requiere hardware', chip: 'chip-warn' },
  experimental: { label: 'experimental', chip: 'chip-muted' },
};

export const ModuleCatalogModal: React.FC<ModuleCatalogModalProps> = ({ isOpen, onClose, modules }) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeModulesState, setActiveModulesState] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  const categories = Array.from(new Set(modules.map((m) => m.category)));
  const q = searchTerm.toLowerCase();
  const filteredModules = modules.filter(
    (m) =>
      (m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)) &&
      (selectedCategory === 'all' || m.category === selectedCategory),
  );

  const toggleModule = (id: string) => {
    setActiveModulesState((prev) => ({ ...prev, [id]: prev[id] !== undefined ? !prev[id] : false }));
  };

  return (
    <Modal
      title="Módulos"
      subtitle="Cada módulo depende de un sensor. Los que no tienen hardware quedan rotulados; no se inventa telemetría."
      onClose={onClose}
      width="max-w-5xl"
      bodyClassName=""
      footer={
        <button onClick={onClose} className="btn btn-primary">
          Listo
        </button>
      }
    >
      <div className="px-5 py-3 border-b border-line flex flex-wrap items-center gap-3 bg-paper/60">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-[8px] h-3.5 w-3.5 text-ink-3" />
          <input type="search" placeholder="Buscar por módulo, tecnología o sensor" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="field !pl-8" />
        </div>
        <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="field !w-auto" aria-label="Categoría">
          <option value="all">Todas las categorías ({modules.length})</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredModules.map((mod) => {
          const isEnabled = activeModulesState[mod.id] ?? mod.toggle_enabled;
          const a = AVAIL[mod.availability];
          return (
            <article key={mod.id} className="border border-line rounded-[2px] bg-surface flex flex-col">
              <div className="p-3.5 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">{mod.category}</span>
                  <span className={`chip ${a.chip}`}>{a.label}</span>
                </div>
                <h4 className="text-[14px] font-semibold mt-1.5" style={{ fontStretch: '90%' }}>
                  {mod.name}
                </h4>
                <p className="text-[12.5px] text-ink-2 leading-snug mt-1">{mod.description}</p>
                <dl className="mt-3 text-[12px]">
                  <div className="kv"><dt>Señal</dt><dd className="num text-[11.5px]">{mod.signal_type}</dd></div>
                  <div className="kv"><dt>Resolución</dt><dd>{mod.expected_resolution}</dd></div>
                  <div className="kv"><dt>Costo relativo</dt><dd>{mod.relative_cost}</dd></div>
                  <div className="kv"><dt>Despliegue</dt><dd className="max-w-[65%]">{mod.deployment_requirements}</dd></div>
                </dl>
              </div>
              <div className="px-3.5 py-2.5 border-t border-line flex items-center justify-between gap-3 bg-paper/60">
                <span className="text-[11.5px] text-ink-3 truncate" title={mod.data_requirements.join(', ')}>
                  Requiere: <span className="num text-ink-2">{mod.data_requirements.join(', ')}</span>
                </span>
                <label className="flex items-center gap-2 text-[12px] cursor-pointer shrink-0">
                  <input type="checkbox" checked={isEnabled} onChange={() => toggleModule(mod.id)} />
                  {isEnabled ? 'Habilitado' : 'Desactivado'}
                </label>
              </div>
            </article>
          );
        })}
      </div>
    </Modal>
  );
};
