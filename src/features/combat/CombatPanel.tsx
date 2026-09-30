import { useState } from 'react';
import { Crosshair, Footprints, Hand, RotateCw, ShieldHalf, Swords, Timer, TriangleAlert, Waves, Zap } from 'lucide-react';
import { activeOs, installedOs, osCooldownName } from '@shared/engine/cyberBonus';
import type { Combatant, GameState } from '@shared/types/game';
import { getPlayerWeapon, MARTIAL_ARTS, playerWeapons, previewAttackDv, turnOrder, UNARMED, type AttackMode } from '@shared/engine/combat';
import { skillValue } from '@shared/engine/checks';
import { DISTANCE_LABEL, WEAPONS } from '@shared/rules/weapons';
import { Badge, Button, Empty, Meter, Select, cn } from '../../ui';
import { prepareAttack, quickTool, reload, rollInitiative, sendAction } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
import { toast } from '../../ui/toastStore';

const COVER_LABEL = { none: 'Exposto', partial: 'Meia cobertura', full: 'Cobertura total' } as const;
const STATUS_LABEL = { active: 'Ativo', down: 'Derrubado', fled: 'Fugiu', dead: 'Morto', surrendered: 'Rendido' } as const;

function EnemyCard({ enemy, game }: { enemy: Combatant; game: GameState }) {
  const [open, setOpen] = useState(false);
  const weapons = playerWeapons(game.character);
  const [weaponId, setWeaponId] = useState(getPlayerWeapon(game.character).id);
  const [aimed, setAimed] = useState(false);
  const [mode, setMode] = useState<AttackMode>('single');
  const [twice, setTwice] = useState(false);
  const [ambush, setAmbush] = useState(false);
  const busy = useUiStore(s => s.gmBusy);
  const revealDv = useUiStore(s => s.revealDv);
  const weapon = getPlayerWeapon(game.character, weaponId);
  const profile = WEAPONS[weapon.weapon?.weaponClass ?? 'unarmed'];
  const canAuto = !!profile.autofire;
  const effMode: AttackMode = canAuto && mode === 'autofire' ? 'autofire' : 'single';
  const preview = previewAttackDv(weapon, enemy, effMode);
  const isMelee = profile.melee;
  const os = activeOs(game);
  const canTwice = profile.rof === 2 || !!os?.extraAttack;
  // Emboscada só no golpe de abertura (antes da iniciativa).
  const canAmbush = game.combat.round <= 1 && game.combat.playerInitiative === null;
  const active = enemy.status === 'active';
  const blocked = busy || !!game.pendingRoll;
  const grabbed = game.character.grappling === enemy.id;

  const confirm = () => {
    const err = prepareAttack(enemy.id, weaponId, {
      aimedHead: effMode === 'single' && aimed && (!twice || !!os?.aimedFollowUp),
      mode: effMode,
      twice: effMode === 'single' && canTwice && twice && (!aimed || !!os?.aimedFollowUp),
      ambush: canAmbush && ambush,
    });
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
        <Badge tone={active ? 'danger' : 'muted'} className="shrink-0">{STATUS_LABEL[enemy.status]}</Badge>
      </div>
      {(enemy.skipNextAttack || enemy.facedown || enemy.coverHp !== undefined || enemy.weapon.quality) && (
        <div className="flex flex-wrap gap-1">
          {enemy.skipNextAttack && (
            <p className="w-full flex items-start gap-1.5 text-[11px] leading-snug text-neon-yellow">
              <TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="min-w-0">
                Perde o próximo ataque <span className="text-muted">— {enemy.skipNextAttack}</span>
              </span>
            </p>
          )}
          {enemy.facedown === 'player' && <Badge tone="cyan">Recuou na Encarada −2</Badge>}
          {enemy.facedown === 'npc' && <Badge tone="danger">Venceu a Encarada: você −2</Badge>}
          {enemy.coverHp !== undefined && enemy.cover === 'full' && <Badge tone="muted">Cobertura {enemy.coverHp} PV</Badge>}
          {enemy.weapon.quality === 'poor' && <Badge tone="muted">Arma ruim</Badge>}
          {enemy.weapon.quality === 'excellent' && <Badge tone="purple">Arma excelente</Badge>}
        </div>
      )}
      <Meter value={enemy.hp.current} max={enemy.hp.max} tone="danger" size="sm" label={`SP ${enemy.sp.body} · cabeça ${enemy.sp.head}`} />

      {grabbed && (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="yellow">Agarrado por você{game.character.humanShield?.id === enemy.id ? ' · escudo' : ''}</Badge>
          <Button size="sm" variant="ghost" tone="danger" disabled={blocked} onClick={() => void quickTool('grapple', { action: 'choke', targetId: enemy.id }, `Estrangulo ${enemy.name}.`)}>
            Estrangular
          </Button>
          <Button size="sm" variant="ghost" tone="yellow" disabled={blocked} onClick={() => void quickTool('grapple', { action: 'throw', targetId: enemy.id }, `Arremesso ${enemy.name} no chão.`)}>
            Arremessar
          </Button>
          {game.character.humanShield?.id !== enemy.id && (
            <Button size="sm" variant="ghost" tone="cyan" disabled={blocked} onClick={() => void quickTool('grapple', { action: 'shield', targetId: enemy.id }, `Uso ${enemy.name} como escudo humano.`)}>
              Escudo humano
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={blocked} onClick={() => void quickTool('grapple', { action: 'release', targetId: enemy.id }, `Solto ${enemy.name}.`)}>
            Soltar
          </Button>
        </div>
      )}

      {active && !grabbed && enemy.distance === 'melee' && !game.character.grappling && (
        <Button size="sm" variant="ghost" tone="yellow" block disabled={blocked} onClick={() => void quickTool('grapple', { action: 'grab', targetId: enemy.id }, `Tento agarrar ${enemy.name}.`)} icon={<Hand className="w-3 h-3" />}>
          Agarrar
        </Button>
      )}

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
              <option value={UNARMED.id}>Punhos</option>
              {skillValue(game.character, 'martial_arts') > 0 && <option value={MARTIAL_ARTS.id}>Artes Marciais (ignora ½ SP)</option>}
            </Select>
            {canAuto && (
              <Select value={mode === 'autofire' ? 'autofire' : 'single'} onChange={e => setMode(e.target.value as AttackMode)} aria-label="Modo de disparo">
                <option value="single">Tiro único</option>
                <option value="autofire">Rajada (10 tiros, 2d6 × margem até ×{profile.autofire!.mult})</option>
              </Select>
            )}
            {effMode === 'single' && !profile.thrown && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={aimed} onChange={e => { setAimed(e.target.checked); if (e.target.checked && !os?.aimedFollowUp) setTwice(false); }} className="accent-[var(--color-neon-cyan)]" />
                Mirar na cabeça (−8, dano ×2)
              </label>
            )}
            {effMode === 'single' && canTwice && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={twice} onChange={e => { setTwice(e.target.checked); if (e.target.checked && !os?.aimedFollowUp) setAimed(false); }} className="accent-[var(--color-neon-cyan)]" />
                {profile.rof === 2 ? 'Cadência 2: atacar duas vezes' : 'Tempo dilatado: ataque extra'}
              </label>
            )}
            {canAmbush && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={ambush} onChange={e => setAmbush(e.target.checked)} className="accent-[var(--color-neon-cyan)]" />
                Emboscada (o alvo não sabe de você)
              </label>
            )}
            {profile.area && <p className="text-[11px] text-neon-yellow">Explosivo: atinge todos na mesma faixa de distância.</p>}
            {weapon.weapon?.jammed && <p className="text-[11px] text-danger">Arma travada — destrave antes.</p>}
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
  const canSuppress = !!WEAPONS[weapon.weapon?.weaponClass ?? 'unarmed'].autofire && (weapon.weapon?.loaded ?? 0) >= 10;
  const osInst = installedOs(game.character);
  const osOn = activeOs(game);
  const osCooling = !!osInst && game.activeEffects.some(e => e.name === osCooldownName(osInst.def));
  const osLeft = osOn && combat.os ? combat.os.startRound + combat.os.rounds - combat.round : 0;
  const jammed = !!weapon.weapon?.jammed;
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
            disabled={blocked || (!jammed && (!weapon.weapon || weapon.weapon.magSize === null || weapon.weapon.loaded >= weapon.weapon.magSize))}
            onClick={() => {
              reload(weapon.id);
              void sendAction(jammed ? `Gasto minha ação destravando ${weapon.name}.` : `Gasto minha ação recarregando ${weapon.name}.`);
            }}
            icon={<RotateCw className="w-3 h-3" />}
          >
            {jammed ? 'Destravar' : 'Recarregar'}
          </Button>
          {osInst && (
            <Button
              size="sm"
              variant={osOn ? 'solid' : 'ghost'}
              tone="yellow"
              className="col-span-2"
              disabled={blocked || !!osOn || osCooling}
              onClick={() => void quickTool('activate_cyberware', { key: osInst.def.key }, `Ativo o ${osInst.def.name}.`)}
              icon={<Zap className="w-3 h-3" />}
            >
              {osOn ? `${osInst.def.name}: ${osLeft} rodada${osLeft === 1 ? '' : 's'}` : osCooling ? `${osInst.def.name} recarregando` : `Ativar ${osInst.def.name}`}
            </Button>
          )}
          {canSuppress && (
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              className="col-span-2"
              disabled={blocked}
              onClick={() => {
                const err = prepareAttack(null, weapon.id, { mode: 'suppressive' });
                if (err) toast({ title: 'Supressão indisponível', body: err, tone: 'warning' });
              }}
              icon={<Waves className="w-3 h-3" />}
            >
              Fogo de supressão (10 tiros)
            </Button>
          )}
          <Button size="sm" variant="ghost" tone="purple" disabled={blocked} onClick={() => void sendAction('Tento fugir do combate pela rota mais segura.')} icon={<Footprints className="w-3 h-3" />} className="col-span-2">
            Fugir
          </Button>
          {game.character.conditions?.some(x => x.key === 'grappled') && (
            <Button size="sm" variant="ghost" tone="yellow" disabled={blocked} onClick={() => void quickTool('grapple', { action: 'escape' }, 'Tento me soltar do agarrão.')} icon={<Hand className="w-3 h-3" />} className="col-span-2">
              Escapar do agarrão
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
