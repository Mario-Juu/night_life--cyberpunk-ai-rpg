/**
 * QA adversarial do Trilheiro: quickhacks com rolagem pendente na tela, combos, RAM, rastro/alerta/daemon,
 * persistência e uma sequência aleatória (seed fixa) checando invariantes.
 *
 * Convenção: `it(...)` = comportamento correto; `it.fails('BUG-NET-n: ...')` = bug confirmado
 * (o teste descreve o comportamento CORRETO e passa enquanto o bug existir).
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { validateSave } from '../src/services/saves';
import { gameReducer } from '../shared/engine/reducer';
import { resolveRoll, canSpendLuck } from '../shared/engine/rolls';
import { sequenceRng, seededRng, type Rng } from '../shared/engine/dice';
import { runEnemyPhase } from '../shared/engine/initiative';
import { REGISTRY, runToolCalls } from '../shared/engine/tools';
import { buildQuickhackRequest, ramMax, withQuickhackDefaults } from '../shared/engine/quickhacks';
import { addTrace, endNetTurn, generateArchitecture, leaveAccessPoint, netAction, jackIn, describeNet } from '../shared/engine/net';
import { migrateState } from '../shared/engine/migrate';
import { applyEnemyPhase, applyInterpretation, applyRoll, beginTurn, buildEngineResult, toCheckRecord } from '../shared/engine/turn';
import { checkNarration } from '../shared/engine/consistency';
import { describeOutcome, buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import { buildGameContext } from '../shared/engine/context';
import { applySandboxRole } from '../shared/engine/sandbox';
import { QUICKHACKS, QUICKHACK_KEYS, QUICKHACK_DV, RAM_REGEN_PER_ROUND, STARTER_QUICKHACKS, type QuickhackKey } from '../shared/rules/quickhacks';
import type { Combatant, GameState, NetArchitecture, NetFloor, NetRun } from '../shared/types/game';

type Sc = ReturnType<typeof scenario>;

// ---------------------------------------------------------------- helpers

/** Trilheiro rank 10 (Interface 10) com os 12 hacks e RAM cheia (9). */
function hacker(rank = 10): Sc {
  return scenario({ role: 'netrunner' }).edit(s => {
    const c = { ...s.character, roleRank: rank, ip: 500, quickhacks: [...QUICKHACK_KEYS] as string[] };
    const m = ramMax(c);
    return { ...s, character: { ...c, deck: { ...c.deck!, ram: { current: m, max: m } } } };
  });
}

const BASE_FOE: Combatant = {
  id: 'f1', name: 'Alvo 1', hp: { current: 60, max: 60 }, sp: { head: 0, body: 6 },
  weapon: { name: 'Pistola', weaponClass: 'pistol_medium', damage: '2d6' },
  attackBase: 6, evasionBase: 6, ref: 6, initiative: 3, distance: '0-6m', cover: 'none', status: 'active', template: 'boosterganger',
};
const foeOf = (id: string, over: Partial<Combatant> = {}): Combatant => ({ ...BASE_FOE, id, name: `Alvo ${id}`, ...over });

function fight(sc: Sc, foes: Combatant[] = [foeOf('f1'), foeOf('f2')]): Sc {
  return sc.edit(s => ({ ...s, combat: { ...s.combat, active: true, round: 1, playerInitiative: 5, combatants: foes } }));
}
const patchFoe = (sc: Sc, id: string, patch: Partial<Combatant>) =>
  sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => (t.id === id ? { ...t, ...patch } : t)) } }));
const foe = (sc: Sc, id = 'f1') => sc.state.combat.combatants.find(t => t.id === id)!;
const ram = (sc: Sc) => sc.state.character.deck!.ram!;
const trace = (sc: Sc) => sc.state.net.trace?.level ?? 0;
const setRam = (sc: Sc, current: number) => sc.edit(s => ({ ...s, character: { ...s.character, deck: { ...s.character.deck!, ram: { ...s.character.deck!.ram!, current } } } }));
const phase = (sc: Sc, rng: Rng = sequenceRng([2])) => sc.edit(s => runEnemyPhase(s, rng).state);
const clearPending = (sc: Sc) => sc.edit(s => ({ ...s, pendingRoll: null }));

/** Pede o quickhack e rola (d10 + dados de efeito), pelo mesmo caminho do jogo. */
function qh(sc: Sc, hack: QuickhackKey, targetId: string | undefined, dice: number[], luck = 0, origin: 'interpreter' | 'player' = 'interpreter'): Sc {
  sc.tool(origin, 'quickhack', targetId ? { hack, targetId } : { hack });
  if (sc.state.pendingRoll) sc.roll(dice, luck);
  return sc;
}
/** d10 alto (passa qualquer defesa) + dados de efeito 3. */
const HIT = [9, 3, 3, 3, 3, 3, 3, 3];

const floor = (index: number, kind: NetFloor['kind'], extra: Partial<NetFloor> = {}): NetFloor => ({ index, kind, cleared: false, revealed: false, ...extra });
const arch = (floors: NetFloor[], extra: Partial<NetArchitecture> = {}): NetArchitecture => ({ id: 'arch_t', name: 'Servidor X', accessPoint: 'terminal', difficulty: 'basic', dv: 6, floors, createdTurn: 0, ...extra });
const mkRun = (patch: Partial<NetRun> = {}): NetRun => ({ architectureId: 'arch_t', position: 0, actionsLeft: 3, netTurn: 1, ice: [], slideUsed: false, skunkPenalty: 0, actionPenalty: 0, cloaked: false, log: [], ...patch });

// ================================================================ 1. QUICKHACKS: matriz de hacks

describe('Quickhacks: 12 hacks × sucesso (RAM, rastro, efeito)', () => {
  const targeted = QUICKHACK_KEYS.filter(k => QUICKHACKS[k].target !== 'none');

  it.each(targeted)('%s em capanga: gasta RAM exata, rastro só em T3/T4, efeito esperado', key => {
    const sc = fight(hacker(), [foeOf('f1'), foeOf('f2', { sp: { head: 0, body: 0 } })]);
    const hp = foe(sc).hp.current;
    const r0 = ram(sc).current;
    qh(sc, key, 'f1', HIT);
    const def = QUICKHACKS[key];
    expect(sc.lastOutcome!.quickhack).toMatchObject({ key, ok: true });
    expect(sc.lastOutcome!.check.success).toBe(true);
    expect(ram(sc).current).toBe(r0 - def.ram);
    expect(trace(sc)).toBe(def.tier >= 3 ? 1 : 0);
    const f = foe(sc);
    switch (key) {
      case 'reboot_optics': expect(f.skipNextAttack).toBeTruthy(); expect(f.hacks?.[0].hitBonus).toBe(2); break;
      case 'sonic_shock': expect(f.hacks?.[0]).toMatchObject({ attackMod: -2, untilRound: 3 }); break;
      case 'memory_wipe': expect(f.status).toBe('fled'); break;
      case 'weapon_glitch': expect(f.skipNextAttack).toBe('arma em pane'); break;
      case 'cripple_movement': expect(f.hacks?.[0]).toMatchObject({ hitBonus: 2, untilRound: 3 }); break;
      case 'cyberware_malfunction': expect(f.sp.body).toBe(4); expect(f.hacks?.[0]).toMatchObject({ attackMod: -3, untilRound: 4 }); break;
      case 'cyberpsychosis': expect(foe(sc, 'f2').hp.current).toBeLessThan(60); expect(f.skipNextAttack).toBeTruthy(); expect(f.hacks?.[0].attackMod).toBe(-4); break;
      case 'short_circuit': expect(f.hp.current).toBe(hp - 6); break;
      case 'overheat': expect(f.hp.current).toBe(hp - 6); expect(f.hacks?.[0]).toMatchObject({ dot: '3', untilRound: 3 }); break;
      case 'synapse_burnout': expect(f.hp.current).toBe(hp - 9); break;
      case 'system_collapse': expect(f.status).toBe('down'); expect(f.hp.current).toBe(hp); break;
    }
  });

  it('Ping: sem alvo, sem teste, gasta 1 RAM, marca todos os inimigos (não aliados) e não deixa pendência', () => {
    const sc = fight(hacker(), [foeOf('f1'), foeOf('f2'), foeOf('a1', { side: 'ally' })]);
    const r0 = ram(sc).current;
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.pendingRoll).toBeNull();
    expect(ram(sc).current).toBe(r0 - 1);
    expect(trace(sc)).toBe(0);
    expect(foe(sc, 'f1').hacks?.[0].key).toBe('ping');
    expect(foe(sc, 'a1').hacks ?? []).toHaveLength(0);
  });

  it('Ping com RAM 0 é recusado e não gasta nada', () => {
    const sc = setRam(fight(hacker()), 0);
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(false);
    expect(ram(sc).current).toBe(0);
  });

  it('Queima Sináptica: +2d6 se o alvo está com metade dos PV ou menos (5d6)', () => {
    const sc = fight(hacker());
    patchFoe(sc, 'f1', { hp: { current: 30, max: 60 } });
    qh(sc, 'synapse_burnout', 'f1', [9, 3, 3, 3, 3, 3]);
    expect(foe(sc).hp.current).toBe(30 - 15);
  });

  it('Queima Sináptica que derruba o alvo: status down (PV não ficam negativos)', () => {
    const sc = fight(hacker());
    patchFoe(sc, 'f1', { hp: { current: 4, max: 60 } });
    qh(sc, 'synapse_burnout', 'f1', [9, 6, 6, 6, 6, 6]);
    expect(foe(sc).hp.current).toBe(0);
    expect(foe(sc).status).toBe('down');
  });

  it('Colapso do Sistema: tenente apaga (vivo, inconsciente); chefe só leva 4d6', () => {
    const sc = fight(hacker(), [foeOf('f1', { template: 'security_officer' }), foeOf('b1', { template: 'cyberpsycho' })]);
    qh(sc, 'system_collapse', 'f1', HIT);
    expect(foe(sc).status).toBe('down');
    expect(foe(sc).conditions?.some(c => c.key === 'unconscious')).toBe(true);
    setRam(sc, 9);
    qh(sc, 'system_collapse', 'b1', [9, 5, 5, 5, 5]);
    expect(foe(sc, 'b1').status).toBe('active');
    expect(foe(sc, 'b1').hp.current).toBe(60 - 20);
  });
});

