/**
 * Iniciativa aplicada (C1): depois da Ação do jogador, os inimigos agem na ordem de iniciativa — os mais
 * lentos terminam a rodada, ela vira, e os mais rápidos abrem a próxima. Tudo antes da narração.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { ensureInitiative, runEnemyPhase } from '../shared/engine/initiative';
import { resolveEnemyAttack } from '../shared/engine/combat';
import { withPartyInCombat } from '../shared/engine/party';
import { MAX_CONTEXT_COMBATANTS, buildGameContext } from '../shared/engine/context';
import { NarrateBody } from '../server/validation';
import { applyEnemyPhase, applyNarration, applyRoll, beginTurn, buildEngineResult } from '../shared/engine/turn';
import { sequenceRng } from '../shared/engine/dice';
import { describeEngineResult } from '../server/gamemaster/promptBuilder';
import type { GameState } from '../shared/types/game';
import type { NarrateResponse } from '../shared/types/gm';

const fight = () => scenario().tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
/** Jogador 15; o primeiro inimigo 20 (mais rápido), o segundo 10 (mais lento). */
const ordered = () => {
  const sc = fight();
  sc.edit(s => ({ ...s, combat: { ...s.combat, playerInitiative: 15, combatants: s.combat.combatants.map((t, i) => ({ ...t, initiative: i === 0 ? 20 : 10, weapon: { ...t.weapon, quality: undefined } })) } }));
  return sc;
};
const narr = (over: Partial<NarrateResponse> = {}): NarrateResponse => ({ narration: 'Tiros.', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [], ...over });

describe('Ordem de iniciativa', () => {
  it('mais lentos terminam a rodada, ela vira, mais rápidos abrem a próxima', () => {
    const sc = ordered();
    const [fast, slow] = sc.state.combat.combatants;
    const round = sc.state.combat.round;
    const phase = runEnemyPhase(sc.state, sequenceRng([5]));
    expect(phase.results.map(r => r.attackerId)).toEqual([slow.id, fast.id]);
    expect(phase.state.combat.round).toBe(round + 1);
    expect(phase.lines).toHaveLength(2);
  });

  it('empate com o jogador: o jogador age antes (o inimigo fica no fim da rodada)', () => {
    const sc = ordered();
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => ({ ...t, initiative: 15 })) } }));
    const round = sc.state.combat.round;
    // Ninguém é mais rápido: todos agem antes da virada; a rodada vira sem ninguém na abertura.
    const phase = runEnemyPhase(sc.state, sequenceRng([5]));
    expect(phase.results).toHaveLength(2);
    expect(phase.state.combat.round).toBe(round + 1);
  });

  it('quem caiu antes da própria vez não age; quem perdeu a vez só gasta a vez', () => {
    const sc = ordered();
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map((t, i) => (i === 0 ? { ...t, status: 'down' as const } : { ...t, skipNextAttack: 'arma em pane' })) } }));
    const phase = runEnemyPhase(sc.state, sequenceRng([5]));
    expect(phase.results).toHaveLength(1);
    expect(phase.results[0].skipped).toBe('arma em pane');
    expect(phase.state.combat.combatants[1].skipNextAttack).toBeUndefined();
  });

  it('ataque letal do jogador é aplicado antes da fase inimiga: o alvo abatido não revida', () => {
    const sc = fight();
    const foe = sc.state.combat.combatants[0];
    sc.edit(s => ({
      ...s,
      combat: {
        ...s.combat,
        playerInitiative: 20,
        combatants: s.combat.combatants.map((t, i) => (i === 0 ? { ...t, hp: { ...t.hp, current: 1 }, sp: { ...t.sp, body: 0 }, initiative: 10, attackBase: 30 } : { ...t, initiative: 5 })),
      },
    }));
    sc.tool('interpreter', 'attack', { targetId: foe.id });
    const rolled = applyRoll(beginTurn(sc.state, 'Atiro no capanga.'), 0, 'force:10:lethal-before-phase');
    expect(rolled.outcome?.attack?.targetStatusAfter).toBe('down');
    const hp = rolled.state.character.hp.current;
    const phase = applyEnemyPhase(rolled, sequenceRng([10, 10, 10]));
    expect(phase.state.combat.combatants.find(t => t.id === foe.id)?.status).toBe('down');
    expect(phase.record.toolCalls.at(-1)?.data).toMatchObject({ attacks: 1 }); // só o segundo capanga ainda pode agir
    expect(phase.state.character.hp.current).toBeLessThanOrEqual(hp);
    expect(phase.state.chat.filter(e => e.kind === 'combat' && e.text.includes(foe.name)).some(e => /acerta você/.test(e.text))).toBe(false);
  });

  it('iniciativa rola sozinha se ninguém rolou; quem entra no meio da luta ganha a sua', () => {
    let s: GameState = fight().state;
    expect(s.combat.playerInitiative).toBeNull();
    s = ensureInitiative(s, sequenceRng([6]));
    expect(s.combat.playerInitiative).not.toBeNull();
    expect(s.combat.combatants.every(t => t.initiative !== null)).toBe(true);
    s = { ...s, combat: { ...s.combat, combatants: [...s.combat.combatants, { ...s.combat.combatants[0], id: 'reforco', name: 'Reforço', initiative: null }] } };
    s = ensureInitiative(s, sequenceRng([3]));
    expect(s.combat.combatants.find(t => t.id === 'reforco')?.initiative).toBe(s.combat.combatants[0].ref + 3);
  });

  it('jogador morto: ninguém mais ataca', () => {
    const sc = ordered();
    sc.edit(s => ({ ...s, character: { ...s.character, dead: true } }));
    expect(runEnemyPhase(sc.state, sequenceRng([5])).results).toEqual([]);
  });
});

