import { ArrowUp, Minus, Plus } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import {
  COMBAT_AWARENESS,
  DRUGS,
  MAKER_SPECIALTIES,
  MAX_ROLE_RANK,
  MEDICINE_SPECIALTIES,
  ROLE_ABILITY,
  familyVehicle,
  makerPointsTotal,
  operatorPerks,
  roleUpgradeCost,
} from '@shared/rules/roles';
import { PROGRAMS, netActionsFor } from '@shared/rules/net';
import { useTutorial } from '../tutorial/TutorialModal';
import { freePoints, surgeryValue, unlockedDrugs, type RoleSection } from '@shared/engine/roles';
import { Badge, Button, cn } from '../../ui';
import { dispatch } from '../../store/gameStore';
import { sound } from '../../services/audio';

function Stepper({ label, value, hint, onMinus, onPlus, disabledMinus, disabledPlus }: { label: string; value: number; hint?: string; onMinus: () => void; onPlus: () => void; disabledMinus?: boolean; disabledPlus?: boolean }) {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm', value > 0 ? 'text-fg' : 'text-dim')}>{label}</p>
        {hint && <p className="text-[10px] text-dim leading-snug">{hint}</p>}
      </div>
      <button type="button" onClick={onMinus} disabled={disabledMinus} aria-label={`Menos ${label}`} className="w-6 h-6 grid place-items-center border border-line text-muted disabled:opacity-20 hover:bg-surface-2">
        <Minus className="w-3 h-3" />
      </button>
      <span className="tabular w-5 text-center">{value}</span>
      <button type="button" onClick={onPlus} disabled={disabledPlus} aria-label={`Mais ${label}`} className="w-6 h-6 grid place-items-center border border-line text-neon-cyan disabled:opacity-20 hover:bg-neon-cyan/10">
        <Plus className="w-3 h-3" />
      </button>
    </li>
  );
}

