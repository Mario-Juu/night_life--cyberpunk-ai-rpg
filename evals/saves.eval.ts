import { describe, expect, it } from 'vitest';
import { validateSave } from '../src/services/saves';
import { scenario } from './harness';
import { applyEnemyPhase, applyNarration, beginTurn, finalizeTurn } from '../shared/engine/turn';
import { buildGameContext } from '../shared/engine/context';
import { advanceTime } from '../shared/engine/world';
import { generateFronts } from '../shared/engine/fronts';
import { sequenceRng } from '../shared/engine/dice';
import type { NarrateResponse } from '../shared/types/gm';
const narr: NarrateResponse = { narration: 'x', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [] };

describe('Validação de save (regressões do QA de 01/10/2026)', () => {
  it('save realista (campanha jogada) continua carregando e jogável', () => {
    const sc = scenario({ role: 'netrunner' })
      .tool('narrator', 'upsert_npc', { name: 'Jax', present: true })
      .tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 20, template: 'bodyguard' })
      .tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
    sc.edit(st => generateFronts(st, { seed: 'x' }));
    const loaded = validateSave(JSON.parse(JSON.stringify(sc.state)));
    let step = beginTurn(loaded, 'olho');
    step = applyEnemyPhase(step, sequenceRng([5]));
    step = finalizeTurn(applyNarration(step, narr, sequenceRng([5])), []);
    buildGameContext(step.state, 'x');
    advanceTime(step.state, 600);
    console.log('REAL ok: turno', step.state.turn, 'fronts', loaded.fronts?.length, 'party', loaded.party?.members.length);
    expect(step.state.turn).toBe(loaded.turn + 1);
  });

  it('save v2 antigo (sem campos novos) ainda migra', () => {
    const s = scenario({ role: 'netrunner' }).state;
    const old = JSON.parse(JSON.stringify(s));
    old.version = 2;
    delete old.character.quickhacks;
    delete old.character.deck.ram;
    delete old.fronts;
    delete old.news;
    delete old.party;
    delete old.net;
    for (const n of old.npcs) {
      delete n.profile;
      delete n.goals;
      delete n.bonds;
      delete n.importance;
    }
    old.character.bio.age = 17;
    const loaded = validateSave(old);
    expect(loaded.character.bio.age).toBe(18);
    expect(loaded.character.quickhacks?.length).toBeGreaterThan(0);
    console.log('V2 ok: ram', JSON.stringify(loaded.character.deck?.ram));
  });

  it('rejeita o que quebrava a tela', () => {
    const base = () => JSON.parse(JSON.stringify(scenario().state));
    const cases: Array<[string, (g: Record<string, never>) => void]> = [
      ['news não-array', g => ((g as never as { news: unknown }).news = 7)],
      ['humanity ausente', g => delete (g as never as { character: { humanity?: unknown } }).character.humanity],
      ['memories null', g => ((g as never as { memories: unknown }).memories = null)],
      ['party.members inválido', g => ((g as never as { party: unknown }).party = { members: 5 })],
      ['scheduled [null]', g => ((g as never as { scheduled: unknown }).scheduled = [null])],
      ['phone sem messages', g => ((g as never as { phone: unknown }).phone = [{ npcId: 'x' }])],
      ['combatente null', g => ((g as never as { combat: { combatants: unknown } }).combat.combatants = [null])],
      ['npcs com null', g => (g as never as { npcs: unknown[] }).npcs.push(null)],
      ['money string', g => ((g as never as { character: { money: unknown } }).character.money = 'abc')],
      ['hp Infinity', g => ((g as never as { character: { hp: { current: unknown } } }).character.hp.current = Infinity)],
    ];
    for (const [label, mutate] of cases) {
      const g = base();
      mutate(g);
      expect(() => validateSave(g), label).toThrow();
    }
  });
});