describe('No turno', () => {
  it('em combate: a fase roda uma vez, entra no resultado do motor e o narrador a vê destacada', () => {
    const sc = ordered();
    const step = applyEnemyPhase(beginTurn(sc.state, 'Atiro no ganger.'), sequenceRng([5]));
    expect(step.record.toolCalls.filter(t => t.tool === 'enemy_phase')).toHaveLength(1);
    expect(applyEnemyPhase(step, sequenceRng([5]))).toBe(step); // não roda duas vezes
    const text = describeEngineResult(buildEngineResult(step, null));
    expect(text).toMatch(/TURNO DOS INIMIGOS \(já resolvido pelo motor/);
  });

  it('com a fase do motor, enemyActions do narrador é ignorado (sem ataques em dobro)', () => {
    const sc = ordered();
    const step = applyEnemyPhase(beginTurn(sc.state, 'Atiro.'), sequenceRng([5]));
    const hp = step.state.character.hp.current;
    const after = applyNarration(step, narr({ enemyActions: sc.state.combat.combatants.map(t => ({ attackerId: t.id })) }), sequenceRng([10, 6, 6, 6]));
    expect(after.state.character.hp.current).toBe(hp);
  });

  it('turno em que o NARRADOR inicia o combate: enemyActions ainda vale (emboscada)', () => {
    const sc = scenario();
    const foeId = fight().state.combat.combatants[0].id; // mesmo id que o start_combat do narrador gera
    const opened = beginTurn(sc.state, 'Entro no beco.');
    expect(applyEnemyPhase(opened)).toBe(opened); // fora de combate, nada
    const after = applyNarration(opened, narr({ toolCalls: [{ tool: 'start_combat', args: { combatants: [{ template: 'maelstrom_ganger', count: 2 }] } }], enemyActions: [{ attackerId: foeId }] }), sequenceRng([10, 6, 6, 6, 6]));
    expect(after.state.chat.some(e => e.kind === 'combat')).toBe(true);
  });

  it('prólogo nunca tem fase de inimigos', () => {
    const sc = ordered();
    const opened = beginTurn(sc.state, null, 'prologue');
    expect(applyEnemyPhase(opened)).toBe(opened);
  });
});

describe('Regressões do QA (01/10/2026)', () => {
  it('CMB-01: enemyActions repetido vale UMA vez por atacante', () => {
    const sc = scenario();
    const hp = sc.state.character.hp.current;
    const after = applyNarration(
      beginTurn(sc.state, 'entro'),
      narr({ toolCalls: [{ tool: 'start_combat', args: { combatants: [{ name: 'Capanga', template: 'maelstrom_ganger' }] } }], enemyActions: Array(6).fill({ attackerId: 'foe_capanga' }) }),
      sequenceRng([9, 5, 6, 6, 6]),
    );
    expect(after.state.chat.filter(c => c.kind === 'combat')).toHaveLength(1);
    expect(hp - after.state.character.hp.current).toBeLessThan(40); // um ataque só, não seis
  });

  it('CMB-01: aliado nunca ataca o jogador, nem por enemyActions', () => {
    const sc = scenario();
    const hp = sc.state.character.hp.current;
    const after = applyNarration(
      beginTurn(sc.state, 'entro'),
      narr({ toolCalls: [{ tool: 'start_combat', args: { combatants: [{ name: 'Amigo', template: 'maelstrom_ganger', side: 'ally' }] } }], enemyActions: [{ attackerId: 'foe_amigo' }] }),
      sequenceRng([10, 6, 6, 6, 6]),
    );
    expect(after.state.character.hp.current).toBe(hp);
    expect(resolveEnemyAttack(after.state, 'foe_amigo', sequenceRng([10, 6, 6]))).toBeNull();
  });

  it('CMB-04: inconsciente e imobilizado não atacam (a condição não é consumida)', () => {
    for (const condition of ['unconscious', 'restrained'] as const) {
      const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 1 }] });
      const foe = sc.state.combat.combatants[0].id;
      sc.tool('narrator', 'set_condition', { targetId: foe, condition, value: true });
      const hp = sc.state.character.hp.current;
      const phase = runEnemyPhase(sc.state, sequenceRng([9, 5, 6, 6, 6]));
      expect(phase.state.character.hp.current).toBe(hp);
      expect(phase.lines.join(' ')).toMatch(condition === 'unconscious' ? /inconsciente/ : /imobilizado/);
      // Continua impedido no turno seguinte.
      expect(runEnemyPhase(phase.state, sequenceRng([9, 5, 6, 6, 6])).state.character.hp.current).toBe(hp);
    }
  });

  it('CMB-04: aliado impedido também não age', () => {
    const sc = scenario()
      .tool('narrator', 'upsert_npc', { name: 'Jax', present: true })
      .tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 20, template: 'bodyguard' })
      .tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 1 }] });
    sc.edit(s => withPartyInCombat(s));
    const ally = sc.state.combat.combatants.find(c => c.side === 'ally')!;
    sc.tool('narrator', 'set_condition', { targetId: ally.id, condition: 'unconscious', value: true });
    const foe = sc.state.combat.combatants.find(c => c.side !== 'ally')!;
    const phase = runEnemyPhase(sc.state, sequenceRng([3, 3, 3]));
    expect(phase.state.combat.combatants.find(c => c.id === foe.id)!.hp.current).toBe(foe.hp.current);
    expect(phase.lines.join(' ')).toMatch(/Jax.*não age \(inconsciente\)/);
  });

  it('CMB-15: luta grande + corpos cabem no limite do servidor', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 6 }] });
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Reforço A', template: 'tyger_claw', count: 6 }] });
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Reforço B', template: 'sixth_street', count: 5 }] });
    expect(sc.state.combat.combatants.length).toBeGreaterThan(MAX_CONTEXT_COMBATANTS);
    const ok = (s: GameState) => NarrateBody.safeParse({ context: JSON.parse(JSON.stringify(buildGameContext(s, ''))), kind: 'action', playerInput: 'x', engineResult: null }).success;
    expect(ok(sc.state)).toBe(true);
    // Todos de pé continuam no contexto.
    const ctx = buildGameContext(sc.state, '');
    expect(ctx.combat.combatants.filter(c => c.status === 'active')).toHaveLength(MAX_CONTEXT_COMBATANTS);
    sc.tool('narrator', 'end_combat', {});
    expect(ok(sc.state)).toBe(true);
  });

  it('jogador pode encerrar a luta vencida sem revistar os corpos', () => {
    const sc = fight();
    const bodies = sc.state.combat.combatants.map(t => t.id);
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => ({ ...t, status: 'down' as const })) } }));
    sc.tool('player', 'end_combat', {});
    expect(sc.last().ok).toBe(true);
    expect(sc.state.combat.active).toBe(false);
    expect(sc.state.combat.combatants.map(t => t.id)).toEqual(bodies);
    expect(sc.state.combat.combatants.every(t => !t.looted)).toBe(true);
  });

  it('quem abandona a cena não pode revistar os corpos depois', () => {
    const sc = fight();
    const body = sc.state.combat.combatants[0];
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => ({ ...t, status: 'down' as const })) } }));
    sc.tool('narrator', 'end_combat', { abandonLoot: true });
    expect(sc.state.combat.combatants.every(t => t.lootUnavailable)).toBe(true);
    sc.tool('player', 'loot', { combatantId: body.id });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/ficou para trás/);
  });

  it('mudar de local também torna o saque da cena anterior indisponível', () => {
    const sc = fight();
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => ({ ...t, status: 'down' as const })) } }));
    sc.tool('narrator', 'end_combat', {});
    sc.tool('player', 'move_location', { spot: 'Saída do beco', minutes: 2 });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.combat.combatants.every(t => t.lootUnavailable)).toBe(true);
  });

  it('jogador não encerra pelo painel enquanto ainda houver inimigo de pé', () => {
    const sc = fight();
    sc.tool('player', 'end_combat', {});
    expect(sc.last().ok).toBe(false);
    expect(sc.state.combat.active).toBe(true);
  });
});
