import { useMemo, useState } from 'react';
import { ArrowUp, Cpu, Minus, Plus, ShoppingBag } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { CYBERWARE } from '@shared/rules/cyberware';
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
import { QuickhackStoreModal } from './QuickhackTree';
import { freePoints, surgeryValue, unlockedDrugs, type RoleSection } from '@shared/engine/roles';
import { marketCyberPrice } from '@shared/engine/citySystems';
import { Badge, Button, Modal, cn } from '../../ui';
import { dispatch } from '../../store/gameStore';
import { quickTool } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
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

const tierReach = (rank: number) => (rank >= 10 ? 5 : rank >= 9 ? 4 : rank >= 7 ? 3 : rank >= 5 ? 2 : rank >= 3 ? 1 : 0);

function FixerOrderModal({ game, open, onClose }: { game: GameState; open: boolean; onClose: () => void }) {
  const [tier, setTier] = useState(0);
  const busy = useUiStore(s => s.gmBusy);
  const maxTier = tierReach(game.character.roleRank);
  const list = useMemo(
    () => Object.values(CYBERWARE).filter(def => def.grade !== 'prototype' && def.tier <= maxTier && (!tier || def.tier === tier)),
    [maxTier, tier],
  );
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Encomendas do Operador" subtitle={`Seu alcance atual: até T${maxTier}. O pagamento sai agora; a peça chega quando o relógio avançar.`}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {[0, 1, 2, 3, 4, 5].map(t => <button key={t} type="button" disabled={!!t && t > maxTier} onClick={() => setTier(t)} className={cn('border px-2 py-1 text-[10px]', tier === t ? 'border-neon-yellow text-neon-yellow' : 'border-line text-muted', !!t && t > maxTier && 'opacity-30')}>
            {t ? `T${t}` : 'Todos'}
          </button>)}
        </div>
        <ul className="grid gap-2 lg:grid-cols-2">
          {list.map(def => {
            const price = marketCyberPrice(game.character, def.key);
            return <li key={def.key} className="border border-line bg-surface-0/30 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2"><div><p className="text-sm text-fg">{def.name}</p><p className="text-[10px] text-dim">T{def.tier} · {def.category}{def.brand ? ` · ${def.brand}` : ''}</p></div><span className="tabular text-neon-yellow">€${price}</span></div>
              <p className="text-[11px] text-muted">{def.effect}</p>
              <Button size="sm" variant="ghost" tone="yellow" disabled={busy || game.combat.active || game.character.money < price} onClick={() => void quickTool('order_cyberware', { key: def.key }, `Encomendo ${def.name} pelos contatos do Operador.`)}>Encomendar</Button>
            </li>;
          })}
        </ul>
        {!list.length && <p className="text-sm text-dim">Este rank ainda não alcança nenhuma peça para encomenda.</p>}
      </div>
    </Modal>
  );
}

export function RoleTab({ game }: { game: GameState }) {
  const c = game.character;
  const [quickhackShopOpen, setQuickhackShopOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
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
          {c.deck && (
            <Button size="sm" variant="ghost" tone="cyan" block icon={<Cpu className="h-3.5 w-3.5" />} onClick={() => setQuickhackShopOpen(true)}>
              Abrir loja de quickhacks
            </Button>
          )}
        </section>
      )}
      {c.bio.role === 'netrunner' && c.deck && <QuickhackStoreModal c={c} open={quickhackShopOpen} onClose={() => setQuickhackShopOpen(false)} />}

      {c.bio.role === 'fixer' && (
        <section className="space-y-2 text-sm">
          <p className="eyebrow">Operador</p>
          <p>Alcance de mercado: <span className="text-neon-cyan">{operatorPerks(c.roleRank).reach}</span></p>
          <p>Pechincha: −{Math.round(operatorPerks(c.roleRank).discount * 100)}% nas compras{operatorPerks(c.roleRank).bulkBonus ? ' · leve 6, pague 5 em munição/consumíveis' : ''}</p>
          {operatorPerks(c.roleRank).jobBonus > 0 && <p>Trabalhos pagam +{Math.round(operatorPerks(c.roleRank).jobBonus * 100)}%</p>}
          <Button size="sm" variant="ghost" tone="yellow" block icon={<ShoppingBag className="w-3.5 h-3.5" />} onClick={() => setOrdersOpen(true)}>Abrir encomendas de cromo</Button>
        </section>
      )}
      {c.bio.role === 'fixer' && <FixerOrderModal game={game} open={ordersOpen} onClose={() => setOrdersOpen(false)} />}

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