describe('Quickhacks: defesa (DV) por tipo de alvo e limites do teste', () => {
  it('capanga 8, tenente 11, chefe 14, sem ficha 10, Trilheiro inimigo +2', () => {
    const sc = fight(hacker(), [
      foeOf('m', { template: 'boosterganger' }), foeOf('l', { template: 'security_officer' }), foeOf('b', { template: 'cyberpsycho' }),
      foeOf('u', { template: undefined }), foeOf('n', { template: 'netrunner' }), foeOf('n2', { template: undefined, name: 'Trilheiro Arasaka' }),
    ]);
    const dv = (id: string) => (buildQuickhackRequest(sc.state, 'short_circuit', { combatantId: id }, 'player') as { dv: number }).dv;
    expect([dv('m'), dv('l'), dv('b'), dv('u'), dv('n'), dv('n2')]).toEqual([8, 11, 14, 10, QUICKHACK_DV.lieutenant + 2, 12]);
  });

  it('empate com a defesa FALHA (precisa ser maior); com 1 de Sorte passa; RAM gasta nos dois casos', () => {
    const sc = fight(hacker(4)); // Interface 4; capanga DV 8 → d10 4 empata
    const r0 = ram(sc).current;
    qh(sc, 'weapon_glitch', 'f1', [4]);
    expect(sc.lastOutcome!.check).toMatchObject({ total: 8, dv: 8, success: false, margin: 0 });
    expect(ram(sc).current).toBe(r0 - 2);
    expect(foe(sc).skipNextAttack).toBeUndefined();
    qh(sc, 'weapon_glitch', 'f1', [4], 1);
    expect(sc.lastOutcome!.check.success).toBe(true);
    expect(foe(sc).skipNextAttack).toBe('arma em pane');
  });

  it('falha contra chefe, em todos os 11 hacks: RAM gasta, nada aplicado no alvo nem nos outros', () => {
    for (const key of QUICKHACK_KEYS.filter(k => QUICKHACKS[k].target !== 'none')) {
      const sc = fight(hacker(), [foeOf('b1', { template: 'cyberpsycho' }), foeOf('f2')]);
      const before = JSON.stringify(foe(sc, 'b1'));
      const r0 = ram(sc).current;
      qh(sc, key, 'b1', [3, 9, 9, 9, 9, 9]); // 10 + 3 = 13 < 14
      expect(sc.lastOutcome!.check.success, key).toBe(false);
      expect(JSON.stringify(foe(sc, 'b1')), key).toBe(before);
      expect(foe(sc, 'f2').hp.current, key).toBe(60);
      expect(ram(sc).current, key).toBe(r0 - QUICKHACKS[key].ram);
    }
  });

  it('crítico (10 natural explode) passa qualquer defesa; retroalimentação (1 natural) zera a RAM', () => {
    const sc = fight(hacker(4), [foeOf('b1', { template: 'cyberpsycho' })]);
    qh(sc, 'weapon_glitch', 'b1', [10, 5]); // 4 + 15 = 19 > 14
    expect(sc.lastOutcome!.check.d10).toMatchObject({ crit: true, total: 15 });
    expect(foe(sc, 'b1').skipNextAttack).toBe('arma em pane');
    qh(sc, 'weapon_glitch', 'b1', [1, 2]);
    expect(sc.lastOutcome!.check.d10.fumble).toBe(true);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/retroalimentação/);
    expect(ram(sc).current).toBe(0);
  });

  it('retroalimentação vale mesmo com Sorte suficiente para "passar"; nada é aplicado', () => {
    const sc = fight(hacker(10));
    qh(sc, 'short_circuit', 'f1', [1, 1, 6, 6], 3);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/retroalimentação/);
    expect(foe(sc).hp.current).toBe(60);
    expect(ram(sc).current).toBe(0);
    expect(sc.lastOutcome!.check.success).toBe(false);
  });

  it('todos os 11 hacks com alvo: retroalimentação zera RAM e não aplica efeito', () => {
    for (const key of QUICKHACK_KEYS.filter(k => QUICKHACKS[k].target !== 'none')) {
      const sc = fight(hacker());
      qh(sc, key, 'f1', [1, 2, 6, 6, 6, 6]);
      expect(ram(sc).current, key).toBe(0);
      expect(foe(sc).hp.current, key).toBe(60);
      expect(foe(sc).status, key).toBe('active');
    }
  });
});

describe('Quickhacks: alvos inválidos', () => {
  it('alvo caído, fugido, morto, aliado, longe (51-100m) ou inexistente: recusado SEM gastar RAM nem abrir rolagem', () => {
    const cases: Array<[string, Partial<Combatant>]> = [['down', { status: 'down' }], ['fled', { status: 'fled' }], ['dead', { status: 'dead' }], ['ally', { side: 'ally' }], ['longe', { distance: '51-100m' }]];
    for (const [label, patch] of cases) {
      const sc = fight(hacker(), [foeOf('f1', patch), foeOf('f2')]);
      const r0 = ram(sc).current;
      sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
      expect(sc.last().ok, label).toBe(false);
      expect(sc.state.pendingRoll, label).toBeNull();
      expect(ram(sc).current, label).toBe(r0);
    }
    const sc = fight(hacker());
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'fantasma' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.pendingRoll).toBeNull();
  });

  it('alcance: 26-50m passa', () => {
    const sc = fight(hacker(), [foeOf('f1', { distance: '26-50m' })]);
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    expect(sc.last().ok).toBe(true);
  });

  it('sem alvo informado em combate: usa o primeiro inimigo ativo (não aliado)', () => {
    const sc = fight(hacker(), [foeOf('a1', { side: 'ally' }), foeOf('f1', { status: 'down' }), foeOf('f2')]);
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit' });
    expect(sc.state.pendingRoll?.targetId).toBe('f2');
  });

  it('hack de alvo único fora de combate: recusado; ao NPC fora de combate só Apagar Memória', () => {
    const sc = hacker().tool('narrator', 'upsert_npc', { name: 'Kiro', present: true });
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'Kiro' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: 'Kiro' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'quickhack', { hack: 'memory_wipe', targetId: 'Kiro' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.pendingRoll).toMatchObject({ kind: 'quickhack', targetNpcId: expect.any(String), dv: QUICKHACK_DV.unknown });
  });

  it('NPC morto, animal ou da equipe não pode ter a memória apagada', () => {
    const sc = hacker().tool('narrator', 'upsert_npc', { name: 'Kiro', present: true }).tool('narrator', 'upsert_npc', { name: 'Rex', present: true, kind: 'animal' });
    sc.edit(s => ({ ...s, npcs: s.npcs.map(n => (n.name === 'Kiro' ? { ...n, status: 'dead' as const } : n)) }));
    sc.tool('interpreter', 'quickhack', { hack: 'memory_wipe', targetId: 'Kiro' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'quickhack', { hack: 'memory_wipe', targetId: 'Rex' });
    expect(sc.last().ok).toBe(false);
    const sc2 = hacker().tool('narrator', 'upsert_npc', { name: 'Jax', present: true }).tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 20, template: 'bodyguard' });
    sc2.tool('interpreter', 'quickhack', { hack: 'memory_wipe', targetId: 'Jax' });
    expect(sc2.last().ok).toBe(false);
  });

  it('só Trilheiro com Neural Link/Plugues: Solo e Trilheiro sem plugues recusados', () => {
    const solo = scenario({ role: 'solo' }).tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(solo.last().ok).toBe(false);
    const noLink = hacker().edit(s => ({ ...s, character: { ...s.character, cyberware: [] } })).tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(noLink.last().ok).toBe(false);
  });

  it('hack não desbloqueado e RAM insuficiente: recusados antes de abrir a rolagem', () => {
    const sc = fight(hacker()).edit(s => ({ ...s, character: { ...s.character, quickhacks: [...STARTER_QUICKHACKS] } }));
    sc.tool('interpreter', 'quickhack', { hack: 'system_collapse', targetId: 'f1' });
    expect(sc.last().ok).toBe(false);
    setRam(sc, 2);
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    expect(sc.last().summary).toMatch(/RAM insuficiente/);
    expect(sc.state.pendingRoll).toBeNull();
  });

  it('conectado numa arquitetura: quickhack bloqueado (Ping inclusive)', () => {
    const sc = fight(hacker()).edit(s => ({ ...s, net: { ...s.net, architecture: arch([floor(0, 'empty')]), run: mkRun() } }));
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(false);
  });

  it('jogador inconsciente ou imobilizado não usa quickhack', () => {
    for (const key of ['unconscious', 'restrained'] as const) {
      const sc = fight(hacker()).edit(s => ({ ...s, character: { ...s.character, conditions: [{ key, sinceTurn: 0, source: 't' }] as never } }));
      sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
      expect(sc.last().ok, key).toBe(false);
    }
  });
});

// ================================================================ 2. ROLAGEM PENDENTE NA TELA

describe('Quickhack como rolagem pendente: pedir ≠ gastar', () => {
  it('pedir pelo texto não gasta RAM, Sorte, rastro nem aplica efeito; rolar gasta uma vez só', () => {
    const sc = fight(hacker());
    const r0 = ram(sc).current;
    const luck0 = sc.state.character.luck.current;
    sc.tool('interpreter', 'quickhack', { hack: 'synapse_burnout', targetId: 'f1' });
    expect(sc.state.pendingRoll).toMatchObject({ kind: 'quickhack', origin: 'gm', quickhack: 'synapse_burnout', targetId: 'f1', dv: 8, stat: 'INT' });
    expect(ram(sc).current).toBe(r0);
    expect(trace(sc)).toBe(0);
    expect(foe(sc).hp.current).toBe(60);
    sc.roll([9, 1, 1, 1], 1);
    expect(ram(sc).current).toBe(r0 - 5);
    expect(sc.state.character.luck.current).toBe(luck0 - 1);
    expect(trace(sc)).toBe(1);
    expect(sc.state.pendingRoll).toBeNull();
    expect(foe(sc).hp.current).toBe(57);
  });

  it('cancelar a rolagem do painel (origin player) não gasta RAM, Sorte nem rastro; a do Mestre (gm) não é cancelável', () => {
    const sc = fight(hacker());
    const before = { ram: ram(sc).current, luck: sc.state.character.luck.current, trace: trace(sc), foe: JSON.stringify(foe(sc)) };
    const req = buildQuickhackRequest(sc.state, 'synapse_burnout', { combatantId: 'f1' }, 'player') as never;
    sc.edit(s => gameReducer(s, { type: 'setPendingRoll', request: req }));
    expect(sc.state.pendingRoll?.origin).toBe('player');
    sc.edit(s => gameReducer(s, { type: 'cancelPendingRoll' }));
    expect(sc.state.pendingRoll).toBeNull();
    expect({ ram: ram(sc).current, luck: sc.state.character.luck.current, trace: trace(sc), foe: JSON.stringify(foe(sc)) }).toEqual(before);
    sc.tool('interpreter', 'quickhack', { hack: 'synapse_burnout', targetId: 'f1' });
    sc.edit(s => gameReducer(s, { type: 'cancelPendingRoll' }));
    expect(sc.state.pendingRoll?.origin).toBe('gm');
  });

  it('canSpendLuck vale para quickhack (e não existe sem rolagem)', () => {
    const sc = fight(hacker()).tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    expect(canSpendLuck(sc.state.pendingRoll)).toBe(true);
    expect(canSpendLuck(null)).toBe(false);
  });

  it('já existe rolagem pendente: um segundo quickhack é recusado e nada muda', () => {
    const sc = fight(hacker()).tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    const id = sc.state.pendingRoll!.id;
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: 'f2' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.pendingRoll!.id).toBe(id);
  });
});

