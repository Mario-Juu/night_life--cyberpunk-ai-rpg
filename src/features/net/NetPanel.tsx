import { ArrowDown, ArrowUp, Eye, FileSearch, Flame, KeyRound, LogIn, LogOut, Map, Radar, Shield, SkipForward, Sparkles, Swords, Wind, Zap } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { ICE, NET_DIFFICULTY_LABEL, PROGRAMS, netActionsFor } from '@shared/rules/net';
import { describeFloor, canNetrun } from '@shared/engine/net';
import { Badge, Button, Empty, Meter, cn } from '../../ui';
import { endNetTurnPanel, leaveNetAccess, netPanelAction } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
import { useGameStore } from '../../store/gameStore';

export function NetPanel({ game }: { game: GameState }) {
  const busy = useUiStore(s => s.gmBusy);
  const activeTurn = useGameStore(s => s.activeTurn);
  const arch = game.net.architecture;
  const run = game.net.run;
  const deck = game.character.deck;

  if (!arch) {
    return (
      <Empty
        icon={<Radar className="w-8 h-8" />}
        title="Nenhum ponto de acesso"
      >
        <p className="text-xs">{canNetrun(game) ? 'Chegue a até 6 m de um terminal, servidor ou rede e o Mestre revela a arquitetura.' : 'Só um Trilheiro com ciberdeck entra na Rede.'}</p>
      </Empty>
    );
  }

  const act = (action: string, extra: Record<string, unknown> = {}) => void netPanelAction('net_action', { action, ...extra });
  const floor = run ? arch.floors[run.position] : null;
  const activeIce = run ? run.ice.filter(i => i.rez > 0 && (i.following || i.floor === run.position)) : [];
  const followers = run ? run.ice.filter(i => i.rez > 0 && i.following) : [];
  const onFire = game.activeEffects.some(e => e.name === 'Deck em chamas');
  const programs = (deck?.programs ?? []).filter(p => !p.destroyed);
  // Um botão por PROGRAMA (várias cópias do mesmo atacante fazem o mesmo ataque).
  const firstOfEach = <T extends { key: string }>(list: T[]) => list.filter((p, i) => list.findIndex(q => q.key === p.key) === i);
  const count = (key: string) => programs.filter(p => p.key === key).length;
  const attackers = firstOfEach(programs.filter(p => p.key === 'sword' || p.key === 'banhammer'));
  // Booster/defensor: rezza uma cópia por vez (só uma cópia de cada defensor roda ao mesmo tempo).
  const toActivate = firstOfEach(programs.filter(p => PROGRAMS[p.key].class !== 'attacker' && !p.active && p.rez > 0 && !programs.some(q => q.key === p.key && q.active)));
  const noActions = !run || run.actionsLeft <= 0;
  const disabled = busy || !!game.character.dead;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="eyebrow">Rede · {NET_DIFFICULTY_LABEL[arch.difficulty]} · {arch.floors.length} andares</p>
        <h3 className="font-display text-sm uppercase tracking-wider text-neon-cyan">{arch.name}</h3>
        <p className="text-[11px] text-dim">{arch.accessPoint}</p>
      </header>

      {!run ? (
        canNetrun(game) ? (
          <div className="flex flex-wrap gap-2">
            <Button tone="cyan" variant="solid" icon={<LogIn className="w-4 h-4" />} disabled={disabled} onClick={() => void netPanelAction('jack_in')}>
              Conectar (1 Ação de Rede)
            </Button>
            <Button variant="ghost" icon={<LogOut className="w-4 h-4" />} disabled={disabled} onClick={leaveNetAccess} title="O ponto de acesso some do painel">
              Afastar-se
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">Só um Trilheiro com ciberdeck pode entrar nesta arquitetura.</p>
            <Button size="sm" variant="ghost" icon={<LogOut className="w-3.5 h-3.5" />} disabled={disabled} onClick={leaveNetAccess}>
              Afastar-se
            </Button>
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="cyan">Turno de Rede {run.netTurn}</Badge>
            <span className="flex items-center gap-1" aria-label={`${run.actionsLeft} Ações de Rede`}>
              {Array.from({ length: netActionsFor(game.character.roleRank) }, (_, i) => (
                <span key={i} className={cn('w-2.5 h-2.5 border', i < run.actionsLeft ? 'bg-neon-cyan border-neon-cyan' : 'border-line')} />
              ))}
            </span>
            {run.cloaked && <Badge tone="green">Rastros apagados</Badge>}
            {onFire && <Badge tone="danger" solid>Deck em chamas</Badge>}
          </div>

          <ol className="border border-line divide-y divide-line-soft max-h-64 overflow-y-auto" aria-label="Andares">
            {arch.floors.map(f => (
              <li
                key={f.index}
                className={cn(
                  'flex items-center gap-2 px-2 py-1 text-[11px]',
                  f.index === run.position ? 'bg-neon-cyan/10 text-neon-cyan' : f.revealed ? 'text-fg' : 'text-dim',
                )}
              >
                <span className="tabular w-5 text-right text-dim">{f.index + 1}</span>
                <span className="flex-1 truncate">{describeFloor(f)}</span>
                {f.index === run.position && <span className="font-display text-[9px] tracking-widest">VOCÊ</span>}
              </li>
            ))}
          </ol>

          {activeIce.length > 0 && (
            <section className="space-y-2">
              <p className="eyebrow text-danger">ICE Negro</p>
              {activeIce.map(i => (
                <div key={i.id} className="border border-danger/40 p-2 space-y-1.5" title={ICE[i.key].effect}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-display uppercase tracking-wider text-danger">{ICE[i.key].name}</span>
                    <span className="text-dim">{i.following ? 'perseguindo' : 'parado'}</span>
                  </div>
                  <Meter value={i.rez} max={i.maxRez} tone="danger" size="sm" label="REZ" />
                  <p className="text-[10px] text-dim">{ICE[i.key].effect}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" tone="yellow" icon={<Zap className="w-3 h-3" />} disabled={disabled || noActions} onClick={() => act('zap', { iceId: i.id })}>
                      Zap
                    </Button>
                    {attackers.map(p => (
                      <Button key={p.id} size="sm" variant="ghost" tone="danger" icon={<Swords className="w-3 h-3" />} disabled={disabled || noActions} onClick={() => act('program', { programId: p.id, iceId: i.id })} title={`${PROGRAMS[p.key].effect}${count(p.key) > 1 ? ` (${count(p.key)} cópias no deck)` : ''}`}>
                        {PROGRAMS[p.key].name}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <p className="eyebrow">Ações de Rede</p>
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="ghost" icon={<Map className="w-3.5 h-3.5" />} disabled={disabled || noActions} onClick={() => act('pathfinder')}>
                Pathfinder
              </Button>
              {floor?.kind === 'password' && !floor.cleared && (
                <Button size="sm" variant="ghost" tone="yellow" icon={<KeyRound className="w-3.5 h-3.5" />} disabled={disabled || noActions} onClick={() => act('backdoor')}>
                  Backdoor
                </Button>
              )}
              {floor?.kind === 'file' && !floor.cleared && (
                <Button size="sm" variant="ghost" tone="yellow" icon={<FileSearch className="w-3.5 h-3.5" />} disabled={disabled || noActions} onClick={() => act('eye_dee')}>
                  Eye-Dee
                </Button>
              )}
              {floor?.kind === 'control' && !floor.cleared && (
                <Button size="sm" variant="ghost" tone="yellow" icon={<Eye className="w-3.5 h-3.5" />} disabled={disabled || noActions} onClick={() => act('control')}>
                  Controle
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<ArrowDown className="w-3.5 h-3.5" />} disabled={disabled || noActions || run.position >= arch.floors.length - 1} onClick={() => act('down')}>
                Descer
              </Button>
              <Button size="sm" variant="ghost" icon={<ArrowUp className="w-3.5 h-3.5" />} disabled={disabled || noActions || run.position === 0} onClick={() => act('up')}>
                Subir
              </Button>
              {followers.length > 0 && (
                <Button size="sm" variant="ghost" tone="magenta" icon={<Wind className="w-3.5 h-3.5" />} disabled={disabled || noActions || run.slideUsed} onClick={() => act('slide')}>
                  Slide
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Sparkles className="w-3.5 h-3.5" />} disabled={disabled || noActions || run.cloaked} onClick={() => act('cloak')}>
                Cloak
              </Button>
              {run.position === arch.floors.length - 1 && !arch.virus && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="magenta"
                  disabled={disabled || noActions}
                  onClick={() => {
                    const virus = window.prompt('O que o vírus faz? (efeito duradouro no sistema)');
                    if (virus?.trim()) act('virus', { virus: virus.trim() });
                  }}
                >
                  Vírus
                </Button>
              )}
              {onFire && (
                <Button size="sm" variant="ghost" tone="danger" icon={<Flame className="w-3.5 h-3.5" />} disabled={disabled} onClick={() => act('extinguish')}>
                  Apagar fogo
                </Button>
              )}
            </div>
            {toActivate.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {toActivate.map(p => (
                  <Button key={p.id} size="sm" variant="ghost" tone="green" icon={<Shield className="w-3 h-3" />} disabled={disabled || noActions} onClick={() => act('activate', { programId: p.id })} title={PROGRAMS[p.key].effect}>
                    Rezzar {PROGRAMS[p.key].name}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button size="sm" variant="solid" tone="cyan" icon={<SkipForward className="w-3.5 h-3.5" />} disabled={disabled || activeTurn?.phase !== 'in_net'} onClick={() => void endNetTurnPanel()}>
                Encerrar turno
              </Button>
              <Button size="sm" variant="ghost" tone="danger" icon={<LogOut className="w-3.5 h-3.5" />} disabled={disabled || noActions} onClick={() => act('jack_out')}>
                Sair com segurança
              </Button>
            </div>
          </section>

          <section className="space-y-1">
            <p className="eyebrow">Programas</p>
            <ul className="flex flex-wrap gap-1.5">
              {(deck?.programs ?? []).map(p => (
                <li
                  key={p.id}
                  title={PROGRAMS[p.key].effect}
                  className={cn('border px-1.5 py-0.5 text-[10px]', p.destroyed ? 'border-line-soft text-dim line-through' : p.active ? 'border-neon-green text-neon-green' : 'border-line text-muted')}
                >
                  {PROGRAMS[p.key].name}
                  {PROGRAMS[p.key].class !== 'attacker' && !p.destroyed ? ` ${p.rez}/${p.maxRez}` : ''}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
