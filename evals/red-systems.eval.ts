/**
 * Sistemas do RED desta rodada: rajada, supressão, Cadência 2, granadas, qualidade/trava,
 * não letal, emboscada, cobertura com PV, Encarada, drogas de rua com vício, custo de vida
 * e perícias ×2.
 */
import { describe, expect, it } from 'vitest';
import { scenario, type Scenario } from './harness';
import { resolveEnemyAttack } from '../shared/engine/combat';
import { gameReducer } from '../shared/engine/reducer';
import { sequenceRng } from '../shared/engine/dice';
import { addToInventory, buildItem } from '../shared/engine/tools/helpers';
import { skillUpgradeCost, getSkill } from '../shared/rules/skills';
import { WEAPON_PRICES } from '../shared/rules/catalog';
import { withdrawalName } from '../shared/rules/streetDrugs';
import type { GameState, WeaponStats } from '../shared/types/game';

/** Personagem com REF/DEX 8 e perícias de combate 6, sem o equipamento inicial de arma. */
function shooter(): Scenario {
  return scenario().edit(s => ({
    ...s,
    character: {
      ...s.character,
      money: 20000,
      stats: { ...s.character.stats, REF: 8, DEX: 8, WILL: 4 },
      skills: { ...s.character.skills, autofire: 6, handgun: 6, athletics: 6, brawling: 6, melee_weapon: 6, resist_torture: 0 },
      inventory: s.character.inventory.filter(i => !i.weapon),
    },
  }));
}

function give(sc: Scenario, args: Parameters<typeof buildItem>[0], patch: Partial<WeaponStats> = {}): string {
  const item = buildItem(args);
  if (item.weapon) item.weapon = { ...item.weapon, ...patch };
  sc.edit(s => addToInventory(s, item));
  return item.id;
}

const foes = (sc: Scenario, n: number, distance = '0-6m', extra: Record<string, unknown> = {}) =>
  sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger', template: 'boosterganger', count: n, distance, ...extra }] });

const foe = (s: GameState, i = 0) => s.combat.combatants[i];

describe('Rajada e fogo de supressão', () => {
  it('rajada gasta 10 tiros e causa 2d6 × margem (até ×3 na SMG)', () => {
    const sc = shooter();
    const smg = give(sc, { name: 'Submetralhadora', category: 'weapon', weaponClass: 'smg' });
    foes(sc, 1);
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: smg, mode: 'autofire' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.pendingRoll).toMatchObject({ mode: 'autofire', skillId: 'autofire', dv: 20 });
    sc.roll([9, 3, 3]); // 8 + 6 + 9 = 23 vs 20 → margem 3
    const a = sc.lastOutcome!.attack!;
    expect(a.ammoAfter).toBe(20);
    expect(a.autofireMult).toBe(3);
    expect(a.damage!.total).toBe(18);
    expect(a.damage!.notation).toBe('2d6×3');
  });

  it('pistola não faz rajada', () => {
    const sc = shooter();
    const p = give(sc, { name: 'Pistola', category: 'weapon', weaponClass: 'pistol_medium' });
    foes(sc, 1);
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: p, mode: 'autofire' });
    expect(sc.last().ok).toBe(false);
  });

  it('supressão: quem não segura os nervos perde o próximo ataque e se abriga', () => {
    const sc = shooter();
    const smg = give(sc, { name: 'Submetralhadora', category: 'weapon', weaponClass: 'smg' });
    foes(sc, 2);
    sc.tool('interpreter', 'attack', { weaponId: smg, mode: 'suppressive' });
    expect(sc.last().ok).toBe(true);
    sc.roll([9]); // jogador 23 × ganger VONTADE 4 + 2 + 9 = 15
    const sup = sc.lastOutcome!.attack!.suppression!;
    expect(sup).toHaveLength(2);
    expect(sup.every(x => !x.held)).toBe(true);
    expect(foe(sc.state).skipNextAttack).toMatch(/suprimido/);
    expect(foe(sc.state).cover).toBe('partial');

    const res = resolveEnemyAttack(sc.state, foe(sc.state).id, sequenceRng([10]))!;
    expect(res.result.skipped).toBeTruthy();
    sc.edit(s => gameReducer(s, { type: 'enemyAttack', result: res.result }));
    expect(foe(sc.state).skipNextAttack).toBeUndefined();
  });
});

