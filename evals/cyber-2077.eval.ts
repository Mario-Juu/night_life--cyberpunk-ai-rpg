/**
 * Cromo de 2077: tiers, grau (civil/militar/protótipo), nível do ripperdoc, peças soltas,
 * sistemas operacionais (Sandevistan/Berserk) no combate, Segundo Coração — e a cadeia de modelos.
 */
import { describe, expect, it } from 'vitest';
import { scenario, withRipperdoc, type Scenario } from './harness';
import { CYBERWARE, TIER_LABEL } from '../shared/rules/cyberware';
import { activeOs } from '../shared/engine/cyberBonus';
import { resolveEnemyAttack } from '../shared/engine/combat';
import { gameReducer } from '../shared/engine/reducer';
import { sequenceRng } from '../shared/engine/dice';
import { addToInventory, buildItem } from '../shared/engine/tools/helpers';
import { DEFAULT_MODEL_CHAIN, modelChain } from '../server/gamemaster/llmClient';
import type { GameState } from '../shared/types/game';

const money = (s: GameState): GameState => ({ ...s, character: { ...s.character, money: 60_000 } });
const doc = (tier: 1 | 2 | 3 | 4 | 5, blackMarket = false, trust = 60) => (s: GameState) => withRipperdoc(money(s), tier, blackMarket, trust);
const install = (sc: Scenario, key: string, dice = [1]) => sc.tool('interpreter', 'install_cyberware', { key }, dice).last();

describe('Catálogo de 2077', () => {
  it('todo implante tem tier e grau; os modelos de Sandevistan sobem de tier', () => {
    for (const d of Object.values(CYBERWARE)) {
      expect(TIER_LABEL[d.tier]).toBeDefined();
      expect(['civil', 'military', 'prototype']).toContain(d.grade);
    }
    expect(CYBERWARE.sandevistan).toMatchObject({ tier: 1, brand: 'Dynalar', grade: 'civil' });
    expect(CYBERWARE.sandevistan_apogee).toMatchObject({ tier: 5, brand: 'Militech', grade: 'military' });
    expect(CYBERWARE.sandevistan_warp_dancer.grade).toBe('prototype');
    expect(CYBERWARE.sandevistan_apogee.os!.rounds).toBeGreaterThan(0);
    expect(CYBERWARE.cybersnake.grade).toBe('military');
  });
});

describe('Quem instala o quê', () => {
  it('sem ripperdoc na cena: só bio-mod básico de shopping', () => {
    const sc = scenario().edit(money);
    expect(install(sc, 'techhair').ok).toBe(true);
    const r = install(sc, 'neural_link');
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/ripperdoc/);
  });

  it('a clínica só faz cromo até o nível dela', () => {
    const sc = scenario().edit(doc(2));
    install(sc, 'neural_link');
    expect(install(sc, 'sandevistan_zetatech').ok).toBe(true); // T2
    const sc2 = scenario().edit(doc(2));
    install(sc2, 'neural_link');
    const r = install(sc2, 'sandevistan_dynalar_mk3'); // T3
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/nível 2/);
  });

  it('cirurgia de hospital exige clínica nível 3+', () => {
    const sc = scenario().edit(doc(2));
    expect(install(sc, 'skin_weave').summary).toMatch(/hospital/);
  });

  it('militar: só no mercado negro e para quem o doutor confia', () => {
    const noBm = scenario().edit(doc(5, false));
    install(noBm, 'neural_link');
    expect(install(noBm, 'sandevistan_falcon').summary).toMatch(/mercado negro/);

    const stranger = scenario().edit(doc(5, true, 0));
    install(stranger, 'neural_link');
    expect(install(stranger, 'sandevistan_falcon').summary).toMatch(/não conhece/);

    const friend = scenario().edit(doc(5, true, 60));
    install(friend, 'neural_link');
    expect(install(friend, 'sandevistan_falcon').ok).toBe(true);
  });

  it('protótipo não se compra; com a peça em mãos, paga só a cirurgia', () => {
    const sc = scenario().edit(doc(5, true));
    install(sc, 'neural_link');
    expect(install(sc, 'sandevistan_warp_dancer').summary).toMatch(/não está à venda/);

    sc.tool('narrator', 'give_item', { name: 'Sandevistan experimental', category: 'gear', cyberKey: 'sandevistan_warp_dancer', source: 'laboratório da Qiant' });
    expect(sc.last().ok).toBe(true);
    const before = sc.state.character.money;
    const r = install(sc, 'sandevistan_warp_dancer');
    expect(r.ok).toBe(true);
    expect(before - sc.state.character.money).toBeLessThan(CYBERWARE.sandevistan_warp_dancer.price);
    expect(sc.state.character.inventory.some(i => i.cyberKey)).toBe(false);
  });

  it('upsert_npc define o nível do ripperdoc', () => {
    const sc = scenario().edit(money);
    sc.tool('narrator', 'upsert_npc', { name: 'Viktor Vektor', role: 'Ripperdoc', ripperdocTier: 3, blackMarket: true, present: true });
    expect(sc.npc('Viktor Vektor')?.ripperdoc).toEqual({ tier: 3, blackMarket: true });
    install(sc, 'neural_link');
    expect(sc.last().ok).toBe(true);
  });

  it('só um sistema operacional (Sandevistan OU Berserk); fundações do mesmo tipo contam juntas', () => {
    const sc = scenario().edit(doc(5, true));
    install(sc, 'neural_link');
    install(sc, 'berserk_moore');
    expect(install(sc, 'sandevistan').summary).toMatch(/sistema operacional/);
    install(sc, 'cyberarm');
    install(sc, 'cyberarm_mk2');
    expect(install(sc, 'cyberarm').summary).toMatch(/máximo/);
  });
});