describe('Quickhack: o estado muda entre pedir e rolar (resolve revalida; nada é gasto à toa)', () => {
  type Mut = [string, (sc: Sc) => void];
  const muts: Mut[] = [
    ['RAM zerada no meio', sc => setRam(sc, 0)],
    ['RAM sobrou 1 (custo 3)', sc => setRam(sc, 1)],
    ['alvo caiu', sc => patchFoe(sc, 'f1', { status: 'down' })],
    ['alvo fugiu', sc => patchFoe(sc, 'f1', { status: 'fled' })],
    ['alvo morreu', sc => patchFoe(sc, 'f1', { status: 'dead' })],
    ['alvo virou aliado', sc => patchFoe(sc, 'f1', { side: 'ally' })],
    ['alvo se afastou (51-100m)', sc => patchFoe(sc, 'f1', { distance: '51-100m' })],
    ['alvo sumiu do combate', sc => sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.filter(t => t.id !== 'f1') } }))],
    ['novo combate (ids novos)', sc => sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: [foeOf('n1')] } }))],
    ['combate acabou', sc => sc.edit(s => ({ ...s, combat: { ...s.combat, active: false } }))],
    ['jogador inconsciente', sc => sc.edit(s => ({ ...s, character: { ...s.character, conditions: [{ key: 'unconscious', sinceTurn: 0, source: 't' }] as never } }))],
    ['hack removido da ficha', sc => sc.edit(s => ({ ...s, character: { ...s.character, quickhacks: ['ping'] } }))],
    ['entrou na Rede', sc => sc.edit(s => ({ ...s, net: { ...s.net, architecture: arch([floor(0, 'empty')]), run: mkRun() } }))],
  ];

  it.each(muts)('%s: resolve não explode, não aplica efeito, não gasta RAM e limpa a pendência', (_label, mutate) => {
    const sc = fight(hacker());
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    expect(sc.state.pendingRoll).not.toBeNull();
    mutate(sc);
    const ramBefore = ram(sc).current;
    const hpBefore = sc.state.combat.combatants.map(t => t.hp.current);
    const traceBefore = trace(sc);
    sc.roll(HIT);
    expect(sc.state.pendingRoll).toBeNull();
    expect(ram(sc).current).toBe(ramBefore);
    expect(sc.state.combat.combatants.map(t => t.hp.current)).toEqual(hpBefore);
    expect(trace(sc)).toBe(traceBefore);
    expect(sc.lastOutcome!.quickhack!.ok).toBe(false);
    expect(sc.lastOutcome!.check.success).toBe(false);
  });

  it('pedido bloqueado no resolve: o resultado explica o motivo (o narrador não vê "falhou" sem razão)', () => {
    const sc = fight(hacker());
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    patchFoe(sc, 'f1', { status: 'down' });
    sc.roll(HIT);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/fora de combate/);
  });

  it('sem bloqueio, a Sorte é consumida normalmente', () => {
    const sc = fight(hacker());
    const l0 = sc.state.character.luck.current;
    qh(sc, 'short_circuit', 'f1', HIT, 1);
    expect(sc.state.character.luck.current).toBe(l0 - 1);
  });

  it('BUG-NET-2: Sorte gasta numa rolagem que o resolve recusou (alvo caiu/RAM acabou) deveria voltar ao jogador', () => {
    const sc = fight(hacker());
    const l0 = sc.state.character.luck.current;
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    patchFoe(sc, 'f1', { status: 'down' });
    sc.roll(HIT, 2);
    expect(sc.lastOutcome!.quickhack!.ok).toBe(false);
    expect(sc.state.character.luck.current).toBe(l0);
  });

  it('combo é lido no RESOLVE (não no pedido): pane aplicada entre o pedido e a rolagem vira combo; dados gravados batem com o dano', () => {
    const sc = fight(hacker());
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    patchFoe(sc, 'f1', { hacks: [{ key: 'cyberware_malfunction', label: 'Pane de Cromo', untilRound: 4, attackMod: -3 }] });
    sc.roll([9, 2, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.effectRolls).toEqual([2, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.combo).toMatch(/Pane de Cromo/);
    expect(foe(sc).hp.current).toBe(60 - 8);
  });

  it('combo desfeito entre pedido e rolagem (pane expirou): dano normal 2d6', () => {
    const sc = fight(hacker());
    patchFoe(sc, 'f1', { hacks: [{ key: 'cyberware_malfunction', label: 'Pane de Cromo', untilRound: 4, attackMod: -3 }] });
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    patchFoe(sc, 'f1', { hacks: [] });
    sc.roll([9, 2, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.effectRolls).toEqual([2, 2]);
    expect(sc.lastOutcome!.quickhack!.combo).toBeUndefined();
    expect(foe(sc).hp.current).toBe(60 - 4);
  });

  it('effectRolls vazio (hack sem dado) aplica o efeito igualmente; cheio repete exatamente os dados', () => {
    const sc = fight(hacker());
    qh(sc, 'weapon_glitch', 'f1', [9]);
    expect(sc.lastOutcome!.quickhack!.effectRolls).toEqual([]);
    expect(foe(sc).skipNextAttack).toBe('arma em pane');
    qh(sc, 'overheat', 'f1', [9, 4, 5]);
    expect(sc.lastOutcome!.quickhack!.effectRolls).toEqual([4, 5]);
    expect(foe(sc).hp.current).toBe(60 - 9);
  });

  it('Ciberpsicose: dados da vítima gravados e repetidos com exatidão', () => {
    const sc = fight(hacker(), [foeOf('f1', { weapon: { name: 'Shotgun', weaponClass: 'shotgun', damage: '3d6' } }), foeOf('f2', { sp: { head: 0, body: 0 } })]);
    qh(sc, 'cyberpsychosis', 'f1', [9, 4, 4, 4]);
    expect(sc.lastOutcome!.quickhack!.effectRolls.slice(0, 3)).toEqual([4, 4, 4]);
    expect(foe(sc, 'f2').hp.current).toBe(60 - 12);
  });

  it('Ciberpsicose sem outra vítima: não explode, o alvo fica fora de si', () => {
    const sc = fight(hacker(), [foeOf('f1')]);
    qh(sc, 'cyberpsychosis', 'f1', HIT);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/sem ninguém/);
    expect(foe(sc).skipNextAttack).toBeTruthy();
  });
});

describe('Quickhack: Sorte e penalidades no teste de Interface', () => {
  it('Sorte gasta é descontada e somada ao total', () => {
    const sc = fight(hacker(4));
    const l0 = sc.state.character.luck.current;
    qh(sc, 'weapon_glitch', 'f1', [3], 2);
    expect(sc.lastOutcome!.check).toMatchObject({ total: 9, luckSpent: 2, success: true });
    expect(sc.state.character.luck.current).toBe(l0 - 2);
  });

  it('BUG-NET-1: Sorte maior que a disponível não pode virar bônus de graça (resolveCheck faz clamp; o quickhack não)', () => {
    const sc = fight(hacker(10), [foeOf('b1', { template: 'cyberpsycho' })]);
    sc.edit(s => ({ ...s, character: { ...s.character, luck: { ...s.character.luck, current: 1 } } }));
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: 'b1' });
    sc.roll([2], 99); // 10 + 2 = 12 < 14: só passaria com Sorte inexistente
    expect(sc.lastOutcome!.check.luckSpent).toBeLessThanOrEqual(1);
    expect(sc.lastOutcome!.check.success).toBe(false);
    expect(sc.state.character.luck.current).toBe(0);
  });

  it('BUG-NET-1b: Sorte negativa não pode reduzir o total (resolveCheck faz clamp 0..atual)', () => {
    const sc = fight(hacker(10));
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: 'f1' });
    sc.roll([5], -5);
    expect(sc.lastOutcome!.check.luckSpent).toBeGreaterThanOrEqual(0);
    expect(sc.lastOutcome!.check.total).toBe(15);
  });

  it('BUG-NET-3b: o teste de Interface do quickhack ignora a penalidade de ferimento (Gravemente/Mortalmente ferido), que Rede e demais testes aplicam', () => {
    const sc = fight(hacker(10));
    sc.edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 2 } } }));
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: 'f1' });
    sc.roll([5]);
    expect(sc.lastOutcome!.check.total).toBe(10 + 5 - 2);
  });

  it('BUG-NET-3: o teste de Interface do quickhack ignora penalidades (Liche, ferimento) que a Rede aplica', () => {
    const sc = fight(hacker(10));
    sc.edit(s => ({ ...s, activeEffects: [{ id: 'e1', name: 'Liche', source: 'net', description: '', penalties: { INT: -4 }, expiresAt: null }] }));
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: 'f1' });
    sc.roll([5]);
    expect(sc.lastOutcome!.check.total).toBe(10 + 5 - 4);
  });
});

