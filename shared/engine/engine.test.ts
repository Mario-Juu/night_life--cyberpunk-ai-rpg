import { describe, expect, it } from 'vitest';
import type { GameState, RollRequest } from '../types/game';
import type { ToolCall } from '../types/turn';
import { STAT_PRESETS, POINT_BUDGET, adjustStat, buildCharacter, statTotal, validateStats } from '../rules/creation';
import { resolveSkillId } from '../rules/skills';
import { parseStat } from '../rules/stats';
import { advanceGameTime, formatGameTime } from '../rules/world';
import { parseNotation, recordingRng, rollD10, rollDamage, seededRng, sequenceRng } from './dice';
import { resolveCheck } from './checks';
import { applyDamageToCharacter, characterSp, checkPenalties, computeDamage, woundState } from './health';
import { reloadWeapon, resolveEnemyAttack, resolvePlayerAttack } from './combat';
import { createInitialState } from './initialState';
import { gameReducer } from './reducer';
import { resolveRoll } from './rolls';
import { REGISTRY, runToolCalls, toolsFor } from './tools';
import { buildGameContext } from './context';
import { memoriesFromEvents, pruneMemories, retrieveMemories } from './memory';
import { advanceTime, computeThreat } from './world';
import { migrateState } from './migrate';

export function newCharacter() {
  return buildCharacter({
    name: 'Ren',
    handle: 'Sparks',
    age: 22,
    role: 'solo',
    occupation: 'Entregador',
    district: 'WATSON',
    familyTie: 'Minha mãe, Elena',
    debtReason: '€$2.400 de aluguel',
    personalAnchor: 'Sair de Watson',
    appearance: '',
    stats: { ...STAT_PRESETS[0].stats },
    starterWeaponId: 'pistol',
  });
}

export function newState(): GameState {
  return createInitialState(newCharacter());
}

const run = (s: GameState, calls: ToolCall[], origin: 'interpreter' | 'narrator' | 'phone' = 'narrator', dice = [5]) =>
  runToolCalls(REGISTRY, s, calls, { rng: sequenceRng(dice), origin });

function withEnemy(state: GameState): GameState {
  return run(state, [
    {
      tool: 'start_combat',
      args: { combatants: [{ id: 'foe_ganger', name: 'Capanga', hp: 20, sp: 4, weaponClass: 'pistol_medium', distance: '0-6m', ref: 5, attackBase: 10, evasionBase: 8 }] },
    },
  ]).state;
}

describe('dados', () => {
  it('10 natural explode e 1 natural implode', () => {
    expect(rollD10(sequenceRng([10, 7]))).toMatchObject({ total: 17, crit: true });
    expect(rollD10(sequenceRng([1, 4]))).toMatchObject({ total: -3, fumble: true });
    expect(rollD10(sequenceRng([6]))).toMatchObject({ total: 6, crit: false, fumble: false });
  });

  it('parser de notação é ancorado e aceita bônus', () => {
    expect(parseNotation('3d6+2')).toEqual({ count: 3, sides: 6, bonus: 2 });
    expect(parseNotation('xx3d6')).toBeNull();
    expect(rollDamage('2d6+1', sequenceRng([3, 4])).total).toBe(8);
  });

  it('crítico exige dois 6 em d6', () => {
    expect(rollDamage('3d6', sequenceRng([6, 6, 1])).critical).toBe(true);
    expect(rollDamage('3d6', sequenceRng([6, 5, 1])).critical).toBe(false);
  });

  it('a mesma seed reproduz exatamente as mesmas rolagens', () => {
    const a = recordingRng(seededRng('abc123'));
    const b = recordingRng(seededRng('abc123'));
    for (let i = 0; i < 20; i++) expect(a.rng(10)).toBe(b.rng(10));
    expect(a.log).toEqual(b.log);
    expect(a.log.every(d => d.face >= 1 && d.face <= 10)).toBe(true);
  });
});

