import { useState } from 'react';
import { CircleHelp, Cpu, Crosshair, Footprints, Hand, RotateCw, ShieldHalf, Swords, Timer, TriangleAlert, Waves, Zap } from 'lucide-react';
import { activeOs, installedOs, osCooldownName } from '@shared/engine/cyberBonus';
import type { Combatant, GameState } from '@shared/types/game';
import { getPlayerWeapon, MARTIAL_ARTS, playerWeapons, previewAttackDv, turnOrder, UNARMED, type AttackMode } from '@shared/engine/combat';
import { skillValue } from '@shared/engine/checks';
import { DISTANCE_LABEL, WEAPONS } from '@shared/rules/weapons';
import { Badge, Button, Empty, Meter, Select, cn } from '../../ui';
import { prepareAttack, prepareQuickhack, quickTool, reload, sendAction } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
import { QUICKHACKS, type QuickhackKey } from '@shared/rules/quickhacks';
import { STANCE_LABEL } from '@shared/engine/party';
import { knownQuickhacks } from '@shared/engine/quickhacks';
import { toast } from '../../ui/toastStore';

const COVER_LABEL = { none: 'Exposto', partial: 'Meia cobertura', full: 'Cobertura total' } as const;
const STATUS_LABEL = { active: 'Ativo', down: 'Derrubado', fled: 'Fugiu', dead: 'Morto', surrendered: 'Rendido' } as const;

