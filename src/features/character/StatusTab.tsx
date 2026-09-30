import { useState } from 'react';
import { HeartPulse, Shield, Skull, TriangleAlert } from 'lucide-react';
import { CONDITION_HINT, CONDITION_LABEL } from '@shared/engine/conditions';
import type { GameState } from '@shared/types/game';
import { formatGameTime } from '@shared/rules/world';
import { STREET_DRUGS } from '@shared/rules/streetDrugs';
import { WOUND_LABEL, characterSp, characterWoundState, deathSavePenalty, woundPenalty } from '@shared/engine/health';
import { Badge, Button, Meter, Row, cn } from '../../ui';
import { dispatch } from '../../store/gameStore';

export function StatusTab({ game }: { game: GameState }) {
  const c = game.character;
  const wound = characterWoundState(c);
  const sp = characterSp(c);
  const [adjust, setAdjust] = useState(false);
  const hpTone = wound === 'healthy' || wound === 'lightly' ? 'green' : wound === 'seriously' ? 'yellow' : 'danger';

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <Meter label="Pontos de Vida" value={c.hp.current} max={c.hp.max} tone={hpTone} size="lg" />
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={hpTone === 'green' ? 'green' : hpTone === 'yellow' ? 'yellow' : 'danger'} solid={wound === 'mortally' || wound === 'dead'}>
            {wound === 'dead' ? <Skull className="w-3 h-3" /> : <HeartPulse className="w-3 h-3" />} {WOUND_LABEL[wound]}
          </Badge>
          {woundPenalty(wound) !== 0 && <Badge tone="danger">{woundPenalty(wound)} em todas as ações</Badge>}
          {c.hp.current <= 0 && !c.dead && (
            <Badge tone={c.stabilized ? 'green' : 'danger'}>{c.stabilized ? 'Estabilizado' : `Teste de Morte +${deathSavePenalty(c)}`}</Badge>
          )}
          {(c.conditions ?? []).map(cond => (
            <Badge key={cond.key} tone="yellow" title={CONDITION_HINT[cond.key]}>
              {CONDITION_LABEL[cond.key]}
            </Badge>
          ))}
          {game.scene.lethalThreat && !c.dead && (
            <Badge tone="danger" solid title={game.scene.lethalThreat.description}>
              <TriangleAlert className="w-3 h-3" /> Perigo mortal
            </Badge>
          )}
        </div>
        <button type="button" onClick={() => setAdjust(a => !a)} className="text-[11px] text-dim hover:text-muted underline-offset-2 hover:underline">
          {adjust ? 'Fechar ajuste manual' : 'Ajuste manual de PV'}
        </button>
        {adjust && (
          <div className="flex gap-1.5">
            {[-5, -1, +1, +5].map(d => (
              <Button key={d} size="sm" variant="ghost" tone={d < 0 ? 'danger' : 'green'} onClick={() => dispatch({ type: 'manualHp', delta: d })}>
                {d > 0 ? `+${d}` : d}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2">
        {(['head', 'body'] as const).map(loc => (
          <div key={loc} className="border border-line bg-surface-0/50 p-2.5 flex items-center gap-2">
            <Shield className={cn('w-5 h-5', sp[loc] > 0 ? 'text-neon-cyan' : 'text-dim')} />
            <div>
              <p className="eyebrow">{loc === 'head' ? 'Cabeça' : 'Corpo'}</p>
              <p className="tabular text-lg leading-none">SP {sp[loc]}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <Meter label="Humanidade" value={c.humanity.current} max={c.humanity.max} tone="purple" size="sm" />
        <Meter label="Sorte" value={c.luck.current} max={c.luck.max} tone="green" size="sm" />
      </section>

      <section className="space-y-1.5 border-t border-line-soft pt-4">
        <Row label="Eddies">
          <span className="tabular text-neon-yellow">€${c.money.toLocaleString('pt-BR')}</span>
        </Row>
        <Row label="Reputação">
          <span className="tabular">{c.reputation}/10</span>
        </Row>
        <Row label="Calor policial">
          <span className={cn('tabular', game.world.heat >= 3 && 'text-danger')}>{game.world.heat}/5</span>
        </Row>
        <Row label="Pontos de Melhoria">
          <span className="tabular text-neon-cyan">{c.ip} PM</span>
        </Row>
        {(c.addictions ?? []).length > 0 && (
          <Row label="Vícios">
            <span className="flex flex-wrap gap-1 justify-end">
              {c.addictions!.map(k => (
                <Badge key={k} tone="danger">
                  {STREET_DRUGS[k].label}
                </Badge>
              ))}
            </span>
          </Row>
        )}
      </section>

      {game.activeEffects.length > 0 && (
        <section className="space-y-2 border-t border-line-soft pt-4">
          <p className="eyebrow">Efeitos ativos</p>
          {game.activeEffects.map(e => (
            <div key={e.id} className="border-l-2 border-neon-purple pl-2.5 py-1">
              <p className="text-sm text-neon-purple">{e.name}</p>
              {e.description && <p className="text-xs text-muted">{e.description}</p>}
              <p className="tabular text-[10px] text-dim">
                {Object.entries(e.penalties).map(([k, v]) => `${k === 'all' ? 'Tudo' : k} ${v! > 0 ? '+' : ''}${v}`).join(' · ') || 'sem modificador'}
                {e.expiresAt && ` · até ${formatGameTime(e.expiresAt).time}`}
              </p>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2 border-t border-line-soft pt-4">
        <p className="eyebrow">Ferimentos críticos</p>
        {c.criticalInjuries.length === 0 ? (
          <p className="text-xs text-dim">Nenhum. Por enquanto.</p>
        ) : (
          c.criticalInjuries.map(inj => (
            <div key={inj.id} className="border-l-2 border-danger pl-2.5 py-1">
              <p className="text-sm text-danger">{inj.name}</p>
              <p className="text-xs text-muted">{inj.effect}</p>
              <p className="tabular text-[10px] text-dim">Remendo DV {inj.quickFixDv} · Tratamento DV {inj.treatmentDv}</p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
