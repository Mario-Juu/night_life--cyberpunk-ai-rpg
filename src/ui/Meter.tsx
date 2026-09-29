import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';

type MeterTone = 'cyan' | 'magenta' | 'yellow' | 'green' | 'purple' | 'danger';

export interface MeterProps {
  label?: ReactNode;
  value: number;
  max: number;
  tone?: MeterTone;
  size?: 'sm' | 'md' | 'lg';
  striped?: boolean;
  showValue?: boolean;
  className?: string;
}

/** Barra de progresso baseada em cp-progress. */
export function Meter({ label, value, max, tone = 'cyan', size = 'md', striped, showValue = true, className }: MeterProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn('space-y-1', className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && <span className="eyebrow">{label}</span>}
          {showValue && (
            <span className="tabular text-xs text-fg">
              {value}
              <span className="text-dim">/{max}</span>
            </span>
          )}
        </div>
      )}
      <div
        className={cn('cp-progress', tone !== 'cyan' && `cp-progress--${tone}`, size !== 'md' && `cp-progress--${size}`, striped && 'cp-progress--striped')}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        style={{ '--cp-progress': `${pct}%` } as CSSProperties}
      >
        <div className="cp-progress__bar" />
      </div>
    </div>
  );
}
