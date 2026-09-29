import { useState } from 'react';
import { ChevronDown, Crosshair, Dices, HeartPulse, Skull, Timer } from 'lucide-react';
import type { RollOutcome } from '@shared/types/game';
import { getSkill } from '@shared/rules/skills';
import { Badge, cn } from '../../ui';
import { useUiStore } from '../../store/uiStore';

const FAILURE_TEXT = {
  no_ammo: 'Clique seco — arma sem munição.',
  out_of_range: 'Alvo fora do alcance desta arma.',
  in_cover: 'Alvo protegido por cobertura total.',
  no_target: 'Alvo indisponível.',
} as const;

/**
 * Resultado de rolagem já resolvido pelo motor (somente leitura; nunca tem botão de rolar).
 * `concealed`: a narração ainda não chegou — mostra só os dados, sem desfecho.
 */
export function RollResult({ outcome, defaultOpen = false, concealed = false }: { outcome: RollOutcome; defaultOpen?: boolean; concealed?: boolean }) {
  const { check, request, attack, deathSave, initiative } = outcome;
  const [open, setOpen] = useState(defaultOpen);
  const revealDv = useUiStore(s => s.revealDv);
  const skill = getSkill(check.skillId);
  const Icon = deathSave ? HeartPulse : initiative ? Timer : attack ? Crosshair : Dices;

  const verdict = concealed
    ? { label: 'O Mestre narra…', tone: 'muted' as const }
    : initiative
    ? { label: `Iniciativa ${initiative.player}`, tone: 'cyan' as const }
    : deathSave
      ? deathSave.success
        ? { label: 'Sobreviveu', tone: 'green' as const }
        : { label: 'Flatline', tone: 'danger' as const }
      : check.success
        ? { label: check.d10.crit ? 'Sucesso crítico' : 'Sucesso', tone: 'green' as const }
        : { label: check.d10.fumble ? 'Falha crítica' : 'Falha', tone: 'danger' as const };

  return (
    <div className={cn('border bg-surface-1/80 px-3 py-2.5 space-y-2', verdict.tone === 'green' ? 'border-neon-green/40' : verdict.tone === 'danger' ? 'border-danger/50' : 'border-neon-cyan/40')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="w-4 h-4 mt-0.5 shrink-0 text-neon-cyan" />
          <p className="text-sm text-fg leading-snug">{request.reason}</p>
        </div>
        <Badge tone={verdict.tone} solid={!concealed} className={cn('shrink-0', concealed && 'animate-pulse-soft')}>
          {verdict.label}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-2 tabular text-xs text-muted">
        <span>
          {attack?.failure
            ? FAILURE_TEXT[attack.failure]
            : initiative
              ? `Você age na iniciativa ${initiative.player}`
              : deathSave
                ? `d10 ${deathSave.roll} · precisa ≤ ${deathSave.target}`
                : revealDv && !concealed ? `${check.total} vs DV ${check.dv}` : `Total ${check.total}`}
          {!concealed && attack?.application && !attack.failure && <span className="text-danger"> · −{attack.application.hpDamage} PV em {attack.targetName}</span>}
        </span>
        {!concealed && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-dim hover:text-neon-cyan shrink-0">
            {open ? 'Ocultar' : 'Detalhes'}
            <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>

      {open && !concealed && (
        <div className="space-y-2 border-t border-line-soft pt-2">
          {attack?.failure ? (
          <p className="text-xs text-neon-yellow">{FAILURE_TEXT[attack.failure]}</p>
        ) : initiative ? (
          <p className="tabular text-xs text-muted">
            Você: REF {check.statValue} + d10 {check.d10.natural} = <span className="text-fg">{initiative.player}</span>
            {initiative.enemies.length > 0 && <> · Inimigos: {initiative.enemies.map(e => e.value).join(', ')}</>}
          </p>
        ) : deathSave ? (
          <p className="tabular text-xs text-muted">
            d10 {deathSave.roll}
            {check.modifiers.map(m => ` + ${m.value} (${m.label})`)} = <span className="text-fg">{check.total}</span> · precisa ≤ BODY {deathSave.target}
            {deathSave.roll === 10 && ' · 10 natural sempre falha'}
          </p>
        ) : (
          <p className="tabular text-xs text-muted leading-relaxed">
            {check.stat} {check.statValue}
            {skill && ` + ${skill.label} ${check.skillValue}`}
            {' + d10 '}
            <span className={cn(check.d10.crit && 'text-neon-green', check.d10.fumble && 'text-danger')}>
              {check.d10.crit ? `${check.d10.rolls[0]}+${check.d10.rolls[1]}` : check.d10.fumble ? `${check.d10.rolls[0]}−${check.d10.rolls[1]}` : check.d10.natural}
            </span>
            {check.modifiers.map(m => (
              <span key={m.label}>
                {' '}
                {m.value >= 0 ? '+' : '−'} {Math.abs(m.value)} <span className="text-dim">({m.label})</span>
              </span>
            ))}
            {check.luckSpent > 0 && <span className="text-neon-yellow"> + {check.luckSpent} Sorte</span>}
            {' = '}
            <span className="text-fg text-sm">{check.total}</span>
            {revealDv && (
              <>
                <span className="text-dim"> vs DV </span>
                <span className="text-fg">{check.dv}</span>
              </>
            )}
          </p>
        )}
  
        {attack && !attack.failure && (
          <div className="tabular text-xs text-muted border-t border-line-soft pt-2 space-y-0.5">
            <p>
              {attack.weaponName} → {attack.targetName}
              {attack.ammoAfter !== null && <span className="text-dim"> · pente {attack.ammoAfter}</span>}
            </p>
            {attack.damage && attack.application && (
              <p>
                Dano {attack.damage.notation} [{attack.damage.rolls.join(', ')}] = {attack.application.raw}
                {attack.application.location === 'head' && ' ×2 cabeça'} − SP {attack.application.spBefore} →{' '}
                <span className="text-danger">{attack.application.hpDamage} PV</span>
                {attack.application.ablated && <span className="text-neon-yellow"> · SP {attack.application.spAfter}</span>}
                {attack.application.criticalInjury && <span className="text-neon-magenta"> · {attack.application.criticalInjury.name}</span>}
                {attack.targetStatusAfter === 'down' && (
                  <span className="text-neon-green">
                    {' '}
                    · <Skull className="inline w-3 h-3" /> abatido
                  </span>
                )}
              </p>
            )}
          </div>
        )}
        </div>
      )}
    </div>
  );
}
