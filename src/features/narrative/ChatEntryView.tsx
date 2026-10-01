import { memo } from 'react';
import { AlertTriangle, Radar, RefreshCw, Search, Swords } from 'lucide-react';
import type { ChatEntry } from '@shared/types/game';
import { parseNarration } from '@shared/engine/narration';
import { cn } from '../../ui';
import { RollResult } from './RollResult';

function Narration({ text, degraded, onRegenerate, fresh }: { text: string; degraded?: boolean; onRegenerate?: () => void; fresh?: boolean }) {
  const segments = parseNarration(text);
  // Entradas novas aparecem trecho a trecho (efeito de transmissão); as antigas ficam estáticas.
  let order = 0;
  const reveal = () => (fresh ? { className: 'animate-reveal', style: { animationDelay: `${order++ * 260}ms` } } : { className: '', style: undefined });
  return (
    <article className={cn('space-y-3 text-[15px] leading-relaxed text-fg/90', degraded && 'border-l-2 border-neon-yellow pl-3 text-muted')}>
      {degraded && (
        <p className="flex items-center gap-1.5 eyebrow text-neon-yellow">
          <AlertTriangle className="w-3.5 h-3.5" /> Modo degradado
        </p>
      )}
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          seg.text.split(/\n\s*\n/).map((p, j) => {
            const r = reveal();
            return (
              <p key={`${i}-${j}`} className={cn('whitespace-pre-line', r.className)} style={r.style}>
                {p}
              </p>
            );
          })
        ) : (
          <blockquote key={i} className={cn('border-l-2 border-neon-magenta bg-neon-magenta/5 pl-3 pr-2 py-2', reveal().className)} style={fresh ? { animationDelay: `${(order - 1) * 260}ms` } : undefined}>
            <cite className="not-italic font-display text-[10px] uppercase tracking-widest text-neon-magenta">{seg.speaker}</cite>
            <p className="mt-1 text-fg italic">“{seg.text}”</p>
          </blockquote>
        ),
      )}
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-dim hover:text-neon-cyan"
          title="Mesma resolução mecânica, nova narração"
        >
          <RefreshCw className="w-3 h-3" /> Regenerar narração
        </button>
      )}
    </article>
  );
}

export const ChatEntryView = memo(function ChatEntryView({ entry, onRegenerate, concealed, fresh }: { entry: ChatEntry; onRegenerate?: () => void; concealed?: boolean; fresh?: boolean }) {
  switch (entry.kind) {
    case 'narration':
      return <Narration text={entry.text} degraded={entry.degraded} onRegenerate={onRegenerate} fresh={fresh} />;
    case 'player':
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] bg-neon-cyan/10 border border-neon-cyan/30 px-3 py-2">
            <p className="eyebrow text-neon-cyan mb-0.5">Você</p>
            <p className="text-sm text-fg whitespace-pre-line">{entry.text}</p>
          </div>
        </div>
      );
    case 'roll':
      return entry.roll ? <RollResult outcome={entry.roll} concealed={concealed} /> : null;
    case 'discovery':
      return (
        <div className="border border-neon-yellow/40 bg-neon-yellow/5 px-3 py-2 flex gap-2">
          <Search className="w-4 h-4 text-neon-yellow shrink-0 mt-0.5" />
          <div>
            <p className="font-display text-[11px] uppercase tracking-wider text-neon-yellow">{entry.discovery?.title ?? 'Descoberta'}</p>
            <p className="text-sm text-muted">{entry.text}</p>
          </div>
        </div>
      );
    case 'combat':
      return (
        <p className="flex items-start gap-2 text-sm text-danger/90 border-l-2 border-danger pl-3">
          <Swords className="w-4 h-4 shrink-0 mt-0.5" />
          {entry.text}
        </p>
      );
    case 'net':
      return (
        <div className="border border-neon-cyan/30 bg-neon-cyan/5 px-3 py-2 flex gap-2">
          <Radar className="w-4 h-4 text-neon-cyan shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="eyebrow text-neon-cyan mb-0.5">Rede</p>
            <p className="tabular text-xs text-muted whitespace-pre-line break-words">{entry.text}</p>
          </div>
        </div>
      );
    case 'system':
    default:
      return (
        <div className="space-y-1">
          <p className="text-center tabular text-[11px] text-dim">{entry.text}</p>
          {onRegenerate && (
            <button type="button" onClick={onRegenerate} className="mx-auto flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted hover:text-neon-cyan">
              <RefreshCw className="w-3 h-3" /> Tentar narrar de novo
            </button>
          )}
        </div>
      );
  }
});