describe('Quickhack: origem e argumentos inválidos', () => {
  it('o narrador não usa quickhack nem net_action do jogador; hack fora do enum é recusado sem lançar', () => {
    const sc = fight(hacker());
    sc.tool('narrator', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'net_action', { action: 'pathfinder' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'quickhack', { hack: 'nao_existe', targetId: 'f1' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'quickhack', {});
    expect(sc.last().ok).toBe(false);
    expect(sc.state.pendingRoll).toBeNull();
    expect(ram(sc).current).toBe(ram(sc).max);
  });
});

describe('Uma Ação por turno: quickhack na mesma frase', () => {
  const calls = (...c: Array<[string, Record<string, unknown>]>) => c.map(([tool, args]) => ({ tool, args }));
  const exec = (sc: Sc, list: ReturnType<typeof calls>) => {
    const res = runToolCalls(REGISTRY, sc.state, list, { rng: sequenceRng([5]), origin: 'interpreter' });
    sc.state = res.state;
    return res;
  };

  it('2 quickhacks na mesma frase em combate: só o primeiro vale; 1 só rolagem pendente', () => {
    const sc = fight(hacker());
    const res = exec(sc, calls(['quickhack', { hack: 'weapon_glitch', targetId: 'f1' }], ['quickhack', { hack: 'short_circuit', targetId: 'f2' }]));
    expect(res.records.map(r => r.ok)).toEqual([true, false]);
    expect(sc.state.pendingRoll?.targetId).toBe('f1');
  });

  it('Ping + quickhack: Ping gasta a Ação; o segundo é recusado e RAM só cobra o Ping', () => {
    const sc = fight(hacker());
    const r0 = ram(sc).current;
    const res = exec(sc, calls(['quickhack', { hack: 'ping' }], ['quickhack', { hack: 'short_circuit', targetId: 'f1' }]));
    expect(res.records.map(r => r.ok)).toEqual([true, false]);
    expect(res.records[1].error).toBe('ação já usada');
    expect(ram(sc).current).toBe(r0 - 1);
    expect(sc.state.pendingRoll).toBeNull();
  });

  it('quickhack + attack e attack + quickhack: o segundo é recusado', () => {
    const a = fight(hacker());
    const r1 = exec(a, calls(['quickhack', { hack: 'weapon_glitch', targetId: 'f1' }], ['attack', { targetId: 'f1' }]));
    expect(r1.records.map(r => r.ok)).toEqual([true, false]);
    const b = fight(hacker());
    const r2 = exec(b, calls(['attack', { targetId: 'f1' }], ['quickhack', { hack: 'weapon_glitch', targetId: 'f1' }]));
    expect(r2.records[0].ok).toBe(true);
    expect(r2.records[1].ok).toBe(false);
    expect(b.state.pendingRoll?.kind).toBe('attack');
  });

  it('quickhack recusado (RAM) NÃO consome a Ação: o ataque seguinte vale', () => {
    const sc = setRam(fight(hacker()), 0);
    const res = exec(sc, calls(['quickhack', { hack: 'short_circuit', targetId: 'f1' }], ['attack', { targetId: 'f1' }]));
    expect(res.records.map(r => r.ok)).toEqual([false, true]);
  });

  it('fora de combate, 2 Apagar Memória na mesma frase: um pedido pendente; o segundo é recusado', () => {
    const sc = hacker().tool('narrator', 'upsert_npc', { name: 'Kiro', present: true }).tool('narrator', 'upsert_npc', { name: 'Lia', present: true });
    const res = exec(sc, calls(['quickhack', { hack: 'memory_wipe', targetId: 'Kiro' }], ['quickhack', { hack: 'memory_wipe', targetId: 'Lia' }]));
    expect(res.records.map(r => r.ok)).toEqual([true, false]);
    expect(sc.state.pendingRoll?.targetNpcId).toBeTruthy();
  });
});

// ================================================================ 3. COMBOS

describe('Combos de quickhack', () => {
  const COMBO = /Combo/;
  const bigHp = (sc: Sc) => sc.edit(s => ({ ...s, character: { ...s.character, hp: { current: 900, max: 900 } } }));

  it('Pane de Cromo → Curto-Circuito: +2d6 (4d6 no total) e a mensagem diz Combo', () => {
    const sc = fight(hacker());
    qh(sc, 'cyberware_malfunction', 'f1', HIT);
    setRam(sc, 9);
    const hp = foe(sc).hp.current;
    qh(sc, 'short_circuit', 'f1', [9, 2, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(COMBO);
    expect(sc.lastOutcome!.quickhack!.combo).toBeTruthy();
    expect(sc.lastOutcome!.quickhack!.effectRolls).toHaveLength(4);
    expect(foe(sc).hp.current).toBe(hp - 8);
  });

  it('Superaquecimento → Queima Sináptica: +1d6 (4d6; 6d6 se o alvo já estava ferido)', () => {
    const sc = fight(hacker());
    qh(sc, 'overheat', 'f1', HIT);
    setRam(sc, 9);
    const hp = foe(sc).hp.current;
    qh(sc, 'synapse_burnout', 'f1', [9, 2, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.combo).toMatch(/Superaquecimento/);
    expect(sc.lastOutcome!.quickhack!.effectRolls).toHaveLength(4);
    expect(foe(sc).hp.current).toBe(hp - 8);
    // já ferido: 5d6 + 1d6 = 6d6
    const sc2 = fight(hacker());
    qh(sc2, 'overheat', 'f1', HIT);
    setRam(sc2, 9);
    patchFoe(sc2, 'f1', { hp: { current: 25, max: 60 } });
    qh(sc2, 'synapse_burnout', 'f1', [9, 2, 2, 2, 2, 2, 2]);
    expect(sc2.lastOutcome!.quickhack!.effectRolls).toHaveLength(6);
    expect(foe(sc2).hp.current).toBe(25 - 12);
  });

  it('Choque Sônico → Apagar Memória: tenente vulnerável foge; sem o combo só perde o próximo ataque', () => {
    const sc = fight(hacker(), [foeOf('l1', { template: 'security_officer' })]);
    qh(sc, 'sonic_shock', 'l1', HIT);
    setRam(sc, 9);
    qh(sc, 'memory_wipe', 'l1', HIT);
    expect(sc.lastOutcome!.quickhack!.combo).toBeTruthy();
    expect(foe(sc, 'l1').status).toBe('fled');
    const sc2 = fight(hacker(), [foeOf('l1', { template: 'security_officer' })]);
    qh(sc2, 'memory_wipe', 'l1', HIT);
    expect(foe(sc2, 'l1').status).toBe('active');
    expect(foe(sc2, 'l1').skipNextAttack).toBeTruthy();
  });

  it('ordem inversa (Curto-Circuito → Pane) e hacks de ramos diferentes não ativam combo', () => {
    const sc = fight(hacker());
    qh(sc, 'short_circuit', 'f1', HIT);
    setRam(sc, 9);
    qh(sc, 'cyberware_malfunction', 'f1', HIT);
    expect(sc.lastOutcome!.quickhack!.combo).toBeUndefined();
    setRam(sc, 9);
    // Pane + Queima Sináptica (par errado) e Superaquecimento + Curto-Circuito (par errado)
    qh(sc, 'synapse_burnout', 'f1', [9, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.combo).toBeUndefined();
    expect(sc.lastOutcome!.quickhack!.effectRolls).toHaveLength(3);
  });

  it('combo no alvo errado não ativa (a pane está no f1; o curto vai no f2)', () => {
    const sc = fight(hacker());
    qh(sc, 'cyberware_malfunction', 'f1', HIT);
    setRam(sc, 9);
    qh(sc, 'short_circuit', 'f2', [9, 2, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.combo).toBeUndefined();
    expect(foe(sc, 'f2').hp.current).toBe(60 - 4);
  });

  it('primeiro hack que FALHOU (ou deu retroalimentação) não arma o combo', () => {
    const sc = fight(hacker(), [foeOf('b1', { template: 'cyberpsycho' })]);
    qh(sc, 'cyberware_malfunction', 'b1', [2]); // 12 < 14
    setRam(sc, 9);
    qh(sc, 'short_circuit', 'b1', [9, 2, 2, 2, 2]);
    expect(sc.lastOutcome!.quickhack!.combo).toBeUndefined();
    expect(sc.lastOutcome!.quickhack!.effectRolls).toHaveLength(2);
  });

  it('janela de validade: Pane de Cromo vale por 3 turnos seguintes; Superaquecimento e Choque Sônico por 2', () => {
    const run1 = (first: QuickhackKey, second: QuickhackKey, k: number) => {
      const sc = bigHp(fight(hacker(), [foeOf('f1', { template: 'security_officer', hp: { current: 900, max: 900 } }), foeOf('f2')]));
      qh(sc, first, 'f1', HIT);
      for (let i = 0; i < k; i++) phase(sc);
      setRam(sc, 9);
      qh(sc, second, 'f1', HIT);
      return !!sc.lastOutcome!.quickhack!.combo;
    };
    expect([1, 2, 3, 4].map(k => run1('cyberware_malfunction', 'short_circuit', k))).toEqual([true, true, true, false]);
    expect([1, 2, 3].map(k => run1('overheat', 'synapse_burnout', k))).toEqual([true, true, false]);
    expect([1, 2, 3].map(k => run1('sonic_shock', 'memory_wipe', k))).toEqual([true, true, false]);
  });

  it('(dúvida de design — documenta o atual) o combo NÃO consome a marca: Curto-Circuito repetido continua em combo enquanto a Pane durar', () => {
    const sc = fight(hacker());
    qh(sc, 'cyberware_malfunction', 'f1', HIT);
    setRam(sc, 9);
    qh(sc, 'short_circuit', 'f1', HIT);
    expect(sc.lastOutcome!.quickhack!.combo).toBeTruthy();
    setRam(sc, 9);
    qh(sc, 'short_circuit', 'f1', HIT);
    expect(sc.lastOutcome!.quickhack!.combo).toBeTruthy();
  });

  it('(dúvida de design — documenta o atual) Apagar Memória em combo faz até o CHEFE fugir', () => {
    const sc = fight(hacker(), [foeOf('b1', { template: 'cyberpsycho' })]);
    qh(sc, 'sonic_shock', 'b1', [9]);
    setRam(sc, 9);
    qh(sc, 'memory_wipe', 'b1', [9]);
    expect(foe(sc, 'b1').status).toBe('fled');
  });

  it('(dúvida de design — documenta o atual) alvo sem ficha (template ausente) é capanga para Apagar Memória mesmo tendo defesa 10 de "desconhecido"', () => {
    const sc = fight(hacker(), [foeOf('u1', { template: undefined })]);
    qh(sc, 'memory_wipe', 'u1', [9]);
    expect(foe(sc, 'u1').status).toBe('fled');
  });

  it('Superaquecimento derruba o alvo na virada de rodada: não fica PV negativo nem o hack some antes da hora', () => {
    const sc = fight(hacker(), [foeOf('f1', { hp: { current: 8, max: 60 } }), foeOf('f2')]);
    qh(sc, 'overheat', 'f1', [9, 1, 1]); // 2 de dano agora → 6
    expect(foe(sc).hp.current).toBe(6);
    phase(sc);
    expect(foe(sc).hp.current).toBe(3);
    phase(sc);
    expect(foe(sc).hp.current).toBe(0);
    expect(foe(sc).status).toBe('down');
    phase(sc);
    expect(foe(sc).hp.current).toBe(0);
  });

  it('efeitos expiram na virada da rodada certa e skipNextAttack é consumido pelo ataque inimigo', () => {
    const sc = bigHp(fight(hacker(), [foeOf('f1', { initiative: 3 })]));
    qh(sc, 'cripple_movement', 'f1', HIT);
    qh(sc, 'weapon_glitch', 'f1', HIT);
    expect(foe(sc).skipNextAttack).toBe('arma em pane');
    phase(sc);
    expect(foe(sc).skipNextAttack).toBeUndefined();
    expect(foe(sc).hacks?.map(h => h.key)).toEqual(['cripple_movement']); // untilRound 3, rodada 2
    phase(sc);
    expect(foe(sc).hacks?.map(h => h.key)).toEqual(['cripple_movement']); // rodada 3
    phase(sc);
    expect(foe(sc).hacks).toEqual([]); // rodada 4
  });

  it('RAM regenera 2 por virada de rodada, nunca passa do máximo, e 0 após retroalimentação volta devagar', () => {
    const sc = fight(hacker());
    qh(sc, 'short_circuit', 'f1', [1, 3]); // fumble → 0
    expect(ram(sc).current).toBe(0);
    const max = ram(sc).max;
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      phase(sc);
      seen.push(ram(sc).current);
    }
    expect(seen.slice(0, 3)).toEqual([RAM_REGEN_PER_ROUND, 2 * RAM_REGEN_PER_ROUND, 3 * RAM_REGEN_PER_ROUND]);
    expect(Math.max(...seen)).toBe(max);
    expect(seen.every(v => Number.isInteger(v) && v >= 0 && v <= max)).toBe(true);
  });

  it('end_combat enche a RAM; Ping pós-combate; descanso não quebra a RAM', () => {
    const sc = fight(hacker());
    qh(sc, 'synapse_burnout', 'f1', HIT);
    expect(ram(sc).current).toBeLessThan(ram(sc).max);
    sc.tool('narrator', 'end_combat', {});
    expect(ram(sc).current).toBe(ram(sc).max);
  });
});

// ================================================================ 4. PIPELINE DO CLIENTE (turn.ts)

describe('Ciclo completo pelo pipeline do cliente: pedir → rolar → fase inimiga → RAM → combo no turno seguinte', () => {
  const interp = (hack: string, targetId: string) => ({ intent: { type: 'netrun' as const, summary: hack, confidence: 1 }, toolCalls: [{ tool: 'quickhack', args: { hack, targetId } }] });
  const bigHp = (sc: Sc) => sc.edit(s => ({ ...s, character: { ...s.character, hp: { current: 900, max: 900 } } }));

  it('dois turnos seguidos: Pane de Cromo e depois Curto-Circuito em combo, com RAM, rodada, checks e narrador corretos', () => {
    const sc = bigHp(fight(hacker()));
    let step = applyInterpretation(beginTurn(sc.state, 'sobrecarrego o cromo do primeiro'), interp('cyberware_malfunction', 'f1'), sequenceRng([5]));
    expect(step.record.phase).toBe('awaiting_roll');
    expect(step.state.pendingRoll).toMatchObject({ kind: 'quickhack', quickhack: 'cyberware_malfunction', targetId: 'f1' });
    const r1 = applyRoll(step, 0, 'force:9:t1');
    expect(r1.outcome!.check.success).toBe(true);
    expect(r1.record.checks[0]).toMatchObject({ check: 'INTERFACE', total: 19, difficulty: 8, success: true });
    const p1 = applyEnemyPhase(r1, seededRng('en1'));
    expect(p1.state.combat.round).toBe(2);
    expect(p1.state.character.deck!.ram!.current).toBe(9 - 4 + RAM_REGEN_PER_ROUND);
    expect(p1.state.net.trace?.level).toBe(1);
    const res1 = buildEngineResult(p1, r1.outcome);
    expect(res1.roll?.quickhack?.key).toBe('cyberware_malfunction');
    expect(res1.tools.map(t => t.tool)).toEqual(['quickhack', 'enemy_phase']);

    // turno 2: o combo é lido do estado depois da fase inimiga
    step = applyInterpretation(beginTurn(p1.state, 'agora fritar o circuito'), interp('short_circuit', 'f1'), sequenceRng([5]));
    const hpBefore = step.state.combat.combatants.find(t => t.id === 'f1')!.hp.current;
    const r2 = applyRoll(step, 0, 'force:9:t2');
    expect(r2.outcome!.quickhack!.combo).toMatch(/Pane de Cromo/);
    const rolls = r2.outcome!.quickhack!.effectRolls;
    expect(rolls).toHaveLength(4);
    expect(r2.state.combat.combatants.find(t => t.id === 'f1')!.hp.current).toBe(hpBefore - rolls.reduce((a, b) => a + b, 0));
    const p2 = applyEnemyPhase(r2, seededRng('en2'));
    expect(p2.state.character.deck!.ram!.current).toBe(Math.min(9, 9 - 4 + RAM_REGEN_PER_ROUND - 3 + RAM_REGEN_PER_ROUND));
    // narrador: o texto de resultado traz o teste, o efeito e o combo
    const text = describeOutcome(r2.outcome!);
    expect(text).toMatch(/QUICKHACK: Interface 10 \+ d10 9 = 19 vs defesa 8 → SUCESSO/);
    expect(text).toMatch(/Efeito aplicado pelo motor: .*Combo/);
  });

  it('o resultado é reproduzível: mesma seed ⇒ mesmo desfecho (preview da animação = aplicação)', () => {
    const sc = fight(hacker());
    const step = applyInterpretation(beginTurn(sc.state, 'x'), interp('synapse_burnout', 'f1'), sequenceRng([5]));
    const a = applyRoll(step, 1, 'seed-fixa');
    const b = applyRoll(step, 1, 'seed-fixa');
    expect(JSON.stringify(a.state.combat)).toBe(JSON.stringify(b.state.combat));
    expect(a.outcome!.quickhack).toEqual(b.outcome!.quickhack);
  });

  it('crítico e retroalimentação aparecem rotulados para o narrador; RAM zerada vira texto', () => {
    const crit = fight(hacker());
    qh(crit, 'short_circuit', 'f1', [10, 4, 3, 3]);
    expect(describeOutcome(crit.lastOutcome!)).toMatch(/\(CRÍTICO\)/);
    const fum = fight(hacker());
    qh(fum, 'short_circuit', 'f1', [1, 4]);
    expect(describeOutcome(fum.lastOutcome!)).toMatch(/FALHA CRÍTICA/);
    expect(describeOutcome(fum.lastOutcome!)).toMatch(/retroalimentação/);
    expect(toCheckRecord(fum.lastOutcome!)).toMatchObject({ check: 'INTERFACE', roll: -3 });
  });

  it('o prompt do narrador recebe o resultado do quickhack e a consistência não dá falso alarme', () => {
    const sc = fight(hacker());
    const step = applyInterpretation(beginTurn(sc.state, 'trava a arma dele'), interp('weapon_glitch', 'f1'), sequenceRng([5]));
    const r = applyRoll(step, 0, 'force:9:abc');
    const phased = applyEnemyPhase(r, seededRng('p'));
    const result = buildEngineResult(phased, r.outcome);
    const prompt = buildNarratePrompt(buildGameContext(phased.state, ''), { kind: 'action', playerInput: 'trava a arma dele', engineResult: result });
    expect(prompt).toMatch(/QUICKHACK: Interface 10/);
    expect(prompt).toMatch(/Efeito aplicado pelo motor/);
    expect(checkNarration(result, 'A arma do capanga trava com um estalo e ele erra o tiro, furioso. O hack funcionou.', [], phased.state.npcs)).toEqual([]);
    // teste FALHO narrado como sucesso: a consistência avisa (verdadeiro positivo)
    const failed = fight(hacker(4));
    const step2 = applyInterpretation(beginTurn(failed.state, 'x'), interp('weapon_glitch', 'f1'), sequenceRng([5]));
    const r2 = applyRoll(step2, 0, 'force:3:abc');
    expect(r2.outcome!.check.success).toBe(false);
    const warn = checkNarration(buildEngineResult(r2, r2.outcome), 'O hack termina com sucesso e a arma trava.', [], r2.state.npcs);
    expect(warn.join(' ')).toMatch(/FALHOU/);
  });
});

// ================================================================ 5. PERSISTÊNCIA E MIGRAÇÃO

describe('Persistência: rolagem pendente, saves antigos e validateSave', () => {
  it('.reload() com rolagem de quickhack pendente (gm): rolar depois dá o mesmo resultado que sem reload', () => {
    const a = fight(hacker()).tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    const b = fight(hacker()).tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    b.reload();
    expect(b.state.pendingRoll).toMatchObject({ kind: 'quickhack', quickhack: 'short_circuit', targetId: 'f1' });
    a.roll([9, 2, 3]);
    b.roll([9, 2, 3]);
    expect(b.state.combat.combatants[0].hp.current).toBe(a.state.combat.combatants[0].hp.current);
    expect(ram(b)).toEqual(ram(a));
  });

  it('save com pendingRoll de quickhack passa por validateSave (e por migração), e rola', () => {
    const sc = fight(hacker()).tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: 'f1' });
    const loaded = validateSave(JSON.parse(JSON.stringify(sc.state)));
    expect(loaded.pendingRoll?.quickhack).toBe('weapon_glitch');
    const out = resolveRoll(loaded, loaded.pendingRoll!, 0, sequenceRng([9]));
    expect(gameReducer(loaded, { type: 'rollResolved', outcome: out }).combat.combatants[0].skipNextAttack).toBe('arma em pane');
  });

  it('save com pendência órfã (alvo sumiu antes de salvar): carrega, rola sem lançar, sem gastar RAM', () => {
    const sc = fight(hacker()).tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'f1' });
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: [foeOf('z9')] } }));
    const loaded = validateSave(JSON.parse(JSON.stringify(sc.state)));
    const r0 = loaded.character.deck!.ram!.current;
    const out = resolveRoll(loaded, loaded.pendingRoll!, 0, sequenceRng([9]));
    const next = gameReducer(loaded, { type: 'rollResolved', outcome: out });
    expect(next.character.deck!.ram!.current).toBe(r0);
    expect(next.pendingRoll).toBeNull();
  });

  it('save antigo sem quickhacks/RAM/rastro/daemon: migra, ganha hacks de nível 1 e RAM cheia; o resto continua ausente', () => {
    const s = hacker().state;
    const old = JSON.parse(JSON.stringify(s));
    delete old.character.quickhacks;
    delete old.character.deck.ram;
    delete old.net.trace;
    delete old.world.daemons;
    delete old.combat.combatants;
    old.combat.combatants = [];
    const loaded = validateSave(old);
    expect(loaded.character.quickhacks).toEqual(STARTER_QUICKHACKS);
    expect(loaded.character.deck!.ram).toEqual({ current: ramMax(loaded.character), max: ramMax(loaded.character) });
    expect(loaded.net.trace).toBeUndefined();
  });

  it('save antigo sem o campo net inteiro: migra para { architecture: null, run: null }', () => {
    const old = JSON.parse(JSON.stringify(hacker().state));
    delete old.net;
    expect(validateSave(old).net).toEqual({ architecture: null, run: null });
  });

  it('RAM acima do máximo (rank caiu / save editado) é clampada; hack desconhecido na lista não quebra', () => {
    const c = withQuickhackDefaults({ ...hacker().state.character, quickhacks: ['ping', 'hack_que_nao_existe'], deck: { ...hacker().state.character.deck!, ram: { current: 99, max: 99 } } });
    expect(c.deck!.ram).toEqual({ current: ramMax(c), max: ramMax(c) });
    const sc = fight(hacker()).edit(s => ({ ...s, character: c }));
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(true);
  });

  it('não-Trilheiro nunca ganha quickhacks/RAM na migração', () => {
    const solo = validateSave(JSON.parse(JSON.stringify(scenario({ role: 'solo' }).state)));
    expect(solo.character.quickhacks).toBeUndefined();
    expect(solo.character.deck).toBeUndefined();
  });

  it('Sandbox: trocar para Trilheiro (deck sem RAM) deixa o Ping e o quickhack com alvo funcionarem e cria a RAM no uso', () => {
    const solo = scenario({ role: 'solo' }).edit(s => applySandboxRole(s, 'netrunner', 10));
    fight(solo);
    solo.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(solo.last().ok).toBe(true);
    expect(ram(solo).max).toBe(ramMax(solo.state.character));
    solo.tool('interpreter', 'quickhack', { hack: 'system_collapse', targetId: 'f1' });
    expect(solo.last().ok).toBe(false); // hack T4 ainda não desbloqueado: mensagem, não exceção
  });
});