/** Quickhacks do Trilheiro contra este inimigo (RAM do deck; teste de Interface na tela). */
function QuickhackPicker({ enemy, game, blocked, onCancel }: { enemy: Combatant; game: GameState; blocked: boolean; onCancel: () => void }) {
  const c = game.character;
  const ram = c.deck?.ram;
  const hacks = knownQuickhacks(c).filter(k => QUICKHACKS[k].target !== 'none' || k === 'ping');
  const [selected, setSelected] = useState<QuickhackKey | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  if (c.bio.role !== 'netrunner' || !ram || !hacks.length) return null;
  const key = selected && hacks.includes(selected) ? selected : hacks[0];
  const hack = QUICKHACKS[key];
  const unavailable = blocked || ram.current < hack.ram || !!game.net.run;
  const reason = game.net.run ? 'Desconecte da arquitetura para usar quickhacks.' : ram.current < hack.ram ? `RAM insuficiente: ${hack.ram} necessária, ${ram.current} disponível.` : undefined;
  return (
    <div className="min-w-0 space-y-2 border-t border-line-soft pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] uppercase tracking-wider text-neon-cyan">Quickhack em {enemy.name} · RAM {ram.current}/{ram.max}</p>
        <button type="button" onClick={() => setShowHelp(v => !v)} aria-label={`O que ${hack.name} faz?`} aria-expanded={showHelp} className="grid h-6 w-6 shrink-0 place-items-center border border-line text-muted hover:border-neon-cyan hover:text-neon-cyan" title="Explicar quickhack">
          <CircleHelp className="w-3.5 h-3.5" />
        </button>
      </div>
      <Select value={key} onChange={e => { setSelected(e.target.value as QuickhackKey); setShowHelp(false); }} aria-label="Quickhack">
        {hacks.map(k => {
          const d = QUICKHACKS[k];
          return <option key={k} value={k}>{d.name} ({d.ram} RAM)</option>;
        })}
      </Select>
      {showHelp && <p className="border border-neon-cyan/30 bg-neon-cyan/5 p-2 text-[11px] leading-snug text-muted">{hack.effect} <span className="text-neon-cyan">Custo: {hack.ram} RAM.</span></p>}
      {reason && <p className="text-[11px] text-neon-yellow">{reason}</p>}
      <div className="flex min-w-0 gap-1.5">
        <Button size="sm" variant="solid" className="min-w-0 flex-1 whitespace-normal px-2 text-center leading-tight" tone={hack.branch === 'dano' ? 'danger' : hack.branch === 'hardware' ? 'yellow' : 'cyan'} disabled={unavailable} title={reason} onClick={() => {
            const err = prepareQuickhack(key, enemy.id);
            if (err) toast({ title: 'Quickhack indisponível', body: err, tone: 'warning' });
            else onCancel();
          }} icon={<Cpu className="w-3 h-3" />}>
          Executar {hack.name}
        </Button>
        <Button size="sm" variant="ghost" className="shrink-0 px-2" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

function EnemyCard({ enemy, game }: { enemy: Combatant; game: GameState }) {
  const [actionOpen, setActionOpen] = useState<'attack' | 'quickhack' | null>(null);
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
  const canQuickhack = game.character.bio.role === 'netrunner' && !!game.character.deck?.ram && knownQuickhacks(game.character).some(k => QUICKHACKS[k].target !== 'none' || k === 'ping');

  const confirm = () => {
    const err = prepareAttack(enemy.id, weaponId, {
      aimedHead: effMode === 'single' && aimed && (!twice || !!os?.aimedFollowUp),
      mode: effMode,
      twice: effMode === 'single' && canTwice && twice && (!aimed || !!os?.aimedFollowUp),
      ambush: canAmbush && ambush,
    });
    if (err) toast({ title: 'Ataque indisponível', body: err, tone: 'warning' });
    else setActionOpen(null);
  };

  return (
    <li className={cn('min-w-0 overflow-hidden border p-2.5 space-y-2', active ? 'border-danger/40 bg-danger/5' : 'border-line-soft opacity-60')}>
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
      {!!enemy.hacks?.length && (
        <div className="flex flex-wrap gap-1">
          {enemy.hacks.map(h => (
            <Badge key={h.key} tone="cyan">
              {h.label}
              {h.hitBonus ? ` +${h.hitBonus} p/ você` : ''}
              {h.attackMod ? ` ${h.attackMod} nos ataques` : ''}
            </Badge>
          ))}
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
        (actionOpen === 'attack' ? (
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
            <div className="flex min-w-0 gap-1.5">
              <Button size="sm" variant="solid" tone="danger" className="min-w-0 flex-1 whitespace-normal px-2 text-center leading-tight" onClick={confirm} disabled={blocked} icon={<Crosshair className="w-3 h-3" />}>
                Preparar ataque
              </Button>
              <Button size="sm" variant="ghost" className="shrink-0 px-2" onClick={() => setActionOpen(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : actionOpen === 'quickhack' ? (
          <QuickhackPicker enemy={enemy} game={game} blocked={blocked} onCancel={() => setActionOpen(null)} />
        ) : (
          <div className={cn('grid gap-1.5', canQuickhack ? 'grid-cols-2' : 'grid-cols-1')}>
            <Button size="sm" variant="ghost" tone="danger" block onClick={() => setActionOpen('attack')} disabled={blocked} icon={<Crosshair className="w-3 h-3" />}>
              Atacar
            </Button>
            {canQuickhack && (
              <Button size="sm" variant="ghost" tone="cyan" block onClick={() => setActionOpen('quickhack')} disabled={blocked} icon={<Cpu className="w-3 h-3" />}>
                Quickhack
              </Button>
            )}
          </div>
        ))}
    </li>
  );
}

export function CombatPanel({ game }: { game: GameState }) {
  const busy = useUiStore(s => s.gmBusy);
  const combat = game.combat;
  if (!combat.active) {
    const bodies = combat.combatants.filter(c => c.side !== 'ally' && c.status !== 'active' && c.status !== 'fled' && !c.looted && !c.lootUnavailable);
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
  const allDown = combat.combatants.every(c => c.status !== 'active' || c.side === 'ally');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge tone="danger" solid>
          <Swords className="w-3 h-3" /> Rodada {combat.round}
        </Badge>
        {combat.playerInitiative === null && (
          // A iniciativa rola sozinha na primeira Ação (o motor resolve a ordem antes da narração).
          <span className="flex items-center gap-1 text-[11px] text-dim">
            <Timer className="w-3 h-3" /> Iniciativa rola na sua primeira ação
          </span>
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

      {allDown && (
        <section className="space-y-2 border border-neon-green/40 bg-neon-green/5 p-3">
          <p className="text-xs text-neon-green">Nenhum inimigo de pé. Você pode encerrar a luta agora; revistar os corpos é opcional.</p>
          <Button size="sm" variant="solid" tone="green" block disabled={blocked} onClick={() => void quickTool('end_combat', {}, 'Encerro o combate; os corpos ficam aqui caso eu decida revistá-los.') }>
            Encerrar combate
          </Button>
        </section>
      )}

      {combat.combatants.some(c => c.side === 'ally') && (
        <section className="space-y-1.5">
          <p className="eyebrow">Sua equipe</p>
          <ul className="space-y-1.5">
            {combat.combatants
              .filter(c => c.side === 'ally')
              .map(a => (
                <li key={a.id} className={cn('border p-2 space-y-1', a.status === 'active' ? 'border-neon-green/40 bg-neon-green/5' : 'border-line-soft opacity-60')}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-fg truncate">{a.name}</p>
                    <Badge tone={a.status === 'active' ? 'green' : 'muted'}>{a.status === 'active' ? STANCE_LABEL[a.stance ?? 'aggressive'] : STATUS_LABEL[a.status]}</Badge>
                  </div>
                  <Meter value={a.hp.current} max={a.hp.max} tone="green" size="sm" label={`${a.weapon.name} · SP ${a.sp.body}${a.initiative !== null ? ` · iniciativa ${a.initiative}` : ''}`} />
                </li>
              ))}
          </ul>
          <p className="text-[11px] text-dim">Eles agem sozinhos na ordem de iniciativa. Para pedir algo, fale com eles (ex.: "Jax, foca no atirador").</p>
        </section>
      )}

      <ul className="space-y-2">
        {combat.combatants
          .filter(e => e.side !== 'ally')
          .map(e => (
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
            onClick={() => reload(weapon.id)}
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
