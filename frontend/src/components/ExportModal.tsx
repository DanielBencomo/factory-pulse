import React from 'react';
import { Download } from 'lucide-react';
import { Modal } from './Modal';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FILES = [
  { href: '/api/export/events.csv?hours=24', name: 'events.csv', title: 'Eventos crudos', desc: 'Posiciones, ciclos, presencia y estados de las últimas 24 h.' },
  { href: '/api/export/stops.csv', name: 'stops.csv', title: 'Registro de paros', desc: 'Causa, responsable, alcance y duración en segundos.' },
];

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <Modal
      title="Exportar datos"
      subtitle="CSV con marcas de tiempo UTC y unidades explícitas."
      onClose={onClose}
      width="max-w-md"
      footer={
        <button onClick={onClose} className="btn">
          Cerrar
        </button>
      }
    >
      <ul className="border border-line rounded-[2px] divide-y divide-line">
        {FILES.map((f) => (
          <li key={f.href}>
            <a href={f.href} download className="flex items-center justify-between gap-4 px-3.5 py-3 hover:bg-sunken">
              <span>
                <span className="block text-[13px] font-medium">{f.title}</span>
                <span className="block text-[12px] text-ink-3 mt-0.5">{f.desc}</span>
              </span>
              <span className="flex items-center gap-1.5 num text-[11.5px] text-ink-2 shrink-0">
                {f.name}
                <Download className="h-3.5 w-3.5" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Modal>
  );
};