describe('criação', () => {
  it('todos os perfis somam exatamente 62', () => {
    for (const p of STAT_PRESETS) expect(statTotal(p.stats), p.id).toBe(POINT_BUDGET);
  });

  it('respeita orçamento e limites 2..8', () => {
    const s = STAT_PRESETS[0].stats;
    expect(adjustStat(s, 'INT', 1)).toBe(s);
    const lower = adjustStat(s, 'INT', -1);
    expect(adjustStat(lower, 'REF', 1).REF).toBe(s.REF + 1);
    expect(validateStats({ ...s, INT: 9, REF: 6 })).not.toBeNull();
  });

  it('HP inicial cheio e SP derivado da jaqueta equipada', () => {
    const c = newCharacter();
    expect(c.hp.current).toBe(c.hp.max);
    expect(characterSp(c)).toEqual({ head: 0, body: 7 });
    expect(c.skills.handgun).toBe(6);
  });
});

describe('perícias e atributos', () => {
  it('resolve nomes livres para ids canônicos', () => {
    expect(resolveSkillId('Pistolas (Handgun)')).toBe('handgun');
    expect(resolveSkillId('Armas de Fogo de Mão')).toBe('handgun');
    expect(resolveSkillId('Cibertecnologia (Cybertech)')).toBe('cybertech');
    expect(resolveSkillId('dança do ventre')).toBe('dance'); // Dança é perícia no RED
    expect(resolveSkillId('culinária molecular')).toBeNull();
  });

  it('stat só aceita correspondência exata', () => {
    expect(parseStat('INTIMIDAÇÃO')).toBeNull();
    expect(parseStat('Corpo')).toBe('BODY');
  });
});

describe('testes de perícia e dano', () => {
  it('soma STAT + perícia + d10 e exige superar o DV', () => {
    const c = newCharacter();
    const r = resolveCheck(c, { stat: 'REF', skillId: 'handgun', dv: 17 }, sequenceRng([4]));
    expect(r.total).toBe(17);
    expect(r.success).toBe(false);
    expect(resolveCheck(c, { stat: 'REF', skillId: 'handgun', dv: 17, luckSpent: 1 }, sequenceRng([4])).success).toBe(true);
  });

  it('aplica −2 quando gravemente ferido', () => {
    const c = newCharacter();
    const hurt = { ...c, hp: { ...c.hp, current: Math.floor(c.hp.max / 2) - 1 } };
    expect(woundState(hurt.hp)).toBe('seriously');
    expect(checkPenalties(hurt, 'REF')).toEqual([{ label: 'Gravemente ferido', value: -2 }]);
  });

  it('armadura, cabeça ×2, ablação e crítico +5 uma vez', () => {
    expect(computeDamage({ raw: 10, sp: 7, location: 'body', critical: false })).toMatchObject({ hpDamage: 3, ablated: true });
    expect(computeDamage({ raw: 10, sp: 7, location: 'head', critical: false }).hpDamage).toBe(6);
    expect(computeDamage({ raw: 5, sp: 7, location: 'body', critical: true })).toMatchObject({ hpDamage: 5, ablated: false });
    expect(computeDamage({ raw: 10, sp: 8, location: 'body', halfArmor: true, critical: false }).hpDamage).toBe(6);
  });

  it('ablação reduz a SP da armadura equipada', () => {
    const c = newCharacter();
    const { character } = applyDamageToCharacter(c, { notation: '2d6', rolls: [5, 5], total: 10, sixes: 0, critical: false }, 'body');
    expect(characterSp(character).body).toBe(6);
    expect(character.hp.current).toBe(c.hp.max - 3);
  });
});