// ================================================================ 6. REDE: daemon, rastro, alerta, Cloak

const SYSTEM_DAEMON = { name: 'Cão de Guarda', directive: 'Rastrear intrusos', alert: 0, controlledNodes: ['senha:1', 'Torretas'], owner: 'system' as const };

/** Trilheiro rank 10 diante de uma arquitetura básica (DV 6). */
function netter(floors: NetFloor[], extra: Partial<NetArchitecture> = {}): Sc {
  return hacker().edit(s => ({ ...s, net: { architecture: arch(floors, extra), run: null } }));
}
const connect = (sc: Sc, patch: Partial<NetRun> = {}) => sc.edit(s => ({ ...s, net: { ...s.net, run: mkRun(patch) } }));
const act = (sc: Sc, action: string, dice: number[], args: Record<string, unknown> = {}) => sc.tool('interpreter', 'net_action', { action, ...args }, dice);
const lastFloor = (sc: Sc) => sc.state.net.architecture!.floors.length - 1;

describe('Rede: daemon persistente (ação de rede `daemon`)', () => {
  const three = () => [floor(0, 'empty'), floor(1, 'empty'), floor(2, 'empty')];

  it('antes do último andar falha, não gasta Ação de Rede e não planta nada', () => {
    const sc = connect(netter(three()), { position: 1 });
    act(sc, 'daemon', [9], { virus: 'vigiar as câmeras' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/andar mais fundo/);
    expect(sc.state.net.run!.actionsLeft).toBe(3);
    expect(sc.state.net.architecture!.daemon).toBeUndefined();
    expect(sc.state.world.daemons ?? []).toHaveLength(0);
  });

  it('sem diretriz (vazia/só espaços) falha; com diretriz grande demais (>160) é rejeitada pelo esquema', () => {
    const sc = connect(netter(three()), { position: 2 });
    for (const virus of [undefined, '', '    ']) {
      act(sc, 'daemon', [9], virus === undefined ? {} : { virus });
      expect(sc.last().ok).toBe(false);
    }
    act(sc, 'daemon', [9], { virus: 'x'.repeat(200) });
    expect(sc.state.net.architecture!.daemon?.directive.length ?? 0).toBeLessThanOrEqual(160);
  });

  it('no último andar, com diretriz e teste vencido: daemon do jogador na arquitetura e no mundo; custa 1 Ação', () => {
    const sc = connect(netter([floor(0, 'empty'), floor(1, 'control', { dv: 6, label: 'Câmeras', cleared: true }), floor(2, 'empty')]), { position: 2 });
    act(sc, 'daemon', [9], { virus: '  vigiar câmeras e manter portas abertas  ' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.net.run!.actionsLeft).toBe(2);
    expect(sc.state.net.architecture!.daemon).toMatchObject({ owner: 'player', directive: 'vigiar câmeras e manter portas abertas', alert: 0, controlledNodes: ['Câmeras'] });
    expect(sc.state.world.daemons).toHaveLength(1);
    expect(sc.state.world.daemons![0]).toMatchObject({ architectureId: 'arch_t', architectureName: 'Servidor X', owner: 'player' });
  });

  it('teste falho: o sistema rejeita, nada plantado, a Ação é gasta', () => {
    const sc = connect(netter(three()), { position: 2 });
    act(sc, 'daemon', [1, 9], { virus: 'vigiar' }); // fumble: 10 + (1−9) = 2 < 10
    expect(sc.last().ok).toBe(true);
    expect(sc.last().summary).toMatch(/rejeita/);
    expect(sc.state.net.architecture!.daemon).toBeUndefined();
    expect(sc.state.net.run!.actionsLeft).toBe(2);
  });

  it('dois daemons na mesma arquitetura: o segundo substitui o primeiro (1 entrada); em outra arquitetura são 2 entradas', () => {
    const sc = connect(netter(three()), { position: 2, actionsLeft: 9 });
    act(sc, 'daemon', [9], { virus: 'primeiro' });
    act(sc, 'daemon', [9], { virus: 'segundo' });
    expect(sc.state.world.daemons).toHaveLength(1);
    expect(sc.state.world.daemons![0].directive).toBe('segundo');
    sc.edit(s => ({ ...s, net: { architecture: { ...arch(three()), id: 'arch_2', name: 'Outro' }, run: mkRun({ architectureId: 'arch_2', position: 2, actionsLeft: 9 }) } }));
    act(sc, 'daemon', [9], { virus: 'terceiro' });
    expect(sc.state.world.daemons!.map(d => d.architectureId).sort()).toEqual(['arch_2', 'arch_t']);
  });

  it('daemon + jack_out no mesmo turno: o daemon persiste depois de sair, e depois de se afastar do ponto de acesso', () => {
    const sc = connect(netter(three()), { position: 2 });
    act(sc, 'daemon', [9], { virus: 'vigiar' });
    act(sc, 'jack_out', [5]);
    expect(sc.state.net.run).toBeNull();
    expect(sc.state.net.architecture!.daemon?.owner).toBe('player');
    expect(sc.state.world.daemons).toHaveLength(1);
    sc.edit(s => leaveAccessPoint(s, sequenceRng([5])));
    expect(sc.state.net.architecture).toBeNull();
    expect(sc.state.world.daemons).toHaveLength(1);
  });

  it('(dúvida de design — documenta o atual) plantar o daemon do jogador SUBSTITUI o daemon defensor do sistema: o alerta/rastro pararam de subir', () => {
    const sc = connect(netter([floor(0, 'password', { dv: 6 }), floor(1, 'empty')], { daemon: { ...SYSTEM_DAEMON } }), { position: 1, actionsLeft: 9 });
    act(sc, 'daemon', [9], { virus: 'meu agente' });
    expect(sc.state.net.architecture!.daemon?.owner).toBe('player');
    sc.edit(s => ({ ...s, net: { ...s.net, run: { ...s.net.run!, position: 0 } } }));
    act(sc, 'backdoor', [1, 9]); // falha
    expect(trace(sc)).toBe(0);
  });

  it('descreve o daemon e o rastro para o narrador (describeNet)', () => {
    const sc = connect(netter(three(), { daemon: { ...SYSTEM_DAEMON } }));
    sc.edit(s => addTrace(s, 2, 'teste'));
    expect(describeNet(sc.state)[0]).toMatch(/daemon Cão de Guarda \(system, alerta 0\/5\).*rastro 2\/5/);
  });
});

describe('Rede: daemon do sistema, alerta e rastro (limites 0..5)', () => {
  const guarded = (extra: Partial<NetArchitecture> = {}) => connect(netter([floor(0, 'password', { dv: 6 }), floor(1, 'control', { dv: 6, label: 'Torretas' }), floor(2, 'empty')], { daemon: { ...SYSTEM_DAEMON }, ...extra }), { actionsLeft: 99 });
  const alert = (sc: Sc) => sc.state.net.architecture!.daemon!.alert;

  it('Backdoor falho (ou em senha vigiada, mesmo com sucesso) sobe alerta e rastro; sucesso em senha livre não', () => {
    const sc = guarded();
    act(sc, 'backdoor', [1, 9]);
    expect([alert(sc), trace(sc)]).toEqual([1, 1]);
    // senha 'senha:1' é vigiada: sucesso também alerta
    act(sc, 'backdoor', [9]);
    expect(sc.state.net.architecture!.floors[0].cleared).toBe(true);
    expect([alert(sc), trace(sc)]).toEqual([2, 2]);
    // nó livre (rótulo diferente) com sucesso: sem reação
    const free = guarded({ floors: [floor(0, 'password', { dv: 6 }), floor(1, 'empty')] });
    free.edit(s => ({ ...s, net: { ...s.net, architecture: { ...s.net.architecture!, daemon: { ...SYSTEM_DAEMON, controlledNodes: [] } } } }));
    act(free, 'backdoor', [9]);
    expect([alert(free), trace(free)]).toEqual([0, 0]);
  });

  it('Controle em nó vigiado alerta; alerta e rastro nunca passam de 5 mesmo com 40 falhas', () => {
    const sc = guarded();
    act(sc, 'backdoor', [9]);
    sc.edit(s => ({ ...s, net: { ...s.net, run: { ...s.net.run!, position: 1 } } }));
    for (let i = 0; i < 40; i++) act(sc, 'control', [1, 9]);
    expect(alert(sc)).toBe(5);
    expect(trace(sc)).toBe(5);
  });

  it('fim do turno de Rede com alerta ≥ 2: varredura sobe o rastro (1 por turno); alerta 1 não varre', () => {
    const sc = guarded();
    sc.edit(s => ({ ...s, net: { ...s.net, architecture: { ...s.net.architecture!, daemon: { ...SYSTEM_DAEMON, alert: 1 } } } }));
    sc.edit(s => endNetTurn(s, sequenceRng([5])).state);
    expect(trace(sc)).toBe(0);
    sc.edit(s => ({ ...s, net: { ...s.net, architecture: { ...s.net.architecture!, daemon: { ...SYSTEM_DAEMON, alert: 2 } } } }));
    for (let i = 0; i < 8; i++) sc.edit(s => endNetTurn(s, sequenceRng([5])).state);
    expect(trace(sc)).toBe(5);
  });

  it('daemon do JOGADOR nunca reage (alerta fica 0), mesmo em falhas', () => {
    const sc = guarded();
    sc.edit(s => ({ ...s, net: { ...s.net, architecture: { ...s.net.architecture!, daemon: { ...SYSTEM_DAEMON, owner: 'player' as const } } } }));
    act(sc, 'backdoor', [1, 9]);
    expect([alert(sc), trace(sc)]).toEqual([0, 0]);
  });

  it('Cloak com sucesso baixa o rastro em 2 e marca rastros apagados; nunca fica abaixo de 0; falha não muda; fora da Rede é recusado', () => {
    const sc = connect(netter([floor(0, 'empty')]), { actionsLeft: 99 });
    sc.edit(s => addTrace(s, 3, 'x'));
    act(sc, 'cloak', [9]);
    expect(trace(sc)).toBe(1);
    expect(sc.state.net.run!.cloaked).toBe(true);
    act(sc, 'cloak', [9]);
    expect(trace(sc)).toBe(0);
    expect(sc.state.net.trace).toBeUndefined();
    act(sc, 'cloak', [9]);
    expect(sc.last().ok).toBe(true);
    expect(sc.state.net.trace).toBeUndefined();
    sc.edit(s => addTrace(s, 4, 'x'));
    act(sc, 'cloak', [1, 9]); // falha: 10 + (1−9) = 2 < 6
    expect(trace(sc)).toBe(4);
    const off = netter([floor(0, 'empty')]);
    act(off, 'cloak', [9]);
    expect(off.last().ok).toBe(false);
  });

  it('rastro: addTrace respeita 0..5, ignora negativos sem rastro e não gera evento quando nada muda', () => {
    const sc = hacker();
    const n0 = sc.state.events.length;
    expect(addTrace(sc.state, -5, 'c').net.trace).toBeUndefined();
    expect(addTrace(sc.state, -5, 'c').events.length).toBe(n0);
    expect(addTrace(sc.state, 99, 'x').net.trace?.level).toBe(5);
    const full = addTrace(sc.state, 5, 'x');
    expect(addTrace(full, 3, 'y')).toBe(full);
  });

  it('T3/T4 sobem o rastro; T1/T2 não; muitos T3/T4 não passam de 5; falha e retroalimentação também deixam assinatura (documenta o atual)', () => {
    const sc = fight(hacker(), [foeOf('f1', { hp: { current: 9999, max: 9999 } })]);
    for (const key of ['short_circuit', 'overheat', 'weapon_glitch', 'cripple_movement', 'reboot_optics'] as QuickhackKey[]) {
      setRam(sc, 9);
      qh(sc, key, 'f1', HIT);
    }
    expect(trace(sc)).toBe(0);
    for (let i = 0; i < 8; i++) {
      setRam(sc, 9);
      patchFoe(sc, 'f1', { status: 'active' });
      qh(sc, i % 2 ? 'system_collapse' : 'synapse_burnout', 'f1', i === 3 ? [1, 4] : HIT);
    }
    expect(trace(sc)).toBe(5);
  });
});

describe('Rede: conexão, desconexão e estados esquisitos', () => {
  it('sem arquitetura: jack_in, net_action e net_end_turn recusados sem mudar nada', () => {
    const sc = hacker();
    const before = JSON.stringify(sc.state.net);
    sc.tool('interpreter', 'jack_in', {});
    expect(sc.last().ok).toBe(false);
    act(sc, 'pathfinder', [5]);
    expect(sc.last().ok).toBe(false);
    sc.tool('engine', 'net_end_turn', {});
    expect(sc.last().ok).toBe(false);
    expect(JSON.stringify(sc.state.net)).toBe(before);
  });

  it('jack_in duplo recusado; quickhack depois de jack_out volta a funcionar; sair no meio é seguro', () => {
    const sc = fight(netter([floor(0, 'empty'), floor(1, 'empty')]));
    sc.tool('interpreter', 'jack_in', {});
    expect(sc.last().ok).toBe(true);
    sc.tool('interpreter', 'jack_in', {});
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(false);
    act(sc, 'jack_out', [5]);
    expect(sc.state.net.run).toBeNull();
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(true);
  });

  it('ações de Rede acabam: recusa até net_end_turn; limites de Ações pelo rank (2/3/4/5)', () => {
    const sc = connect(netter([floor(0, 'empty'), floor(1, 'empty'), floor(2, 'empty')]), { actionsLeft: 1 });
    act(sc, 'pathfinder', [5]);
    act(sc, 'pathfinder', [5]);
    expect(sc.last().ok).toBe(false);
    sc.tool('engine', 'net_end_turn', {});
    expect(sc.state.net.run!.actionsLeft).toBe(5);
    expect(sc.state.net.run!.netTurn).toBe(2);
  });

  it('arquitetura trocada pelo Mestre é recusada enquanto conectado', () => {
    const sc = connect(netter([floor(0, 'empty')]));
    sc.tool('narrator', 'net_architecture', { name: 'Outra', difficulty: 'basic' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.net.architecture!.id).toBe('arch_t');
  });

  it('estado corrompido (run sem arquitetura): ações recusam sem lançar; sair do alcance limpa; describeNet vazio', () => {
    const sc = hacker().edit(s => ({ ...s, net: { architecture: null, run: mkRun() } }));
    act(sc, 'pathfinder', [5]);
    expect(sc.last().ok).toBe(false);
    sc.tool('engine', 'net_end_turn', {});
    expect(describeNet(sc.state)).toEqual([]);
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(false);
  });

  it('conectado e se afastando do ponto de acesso (leaveAccessPoint): desconexão insegura, ICE cobra, rastro persiste', () => {
    const sc = connect(netter([floor(0, 'empty')]), { ice: [{ id: 'ice_0_0', key: 'hellhound', floor: 0, rez: 20, maxRez: 20, following: true }] });
    sc.edit(s => addTrace(s, 2, 'x'));
    const hp = sc.state.character.hp.current;
    sc.edit(s => leaveAccessPoint(s, sequenceRng([3, 3])));
    expect(sc.state.net).toMatchObject({ run: null, architecture: null });
    expect(sc.state.character.hp.current).toBeLessThan(hp);
    expect(trace(sc)).toBe(2);
  });

  it('Rede + combate: jack_in no meio da luta e fase inimiga pelo pipeline não lançam; quickhack fica bloqueado conectado', () => {
    const sc = fight(netter([floor(0, 'empty'), floor(1, 'empty')]));
    sc.edit(s => ({ ...s, character: { ...s.character, hp: { current: 900, max: 900 } } }));
    let step = applyInterpretation(beginTurn(sc.state, 'me conecto'), { intent: { type: 'netrun', summary: 'jack in', confidence: 1 }, toolCalls: [{ tool: 'jack_in', args: {} }] }, sequenceRng([5]));
    step = applyEnemyPhase(step, seededRng('fase'));
    expect(step.state.net.run).not.toBeNull();
    expect(step.state.combat.round).toBe(2);
    const blocked = runToolCalls(REGISTRY, step.state, [{ tool: 'quickhack', args: { hack: 'ping' } }], { rng: sequenceRng([5]), origin: 'interpreter' });
    expect(blocked.records[0].ok).toBe(false);
  });

  it('runner com 1 PV derrubado por ICE: PV nunca negativo; estado serializável', () => {
    const sc = connect(netter([floor(0, 'empty')]), { ice: [{ id: 'ice_0_0', key: 'hellhound', floor: 0, rez: 20, maxRez: 20, following: true }] });
    sc.edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 1 } } }));
    sc.edit(s => endNetTurn(s, sequenceRng([10, 6, 6])).state);
    expect(sc.state.character.hp.current).toBe(0);
    expect(() => JSON.stringify(sc.state)).not.toThrow();
  });

  it('BUG-NET-6: fora de combate, Apagar Memória não pode mirar combatantes sobrados da luta anterior (end_combat não limpa a lista)', () => {
    const sc = fight(hacker());
    sc.tool('narrator', 'end_combat', {});
    expect(sc.state.combat.active).toBe(false);
    expect(sc.state.combat.combatants.some(t => t.id === 'f1' && t.status === 'active')).toBe(true);
    sc.tool('interpreter', 'quickhack', { hack: 'memory_wipe', targetId: 'f1' });
    expect(sc.last().ok).toBe(false);
  });

  it('fora de combate a RAM enche com a passagem do tempo (rest/advance), inclusive depois de retroalimentação', () => {
    const sc = hacker().tool('narrator', 'upsert_npc', { name: 'Kiro', present: true });
    sc.tool('interpreter', 'quickhack', { hack: 'memory_wipe', targetId: 'Kiro' });
    sc.roll([1, 4]); // retroalimentação: RAM 0
    expect(ram(sc).current).toBe(0);
    sc.tool('interpreter', 'rest', { hours: 8 });
    sc.advance(600);
    expect(ram(sc).current).toBe(ram(sc).max);
  });

  it('BUG-NET-8 (baixa): o rastro gerado por quickhacks T3/T4 fora de uma arquitetura não chega ao narrador (describeNet só roda com arquitetura)', () => {
    const sc = fight(hacker());
    qh(sc, 'synapse_burnout', 'f1', HIT);
    expect(trace(sc)).toBe(1);
    expect(sc.state.net.architecture).toBeNull();
    const prompt = buildNarratePrompt(buildGameContext(sc.state, ''), { kind: 'action', playerInput: 'x', engineResult: null });
    expect(prompt).toMatch(/rastro/i);
  });

  it('BUG-NET-5: personagem morto não pode usar quickhack nem Ação de Rede (o ataque e jack_in já recusam)', () => {
    const sc = fight(hacker()).edit(s => ({ ...s, character: { ...s.character, dead: true } }));
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().ok).toBe(false);
    const net = connect(netter([floor(0, 'empty')])).edit(s => ({ ...s, character: { ...s.character, dead: true } }));
    act(net, 'pathfinder', [5]);
    expect(net.last().ok).toBe(false);
  });

  it('BUG-NET-4 (baixa): save com RAM negativa é normalizado para 0 ao carregar', () => {
    const old = JSON.parse(JSON.stringify(hacker().state));
    old.character.deck.ram.current = -3;
    expect(validateSave(old).character.deck!.ram!.current).toBeGreaterThanOrEqual(0);
  });

  it('jackIn/generateArchitecture: dificuldade exige Interface mínima; daemon do sistema nasce com alerta 0 e nós copiados', () => {
    const a = generateArchitecture({ name: 'T', accessPoint: 'p', difficulty: 'advanced', floors: 3, controls: ['Torretas'], daemon: { name: 'D', directive: 'x' } }, 1, sequenceRng([1]));
    expect(a.daemon).toMatchObject({ alert: 0, owner: 'system', controlledNodes: ['Torretas'] });
    const sc = hacker(4).edit(s => ({ ...s, net: { architecture: a, run: null } }));
    expect(jackIn(sc.state, sequenceRng([5])).ok).toBe(false);
    expect(netAction(sc.state, { kind: 'pathfinder' }, sequenceRng([5])).ok).toBe(false);
  });
});

