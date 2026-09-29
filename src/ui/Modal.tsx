import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { useOverlay } from './overlay';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  children: ReactNode;
  /** Impede fechar clicando fora (ex.: confirmação destrutiva em andamento). */
  dismissable?: boolean;
}

const SIZES = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' };

/**
 * Modal renderizado em portal no <body> (nunca preso em contêineres com transform/blur).
 * Esc e clique no fundo fecham; em telas pequenas vira bottom-sheet rolável.
 */
export function Modal({ open, onClose, title, subtitle, size = 'md', footer, children, dismissable = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay(open, () => dismissable && onClose(), panelRef);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-surface-0/80 backdrop-blur-sm animate-fade-in" onClick={() => dismissable && onClose()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative w-full flex flex-col max-h-[92dvh] sm:max-h-[88dvh] bg-surface-1 border border-line shadow-2xl animate-slide-up outline-none',
          'border-t-2 border-t-neon-cyan',
          SIZES[size],
        )}
      >
        <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-line-soft">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-base sm:text-lg uppercase tracking-wider text-neon-cyan truncate">
              {title}
            </h2>
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          {dismissable && (
            <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 -m-1 text-muted hover:text-neon-cyan transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-line-soft safe-bottom">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
