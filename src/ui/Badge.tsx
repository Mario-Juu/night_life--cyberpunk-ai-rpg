import type { HTMLAttributes } from 'react';
import { cn, type Tone } from './cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone | 'muted';
  solid?: boolean;
  cut?: boolean;
  dot?: boolean;
}

export function Badge({ tone = 'cyan', solid, cut, dot, className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn('cp-badge', tone !== 'cyan' && `cp-badge--${tone}`, solid && 'cp-badge--solid', cut && 'cp-badge--cut', dot && 'cp-badge--dot', className)}
      {...rest}
    />
  );
}
