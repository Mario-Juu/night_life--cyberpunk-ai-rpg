import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, GitBranch, History, ListTree, RotateCcw, ScrollText, X } from 'lucide-react';
import type { GameEventType, GameState } from '@shared/types/game';
import type { TurnRecord } from '@shared/types/turn';
import { formatGameTime } from '@shared/rules/world';
import { EVENT_LABEL, INTENT_LABEL, ORIGIN_LABEL, PHASE_LABEL } from '@shared/rules/labels';

/** Fatos ocultos são do Mestre: não aparecem para o jogador. */
const isSecret = (e: { type: string; data?: Record<string, unknown> }) => e.type === 'WORLD_FLAG_CHANGED' && e.data?.visibility === 'hidden';
import { Badge, Button, Empty, Modal, Spinner, Tabs, cn } from '../../ui';
import { useUiStore, type LogTab } from '../../store/uiStore';
import { getRepository, type SnapshotMeta } from '../../services/repository';
import { branchesOf, createBranch, listTimeline, rewindTo, switchBranch } from '../../store/timeline';
import { isPermadead } from '../../services/saves';
import { toast } from '../../ui/toastStore';

type Tone = 'cyan' | 'magenta' | 'yellow' | 'green' | 'danger' | 'muted' | 'purple';

function eventTone(type: GameEventType): Tone {
  if (/DAMAGE|DIED|INJURY|FAILED|COMBAT/.test(type)) return 'danger';
  if (/HEAL|COMPLETED|IP_|SKILL/.test(type)) return 'green';
  if (/MONEY|ITEM|AMMO/.test(type)) return 'yellow';
  if (/QUEST|FLAG|SCHEDULED|TRIGGERED/.test(type)) return 'magenta';
  if (/NPC|RELATIONSHIP|FACTION|MESSAGE|MEMORY/.test(type)) return 'purple';
  if (/REJECTED|TIME|ROLL_MADE|SYSTEM|CANCELLED/.test(type)) return 'muted';
  return 'cyan';
}

