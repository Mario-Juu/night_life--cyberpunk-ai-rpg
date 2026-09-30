import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Skull } from 'lucide-react';
import { CYBERPSYCHO_ACTIONS, isCyberpsycho } from '@shared/rules/humanity';
import type { GameState } from '@shared/types/game';
import { Button, SuggestionStrip, cn } from '../../ui';
import { sendAction } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
import { RollCard } from './RollCard';

export function ActionInput({ game }: { game: GameState }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = useUiStore(s => s.gmBusy);
  const gmRollPending = game.pendingRoll?.origin === 'gm' || game.pendingRoll?.kind === 'deathSave';
  const dead = game.character.dead;
  // Ciberpsicose: o teclado some — só sobram os impulsos.
  const psycho = isCyberpsycho(game.character);
  const disabled = busy || gmRollPending || dead;

  // Altura automática (1 a 5 linhas).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = (value: string) => {
    const clean = value.trim();
    if (!clean || disabled) return;
    setText('');
    void sendAction(clean);
  };

  const placeholder = dead
    ? 'Seu personagem morreu.'
    : gmRollPending
      ? 'Role o teste acima…'
      : busy
        ? 'O Mestre está narrando…'
        : 'O que você faz, choom?';

  return (
    <div className="shrink-0 border-t border-line bg-surface-1/95 backdrop-blur px-3 sm:px-6 pt-3 pb-3 safe-bottom">
      <div className="max-w-3xl mx-auto space-y-2.5">
        {game.pendingRoll && <RollCard key={game.pendingRoll.id} game={game} />}

        {!game.pendingRoll && !dead && !psycho && <SuggestionStrip items={game.suggestedActions} onPick={submit} disabled={disabled} label="Ações sugeridas" />}

        {psycho && !dead && (
          <div className="psycho-lock border border-danger/60 bg-danger/10 p-3 space-y-2" role="group" aria-label="Ciberpsicose">
            <p className="flex items-center gap-2 font-display text-[11px] uppercase tracking-[0.3em] text-danger psycho-text">
              <Skull className="w-4 h-4" /> Controle perdido · ciberpsicose
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(game.suggestedActions.length ? game.suggestedActions : CYBERPSYCHO_ACTIONS).map(a => (
                <button
                  key={a}
                  type="button"
                  disabled={disabled}
                  onClick={() => submit(a)}
                  className="text-left text-sm px-3 py-2 border border-danger/50 bg-surface-0/70 text-fg hover:bg-danger/20 hover:border-danger disabled:opacity-40 psycho-option"
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        {!psycho && (
        <form
          className="flex items-end gap-2"
          onSubmit={e => {
            e.preventDefault();
            submit(text);
          }}
        >
          <textarea
            ref={ref}
            rows={1}
            value={text}
            maxLength={1500}
            disabled={disabled}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(text);
              }
            }}
            placeholder={placeholder}
            aria-label="Sua ação"
            className={cn('cp-input flex-1 resize-none text-sm leading-snug py-2.5 min-h-[42px]', disabled && 'opacity-60')}
          />
          <Button type="submit" variant="solid" disabled={disabled || !text.trim()} aria-label="Enviar ação" className="h-[42px]">
            <CornerDownLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Agir</span>
          </Button>
        </form>
        )}
      </div>
    </div>
  );
}