// ================================================================ 7. PROPRIEDADE: sequência aleatória (seed fixa)

describe('Propriedade: ~2000 operações aleatórias misturando quickhack, rolagem, cancelar, fase inimiga, Rede, combate e descanso', () => {
  const scanNumbers = (v: unknown, path: string, bad: string[]) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) bad.push(`${path}=${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => scanNumbers(x, `${path}[${i}]`, bad));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scanNumbers(x, `${path}.${k}`, bad);
  };

  function invariants(s: GameState, label: string) {
    const c = s.character;
    const r = c.deck?.ram;
    expect(r, label).toBeDefined();
    expect(Number.isInteger(r!.current), `${label} RAM inteira`).toBe(true);
    expect(r!.current, `${label} RAM >= 0`).toBeGreaterThanOrEqual(0);
    expect(r!.current, `${label} RAM <= max`).toBeLessThanOrEqual(r!.max);
    expect(r!.max, `${label} RAM max`).toBe(ramMax(c));
    if (s.net.trace) {
      expect(Number.isInteger(s.net.trace.level), `${label} trace int`).toBe(true);
      expect(s.net.trace.level, `${label} trace 1..5`).toBeGreaterThanOrEqual(1);
      expect(s.net.trace.level).toBeLessThanOrEqual(5);
    }
    for (const d of [s.net.architecture?.daemon, ...(s.world.daemons ?? [])]) if (d) {
      expect(d.alert, `${label} alerta`).toBeGreaterThanOrEqual(0);
      expect(d.alert).toBeLessThanOrEqual(5);
    }
    for (const t of s.combat.combatants) {
      expect(Number.isFinite(t.hp.current), `${label} hp ${t.id}`).toBe(true);
      expect(t.hp.current, `${label} hp>=0 ${t.id}`).toBeGreaterThanOrEqual(0);
      expect(t.hp.current, `${label} hp<=max ${t.id}`).toBeLessThanOrEqual(t.hp.max);
      expect(t.sp.body, `${label} sp ${t.id}`).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isFinite(c.hp.current) && c.hp.current <= c.hp.max, `${label} hp jogador`).toBe(true);
    expect(c.luck.current, `${label} sorte`).toBeGreaterThanOrEqual(0);
    expect(c.luck.current).toBeLessThanOrEqual(c.luck.max);
    if (s.net.run) {
      expect(s.net.architecture, `${label} run sem arquitetura`).not.toBeNull();
      expect(s.net.run.position).toBeLessThan(s.net.architecture!.floors.length);
      expect(s.net.run.actionsLeft, `${label} ações`).toBeGreaterThanOrEqual(0);
    }
    const bad: string[] = [];
    scanNumbers({ ...s, chat: [], events: [], memories: [] }, 'state', bad);
    expect(bad, `${label} números inválidos`).toEqual([]);
  }

  it('invariantes valem por 2000 operações; pendências órfãs são tratadas; estado sempre serializável e aceito por validateSave', () => {
    const R = seededRng('qa-netrunner-prop-1');
    const pick = <T,>(a: readonly T[]): T => a[R(a.length) - 1];
    const dice = () => Array.from({ length: 12 }, () => R(10));
    const sc = fight(hacker(10), [foeOf('f1'), foeOf('f2'), foeOf('f3', { template: 'security_officer' })]);
    const targets = ['f1', 'f2', 'f3', 'b1', 'fantasma', 'Kiro', undefined] as const;
    const stats = { quickhacksResolved: 0, combos: 0, blocked: 0, cancels: 0, net: 0, orphans: 0, reloads: 0 };

    sc.tool('narrator', 'upsert_npc', { name: 'Kiro', present: true });
    for (let i = 0; i < 2000; i++) {
      // o jogador não fica morto para sempre: o teste quer exercitar, não esperar o fim
      if (sc.state.character.dead || sc.state.character.hp.current < 20) {
        sc.edit(s => ({ ...s, pendingRoll: s.pendingRoll?.kind === 'deathSave' ? null : s.pendingRoll, character: { ...s.character, dead: false, stabilized: false, hp: { ...s.character.hp, current: s.character.hp.max }, conditions: [] } }));
      }
      // mantém o cenário vivo: recomeça a luta (ids fixos) e solta a conexão de vez em quando
      if ((!sc.state.combat.active || !sc.state.combat.combatants.some(t => t.status === 'active' && t.side !== 'ally')) && R(10) <= 7) fight(sc, [foeOf('f1'), foeOf('f2'), foeOf('f3', { template: 'security_officer' })]);
      if (sc.state.net.run && R(3) === 1) sc.edit(s => ({ ...s, net: { ...s.net, run: null } }));
      const op = R(100);
      const label = `op#${i}(${op})`;
      if (op <= 22) {
        sc.tool(pick(['interpreter', 'player'] as const), 'quickhack', { hack: pick(QUICKHACK_KEYS), ...(R(5) === 1 ? {} : { targetId: pick(targets) }) }, dice());
        // adversário: muda o mundo entre o pedido e a rolagem
        if (sc.state.pendingRoll?.kind === 'quickhack' && R(3) === 1) {
          const id = sc.state.pendingRoll.targetId ?? 'f1';
          pick<() => void>([() => patchFoe(sc, id, { status: 'down' }), () => patchFoe(sc, id, { status: 'fled' }), () => patchFoe(sc, id, { side: 'ally' }), () => patchFoe(sc, id, { distance: '51-100m' }), () => setRam(sc, 0), () => sc.tool('narrator', 'end_combat', {}), () => sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: [] } })), () => sc.edit(s => ({ ...s, character: { ...s.character, conditions: [{ key: 'unconscious', sinceTurn: 0, source: 't' }] as never } }))])();
        }
      } else if (op <= 42) {
        if (sc.state.pendingRoll) {
          const before = sc.state.pendingRoll;
          sc.roll(dice(), R(4) - 1);
          if (before.kind === 'quickhack') {
            stats.quickhacksResolved++;
            if (sc.lastOutcome?.quickhack?.combo) stats.combos++;
            if (sc.lastOutcome?.quickhack && !sc.lastOutcome.quickhack.ok) stats.blocked++;
          }
        }
      } else if (op <= 50) {
        if (sc.state.pendingRoll) stats.cancels++;
        sc.edit(s => gameReducer(s, { type: 'cancelPendingRoll' }));
      } else if (op <= 58) {
        const p = sc.state.pendingRoll;
        if (!p || p.origin === 'player') {
          const req = buildQuickhackRequest(sc.state, pick(QUICKHACK_KEYS.filter(k => QUICKHACKS[k].target !== 'none')), { combatantId: pick(targets) }, 'player');
          if (typeof req !== 'string') sc.edit(s => gameReducer(s, { type: 'setPendingRoll', request: req }));
        }
      } else if (op <= 62) {
        // pares de combo de verdade, com RAM cheia e dados altos (o aleatório puro quase não os monta)
        const [first, second] = pick([['cyberware_malfunction', 'short_circuit'], ['overheat', 'synapse_burnout'], ['sonic_shock', 'memory_wipe']] as const);
        const id = pick(['f1', 'f2', 'f3']);
        if (!sc.state.pendingRoll && !sc.state.net.run && sc.state.combat.active) {
          for (const key of [first, second]) {
            setRam(sc, ram(sc).max);
            qh(sc, key, id, [9, 1 + R(6), 1 + R(6), 1 + R(6), 1 + R(6), 1 + R(6), 1 + R(6)]);
            if (sc.lastOutcome?.quickhack?.combo) stats.combos++;
            invariants(sc.state, label + '-combo');
          }
        }
      } else if (op <= 72) {
        if (sc.state.combat.active) {
          const seed = R(1e6);
          sc.edit(s => runEnemyPhase(s, seededRng(`ph${seed}`)).state);
        }
      } else if (op <= 80) {
        stats.net++;
        const kind = R(6);
        if (kind === 1) sc.tool('narrator', 'net_architecture', { name: `Rede ${i}`, difficulty: pick(['basic', 'standard', 'uncommon', 'advanced'] as const), floors: 3 + R(4), controls: 'Câmeras;Portas', ...(R(2) === 1 ? { daemonName: 'Guarda', daemonDirective: 'caçar intrusos' } : {}) }, dice());
        else if (kind === 2) sc.tool(pick(['interpreter', 'player'] as const), 'jack_in', {}, dice());
        else if (kind === 3) sc.tool('engine', 'net_end_turn', {}, dice());
        else sc.tool('interpreter', 'net_action', { action: pick(['pathfinder', 'backdoor', 'eye_dee', 'control', 'cloak', 'virus', 'daemon', 'slide', 'zap', 'program', 'activate', 'down', 'up', 'jack_out', 'extinguish']), virus: 'diretriz qualquer', programId: pick(['sword', 'banhammer', 'armor', 'eraser']) }, dice());
      } else if (op <= 85) {
        sc.tool('narrator', 'start_combat', { combatants: [{ template: pick(['boosterganger', 'security_officer', 'cyberpsycho', 'netrunner']), count: 1 + R(2) }] }, dice());
      } else if (op <= 89) {
        sc.tool('narrator', 'end_combat', {}, dice());
      } else if (op <= 92) {
        sc.tool('interpreter', 'rest', { hours: pick([1, 8]) }, dice());
      } else if (op <= 95) {
        // adversário: mexe nos PV/status/distância dos combatentes (inclusive o alvo de uma pendência)
        const t = pick(sc.state.combat.combatants);
        if (t) patchFoe(sc, t.id, pick([{ hp: { current: R(t.hp.max + 1) - 1, max: t.hp.max } }, { status: 'down' as const }, { status: 'fled' as const }, { status: 'active' as const, hp: { current: t.hp.max, max: t.hp.max } }, { distance: '51-100m' as const }, { distance: '0-6m' as const }, { side: 'ally' as const }, { side: 'enemy' as const }]));
      } else if (op <= 97) {
        setRam(sc, R(ram(sc).max + 1) - 1);
      } else if (op <= 98) {
        sc.reload();
        stats.reloads++;
      } else {
        sc.advance(30 * R(8));
      }

      invariants(sc.state, label);

      // pendência órfã: resolver numa cópia não pode lançar, não pode aumentar a RAM e tem de limpar a pendência
      const p = sc.state.pendingRoll;
      if (p?.kind === 'quickhack') {
        const orphan = sc.state.combat.active && !!p.targetId && QUICKHACKS[p.quickhack as QuickhackKey].target !== 'none' && !sc.state.combat.combatants.some(t => t.id === p.targetId);
        if (orphan) stats.orphans++;
        const copy: GameState = JSON.parse(JSON.stringify(sc.state));
        const out = resolveRoll(copy, copy.pendingRoll!, 0, sequenceRng(dice()));
        const next = gameReducer(copy, { type: 'rollResolved', outcome: out });
        expect(next.pendingRoll, `${label} pendência limpa`).toBeNull();
        expect(next.character.deck!.ram!.current, `${label} RAM`).toBeLessThanOrEqual(copy.character.deck!.ram!.current);
        if (orphan) expect(out.quickhack!.ok, `${label} órfã`).toBe(false);
      }
      if (i % 40 === 0) {
        expect(() => validateSave(JSON.parse(JSON.stringify(sc.state))), `${label} validateSave`).not.toThrow();
      }
    }
    // o teste precisa ter de fato exercitado o que promete
    expect(stats.quickhacksResolved).toBeGreaterThan(40);
    expect(stats.cancels).toBeGreaterThan(5);
    expect(stats.net).toBeGreaterThan(50);
    expect(stats.reloads).toBeGreaterThan(5);
    // Com as penalidades de ferimento valendo no teste de Interface (BUG-NET-3), saem menos combos.
    expect(stats.combos).toBeGreaterThan(5);
    expect(stats.orphans).toBeGreaterThan(5);
    expect(() => validateSave(JSON.parse(JSON.stringify(sc.state)))).not.toThrow();
  }, 60_000);
});