describe('combate', () => {
  it('ataque do jogador gasta 1 munição e aplica dano ao alvo', () => {
    const s = withEnemy(newState());
    const req: RollRequest = { id: 'r', kind: 'attack', origin: 'player', reason: 'tiro', stat: 'REF', skillId: 'handgun', dv: 13, modifier: 0, targetId: 'foe_ganger' };
    const outcome = resolvePlayerAttack(s, req, 0, sequenceRng([8, 6, 5]));
    expect(outcome.attack).toMatchObject({ hit: true, ammoAfter: 11 });
    const next = gameReducer(s, { type: 'rollResolved', outcome });
    expect(next.combat.combatants[0].hp.current).toBe(13);
    expect(next.combat.combatants[0].sp.body).toBe(3);
    expect(next.events.map(e => e.type)).toEqual(expect.arrayContaining(['ATTACK_RESOLVED', 'DAMAGE_DEALT']));
    expect(next.events.find(e => e.type === 'DAMAGE_DEALT')).toMatchObject({ source: 'player', target: 'foe_ganger', value: 7 });
  });

  it('recarga consome estoque e falha sem munição', () => {
    const c = newCharacter();
    const fired = { ...c, inventory: c.inventory.map(i => (i.weapon ? { ...i, weapon: { ...i.weapon, loaded: 2 } } : i)) };
    const res = reloadWeapon(fired, 'item_starter_weapon');
    if ('error' in res) throw new Error(res.error);
    expect(res.loadedRounds).toBe(10);
    expect('error' in reloadWeapon({ ...fired, inventory: fired.inventory.filter(i => i.category !== 'ammo') }, 'item_starter_weapon')).toBe(true);
  });

  it('ataque inimigo reduz HP e SP do jogador', () => {
    const s = withEnemy(newState());
    const res = resolveEnemyAttack(s, 'foe_ganger', sequenceRng([9, 6, 6, 1]));
    expect(res?.result.application?.hpDamage).toBe(10);
    const next = gameReducer(s, { type: 'enemyAttack', result: res!.result });
    expect(next.character.hp.current).toBe(s.character.hp.max - 10);
    expect(next.character.criticalInjuries).toHaveLength(1);
    expect(next.events.some(e => e.type === 'DAMAGE_TAKEN' && e.source === 'foe_ganger')).toBe(true);
  });

  it('iniciativa = REF + 1d10 (+ Reação de Iniciativa do Solo)', () => {
    const s = withEnemy(newState());
    const req = { id: 'i', kind: 'initiative' as const, origin: 'player' as const, reason: 'Iniciativa', stat: 'REF' as const, skillId: null, dv: 0, modifier: 0 };
    // Solo padrão: 1 ponto em Reação de Iniciativa.
    expect(resolveRoll(s, req, 0, sequenceRng([5, 3])).initiative).toEqual({ player: 13, enemies: [{ id: 'foe_ganger', value: 8 }] });
    const noReaction = { ...s, character: { ...s.character, roleData: {} } };
    expect(resolveRoll(noReaction, req, 0, sequenceRng([5, 3])).initiative).toEqual({ player: 12, enemies: [{ id: 'foe_ganger', value: 8 }] });
  });

  it('Teste de Morte é forçado a 0 PV e mata ao falhar', () => {
    const down = gameReducer(newState(), { type: 'manualHp', delta: -999 });
    expect(down.pendingRoll?.kind).toBe('deathSave');
    const fail = resolveRoll(down, down.pendingRoll!, 0, sequenceRng([10]));
    expect(gameReducer(down, { type: 'rollResolved', outcome: fail }).character.dead).toBe(true);
  });
});