function EventsTab({ game }: { game: GameState }) {
  const [showNoise, setShowNoise] = useState(false);
  const noisy = (t: GameEventType) => t === 'TOOL_REJECTED' || t === 'TIME_ADVANCED' || t === 'ROLL_MADE';
  const events = useMemo(() => game.events.filter(e => !isSecret(e) && (showNoise || !noisy(e.type))).slice().reverse(), [game.events, showNoise]);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={showNoise} onChange={e => setShowNoise(e.target.checked)} /> Mostrar tempo, dados brutos e ferramentas recusadas
      </label>
      <ul className="divide-y divide-line-soft">
        {events.map(e => (
          <li key={e.id} className="flex items-start gap-2 py-1.5 text-sm">
            <span className="tabular text-[10px] text-dim w-16 shrink-0 pt-0.5">
              T{e.turn} {formatGameTime(e.time).time}
            </span>
            <Badge tone={eventTone(e.type)} className="shrink-0 text-[9px]!">
              {EVENT_LABEL[e.type] ?? e.type}
            </Badge>
            <span className="text-fg/90 min-w-0 break-words">{e.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TurnCard({ t }: { t: TurnRecord }) {
  const [open, setOpen] = useState(false);
  const revealDv = useUiStore(s => s.revealDv);
  const tokensIn = t.llmRuns.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
  const tokensOut = t.llmRuns.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
  const latency = t.llmRuns.reduce((s, r) => s + r.latencyMs, 0);
  return (
    <li className="border border-line">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2" aria-expanded={open}>
        <span className="font-display text-xs text-neon-cyan w-12 shrink-0">T{t.turn}</span>
        <span className="flex-1 min-w-0 text-sm truncate">{t.playerInput ?? (t.kind === 'prologue' ? 'Prólogo' : t.parsedIntent?.summary ?? '—')}</span>
        <Badge tone={t.phase === 'complete' ? 'green' : t.phase === 'failed' ? 'danger' : 'yellow'}>{PHASE_LABEL[t.phase] ?? t.phase}</Badge>
        <ChevronDown className={cn('w-4 h-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 text-xs border-t border-line-soft pt-2">
          {t.parsedIntent && (
            <p>
              <span className="eyebrow">Intenção</span> <Badge tone="purple">{INTENT_LABEL[t.parsedIntent.type] ?? t.parsedIntent.type}</Badge> {t.parsedIntent.summary}
            </p>
          )}
          {t.toolCalls.length > 0 && (
            <div>
              <p className="eyebrow mb-1">Ferramentas</p>
              <ul className="space-y-0.5 tabular">
                {t.toolCalls.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    {c.ok ? <Check className="w-3.5 h-3.5 text-neon-green shrink-0" /> : <X className="w-3.5 h-3.5 text-danger shrink-0" />}
                    <span className="text-dim shrink-0">{ORIGIN_LABEL[c.origin] ?? c.origin}</span>
                    <span className="text-fg shrink-0">{c.tool}</span>
                    <span className="text-muted break-words">{c.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {t.checks.length > 0 && (
            <div>
              <p className="eyebrow mb-1">Testes</p>
              {t.checks.map((c, i) => (
                <p key={i} className="tabular">
                  {c.check}: {c.dice} → {c.roll} {c.modifier >= 0 ? '+' : '−'} {Math.abs(c.modifier)} = <span className="text-fg">{c.total}</span>
                  {revealDv && ` vs DV ${c.difficulty}`} →{' '}
                  <span className={c.success ? 'text-neon-green' : 'text-danger'}>{c.success ? 'SUCESSO' : 'FALHA'}</span>
                </p>
              ))}
              {t.diceRolls.map(r => (
                <p key={r.rollId} className="tabular text-dim">
                  {r.rollId.split(':').slice(-2).join(':')} · {r.dice} [{r.results.join(', ')}] · semente {r.seed}
                </p>
              ))}
            </div>
          )}
          {t.llmRuns.length > 0 && (
            <div>
              <p className="eyebrow mb-1">
                Modelo · {(latency / 1000).toFixed(2)}s · {tokensIn} tokens de entrada / {tokensOut} de saída
              </p>
              <ul className="space-y-0.5 tabular">
                {t.llmRuns.map(r => (
                  <li key={r.requestId} className={cn(r.degraded && 'text-neon-yellow')}>
                    {r.purpose} · {r.model} · {(r.latencyMs / 1000).toFixed(2)}s · {r.inputTokens ?? '?'}/{r.outputTokens ?? '?'} tokens
                    {r.cachedTokens ? ` (${r.cachedTokens} em cache)` : ''}
                    {r.thoughtsTokens ? ` · +${r.thoughtsTokens} de pensamento` : ''} · versão do prompt {r.promptVersion}
                    {r.attempts.length > 1 && ` · ${r.attempts.length} tentativas`}
                    {r.liteOffered && <span className="text-neon-yellow"> · Flash indisponível (Lite oferecido)</span>}
                    {r.errors.length > 0 && <span className="text-danger"> · {r.errors.join('; ').slice(0, 200)}</span>}
                    {r.attempts.length > 1 && (
                      <details className="ml-3 mt-0.5">
                        <summary className="cursor-pointer text-dim hover:text-neon-cyan">ver tentativas</summary>
                        <ol className="space-y-0.5 mt-0.5">
                          {r.attempts.map((a, i) => (
                            <li key={i} className={a.ok ? 'text-neon-green' : a.skipped ? 'text-dim' : 'text-muted'}>
                              {i + 1}. {a.model} · {a.skipped ? `pulado — ${attemptReason(a.error)} (${a.error?.match(/por mais (\d+s)/)?.[1] ?? '?'} para voltar)` : `${(a.latencyMs / 1000).toFixed(1)}s · ${a.ok ? 'ok' : attemptReason(a.error)}`}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-dim">
            Memórias: {t.memoriesRetrieved.length} recuperadas · {t.memoriesCreated.length} criadas · Eventos: {t.events.length} · Estado v{t.stateVersionBefore}
            {t.stateVersionAfter !== undefined && ` → v${t.stateVersionAfter}`}
          </p>
        </div>
      )}
    </li>
  );
}

function TurnsTab({ game }: { game: GameState }) {
  const [turns, setTurns] = useState<TurnRecord[] | null>(null);
  useEffect(() => {
    getRepository()
      .listTurns(game.id, game.session.branchId)
      .then(t => setTurns(t.reverse()))
      .catch(() => setTurns([]));
  }, [game.id, game.session.branchId, game.turn]);
  if (!turns) return <Spinner />;
  if (!turns.length) return <Empty icon={<ListTree className="w-8 h-8" />} title="Nenhum turno registrado ainda" />;
  return (
    <ul className="space-y-1.5">
      {turns.map(t => (
        <TurnCard key={t.turnId} t={t} />
      ))}
    </ul>
  );
}

function TimelineTab({ game, close }: { game: GameState; close: () => void }) {
  const [metas, setMetas] = useState<SnapshotMeta[] | null>(null);
  const busy = useUiStore(s => s.gmBusy);
  useEffect(() => {
    listTimeline(game.id)
      .then(setMetas)
      .catch(() => setMetas([]));
  }, [game.id, game.session.branchId, game.turn]);
  if (!metas) return <Spinner />;
  if (isPermadead(game)) {
    return (
      <Empty title="Modo hardcore">{game.character.bio.handle} morreu, e no hardcore a morte é definitiva: não há como voltar pela linha do tempo.</Empty>
    );
  }

  const points = metas.filter(m => m.branchId === game.session.branchId && m.kind === 'turn_start').reverse();
  const branches = branchesOf(metas);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast({ title: msg, tone: 'success' });
      close();
    } catch (err) {
      toast({ title: 'Falhou', body: (err as Error).message, tone: 'danger' });
    }
  };

  return (
    <div className="space-y-5">
      {branches.length > 1 && (
        <section className="space-y-1.5">
          <p className="eyebrow">Linhas do tempo</p>
          {branches.map(b => (
            <div key={b.branchId} className="flex items-center gap-2 border border-line px-3 py-2">
              <GitBranch className={cn('w-4 h-4', b.branchId === game.session.branchId ? 'text-neon-cyan' : 'text-dim')} />
              <span className="flex-1 tabular text-xs">
                {b.branchId === 'main' ? 'Principal' : b.branchId} · até o turno {b.lastTurn}
              </span>
              {b.branchId === game.session.branchId ? (
                <Badge>atual</Badge>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => switchBranch(b.branchId), 'Linha do tempo retomada')}>
                  Retomar
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-1.5">
        <p className="eyebrow">Voltar para antes de um turno</p>
        {points.length === 0 ? (
          <Empty icon={<History className="w-8 h-8" />} title="Nenhum ponto de retorno" />
        ) : (
          <ul className="space-y-1.5">
            {points.map(p => (
              <li key={p.id} className="border border-line p-2.5 flex flex-wrap items-center gap-2">
                <span className="font-display text-xs text-neon-cyan w-10">T{p.turn}</span>
                <span className="flex-1 min-w-0 text-sm truncate">{p.label}</span>
                <span className="tabular text-[10px] text-dim">{new Date(p.createdAt).toLocaleTimeString('pt-BR')}</span>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    tone="yellow"
                    disabled={busy}
                    icon={<RotateCcw className="w-3 h-3" />}
                    onClick={() => window.confirm(`Voltar para antes do turno ${p.turn}? Tudo depois será desfeito nesta linha do tempo.`) && run(() => rewindTo(p.id), 'Linha do tempo restaurada')}
                  >
                    Voltar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    tone="purple"
                    disabled={busy}
                    icon={<GitBranch className="w-3 h-3" />}
                    title="Cria uma linha alternativa a partir daqui, preservando a atual"
                    onClick={() => run(() => createBranch(p.id), 'Nova linha do tempo criada')}
                  >
                    Ramificar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}


/** Motivo legível de uma tentativa que falhou (o erro começa com o tipo: quota_day, overloaded…). */
const ATTEMPT_REASON: Record<string, string> = {
  quota_day: 'cota diária esgotada',
  quota_minute: 'limite por minuto',
  overloaded: 'Google sobrecarregado (503)',
  timeout: 'demorou demais (cortado)',
  bad_request: 'recusou o schema (400) → simplificado',
  auth: 'chave recusada',
  model_unavailable: 'modelo indisponível',
  network: 'falha de rede',
  blocked: 'bloqueado pelo filtro de conteúdo do Google',
};
function attemptReason(error?: string): string {
  if (!error) return 'falhou';
  if (/^JSON inválido/.test(error)) return 'JSON inválido';
  const kind = error.split(' ')[0];
  return ATTEMPT_REASON[kind] ?? error.slice(0, 80);
}
export function EventLogModal({ game }: { game: GameState }) {
  const open = useUiStore(s => s.modal === 'log');
  const tab = useUiStore(s => s.logTab);
  const close = () => useUiStore.getState().openModal(null);
  return (
    <Modal open={open} onClose={close} title="Registro da campanha" subtitle={`Turno ${game.turn} · estado v${game.session.version} · linha ${game.session.branchId === 'main' ? 'principal' : game.session.branchId}`} size="lg">
      <Tabs<LogTab>
        value={tab}
        onChange={t => useUiStore.setState({ logTab: t })}
        items={[
          { id: 'events', label: `Eventos (${game.events.length})`, icon: <ScrollText className="w-3.5 h-3.5" /> },
          { id: 'turns', label: 'Turnos', icon: <ListTree className="w-3.5 h-3.5" /> },
          { id: 'timeline', label: 'Linha do tempo', icon: <History className="w-3.5 h-3.5" /> },
        ]}
        className="mb-4"
      />
      {tab === 'events' && <EventsTab game={game} />}
      {tab === 'turns' && <TurnsTab game={game} />}
      {tab === 'timeline' && <TimelineTab game={game} close={close} />}
    </Modal>
  );
}