describe('Sistemas operacionais no combate', () => {
  /** O que a fase dos inimigos faz depois da Ação do jogador: a rodada vira. */
  const nextRound = (s: GameState): GameState => ({ ...s, combat: { ...s.combat, round: s.combat.round + 1 } });
  const fighter = (key: string) => {
    const sc = scenario()
      .edit(doc(5, true))
      .edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, REF: 6, WILL: 8 }, skills: { ...s.character.skills, endurance: 6, handgun: 6 } } }));
    install(sc, 'neural_link');
    install(sc, key);
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger', template: 'boosterganger', distance: '0-6m' }] });
    return sc;
  };

  it('Sandevistan: ataque extra até com arma de Cadência 1; acaba depois das rodadas', () => {
    const sc = fighter('sandevistan_zetatech');
    const gun = buildItem({ name: 'Pistola muito pesada', category: 'weapon', weaponClass: 'pistol_vheavy' });
    sc.edit(s => addToInventory(s, gun));
    const foe = sc.state.combat.combatants[0].id;
    sc.tool('interpreter', 'attack', { targetId: foe, weaponId: gun.id, twice: true });
    expect(sc.last().ok).toBe(false); // sem o Sandevistan, Cadência 1

    sc.tool('interpreter', 'activate_cyberware', {}, [9, 9]); // passa no estresse
    expect(sc.last().ok).toBe(true);
    // A ativação gastou a Ação desta rodada: o tempo dilatado vale a partir da próxima.
    expect(activeOs(sc.state)).toBeNull();
    sc.edit(nextRound);
    expect(activeOs(sc.state)?.extraAttack).toBe(true);
    sc.tool('interpreter', 'attack', { targetId: foe, weaponId: gun.id, twice: true });
    expect(sc.last().ok).toBe(true);
    sc.roll([2, 1, 1, 1, 1]);
    expect(sc.lastOutcome!.followUp).toBeDefined();

    // Passadas as rodadas do modelo (uma Ação turbinada por rodada), o tempo volta ao normal.
    const run = sc.state.combat.os!;
    sc.edit(s => ({ ...s, combat: { ...s.combat, round: run.startRound + run.rounds } }));
    expect(activeOs(sc.state)).toBeNull();
    expect(sc.tool('interpreter', 'activate_cyberware', {}).last().ok).toBe(false); // uma por luta
  });

  it('Sandevistan deixa esquivar de balas mesmo com REF baixo', () => {
    const sc = fighter('sandevistan');
    sc.tool('interpreter', 'activate_cyberware', {}, [9, 9]).edit(nextRound);
    const res = resolveEnemyAttack(sc.state, sc.state.combat.combatants[0].id, sequenceRng([5, 10]))!; // 5 no ataque (a pistola ruim do capanga trava num 1), 10 na esquiva
    expect(res.result.defenseKind).toBe('evasion');
  });

  it('estresse neural: falhar custa PV (e nunca mata)', () => {
    const sc = fighter('sandevistan_apogee');
    sc.edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 3 } } }));
    const hum = sc.state.character.humanity.current;
    sc.tool('interpreter', 'activate_cyberware', {}, [1, 6, 6, 6]);
    expect(sc.state.character.hp.current).toBe(1);
    expect(sc.state.character.humanity.current).toBeLessThan(hum); // Apogee corrói a Humanidade
  });

  it('Berserk reduz o dano sofrido', () => {
    const sc = fighter('berserk_moore');
    sc.tool('interpreter', 'activate_cyberware', {}, [9, 9]).edit(nextRound);
    sc.edit(s => ({ ...s, character: { ...s.character, inventory: s.character.inventory.map(i => (i.armor ? { ...i, equipped: false } : i)) } }));
    const res = resolveEnemyAttack(sc.state, sc.state.combat.combatants[0].id, sequenceRng([10, 1, 5, 5, 5, 5]))!;
    if (res.result.hit && res.result.application) expect(res.result.reduced).toBe(2);
  });
});

describe('Segundo Coração', () => {
  it('ao cair a 0 PV, volta com metade — uma vez por dia', () => {
    const sc = scenario().edit(doc(5, true));
    install(sc, 'second_heart');
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Solo', template: 'boosterganger', distance: '0-6m' }] });
    sc.edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 1 }, inventory: s.character.inventory.map(i => (i.armor ? { ...i, equipped: false } : i)) } }));
    const res = resolveEnemyAttack(sc.state, sc.state.combat.combatants[0].id, sequenceRng([10, 10, 6, 6, 6, 6]))!;
    expect(res.result.hit).toBe(true);
    sc.edit(s => gameReducer(s, { type: 'enemyAttack', result: res.result }));
    expect(sc.state.character.hp.current).toBe(Math.ceil(sc.state.character.hp.max / 2));
  });
});

describe('Modelos', () => {
  it('sem pro: desce flash 3.8 → 3.7 → 3.6 → 3.5 e só então vai ao flash-lite', () => {
    const chain = modelChain();
    expect(chain).toEqual(DEFAULT_MODEL_CHAIN);
    expect(chain.slice(0, 4)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
    expect(chain.some(m => /pro/.test(m))).toBe(false);
    expect(chain.findIndex(m => m.includes('lite'))).toBeGreaterThan(3);
  });

  it('GM_MODELS personaliza, mas qualquer "pro" é descartado', () => {
    const prev = process.env.GM_MODELS;
    process.env.GM_MODELS = 'gemini-3.1-pro-preview, gemini-3.7-flash ,gemini-3.1-flash-lite';
    try {
      expect(modelChain()).toEqual(['gemini-3.7-flash', 'gemini-3.1-flash-lite']);
    } finally {
      if (prev === undefined) delete process.env.GM_MODELS;
      else process.env.GM_MODELS = prev;
    }
  });
});
