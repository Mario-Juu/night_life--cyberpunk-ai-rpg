import { useState } from 'react';
import { Clover, Dices, Minus, Plus, X } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { getSkill } from '@shared/rules/skills';
import { checkPenalties, deathSavePenalty } from '@shared/engine/health';
import { skillValue, statValue } from '@shared/engine/checks';
import { canSpendLuck, requestModifiers } from '@shared/engine/rolls';
import { AIMED_SHOT_PENALTY } from '@shared/rules/weapons';
import { Badge, Button, cn } from '../../ui';
import { cancelLocalRoll, rollPending } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';

/** O ÚNICO lugar onde se rola o teste pendente. */
export function RollCard({ game }: { game: GameState }) {
  const request = game.pendingRoll;
  const busy = useUiStore(s => s.gmBusy);
  const [luck, setLuck] = useState(0);
  const [rolling, setRolling] = useState(false);
  if (!request) return null;

  const c = game.character;
  const skill = getSkill(request.skillId);
  const isDeath = request.kind === 'deathSave';
  const penalties = isDeath ? [] : checkPenalties(c, request.stat);
  // Mesmos modificadores que o motor aplicará (situação, relação, cena, efeitos, ferimentos).
  const mods = isDeath
    ? []
    : [...requestModifiers(game, request), ...(request.aimedHead ? [{ label: 'Mira na cabeça', value: AIMED_SHOT_PENALTY }] : []), ...penalties];
  const base = statValue(c, request.stat) + skillValue(c, request.skillId) + mods.reduce((s, m) => s + m.value, 0);
  const luckAllowed = canSpendLuck(request) && c.luck.current > 0;
  // O DV é segredo do Mestre (como numa mesa real); só aparece no modo transparente.
  const revealDv = useUiStore(s => s.revealDv);
  const showDv = revealDv && request.dv > 0;

  const roll = async () => {
    setRolling(true);
    await rollPending(luckAllowed ? luck : 0);
    setRolling(false);
    setLuck(0);
  };

  return (
    <div
      className={cn(
        'border-2 bg-surface-2/95 backdrop-blur px-3 py-3 space-y-3 animate-slide-up',
        isDeath ? 'border-danger shadow-[0_0_24px_rgba(255,0,60,0.35)]' : 'border-neon-yellow/70 shadow-[0_0_18px_rgba(252,238,10,0.18)]',
      )}
      role="region"
      aria-label="Teste pendente"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('eyebrow', isDeath ? 'text-danger' : 'text-neon-yellow')}>
            {isDeath ? 'Teste de Morte' : request.kind === 'attack' ? 'Ataque' : request.origin === 'gm' ? 'O Mestre pede um teste' : 'Teste'}
          </p>
          <p className="text-sm text-fg leading-snug mt-0.5">{request.reason}</p>
        </div>
        {request.origin === 'player' && (
          <button type="button" onClick={cancelLocalRoll} disabled={rolling || busy} aria-label="Cancelar ataque" className="text-muted hover:text-fg p-1 -m-1">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 tabular text-xs">
        {isDeath ? (
          <>
            <Badge tone="danger">1d10 + {deathSavePenalty(c)} ≤ BODY {c.stats.BODY}</Badge>
            <span className="text-muted">10 natural sempre falha.</span>
          </>
        ) : (
          <>
            <Badge>
              {request.stat} {statValue(c, request.stat)}
            </Badge>
            {skill && (
              <Badge tone="purple">
                {skill.label} {skillValue(c, request.skillId)}
              </Badge>
            )}
            {mods.map(m => (
              <Badge key={m.label} tone={m.value < 0 ? 'danger' : 'green'}>
                {m.label} {m.value > 0 ? '+' : ''}
                {m.value}
              </Badge>
            ))}
            <span className="text-muted">
              = {base} + 1d10{showDv ? ` vs DV ${request.dv}` : ''}
            </span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {luckAllowed ? (
          <div className="flex items-center gap-1.5" title="Gaste pontos de Sorte para somar ao teste. Recarregam a cada dia.">
            <Clover className="w-4 h-4 text-neon-green" />
            <span className="text-xs text-muted">Sorte</span>
            <button type="button" aria-label="Menos sorte" disabled={luck <= 0} onClick={() => setLuck(l => l - 1)} className="w-6 h-6 border border-line grid place-items-center disabled:opacity-30">
              <Minus className="w-3 h-3" />
            </button>
            <span className="tabular text-sm w-8 text-center">
              {luck}/{c.luck.current}
            </span>
            <button type="button" aria-label="Mais sorte" disabled={luck >= c.luck.current} onClick={() => setLuck(l => l + 1)} className="w-6 h-6 border border-line grid place-items-center disabled:opacity-30">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <span />
        )}
        <Button
          variant="neon"
          tone={isDeath ? 'danger' : 'yellow'}
          onClick={roll}
          loading={rolling}
          disabled={busy && !rolling}
          icon={<Dices className={cn('w-4 h-4', rolling && 'animate-dice')} />}
        >
          Rolar 1d10
        </Button>
      </div>
    </div>
  );
}