export function RoleTab({ game }: { game: GameState }) {
  const c = game.character;
  const info = ROLE_ABILITY[c.bio.role];
  const d = c.roleData;
  useTutorial('role', true);
  const free = freePoints(c);
  const cost = roleUpgradeCost(c.roleRank + 1);
  const canUp = c.roleRank < MAX_ROLE_RANK && c.ip >= cost;
  const alloc = (section: RoleSection, key: string, delta: number) => {
    sound.playClick();
    dispatch({ type: 'allocateRole', section, key, delta });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="eyebrow">Habilidade de Papel</p>
            <h3 className="font-display text-base uppercase tracking-wider text-neon-yellow">{info.name}</h3>
          </div>
          <div className="text-center">
            <p className="font-display text-[9px] tracking-widest text-neon-cyan">RANK</p>
            <p className="tabular text-2xl leading-none">{c.roleRank}</p>
          </div>
        </div>
        <p className="text-xs text-muted leading-relaxed">{info.summary}</p>
        <Button
          size="sm"
          variant="ghost"
          tone="yellow"
          disabled={!canUp}
          icon={<ArrowUp className="w-3.5 h-3.5" />}
          onClick={() => {
            sound.playSuccess();
            dispatch({ type: 'improveRole' });
          }}
        >
          {c.roleRank >= MAX_ROLE_RANK ? 'Rank máximo' : `Rank ${c.roleRank + 1} · ${cost} PM`}
        </Button>
        {c.roleRank < MAX_ROLE_RANK && (
          <p className="text-[11px] text-dim">
            Você tem <span className="tabular text-neon-cyan">{c.ip} PM</span>. Os PM vêm de trabalhos concluídos e boas jogadas.
          </p>
        )}
      </section>

      {c.bio.role === 'solo' && (
        <section className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Consciência de Combate</p>
            <Badge tone={free > 0 ? 'yellow' : 'muted'}>{free} livre(s)</Badge>
          </div>
          {game.combat.active && <p className="text-[11px] text-neon-yellow">Em combate, redistribuir custa sua Ação — ajuste depois da luta.</p>}
          <ul className="divide-y divide-line-soft">
            {COMBAT_AWARENESS.map(o => {
              const v = d.combatAwareness?.[o.key] ?? 0;
              return (
                <Stepper
                  key={o.key}
                  label={o.label}
                  value={v}
                  hint={v > 0 ? o.describe(v) : `passo de ${o.step} ponto(s)`}
                  onMinus={() => alloc('combatAwareness', o.key, -1)}
                  onPlus={() => alloc('combatAwareness', o.key, +1)}
                  disabledMinus={v === 0 || game.combat.active}
                  disabledPlus={free < o.step || v >= o.max || game.combat.active}
                />
              );
            })}
          </ul>
        </section>
      )}

      {c.bio.role === 'tech' && (
        <section className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Especialidades ({makerPointsTotal(c.roleRank)} pontos)</p>
            <Badge tone={free > 0 ? 'yellow' : 'muted'}>{free} livre(s)</Badge>
          </div>
          <ul className="divide-y divide-line-soft">
            {MAKER_SPECIALTIES.map(m => {
              const v = d.maker?.[m.key] ?? 0;
              return (
                <Stepper key={m.key} label={m.label} value={v} hint={m.description} onMinus={() => alloc('maker', m.key, -1)} onPlus={() => alloc('maker', m.key, +1)} disabledMinus={v === 0} disabledPlus={free <= 0 || v >= c.roleRank} />
              );
            })}
          </ul>
          <p className="text-[11px] text-dim">Peça em texto: "aprimoro minha pistola", "fabrico um colete", "invento um drone".</p>
        </section>
      )}

      {c.bio.role === 'medtech' && (
        <section className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Medicina</p>
            <Badge tone={free > 0 ? 'yellow' : 'muted'}>{free} livre(s)</Badge>
          </div>
          <ul className="divide-y divide-line-soft">
            {MEDICINE_SPECIALTIES.map(m => {
              const v = d.medicine?.[m.key] ?? 0;
              return (
                <Stepper key={m.key} label={m.label} value={v} hint={m.description} onMinus={() => alloc('medicine', m.key, -1)} onPlus={() => alloc('medicine', m.key, +1)} disabledMinus={v === 0} disabledPlus={free <= 0 || v >= m.max} />
              );
            })}
          </ul>
          <p className="text-[11px] text-muted">
            Cirurgia <span className="tabular text-neon-cyan">{surgeryValue(c)}</span> · Drogas:{' '}
            {unlockedDrugs(d).map(k => DRUGS[k].label).join(', ') || 'nenhuma'}
          </p>
          <p className="text-[11px] text-dim">Peça em texto: "preparo Speedheal", "trato a costela quebrada".</p>
        </section>
      )}

      {c.bio.role === 'netrunner' && (
        <section className="space-y-2">
          <p className="eyebrow">Ciberdeck</p>
          <p className="text-sm">
            {c.deck?.name ?? 'Sem deck'} <span className="text-dim">· {netActionsFor(c.roleRank)} Ações de Rede/turno</span>
          </p>
          <ul className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: c.deck?.slots ?? 0 }, (_, i) => {
              const p = (c.deck?.programs ?? []).filter(x => !x.destroyed)[i];
              return (
                <li key={i} className={cn('border px-2 py-1 text-[11px]', p ? 'border-neon-cyan/40 text-fg' : 'border-line-soft text-dim')} title={p ? PROGRAMS[p.key].effect : 'slot livre'}>
                  {p ? PROGRAMS[p.key].name : 'slot livre'}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-dim">Use a aba Rede no painel lateral quando houver um ponto de acesso na cena.</p>
        </section>
      )}

      {c.bio.role === 'fixer' && (
        <section className="space-y-1 text-sm">
          <p className="eyebrow">Operador</p>
          <p>Alcance de mercado: <span className="text-neon-cyan">{operatorPerks(c.roleRank).reach}</span></p>
          <p>Pechincha: −{Math.round(operatorPerks(c.roleRank).discount * 100)}% nas compras{operatorPerks(c.roleRank).bulkBonus ? ' · leve 6, pague 5 em munição/consumíveis' : ''}</p>
          {operatorPerks(c.roleRank).jobBonus > 0 && <p>Trabalhos pagam +{Math.round(operatorPerks(c.roleRank).jobBonus * 100)}%</p>}
        </section>
      )}

      {c.bio.role === 'nomad' && (
        <section className="space-y-1 text-sm">
          <p className="eyebrow">Moto</p>
          <p>+{c.roleRank} em Pilotar Veículo e Tec. de Veículos</p>
          <p>Veículo da família: <span className="text-neon-cyan">{familyVehicle(c.roleRank)}</span></p>
        </section>
      )}
    </div>
  );
}
