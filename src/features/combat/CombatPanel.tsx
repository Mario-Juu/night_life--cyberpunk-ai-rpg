import { useState } from 'react';
import { Crosshair, Footprints, RotateCw, ShieldHalf, Swords, Timer } from 'lucide-react';
import type { Combatant, GameState } from '@shared/types/game';
import { getPlayerWeapon, playerWeapons, previewAttackDv, turnOrder, UNARMED } from '@shared/engine/combat';
import { DISTANCE_LABEL, WEAPONS } from '@shared/rules/weapons';
import { Badge, Button, Empty, Meter, Select, cn } from '../../ui';
import { prepareAttack, reload, rollInitiative, sendAction } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
import { toast } from '../../ui/toastStore';

const COVER_LABEL = { none: 'Exposto', partial: 'Meia cobertura', full: 'Cobertura total' } as const;
const STATUS_LABEL = { active: 'Ativo', down: 'Caído', fled: 'Fugiu', dead: 'Morto', surrendered: 'Rendido' } as const;

function EnemyCard({ enemy, game }: { enemy: Combatant; game: GameState }) {
  const [open, setOpen] = useState(false);
  const weapons = playerWeapons(game.character);
  const [weaponId, setWeaponId] = useState(getPlayerWeapon(game.character).id);
  const [aimed, setAimed] = useState(false);
  const busy = useUiStore(s => s.gmBusy);
  const revealDv = useUiStore(s => s.revealDv);
  const weapon = weaponId === UNARMED.id ? UNARMED : getPlayerWeapon(game.character, weaponId);
  const preview = previewAttackDv(weapon, enemy);
  const isMelee = WEAPONS[weapon.weapon?.weaponClass ?? 'unarmed'].melee;
  const active = enemy.status === 'active';
  const blocked = busy || !!game.pendingRoll;

  const confirm = () => {
    const err = prepareAttack(enemy.id, weaponId, aimed);
    if (err) toast({ title: 'Ataque indisponível', body: err, tone: 'warning' });
    else setOpen(false);
  };

  return (
    <li className={cn('border p-2.5 space-y-2', active ? 'border-danger/40 bg-danger/5' : 'border-line-soft opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-fg truncate">{enemy.name}</p>
          <p className="tabular text-[10px] text-muted">
            {enemy.weapon.name} ({enemy.weapon.damage}) · {DISTANCE_LABEL[enemy.distance]} · {COVER_LABEL[enemy.cover]}
          </p>
        </div>
        <Badge tone={active ? 'danger' : 'muted'}>{STATUS_LABEL[enemy.status]}</Badge>
      </div>
      <Meter value={enemy.hp.current} max={enemy.hp.max} tone="danger" size="sm" label={`SP ${enemy.sp.body} · cabeça ${enemy.sp.head}`} />

      {active &&
        (open ? (
          <div className="space-y-2 border-t border-line-soft pt-2">
            <Select value={weaponId} onChange={e => setWeaponId(e.target.value)} aria-label="Arma">
              {weapons.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.weapon?.magSize !== null ? ` (${w.weapon?.loaded}/${w.weapon?.magSize})` : ''}
                </option>
              ))}
              <option value={UNARMED.id}>Punhos (1d6)</option>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={aimed} onChange={e => setAimed(e.target.checked)} className="accent-[var(--color-neon-cyan)]" />
              Mirar na cabeça (−8, dano ×2)
            </label>
            <p className={cn('tabular text-[11px]', preview.dv === null && !isMelee ? 'text-neon-yellow' : 'text-muted')}>
              {revealDv ? preview.label : isMelee ? 'Contra a esquiva do alvo' : preview.dv === null ? 'Fora do alcance desta arma' : 'Alvo ao alcance'}
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="solid" tone="danger" onClick={confirm} disabled={blocked} icon={<Crosshair className="w-3 h-3" />}>
                Preparar ataque
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" tone="danger" block onClick={() => setOpen(true)} disabled={blocked} icon={<Crosshair className="w-3 h-3" />}>
            Atacar
          </Button>
        ))}
    </li>
  );
}

export function CombatPanel({ game }: { game: GameState }) {
  const busy = useUiStore(s => s.gmBusy);
  const combat = game.combat;
  if (!combat.active) {
    const bodies = combat.combatants.filter(c => c.status !== 'active' && c.status !== 'fled' && !c.looted);
    return (
      <div className="space-y-3">
        <Empty icon={<Swords className="w-8 h-8" />} title="Sem combate">
          O Mestre inicia um combate quando a cena exigir. Aqui aparecem inimigos, iniciativa e ataques.
        </Empty>
        {bodies.length > 0 && (
          <section className="space-y-1.5">
            <p className="eyebrow">Corpos por revistar</p>
            {bodies.map(b => (
              <Button key={b.id} size="sm" variant="ghost" tone="yellow" block disabled={busy} onClick={() => void sendAction(`Revisto o corpo de ${b.name}.`)}>
                Revistar {b.name}
              </Button>
            ))}
          </section>
        )}
      </div>
    );
  }

  const order = turnOrder(combat);
  const weapon = getPlayerWeapon(game.character);
  const blocked = busy || !!game.pendingRoll;
  const allDown = combat.combatants.every(c => c.status !== 'active');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge tone="danger" solid>
          <Swords className="w-3 h-3" /> Rodada {combat.round}
        </Badge>
        {combat.playerInitiative === null && (
          <Button size="sm" variant="neon" tone="yellow" onClick={() => void rollInitiative()} disabled={blocked} icon={<Timer className="w-3 h-3" />}>
            Rolar iniciativa
          </Button>
        )}
      </div>

      {combat.playerInitiative !== null && (
        <section>
          <p className="eyebrow mb-1">Ordem de iniciativa</p>
          <ol className="flex flex-wrap gap-1">
            {order.map((row, i) => (
              <li key={row.id} className={cn('tabular text-[11px] px-2 py-1 border', row.isPlayer ? 'border-neon-cyan text-neon-cyan' : 'border-line text-muted')}>
                {i + 1}. {row.name} <span className="text-dim">{row.initiative ?? '—'}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {allDown && <p className="text-xs text-neon-green">Nenhum inimigo de pé. Descreva o que você faz para encerrar a cena.</p>}

      <ul className="space-y-2">
        {combat.combatants.map(e => (
          <EnemyCard key={e.id} enemy={e} game={game} />
        ))}
      </ul>

      <section className="space-y-1.5 border-t border-line-soft pt-3">
        <p className="eyebrow">Ações rápidas</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="ghost" disabled={blocked} onClick={() => void sendAction('Busco a cobertura mais próxima e me protejo.')} icon={<ShieldHalf className="w-3 h-3" />}>
            Cobertura
          </Button>
          <Button
            size="sm"
            variant="ghost"
            tone="yellow"
            disabled={blocked || !weapon.weapon || weapon.weapon.magSize === null || weapon.weapon.loaded >= weapon.weapon.magSize}
            onClick={() => {
              reload(weapon.id);
              void sendAction(`Gasto minha ação recarregando ${weapon.name}.`);
            }}
            icon={<RotateCw className="w-3 h-3" />}
          >
            Recarregar
          </Button>
          <Button size="sm" variant="ghost" tone="purple" disabled={blocked} onClick={() => void sendAction('Tento fugir do combate pela rota mais segura.')} icon={<Footprints className="w-3 h-3" />} className="col-span-2">
            Fugir
          </Button>
        </div>
      </section>
    </div>
  );
}
