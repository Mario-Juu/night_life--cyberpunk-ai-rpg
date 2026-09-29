import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

type InputTone = 'cyan' | 'magenta' | 'yellow' | 'green' | 'purple';

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('cp-field', className)}>
      <span className="cp-field__label">{label}</span>
      {children}
      {error ? <span className="cp-field__hint cp-field__hint--error">{error}</span> : hint ? <span className="cp-field__hint">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { tone?: InputTone }>(function Input(
  { tone = 'cyan', className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn('cp-input', tone !== 'cyan' && `cp-input--${tone}`, 'w-full', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('cp-input cp-textarea w-full resize-none', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn('cp-input cp-select w-full', className)} {...rest} />;
});
