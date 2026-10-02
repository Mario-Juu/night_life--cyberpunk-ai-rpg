/**
 * Fidelidade às regras do Cyberpunk RED (livro básico).
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { computeDamage, checkPenalties, deathSavePenalty } from '../shared/engine/health';
import { unarmedDamage, armorPenalty, rangedDv } from '../shared/rules/weapons';
import { resolveRoll } from '../shared/engine/rolls';
import { resolvePlayerAttack } from '../shared/engine/combat';
import { sequenceRng } from '../shared/engine/dice';

describe('Cyberpunk RED — armas brancas e desarmado', () => {
  it('arma branca ignora metade da SP (arredondada para cima)', () => {
    // SP 7: ignora 4, sobra 3 → 10 de dano = 7 no alvo
    expect(computeDamage({ raw: 10, sp: 7, location: 'body', halfArmor: true, critical: false })).toMatchObject({ effectiveSp: 3, hpDamage: 7 });
    expect(computeDamage({ raw: 10, sp: 11, location: 'body', halfArmor: true, critical: false }).effectiveSp).toBe(5);
  });

  it('dano desarmado depende do BODY e não perfura armadura', () => {
    expect([unarmedDamage(4), unarmedDamage(6), unarmedDamage(7), unarmedDamage(11)]).toEqual(['1d6', '2d6', '3d6', '4d6']);
    const sc = scenario() // BODY 7
      .tool('narrator', 'start_combat', { combatants: [{ id: 'foe_x', name: 'Bandido', hp: 30, sp: 7, weaponClass: 'melee_light', distance: 'melee', evasionBase: 2 }] });
    const req = { id: 'r', kind: 'attack' as const, origin: 'player' as const, reason: 'soco', stat: 'DEX' as const, skillId: 'brawling', dv: 0, modifier: 0, targetId: 'foe_x', weaponId: 'unarmed' };
    // evasão do alvo: 2 + d10(1→implode 1 = 0) ; ataque: DEX 7 + Briga 4 + 9 ; dano 3d6 = 4+4+4 = 12 − SP 7 = 5
    const o = resolvePlayerAttack(sc.state, req, 0, sequenceRng([1, 1, 9, 4, 4, 4]));
    expect(o.attack?.damage?.notation).toBe('3d6');
    expect(o.attack?.application?.hpDamage).toBe(5);
  });
});

describe('Cyberpunk RED — Teste de Morte', () => {
  it('cada Ferimento Crítico soma +1 à penalidade', () => {
    const sc = scenario().tool('narrator', 'add_injury', { key: 'broken_arm' }).tool('narrator', 'add_injury', { key: 'concussion' });
    sc.edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 0 }, deathSavePenalty: 1 } }));
    expect(deathSavePenalty(sc.state.character)).toBe(3);
    // BODY 7: rolar 5 + 3 = 8 > 7 → falha
    const o = resolveRoll(sc.state, { id: 'd', kind: 'deathSave', origin: 'gm', reason: 'morte', stat: 'BODY', skillId: null, dv: 7, modifier: 0 }, 0, sequenceRng([5]));
    expect(o.deathSave?.success).toBe(false);
    expect(o.check.total).toBe(8);
  });
});

describe('Cyberpunk RED — armadura pesada', () => {
  it('SP 12+ dá −2 em REF/DEX/MOVE; SP 15+ dá −4; leve não penaliza', () => {
    expect([armorPenalty(7), armorPenalty(11), armorPenalty(12), armorPenalty(13), armorPenalty(15), armorPenalty(18)]).toEqual([0, 0, -2, -2, -4, -4]);
    const sc = scenario().tool('narrator', 'give_item', { name: 'Armorjack médio', category: 'armor', catalogKey: 'armor_12_body' });
    const jacket = sc.item('Armorjack médio')!;
    sc.tool('interpreter', 'equip_item', { itemId: jacket.id, equipped: true });
    expect(checkPenalties(sc.state.character, 'REF')).toContainEqual({ label: 'Armadura pesada', value: -2 });
    expect(checkPenalties(sc.state.character, 'INT')).toEqual([]);
  });
});

describe('Cyberpunk RED — tabela de alcance', () => {
  it('DVs conferem com o livro', () => {
    expect(['0-6m', '7-12m', '13-25m', '26-50m', '51-100m'].map(d => rangedDv('pistol_medium', d as never))).toEqual([13, 15, 20, 25, 30]);
    expect(['0-6m', '7-12m', '13-25m', '26-50m', '51-100m'].map(d => rangedDv('assault_rifle', d as never))).toEqual([17, 16, 15, 13, 15]);
    expect(['0-6m', '7-12m', '13-25m', '26-50m', '51-100m'].map(d => rangedDv('sniper_rifle', d as never))).toEqual([30, 25, 25, 20, 15]);
  });
});
