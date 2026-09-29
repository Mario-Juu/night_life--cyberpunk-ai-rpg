import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useToastStore, type ToastTone } from './toastStore';
import { cn } from './cn';

const TONE: Record<ToastTone, string> = {
  info: 'border-l-neon-cyan',
  success: 'border-l-neon-green',
  warning: 'border-l-neon-yellow',
  danger: 'border-l-danger',
};

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  return createPortal(
    <div className="fixed z-60 top-16 right-3 left-3 sm:left-auto sm:w-80 flex flex-col gap-2 pointer-events-none" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={cn('pointer-events-auto bg-surface-2 border border-line border-l-4 shadow-xl px-3 py-2.5 animate-slide-up', TONE[t.tone])}>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-display text-[11px] uppercase tracking-wider text-fg">{t.title}</p>
              {t.body && <p className="text-xs text-muted mt-0.5 line-clamp-3">{t.body}</p>}
              {t.action && (
                <button
                  type="button"
                  className="mt-1.5 text-[11px] font-display uppercase tracking-wider text-neon-cyan hover:underline"
                  onClick={() => {
                    t.action?.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dispensar" onClick={() => dismiss(t.id)} className="text-dim hover:text-fg">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
