import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type CardTone = 'cyan' | 'magenta' | 'yellow' | 'green' | 'purple';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tone?: CardTone;
  cut?: boolean;
  raised?: boolean;
  bodyClassName?: string;
}

/** Painel baseado em cp-card. */
export function Card({ title, subtitle, actions, tone = 'cyan', cut, raised, className, bodyClassName, children, ...rest }: CardProps) {
  return (
    <section
      className={cn('cp-card', tone !== 'cyan' && `cp-card--${tone}`, cut && 'cp-card--cut', raised && 'cp-card--raised', 'hover:shadow-none', className)}
      {...rest}
    >
      {(title || actions) && (
        <header className="cp-card__header flex items-start justify-between gap-2 px-3 pt-3 pb-2">
          <div className="min-w-0">
            {title && <h3 className="cp-card__title text-sm truncate">{title}</h3>}
            {subtitle && <p className="cp-card__subtitle text-xs">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn('cp-card__body px-3 pb-3', !title && !actions && 'pt-3', bodyClassName)}>{children}</div>
    </section>
  );
}
