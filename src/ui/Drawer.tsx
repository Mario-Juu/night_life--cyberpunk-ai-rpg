import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { useOverlay } from './overlay';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}

/** Painel lateral direito em portal (telefone). Em telas pequenas ocupa a tela inteira. */
export function Drawer({ open, onClose, label, children, className }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-surface-0/60 animate-fade-in" onClick={onClose} aria-hidden />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        id={id}
        tabIndex={-1}
        className={cn('relative h-full w-full sm:w-[420px] bg-surface-1 border-l border-line flex flex-col animate-slide-in-right outline-none', className)}
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}