describe('registro de ferramentas', () => {
  it('parâmetros com o mesmo nome têm o mesmo tipo em todas as ferramentas de uma origem', () => {
    for (const origin of ['interpreter', 'narrator', 'phone'] as const) {
      const types = new Map<string, string>();
      for (const t of toolsFor(origin))
        for (const [k, p] of Object.entries(t.params)) {
          const prev = types.get(k);
          expect(prev === undefined || prev === p.type, `${origin}: ${t.name}.${k} é ${p.type}, mas outra ferramenta usa ${prev}`).toBe(true);
          types.set(k, p.type);
        }
    }
  });

  it('LLM não pode setar HP diretamente nem usar ferramentas de outra origem', () => {
    const s = newState();
    const res = run(s, [
      { tool: 'set_hp', args: { value: 0 } },
      { tool: 'attack', args: { targetName: 'x' } }, // ação só do intérprete
      { tool: 'transfer_money', args: { amount: 999999, counterpart: 'x', reason: 'y' } },
    ]);
    expect(res.records.map(r => r.ok)).toEqual([false, false, true]);
    expect(res.state.character.money).toBe(s.character.money + 1000); // limitado
    expect(res.state.events.filter(e => e.type === 'TOOL_REJECTED')).toHaveLength(2);
  });

  it('attack sem alvo registrado cria o combatente e inicia o combate', () => {
    const res = run(newState(), [{ tool: 'attack', args: { targetName: 'Segurança' } }], 'interpreter');
    expect(res.records[0].ok).toBe(true);
    expect(res.state.combat.active).toBe(true);
    expect(res.pendingRoll).toMatchObject({ kind: 'attack', targetId: 'foe_seguranca' });
  });

  it('só uma rolagem por turno', () => {
    const res = run(newState(), [
      { tool: 'persuade', args: { dv: 13, reason: 'a' } },
      { tool: 'intimidate', args: { dv: 13, reason: 'b' } },
    ], 'interpreter');
    expect(res.records.map(r => r.ok)).toEqual([true, false]);
  });

  it('relação com o NPC modifica testes sociais', () => {
    let s = newState();
    s = { ...s, npcs: s.npcs.map(n => (n.id === 'npc_rafa' ? { ...n, trust: 70 } : n)) };
    const res = run(s, [{ tool: 'persuade', args: { dv: 15, reason: 'baixar o preço', targetNpcId: 'npc_rafa' } }], 'interpreter');
    expect(res.pendingRoll?.modifiers).toContainEqual({ label: 'Rafa "Zero-Um" confia em você', value: 2 });
  });

  it('upsert_npc deduplica por nome; modify_relationship persiste', () => {
    let s = run(newState(), [
      { tool: 'upsert_npc', args: { name: 'Judy', role: 'Técnica de ND' } },
      { tool: 'upsert_npc', args: { name: 'judy', currentGoal: 'Achar a Evelyn' } },
      { tool: 'modify_relationship', args: { npcId: 'judy', trust: 10, fear: 5 } },
    ]).state;
    const judys = s.npcs.filter(n => n.name.toLowerCase() === 'judy');
    expect(judys).toHaveLength(1);
    expect(judys[0]).toMatchObject({ trust: 10, fear: 5, currentGoal: 'Achar a Evelyn' });
    s = run(s, [{ tool: 'modify_relationship', args: { npcId: judys[0].id, trust: 100 } }]).state;
    expect(s.npcs.find(n => n.name === 'Judy')?.trust).toBe(35); // limitado a +25 por chamada
  });
});

describe('mundo', () => {
  it('avanço de tempo vira o dia e recarrega a Sorte', () => {
    let s = newState();
    s = { ...s, character: { ...s.character, luck: { ...s.character.luck, current: 0 } } };
    const next = advanceTime(s, 30);
    expect(formatGameTime(next.world.time)).toMatchObject({ date: '30 SET 2077', time: '00:11' });
    expect(next.character.luck.current).toBe(next.character.luck.max);
    expect(advanceGameTime('2077-12-31T23:50:00.000Z', 20).startsWith('2078-01-01')).toBe(true);
  });

  it('evento agendado com condição dispara ou é cancelado', () => {
    const s = newState(); // Rafa insiste às 00:31 se rafa_job_answered não for true
    const fired = advanceTime(s, 60);
    expect(fired.phone.find(t => t.npcId === 'npc_rafa')?.messages.at(-1)?.text).toMatch(/Última chamada/);
    expect(fired.scheduled[0].status).toBe('resolved');

    const answered = run(s, [{ tool: 'set_flag', args: { key: 'rafa_job_answered', value: true } }]).state;
    const cancelled = advanceTime(answered, 60);
    expect(cancelled.scheduled[0].status).toBe('cancelled');
    expect(cancelled.phone.find(t => t.npcId === 'npc_rafa')?.messages).toHaveLength(1);
  });

  it('missão com completeFlag conclui sozinha e paga uma única vez', () => {
    let s = run(newState(), [{ tool: 'start_quest', args: { title: 'Entrega do chip', objective: 'Levar o chip', rewardEddies: 600, completeFlag: 'chip_delivered', giverId: 'npc_rafa' } }]).state;
    const money = s.character.money;
    s = run(s, [{ tool: 'set_flag', args: { key: 'chip_delivered', value: true } }]).state;
    expect(s.missions.find(m => m.title === 'Entrega do chip')?.status).toBe('COMPLETED');
    expect(s.character.money).toBe(money + 600);
    s = run(s, [{ tool: 'complete_quest', args: { questId: 'm_entrega_do_chip' } }]).state;
    expect(s.character.money).toBe(money + 600);
  });

  it('ameaça sobe em combate', () => {
    expect(computeThreat(newState())).toBe('low');
    expect(computeThreat(withEnemy(newState()))).toBe('high');
  });
});