describe('Cadência 2, emboscada e artes marciais', () => {
  it('twice: dois ataques na mesma ação (dois tiros gastos, resultado aninhado)', () => {
    const sc = shooter();
    const p = give(sc, { name: 'Pistola', category: 'weapon', weaponClass: 'pistol_medium' });
    foes(sc, 1, '7-12m');
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: p, twice: true });
    sc.roll([9, 1, 1]);
    expect(sc.lastOutcome!.followUp).toBeDefined();
    expect(sc.state.character.inventory.find(i => i.id === p)!.weapon!.loaded).toBe(10);
  });

  it('pistola muito pesada é Cadência 1', () => {
    const sc = shooter();
    const p = give(sc, { name: 'Pistola muito pesada', category: 'weapon', weaponClass: 'pistol_vheavy' });
    foes(sc, 1);
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: p, twice: true });
    expect(sc.last().ok).toBe(false);
  });

  it('emboscada corpo a corpo: DV 9 sem esquiva; os inimigos perdem a próxima ação', () => {
    const sc = shooter();
    const k = give(sc, { name: 'Faca', category: 'weapon', weaponClass: 'melee_light' });
    foes(sc, 2, 'melee');
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: k, ambush: true });
    sc.roll([2, 1]);
    expect(sc.lastOutcome!.check.dv).toBe(9);
    expect(sc.lastOutcome!.attack!.hit).toBe(true);
    expect(sc.state.combat.combatants.every(c => c.status !== 'active' || c.skipNextAttack)).toBe(true);
  });

  it('artes marciais exigem a perícia', () => {
    const sc = shooter();
    foes(sc, 1, 'melee');
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: 'martial_arts' });
    expect(sc.last().ok).toBe(false);
    sc.edit(s => ({ ...s, character: { ...s.character, skills: { ...s.character.skills, martial_arts: 4 } } }));
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: 'martial_arts' });
    expect(sc.last().ok).toBe(true);
  });
});

describe('Granadas', () => {
  it('atinge todos na mesma faixa, rola o dano uma vez e consome a granada', () => {
    const sc = shooter();
    sc.tool('interpreter', 'buy_item', { name: 'Granada de fragmentação', category: 'weapon', quantity: 2 });
    expect(sc.last().ok).toBe(true);
    const g = sc.state.character.inventory.find(i => i.weapon?.weaponClass === 'grenade')!;
    expect(g.quantity).toBe(2);
    expect(sc.state.character.money).toBe(20000 - WEAPON_PRICES.grenade * 2);
    foes(sc, 2, '7-12m');
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: g.id });
    sc.roll([9, 3, 3, 3, 3, 3, 3]);
    const a = sc.lastOutcome!.attack!;
    expect(a.areaHits).toHaveLength(2);
    expect(a.areaHits!.every(h => h.application?.raw === a.damage!.total)).toBe(true);
    expect(sc.state.character.inventory.find(i => i.id === g.id)!.quantity).toBe(1);
  });

  it('granada de luz ofusca (perde o ataque) sem causar dano', () => {
    const sc = shooter();
    sc.tool('interpreter', 'buy_item', { name: 'Granada de luz', category: 'weapon', quantity: 1 });
    const g = sc.state.character.inventory.find(i => i.weapon?.grenade === 'flashbang')!;
    foes(sc, 1, '7-12m');
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: g.id });
    sc.roll([9, 1]);
    const h = sc.lastOutcome!.attack!.areaHits![0];
    expect(h.application).toBeUndefined();
    expect(foe(sc.state).skipNextAttack).toMatch(/ofuscado/);
    expect(sc.state.character.inventory.some(i => i.id === g.id)).toBe(false);
  });
});

