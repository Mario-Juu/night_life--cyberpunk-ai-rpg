import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { Button, Spinner } from '../../ui';
import { regenerateNarration, requestOpening } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
import { ChatEntryView } from './ChatEntryView';

const PAGE = 60;

export function NarrativeFeed({ game }: { game: GameState }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(PAGE);
  const busy = useUiStore(s => s.gmBusy);
  const busyLabel = useUiStore(s => s.gmBusyLabel);
  const phoneTyping = useUiStore(s => s.phoneTyping);
  // Rolagem do turno atual fica sem desfecho até a narração chegar.
  const concealing = useUiStore(s => s.concealedGame !== null);

  const entries = game.chat.slice(-visible);
  // Entradas que já existiam ao abrir o jogo não são animadas de novo.
  const initialIds = useRef<Set<string> | null>(null);
  if (!initialIds.current) initialIds.current = new Set(game.chat.map(e => e.id));
  // Só a última narração do turno atual (turno fechado, sem rolagem pendente) pode ser regenerada.
  const lastNarration = [...game.chat].reverse().find(e => e.kind === 'narration');
  const regenerableId = !busy && !game.pendingRoll && lastNarration?.turn === game.turn ? lastNarration.id : null;
  const hidden = game.chat.length - entries.length;

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Rola para o fim apenas quando o jogador já estava no fim.
  useEffect(() => {
    if (atBottom) scrollToBottom(game.chat.length > 1);
  }, [game.chat.length, busy, game.pendingRoll?.id]);

  useEffect(() => scrollToBottom(false), []);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="h-full overflow-y-auto px-3 sm:px-6 py-5"
      >
        <div className="max-w-3xl mx-auto space-y-5">
          {hidden > 0 && (
            <button type="button" onClick={() => setVisible(v => v + PAGE)} className="w-full text-center eyebrow py-2 hover:text-neon-cyan">
              Carregar {Math.min(PAGE, hidden)} mensagens anteriores
            </button>
          )}
          {!busy && !game.chat.some(e => e.kind === 'narration') && (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted">A cidade está em silêncio. O prólogo ainda não foi narrado.</p>
              <Button variant="solid" onClick={() => void requestOpening()}>
                Gerar abertura
              </Button>
            </div>
          )}
          {entries.map(entry => (
            <ChatEntryView
              key={entry.id}
              entry={entry}
              fresh={!initialIds.current?.has(entry.id)}
              concealed={concealing && entry.kind === 'roll' && entry.turn === game.turn}
              onRegenerate={entry.id === regenerableId ? () => window.confirm('Gerar uma nova narração para este turno? A mecânica (dados, dano, itens) continua a mesma.') && void regenerateNarration() : undefined}
            />
          ))}
          {busy && !phoneTyping && (
            <div className="flex items-center gap-2 text-sm text-muted animate-pulse-soft" role="status">
              <Spinner /> {busyLabel || 'O Mestre pensa…'}
            </div>
          )}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          aria-label="Ir para o fim"
          className="absolute bottom-3 right-4 w-9 h-9 grid place-items-center bg-surface-2 border border-neon-cyan/50 text-neon-cyan shadow-lg"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
