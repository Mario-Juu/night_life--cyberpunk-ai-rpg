import { useState } from 'react';
import { ChevronDown, Crosshair, Dices, HeartPulse, Skull, Timer } from 'lucide-react';
import type { RollOutcome } from '@shared/types/game';
import { getSkill } from '@shared/rules/skills';
import { Badge, cn } from '../../ui';
import { useUiStore } from '../../store/uiStore';

const FAILURE_TEXT = {
  no_ammo: 'Clique seco — arma sem munição.',
  out_of_range: 'Alvo fora do alcance (longe demais para esta arma ou para chegar neste turno).',
  jammed: 'Arma travada — destrave (recarregar) antes de atirar.',
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

      {!concealed && outcome.quickhack?.combo && (
        <div className="border border-neon-yellow/60 bg-neon-yellow/10 px-2 py-1.5 text-xs text-neon-yellow">
          <span className="font-display tracking-wider">COMBO ATIVO</span> · {outcome.quickhack.combo.replace(/^Combo:\s*/i, '')}
        </div>
      )}

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
            {outcome.quickhack ? `Interface ${check.statValue}` : `${check.stat} ${check.statValue}`}
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
                {/* Ordem das regras RED: dano − SP; só o que passa da armadura é dobrado na cabeça. */}
                Dano {attack.damage.notation} [{attack.damage.rolls.join(', ')}] = {attack.application.raw} − SP {attack.application.spBefore}
                {attack.application.location === 'head' ? (
                  <>
                    {' '}= {attack.application.throughArmor} ×2 cabeça
                  </>
                ) : null}
                {attack.application.critBonus > 0 && ` + ${attack.application.critBonus} crítico`} →{' '}
                <span className="text-danger">{attack.application.hpDamage} PV</span>
                {attack.application.throughArmor === 0 && <span className="text-dim"> · não atravessou a armadura</span>}
                {attack.application.ablated && <span className="text-neon-yellow"> · SP {attack.application.spAfter}</span>}
                {attack.application.criticalInjury && <span className="text-neon-magenta"> · {attack.application.criticalInjury.name}</span>}
                {attack.targetStatusAfter === 'down' && !attack.knockedOut && (
                  <span className="text-neon-green">
                    {' '}
                    · <Skull className="inline w-3 h-3" /> abatido
                  </span>
                )}
                {attack.knockedOut && <span className="text-neon-green"> · nocauteado (vivo)</span>}
                {attack.nonLethal === 'rubber' && <span className="text-dim"> · borracha: não mata</span>}
              </p>
            )}
            {attack.autofireMult && <p className="text-neon-yellow">Rajada: 10 tiros · multiplicador ×{attack.autofireMult}</p>}
            {attack.ambush && <p className="text-neon-cyan">Emboscada: o alvo não esquivou e os inimigos perdem a próxima ação.</p>}
            {attack.jammedNow && <p className="text-danger">A arma ruim TRAVOU (1 natural) — destrave antes de atirar de novo.</p>}
            {attack.coverDamage && (
              <p>
                Tiro na cobertura: {attack.coverDamage.before} → {attack.coverDamage.after} PV
                {attack.coverDamage.after <= 0 && <span className="text-neon-green"> · cobertura destruída, alvo exposto</span>}
              </p>
            )}
            {attack.areaHits && attack.areaHits.length > 0 && (
              <ul className="space-y-0.5">
                <li className="text-neon-yellow">Explosão{attack.grenade && attack.grenade !== 'basic' ? ` (${attack.grenade})` : ''}:</li>
                {attack.areaHits.map(h => (
                  <li key={h.targetId}>
                    · {h.name}:{' '}
                    {h.dodged ? (
                      <span className="text-dim">pulou para fora da área</span>
                    ) : (
                      <>
                        {h.application && <span className="text-danger">−{h.application.hpDamage} PV</span>}
                        {h.effect && <span className="text-neon-magenta"> {h.effect}</span>}
                        {h.statusAfter === 'down' && <span className="text-neon-green"> · fora de combate</span>}
                        {!h.application && !h.effect && <span className="text-dim">sem efeito</span>}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {attack.suppression && (
              <ul className="space-y-0.5">
                <li className="text-neon-yellow">Fogo de supressão (10 tiros):</li>
                {attack.suppression.length === 0 && <li className="text-dim">ninguém ao alcance (25 m, fora de cobertura total)</li>}
                {attack.suppression.map(x => (
                  <li key={x.id}>
                    · {x.name}: {x.held ? <span className="text-dim">segurou os nervos</span> : <span className="text-neon-green">mergulhou na cobertura e perde o ataque</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {outcome.followUp && (
          <div className="border-t border-line-soft pt-2">
            <p className="eyebrow mb-1">Segundo ataque (Cadência 2)</p>
            <RollResult outcome={outcome.followUp} defaultOpen concealed={concealed} />
          </div>
        )}
        </div>
      )}
    </div>
  );
}
