import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';

export interface SuggestionStripProps {
  items: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

/**
 * Faixa de sugestões com rolagem lateral: texto completo (até 3 linhas, sem reticências),
 * snap por item, setas no desktop, degradê indicando que há mais e roda do mouse horizontal.
 */
export function SuggestionStrip({ items, onPick, disabled, label = 'Sugestões', className }: SuggestionStripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, measure]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Roda do mouse vertical vira rolagem horizontal (só quando há o que rolar).
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY;
  };

  if (!items.length) return null;

  return (
    <div className={cn('relative', className)} role="group" aria-label={label}>
      <div
        ref={ref}
        onScroll={measure}
        onWheel={onWheel}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory scroll-px-1 pb-1.5 suggestion-scroll"
      >
        {items.map(text => (
          <button
            key={text}
            type="button"
            disabled={disabled}
            onClick={() => onPick(text)}
            title={text}
            className={cn(
              'snap-start shrink-0 w-[min(78vw,17rem)] sm:w-64 text-left text-xs leading-snug whitespace-normal line-clamp-3',
              'border border-line bg-surface-1 px-3 py-2 text-muted transition-colors',
              'hover:border-neon-cyan hover:text-neon-cyan focus-visible:border-neon-cyan disabled:opacity-40',
            )}
          >
            {text}
          </button>
        ))}
      </div>

      {/* Indicadores de que há mais opções para os lados */}
      <div className={cn('pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface-1 to-transparent transition-opacity', edges.start ? 'opacity-100' : 'opacity-0')} />
      <div className={cn('pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface-1 to-transparent transition-opacity', edges.end ? 'opacity-100' : 'opacity-0')} />
      {edges.start && (
        <button type="button" aria-label="Sugestões anteriores" onClick={() => scrollBy(-1)} className="hidden sm:grid absolute left-0 top-1/2 -translate-y-1/2 w-7 h-7 place-items-center bg-surface-2 border border-line text-muted hover:text-neon-cyan">
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      {edges.end && (
        <button type="button" aria-label="Mais sugestões" onClick={() => scrollBy(1)} className="hidden sm:grid absolute right-0 top-1/2 -translate-y-1/2 w-7 h-7 place-items-center bg-surface-2 border border-line text-muted hover:text-neon-cyan">
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
