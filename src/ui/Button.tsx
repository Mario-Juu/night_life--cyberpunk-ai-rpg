import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn, type Tone } from './cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'outline' | 'solid' | 'ghost' | 'neon' | 'link';
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  cut?: boolean;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

/** Botão baseado em cp-btn, com API tipada (apenas modificadores que existem na lib). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', tone = 'cyan', size = 'md', cut, block, loading, icon, className, children, type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-loading={loading ? 'true' : undefined}
      className={cn(
        'cp-btn',
        variant !== 'outline' && `cp-btn--${variant}`,
        tone !== 'cyan' && `cp-btn--${tone}`,
        size !== 'md' && `cp-btn--${size}`,
        cut && 'cp-btn--cut',
        block && 'cp-btn--block',
        'disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  label: string;
  icon: ReactNode;
  badge?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, badge, className, variant = 'ghost', size = 'md', ...rest },
  ref,
) {
  return (
    <Button ref={ref} aria-label={label} title={label} variant={variant} size={size} className={cn('cp-btn--icon relative shrink-0', className)} {...rest}>
      {icon}
      {badge ? (
        <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-neon-magenta text-surface-0 text-[10px] font-bold leading-4 text-center tabular">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </Button>
  );
});
