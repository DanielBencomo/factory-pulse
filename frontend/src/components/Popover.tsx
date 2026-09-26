import React, { useEffect, useRef, useState } from 'react';

/** Botón con panel desplegable; se cierra con clic fuera o Esc. */
export const Popover: React.FC<{
  label: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: 'left' | 'right';
  buttonClassName?: string;
  width?: number;
  placement?: 'bottom' | 'top';
}> = ({ label, children, align = 'right', buttonClassName = 'btn btn-sm', width = 260, placement = 'bottom' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="relative" ref={ref}>
      <button className={buttonClassName} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div
          className={`absolute z-30 panel shadow-[0_8px_24px_rgba(0,0,0,0.12)] ${align === 'right' ? 'right-0' : 'left-0'} ${
            placement === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1'
          }`}
          style={{ width }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
};
