import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  width?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}

export const Modal: React.FC<ModalProps> = ({ title, subtitle, onClose, width = 'max-w-lg', footer, children, bodyClassName = 'p-5' }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(26,27,29,0.42)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className={`panel w-full ${width} max-h-[90vh] flex flex-col shadow-[0_12px_40px_rgba(0,0,0,0.18)]`}>
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
          <div>
            <h3 className="text-[16px] font-semibold leading-tight" style={{ fontStretch: '88%' }}>
              {title}
            </h3>
            {subtitle && <p className="text-[12.5px] text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className={`overflow-y-auto flex-1 ${bodyClassName}`}>{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-5 py-3 border-t border-line bg-paper/60">{footer}</footer>}
      </div>
    </div>
  );
};
