import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: number;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  size = 'md',
  compact = false,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  /** Painéis estreitos: só a aba ativa mostra o nome; as outras mostram o ícone (nome no title). */
  compact?: boolean;
}) {
  return (
    <div role="tablist" className={cn('flex border-b border-line overflow-x-auto scrollbar-none', className)}>
      {items.map(item => {
        const active = item.id === value;
        const iconOnly = compact && !active && !!item.icon;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            aria-label={typeof item.label === 'string' ? item.label : undefined}
            title={iconOnly && typeof item.label === 'string' ? item.label : undefined}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative flex items-center gap-1.5 whitespace-nowrap font-display uppercase tracking-wider transition-colors',
              size === 'sm' ? 'px-2.5 py-2 text-[10px]' : 'px-3 py-2.5 text-[11px]',
              compact && 'flex-1 justify-center',
              active ? 'text-neon-cyan' : 'text-muted hover:text-fg',
            )}
          >
            {item.icon}
            {!iconOnly && item.label}
            {item.badge ? <span className="ml-0.5 rounded-full bg-neon-magenta text-surface-0 text-[9px] px-1.5 leading-4 tabular">{item.badge}</span> : null}
            {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-neon-cyan shadow-[0_0_8px_var(--color-neon-cyan)]" />}
          </button>
        );
      })}
    </div>
  );
}
