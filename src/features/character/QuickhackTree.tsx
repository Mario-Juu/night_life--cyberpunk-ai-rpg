import { Check, Cpu, Lock, Network } from 'lucide-react';
import type { Character } from '@shared/types/game';
import { BRANCH_LABEL, QUICKHACKS, type QuickhackBranch, type QuickhackKey } from '@shared/rules/quickhacks';
import { knownQuickhacks, unlockBlocker } from '@shared/engine/quickhacks';
import { Badge, Button, Meter, Modal, cn } from '../../ui';
import { dispatch } from '../../store/gameStore';
import { sound } from '../../services/audio';

const BRANCHES: QuickhackBranch[] = ['controle', 'hardware', 'dano'];

const BRANCH_STYLE = {
  controle: {
    accent: 'border-neon-cyan text-neon-cyan',
    line: 'bg-neon-cyan/45',
    ink: 'text-neon-cyan/45',
    halo: 'bg-neon-cyan/10',
    tone: 'cyan',
  },
  hardware: {
    accent: 'border-neon-yellow text-neon-yellow',
    line: 'bg-neon-yellow/45',
    ink: 'text-neon-yellow/45',
    halo: 'bg-neon-yellow/10',
    tone: 'yellow',
  },
  dano: {
    accent: 'border-danger text-danger',
    line: 'bg-danger/45',
    ink: 'text-danger/45',
    halo: 'bg-danger/10',
    tone: 'danger',
  },
} as const;

/** Loja de quickhacks: a árvore vive num modal, sem disputar espaço com a ficha. */
export function QuickhackStoreModal({ c, open, onClose }: { c: Character; open: boolean; onClose: () => void }) {
  const known = new Set(knownQuickhacks(c));
  const ram = c.deck?.ram;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Loja de quickhacks"
      subtitle="Monte seu repertório de intrusão. Cada nó exige Interface, PM e a progressão do seu ramo."
    >
      <section className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="border border-neon-cyan/35 bg-neon-cyan/5 p-3">
            <p className="eyebrow flex items-center gap-1.5"><Network className="h-3.5 w-3.5" /> Interface N{c.roleRank}</p>
            <p className="mt-1 text-xs text-muted">Desbloqueie programas para usá-los pelo botão <span className="text-neon-cyan">Quickhack</span> durante o combate.</p>
          </div>
          <div className="flex gap-2">
            <div className="border border-line-soft bg-surface-0/40 px-3 py-2 text-right">
              <p className="eyebrow">Pontos</p>
              <p className="tabular text-lg text-neon-cyan">{c.ip} PM</p>
            </div>
            {ram && (
              <div className="min-w-36 border border-line-soft bg-surface-0/40 px-3 py-2">
                <Meter value={ram.current} max={ram.max} tone="cyan" size="sm" label={`RAM ${ram.current}/${ram.max}`} />
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {BRANCHES.map(branch => {
            const style = BRANCH_STYLE[branch];
            const hacks = Object.values(QUICKHACKS)
              .filter(def => def.branch === branch)
              .sort((a, b) => a.tier - b.tier);
            return (
              <section key={branch} className="min-w-0">
                <div className={cn('mb-3 flex items-center gap-2 border-b pb-2 font-display text-xs uppercase tracking-[0.16em]', style.accent)}>
                  <span className={cn('grid h-5 w-5 place-items-center border', style.accent)}>{branch.slice(0, 1)}</span>
                  {BRANCH_LABEL[branch]}
                </div>
                <ol className="relative space-y-3 before:absolute before:bottom-5 before:left-3 before:top-5 before:w-px before:bg-current">
                  {hacks.map(def => {
                    const have = known.has(def.key);
                    const reason = have ? null : unlockBlocker(c, def.key as QuickhackKey);
                    return (
                      <li key={def.key} className={cn('relative pl-8', style.ink)}>
                        <span className={cn('absolute left-1.5 top-5 z-10 h-3 w-3 -translate-x-1/2 border-2 bg-surface-1', have ? style.accent : 'border-line')} />
                        <article className={cn('space-y-2 border p-3 transition-colors', have ? `${style.accent} ${style.halo}` : 'border-line-soft bg-surface-0/30')}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className={cn('flex items-center gap-1.5 text-sm', have ? 'text-fg' : 'text-muted')}>
                                {have ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Lock className="h-3.5 w-3.5 shrink-0" />}
                                <span className="truncate">{def.name}</span>
                              </p>
                              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-dim">Nível {def.tier} · {def.ram} RAM</p>
                            </div>
                            {have && <Badge tone="cyan">Instalado</Badge>}
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted">{def.effect}</p>
                          {have ? (
                            <p className="text-[10px] text-neon-cyan">Pronto para equipar no combate.</p>
                          ) : reason ? (
                            <p className="min-h-7 text-[10px] leading-snug text-dim">{reason}</p>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              tone={style.tone}
                              block
                              onClick={() => {
                                sound.playSuccess();
                                dispatch({ type: 'unlockQuickhack', key: def.key });
                              }}
                            >
                              Desbloquear · {def.ipCost} PM
                            </Button>
                          )}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
        <p className="border-t border-line-soft pt-3 text-[11px] text-dim"><Cpu className="mr-1 inline h-3.5 w-3.5" /> A RAM é gasta ao executar e se recupera normalmente pelas regras de combate.</p>
      </section>
    </Modal>
  );
}