describe('memória e contexto', () => {
  it('eventos importantes viram memórias; banais esquecidas são podadas', () => {
    let s = run(newState(), [{ tool: 'npc_status', args: { npcId: 'npc_rafa', status: 'dead', reason: 'tiroteio' } }]).state;
    const created = memoriesFromEvents(s, s.events);
    expect(created.created.length).toBeGreaterThan(0);
    expect(created.state.memories.some(m => m.type === 'NPC_MEMORY' && m.subject === 'npc_rafa' && m.importance === 9)).toBe(true);

    s = { ...created.state, turn: 100, memories: [...created.state.memories, { id: 'banal', type: 'SCENE_MEMORY', subject: 'x', content: 'y', importance: 2, confidence: 1, createdTurn: 1, lastRelevantTurn: 1, tags: [] }] };
    const pruned = pruneMemories(s);
    expect(pruned.memories.some(m => m.id === 'banal')).toBe(false);
    expect(pruned.memories.some(m => m.subject === 'npc_rafa' && m.importance === 9)).toBe(true);
  });

  it('memória citada na ação é recuperada primeiro', () => {
    const s = newState();
    expect(retrieveMemories(s, 'vou falar com o Rafa sobre o corre', 1)[0].subject).toBe('npc_rafa');
  });

  it('contexto separa segredos de NPC do conhecimento do jogador', () => {
    const ctx = buildGameContext(newState(), 'Rafa');
    const rafa = ctx.npcs.find(n => n.id === 'npc_rafa');
    expect(rafa?.knowledge.some(k => k.secret && /Militech/.test(k.fact))).toBe(true);
    expect(ctx.playerKnowledge.join(' ')).not.toMatch(/Militech/);
  });
});

describe('persistência', () => {
  it('migra save v2 para v3 preenchendo os campos novos', () => {
    const s = newState();
    const v2 = {
      ...s,
      version: 2,
      session: undefined,
      scene: undefined,
      flags: undefined,
      scheduled: undefined,
      activeEffects: undefined,
      history: undefined,
      npcs: s.npcs.map(({ respect: _r, fear: _f, anger: _a, knowledge: _k, ...n }) => n),
      memories: [{ id: 'm1', subject: 'Rafa', content: 'x', importance: 5, turn: 2, tags: ['phone'] }],
      events: [{ id: 'e', turn: 1, time: s.world.time, type: 'money', summary: '+10' }],
    };
    const m = migrateState(JSON.parse(JSON.stringify(v2)));
    expect(m.version).toBe(3);
    expect(m.session.branchId).toBe('main');
    expect(m.npcs[0]).toMatchObject({ respect: 30, fear: 0, anger: 0, knowledge: [] });
    expect(m.memories[0]).toMatchObject({ type: 'NPC_MEMORY', createdTurn: 2, confidence: 0.9 });
    expect(m.events[0].type).toBe('MONEY_CHANGED');
  });
});
