import { Flag, MapPin, Search, Target, Users } from 'lucide-react';
import type { GameState, MissionStatus } from '@shared/types/game';
import { Badge, Empty, cn } from '../../ui';

const MISSION_TONE: Record<MissionStatus, 'cyan' | 'green' | 'danger' | 'muted'> = {
  ACTIVE: 'cyan',
  COMPLETED: 'green',
  FAILED: 'danger',
  ABANDONED: 'muted',
};
const MISSION_LABEL: Record<MissionStatus, string> = { ACTIVE: 'Ativa', COMPLETED: 'Concluída', FAILED: 'Falhou', ABANDONED: 'Abandonada' };

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

      <section className="space-y-2">
        <p className="flex items-center gap-1.5 eyebrow">
          <Users className="w-3 h-3" /> Pessoas
        </p>
        {game.npcs.map(n => (
          <div key={n.id} className="flex items-start justify-between gap-2 border-b border-line-soft pb-2">
            <div className="min-w-0">
              <p className={cn('text-sm', n.status === 'dead' ? 'text-dim line-through' : 'text-fg')}>{n.name}</p>
              <p className="text-[11px] text-muted">{n.role}{n.faction ? ` · ${n.faction}` : ''}{n.location ? ` · ${n.location}` : ''}</p>
              {n.status !== 'dead' && (
                <p className="tabular text-[10px] text-dim">
                  respeito {n.respect} · medo {n.fear} · raiva {n.anger}
                </p>
              )}
              {n.currentGoal && n.status !== 'dead' && <p className="text-[11px] text-muted">Quer: {n.currentGoal}</p>}
              {n.pendingMatters && <p className="text-[11px] text-neon-yellow/80">Pendente: {n.pendingMatters}</p>}
            </div>
            <span className={cn('tabular text-xs shrink-0', standingTone(n.trust))} title="Confiança (−100 a 100)">
              {n.trust > 0 ? '+' : ''}
              {n.trust}
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <p className="eyebrow">Facções</p>
        {game.factions.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-fg truncate">
              {f.name} <span className="text-[10px] text-dim">{f.category}</span>
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
