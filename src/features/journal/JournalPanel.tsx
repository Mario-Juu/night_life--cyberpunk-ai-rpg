import { Flag, MapPin, Search, Shield, Target, Users } from 'lucide-react';
import { STANCE_LABEL } from '@shared/engine/party';
import type { GameState, MissionStatus } from '@shared/types/game';
import { playerViewOf } from '@shared/engine/npcProfile';
import { Badge, Empty, Meter, cn } from '../../ui';

const MISSION_TONE: Record<MissionStatus, 'cyan' | 'green' | 'danger' | 'muted'> = {
  ACTIVE: 'cyan',
  COMPLETED: 'green',
  FAILED: 'danger',
  ABANDONED: 'muted',
};
const MISSION_LABEL: Record<MissionStatus, string> = { ACTIVE: 'Ativa', COMPLETED: 'Concluída', FAILED: 'Falhou', ABANDONED: 'Abandonada' };

/** Centrais primeiro no Diário (a ordem estável mantém quem apareceu antes). */
const IMPORTANCE_ORDER = { extra: 0, recurring: 1, core: 2 } as const;

function standingTone(v: number) {
  return v >= 30 ? 'text-neon-green' : v <= -30 ? 'text-danger' : 'text-muted';
}

export function JournalPanel({ game }: { game: GameState }) {
  const rank = (s: MissionStatus) => (s === 'ACTIVE' ? 0 : 1);
  const missions = [...game.missions].sort((a, b) => rank(a.status) - rank(b.status));
  return (
    <div className="space-y-5">
      <section className="border border-neon-cyan/30 bg-neon-cyan/5 p-3 space-y-2">
        <p className="flex items-center gap-1.5 eyebrow text-neon-cyan">
          <MapPin className="w-3 h-3" /> Situação
        </p>
        <p className="text-sm text-fg leading-snug">{game.world.situation}</p>
        <p className="flex items-start gap-1.5 text-sm text-neon-yellow">
          <Target className="w-4 h-4 shrink-0 mt-0.5" /> {game.world.objective}
        </p>
      </section>

      <section className="space-y-2">
        <p className="flex items-center gap-1.5 eyebrow">
          <Flag className="w-3 h-3" /> Missões
        </p>
        {missions.length === 0 && <p className="text-xs text-dim">Nenhuma missão.</p>}
        {missions.map(m => (
          <article key={m.id} className={cn('border p-2.5 space-y-1', m.status === 'ACTIVE' ? 'border-line' : 'border-line-soft opacity-70')}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-fg">{m.title}</p>
              <Badge tone={MISSION_TONE[m.status]}>{MISSION_LABEL[m.status]}</Badge>
            </div>
            {m.objective && <p className="text-xs text-muted">▸ {m.objective}</p>}
            {(m.reward || m.rewardEddies > 0) && <p className="tabular text-[11px] text-neon-yellow">Recompensa: {m.rewardEddies > 0 ? `€$${m.rewardEddies}` : m.reward}</p>}
            {m.notes.length > 0 && (
              <ul className="text-[11px] text-dim list-disc pl-4">
                {m.notes.slice(-3).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      {(game.party?.members.length ?? 0) > 0 && (
        <section className="space-y-2">
          <p className="flex items-center gap-1.5 eyebrow text-neon-green">
            <Shield className="w-3 h-3" /> Equipe
          </p>
          {game.party!.members.map(m => {
            const n = game.npcs.find(x => x.id === m.npcId);
            if (!n) return null;
            return (
              <div key={m.npcId} className="border border-neon-green/30 bg-neon-green/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-fg truncate">{n.name}</p>
                  <span className="tabular text-[11px] text-muted">{m.share ? `${m.share}% por trabalho` : 'sem cobrar'}</span>
                </div>
                {n.combat && <Meter value={n.combat.hp.current} max={n.combat.hp.max} tone="green" size="sm" label={`PV · ${n.combat.weapon.name}`} />}
                <p className="tabular text-[10px] text-dim">
                  lealdade {m.loyalty}/100 · {STANCE_LABEL[m.stance]}
                  {!game.scene.presentNpcIds.includes(m.npcId) && ' · longe daqui'}
                </p>
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-2">
        <p className="flex items-center gap-1.5 eyebrow">
          <Users className="w-3 h-3" /> Pessoas
        </p>
        {game.npcs.filter(n => !n.offstage).sort((a, b) => IMPORTANCE_ORDER[b.importance ?? 'extra'] - IMPORTANCE_ORDER[a.importance ?? 'extra']).map(n => {
          // Só o que o personagem descobriu: objetivos e segredos escondidos não aparecem aqui.
          const view = playerViewOf(game, n);
          const alive = n.status !== 'dead';
          return (
            <div key={n.id} className="flex items-start justify-between gap-2 border-b border-line-soft pb-2">
              <div className="min-w-0 space-y-0.5">
                <p className={cn('text-sm', alive ? 'text-fg' : 'text-dim line-through')}>{n.name}</p>
                <p className="text-[11px] text-muted">{n.role}{n.faction ? ` · ${n.faction}` : ''}{n.location ? ` · ${n.location}` : ''}</p>
                {view.traits.length > 0 && <p className="text-[11px] text-neon-cyan/80">{view.traits.join(' · ')}</p>}
                {alive && (
                  <p className="tabular text-[10px] text-dim">
                    respeito {n.respect} · medo {n.fear} · raiva {n.anger}
                  </p>
                )}
                {view.currentGoal && alive && <p className="text-[11px] text-muted">Quer: {view.currentGoal}</p>}
                {view.goals.map(g => (
                  <p key={g.text} className={cn('text-[11px]', g.status === 'active' ? 'text-muted' : 'text-dim line-through')}>
                    {g.suspected ? 'Talvez queira' : 'Objetivo'}: {g.text}
                  </p>
                ))}
                {view.bonds.map(b => (
                  <p key={b.text} className="text-[11px] text-muted">
                    {b.suspected ? '? ' : ''}
                    {b.text}
                  </p>
                ))}
                {view.facts.map(f => (
                  <p key={f.text} className={cn('text-[11px]', f.secret ? 'text-neon-magenta/90' : 'text-muted')}>
                    {f.suspected ? '? ' : f.secret ? '◆ ' : ''}
                    {f.text}
                    {f.how && <span className="text-dim"> — {f.how}</span>}
                  </p>
                ))}
                {n.pendingMatters && <p className="text-[11px] text-neon-yellow/80">Pendente: {n.pendingMatters}</p>}
              </div>
              <span className={cn('tabular text-xs shrink-0', standingTone(n.trust))} title="Confiança (−100 a 100)">
                {n.trust > 0 ? '+' : ''}
                {n.trust}
              </span>
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <p className="eyebrow">Facções</p>
        {game.factions.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-fg truncate">
              {f.name} <span className="text-[10px] text-dim">{f.category === 'Gang' ? 'Gangue' : f.category}</span>
            </span>
            <span className={cn('tabular text-xs', standingTone(f.standing))}>
              {f.standing > 0 ? '+' : ''}
              {f.standing}
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <p className="flex items-center gap-1.5 eyebrow">
          <Search className="w-3 h-3" /> Pistas
        </p>
        {game.discoveries.length === 0 ? (
          <Empty title="Nada descoberto ainda" />
        ) : (
          game.discoveries
            .slice()
            .reverse()
            .map(d => (
              <div key={d.title} className="border-l-2 border-neon-yellow pl-2.5">
                <p className="text-sm text-neon-yellow">{d.title}</p>
                <p className="text-xs text-muted">{d.description}</p>
              </div>
            ))
        )}
      </section>
    </div>
  );
}
