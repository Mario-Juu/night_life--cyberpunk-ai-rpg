import type { ReactNode } from 'react';
import { cn } from './cn';

export function Spinner({ size = 'sm', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <span className={cn('cp-spinner', `cp-spinner--${size}`, className)} role="status" aria-label="Carregando" />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-8 px-4 text-muted">
      {icon && <div className="text-dim">{icon}</div>}
      <p className="font-display text-xs uppercase tracking-widest">{title}</p>
      {children && <div className="text-xs max-w-xs">{children}</div>}
    </div>
  );
}

export function Stepper({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn('cp-stepper cp-stepper--sm', className)} role="list">
      {steps.map((title, i) => (
        <li key={title} className={cn('cp-stepper__step', i < current && 'cp-stepper__step--complete', i === current && 'cp-stepper__step--current')}>
          <span className="cp-stepper__marker">{i + 1}</span>
          <span className="cp-stepper__title hidden sm:inline">{title}</span>
        </li>
      ))}
    </ol>
  );
}

/** Linha rótulo/valor compacta. */
export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-sm', className)}>
      <span className="text-muted">{label}</span>
      <span className="text-fg text-right">{children}</span>
    </div>
  );
}
