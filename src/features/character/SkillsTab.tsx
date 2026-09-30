import { ArrowUp } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { SKILLS, MAX_SKILL_LEVEL, skillUpgradeCost, type SkillCategory } from '@shared/rules/skills';
import { STAT_INFO, STAT_KEYS } from '@shared/rules/stats';
import { statValue } from '@shared/engine/checks';
import { checkPenalties } from '@shared/engine/health';
import { cn } from '../../ui';
import { dispatch } from '../../store/gameStore';
import { sound } from '../../services/audio';

const CATEGORIES: SkillCategory[] = ['Combate', 'Ação', 'Percepção', 'Técnica', 'Social', 'Conhecimento'];

export function SkillsTab({ game }: { game: GameState }) {
  const c = game.character;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-5 gap-1.5">
        {STAT_KEYS.map(k => {
          const value = statValue(c, k);
          const penalty = checkPenalties(c, k).reduce((s, m) => s + m.value, 0);
          return (
            <div key={k} className="border border-line bg-surface-0/50 py-1.5 text-center" title={`${STAT_INFO[k].label}: ${STAT_INFO[k].description}`}>
              <p className="font-display text-[9px] tracking-widest text-neon-cyan">{k}</p>
              <p className="tabular text-base leading-tight">{value}</p>
              {penalty !== 0 && <p className="tabular text-[9px] text-danger">{penalty}</p>}
            </div>
          );
        })}
      </section>

      <p className="text-[11px] text-muted">
        Evolua perícias gastando PM (custo = 20 × novo nível; perícias ×2 custam o dobro). Você tem <span className="text-neon-cyan tabular">{c.ip} PM</span>.
      </p>

      {CATEGORIES.map(cat => (
        <section key={cat} className="space-y-1">
          <p className="eyebrow">{cat}</p>
          <ul className="divide-y divide-line-soft">
            {SKILLS.filter(s => s.category === cat).map(s => {
              const level = c.skills[s.id] ?? 0;
              const cost = skillUpgradeCost(level + 1, s.difficult);
              const canUp = level < MAX_SKILL_LEVEL && c.ip >= cost;
              const base = statValue(c, s.stat) + level;
              return (
                <li key={s.id} className="flex items-center gap-2 py-1.5" title={s.description}>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm truncate', level === 0 ? 'text-dim' : 'text-fg')}>{s.label}{s.difficult && <span className="text-[9px] text-neon-yellow ml-1" title="Perícia ×2: evoluir custa o dobro">×2</span>}</p>
                    <p className="tabular text-[10px] text-dim">
                      {s.stat} {statValue(c, s.stat)} + {level} = base {base}
                    </p>
                  </div>
                  <span className={cn('tabular text-base w-6 text-right', level >= 6 ? 'text-neon-yellow' : level > 0 ? 'text-fg' : 'text-dim')}>{level}</span>
                  <button
                    type="button"
                    disabled={!canUp}
                    onClick={() => {
                      sound.playSuccess();
                      dispatch({ type: 'improveSkill', skillId: s.id });
                    }}
                    title={level >= MAX_SKILL_LEVEL ? 'Nível máximo' : `Subir para ${level + 1} (${cost} PM)`}
                    aria-label={`Evoluir ${s.label}`}
                    className="w-6 h-6 grid place-items-center border border-line text-neon-cyan disabled:opacity-20 hover:bg-neon-cyan/10"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