describe('Qualidade, trava e não letal', () => {
  it('arma ruim trava num 1 natural; recarregar destrava', () => {
    const sc = shooter();
    const p = give(sc, { name: 'Pistola (ruim)', category: 'weapon', weaponClass: 'pistol_medium' });
    expect(sc.state.character.inventory.find(i => i.id === p)!.weapon!.quality).toBe('poor');
    foes(sc, 1);
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: p });
    sc.roll([1, 1]);
    expect(sc.lastOutcome!.attack!.jammedNow).toBe(true);
    expect(sc.lastOutcome!.check.success).toBe(false);
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: p });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/TRAVADA/);
    sc.edit(s => gameReducer(s, { type: 'reload', weaponId: p }));
    expect(sc.state.character.inventory.find(i => i.id === p)!.weapon!.jammed).toBe(false);
  });

  it('arma excelente dá +1 e custa uma categoria acima', () => {
    const sc = shooter();
    sc.tool('interpreter', 'buy_item', { name: 'Pistola pesada', category: 'weapon', weaponClass: 'pistol_heavy', quality: 'excellent' });
    const w = sc.state.character.inventory.find(i => i.weapon?.weaponClass === 'pistol_heavy')!;
    expect(w.name).toMatch(/excelente/);
    expect(20000 - sc.state.character.money).toBeGreaterThan(WEAPON_PRICES.pistol_heavy);
    foes(sc, 1);
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: w.id });
    sc.roll([5, 1, 1, 1]);
    expect(sc.lastOutcome!.check.modifiers.some(m => m.label === 'Arma excelente' && m.value === 1)).toBe(true);
  });

  it('borracha nunca leva abaixo de 1 PV; choque nocauteia vivo', () => {
    const sc = shooter();
    const p = give(sc, { name: 'Pistola', category: 'weapon', weaponClass: 'pistol_medium', damage: '2d6' }, { nonLethal: 'rubber' });
    foes(sc, 1);
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(c => ({ ...c, hp: { ...c.hp, current: 2 }, sp: { head: 0, body: 0 } })) } }));
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: p });
    sc.roll([9, 6, 6]);
    expect(foe(sc.state).hp.current).toBe(1);
    expect(sc.lastOutcome!.attack!.application!.criticalInjury).toBeUndefined();

    const sc2 = shooter();
    const t = give(sc2, { name: 'Bastão de choque', category: 'weapon', weaponClass: 'melee_medium' });
    expect(sc2.state.character.inventory.find(i => i.id === t)!.weapon!.nonLethal).toBe('stun');
    foes(sc2, 1, 'melee');
    sc2.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(c => ({ ...c, hp: { ...c.hp, current: 1 } })) } }));
    sc2.tool('interpreter', 'attack', { targetId: foe(sc2.state).id, weaponId: t, ambush: true });
    sc2.roll([9, 6, 6]);
    expect(sc2.lastOutcome!.attack!.knockedOut).toBe(true);
    expect(foe(sc2.state).status).toBe('down');
    expect(foe(sc2.state).conditions?.some(c => c.key === 'unconscious')).toBe(true);
  });

  it('munição de borracha: recarregar com ela deixa a arma não letal', () => {
    const sc = shooter();
    const p = give(sc, { name: 'Pistola', category: 'weapon', weaponClass: 'pistol_medium' }, { loaded: 0 });
    sc.tool('interpreter', 'buy_item', { name: 'Munição de borracha 9mm', category: 'ammo', ammoKind: 'M_PISTOL', quantity: 12 });
    sc.edit(s => gameReducer(s, { type: 'reload', weaponId: p }));
    expect(sc.state.character.inventory.find(i => i.id === p)!.weapon!.nonLethal).toBe('rubber');
  });
});

describe('Cobertura com PV', () => {
  it('atirar na cobertura total desconta os PV dela até expor o alvo', () => {
    const sc = shooter();
    const p = give(sc, { name: 'Pistola pesada', category: 'weapon', weaponClass: 'pistol_heavy', damage: '3d6' });
    foes(sc, 1);
    sc.tool('narrator', 'update_combatant', { id: foe(sc.state).id, cover: 'full', coverHp: 5 });
    expect(foe(sc.state).coverHp).toBe(5);
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, weaponId: p });
    expect(sc.last().ok).toBe(true);
    const hpBefore = foe(sc.state).hp.current;
    sc.roll([9, 4, 4, 4]);
    expect(sc.lastOutcome!.attack!.coverDamage).toEqual({ before: 5, after: 0 });
    expect(foe(sc.state).cover).toBe('none');
    expect(foe(sc.state).hp.current).toBe(hpBefore);
  });
});

describe('Encarada', () => {
  it('vencedor impõe −2 ao outro; perdedor recebe −2 contra o vencedor', () => {
    const sc = shooter();
    sc.edit(s => ({ ...s, character: { ...s.character, reputation: 3, stats: { ...s.character.stats, COOL: 8 } } }));
    foes(sc, 1);
    sc.tool('interpreter', 'facedown', { targetId: foe(sc.state).id }, [1, 9]); // NPC 4+0+1 = 5 × jogador 8+3+9
    expect(sc.last().ok).toBe(true);
    expect(sc.last().data).toMatchObject({ won: true });
    expect(foe(sc.state).facedown).toBe('player');
    sc.tool('interpreter', 'facedown', { targetId: foe(sc.state).id });
    expect(sc.last().ok).toBe(false); // uma vez por combate

    const sc2 = shooter();
    foes(sc2, 1);
    sc2.tool('interpreter', 'facedown', { targetId: foe(sc2.state).id }, [10, 1]);
    expect(foe(sc2.state).facedown).toBe('npc');
    const p = give(sc2, { name: 'Pistola', category: 'weapon', weaponClass: 'pistol_medium' });
    sc2.tool('interpreter', 'attack', { targetId: foe(sc2.state).id, weaponId: p });
    sc2.roll([5, 1, 1]);
    expect(sc2.lastOutcome!.check.modifiers.some(m => m.label === 'Perdeu a Encarada' && m.value === -2)).toBe(true);
  });
});

describe('Drogas de rua e vício', () => {
  it('Boost dá +2 INT; falhar no teste vicia; sóbrio vem a abstinência; desintoxicação cura', () => {
    const sc = shooter();
    sc.tool('interpreter', 'buy_item', { name: 'Boost', category: 'consumable', quantity: 2 });
    expect(sc.last().ok).toBe(true);
    const boost = sc.state.character.inventory.find(i => i.streetDrug === 'boost')!;
    expect(20000 - sc.state.character.money).toBe(100);
    sc.tool('interpreter', 'use_item', { itemId: boost.id }, [1]);
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.addictions).toEqual(['boost']);
    expect(sc.state.activeEffects.find(e => e.name === 'Boost')?.penalties).toEqual({ INT: 2 });
    expect(sc.state.activeEffects.some(e => e.name === withdrawalName('boost'))).toBe(false);

    sc.advance(25 * 60);
    expect(sc.state.activeEffects.some(e => e.name === 'Boost')).toBe(false);
    expect(sc.state.activeEffects.find(e => e.name === withdrawalName('boost'))?.penalties).toEqual({ INT: -2 });

    // Nova dose suspende a abstinência (e não testa vício de novo).
    sc.tool('interpreter', 'use_item', { itemId: boost.id }, [1]);
    expect(sc.state.activeEffects.some(e => e.name === withdrawalName('boost'))).toBe(false);

    sc.tool('interpreter', 'therapy', { mode: 'addiction' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.addictions).toEqual([]);
    expect(sc.state.activeEffects.some(e => e.name.startsWith('Abstinência'))).toBe(false);
  });

  it('Black Lace custa Humanidade', () => {
    const sc = shooter();
    sc.tool('interpreter', 'buy_item', { name: 'Black Lace', category: 'consumable', quantity: 1 });
    const before = sc.state.character.humanity.current;
    sc.tool('interpreter', 'use_item', { itemId: sc.state.character.inventory.find(i => i.streetDrug)!.id }, [3, 3, 10]);
    expect(sc.state.character.humanity.current).toBe(before - 6);
  });
});

describe('Perícias do RED', () => {
  it('perícias ×2 custam o dobro de PM', () => {
    expect(getSkill('autofire')?.difficult).toBe(true);
    expect(getSkill('demolitions')?.difficult).toBe(true);
    expect(skillUpgradeCost(3, true)).toBe(120);
    expect(skillUpgradeCost(3)).toBe(60);
    expect(getSkill('handgun')?.difficult).toBeFalsy();
  });
});
