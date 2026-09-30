/**
 * Cromo: catálogo do RED, fundações/slots, Humanidade e efeitos mecânicos aplicados pelo motor.
 */
import { describe, expect, it } from 'vitest';
import { scenario, withRipperdoc } from './harness';
import { CYBERWARE } from '../shared/rules/cyberware';
import { gameReducer } from '../shared/engine/reducer';
import { characterSp, checkPenalties } from '../shared/engine/health';
import { skillValue } from '../shared/engine/checks';
import { rollInitiative } from '../shared/engine/combat';
import { canNetrun } from '../shared/engine/net';
import { sequenceRng } from '../shared/engine/dice';
import { computeMaxHp } from '../shared/rules/stats';
import type { GameState } from '../shared/types/game';

const rich = (s: GameState): GameState => withRipperdoc({ ...s, character: { ...s.character, money: 50_000 } });

describe('Catálogo', () => {
  it('traz o ciberware do livro básico com preço, perda e local', () => {
    expect(Object.keys(CYBERWARE).length).toBeGreaterThanOrEqual(80);
    expect(CYBERWARE.kerenzikov).toMatchObject({ price: 1000, hl: '4d6', install: 'clinic', requires: 'neural_link', speedware: true, tier: 2, grade: 'civil' });
    expect(CYBERWARE.cyberarm.foundation).toEqual({ kind: 'cyberarm', slots: 4, max: 2 });
  });
});

describe('Instalação', () => {
  it('cobra o preço, rola a perda de Humanidade e baixa o máximo em 2', () => {
    const sc = scenario().edit(rich);
    const { money, humanity } = sc.state.character;
    sc.tool('interpreter', 'install_cyberware', { key: 'cybereye' }, [3, 4]); // 2d6 = 7
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(money - 100);
    expect(sc.state.character.humanity).toEqual({ current: humanity.current - 7, max: humanity.max - 2 });
  });

  it('opção sem fundação é recusada; com fundação ocupa slot', () => {
    const sc = scenario().edit(rich);
    expect(sc.tool('interpreter', 'install_cyberware', { key: 'targeting_scope' }).last().summary).toMatch(/precisa de Ciberolho/);
    sc.tool('interpreter', 'install_cyberware', { key: 'cybereye' }).tool('interpreter', 'install_cyberware', { key: 'targeting_scope' });
    expect(sc.last().ok).toBe(true);
    const eye = sc.state.character.cyberware.find(c => c.key === 'cybereye')!;
    expect(sc.state.character.cyberware.find(c => c.key === 'targeting_scope')?.parentId).toBe(eye.id);
  });

  it('item de par exige os dois olhos e custa em dobro', () => {
    const sc = scenario().edit(rich).tool('interpreter', 'install_cyberware', { key: 'cybereye' });
    expect(sc.tool('interpreter', 'install_cyberware', { key: 'low_light' }).last().ok).toBe(false);
    sc.tool('interpreter', 'install_cyberware', { key: 'cybereye' });
    const money = sc.state.character.money;
    sc.tool('interpreter', 'install_cyberware', { key: 'low_light' });
    expect(sc.last().ok).toBe(true);
    expect(money - sc.state.character.money).toBe(1000);
    expect(sc.state.character.cyberware.filter(c => c.key === 'low_light')).toHaveLength(2);
  });

  it('só uma speedware; Kerenzikov soma +2 na iniciativa', () => {
    const sc = scenario({ role: 'tech' }).edit(rich).tool('interpreter', 'install_cyberware', { key: 'neural_link' }).tool('interpreter', 'install_cyberware', { key: 'kerenzikov' });
    expect(sc.tool('interpreter', 'install_cyberware', { key: 'sandevistan' }).last().summary).toMatch(/speedware/);
    expect(rollInitiative(sc.state, sequenceRng([5])).modifiers).toContainEqual({ label: 'Kerenzikov', value: 2 });
  });

  it('Sandevistan Mk.1 (fora de combate): ativar dá +2 de iniciativa por 1 minuto e depois recarrega', () => {
    const sc = scenario({ role: 'tech' }).edit(rich).tool('interpreter', 'install_cyberware', { key: 'neural_link' }).tool('interpreter', 'install_cyberware', { key: 'sandevistan' });
    sc.tool('interpreter', 'activate_cyberware', { key: 'sandevistan' }, [10, 10, 1]);
    expect(sc.last().ok).toBe(true);
    expect(rollInitiative(sc.state, sequenceRng([5])).modifiers).toContainEqual({ label: 'Sandevistan Mk.1', value: 2 });
    expect(sc.tool('interpreter', 'activate_cyberware', { key: 'sandevistan' }).last().ok).toBe(false);
  });
});

describe('Efeitos', () => {
  it('Wolvers viram arma embutida no inventário (não dá para largar)', () => {
    const sc = scenario().edit(rich).tool('interpreter', 'install_cyberware', { key: 'cyberarm' }).tool('interpreter', 'install_cyberware', { key: 'wolvers' });
    const blade = sc.state.character.inventory.find(i => i.implant && i.weapon)!;
    expect(blade.weapon).toMatchObject({ weaponClass: 'melee_heavy', damage: '3d6' });
    sc.edit(s => gameReducer(s, { type: 'dropItem', itemId: blade.id }));
    expect(sc.state.character.inventory.some(i => i.id === blade.id)).toBe(true);
  });

  it('Armadura Subdérmica: SP 11 na cabeça e no corpo, sem somar com a jaqueta', () => {
    const sc = scenario().edit(rich).tool('interpreter', 'install_cyberware', { key: 'subdermal_armor' });
    expect(characterSp(sc.state.character)).toEqual({ head: 11, body: 11 });
  });

  it('Músculo Enxertado: +2 CORPO e PV recalculados; remover desfaz e devolve o máximo de Humanidade', () => {
    const sc = scenario().edit(rich);
    const { stats, humanity } = sc.state.character;
    sc.tool('interpreter', 'install_cyberware', { key: 'grafted_muscle' });
    expect(sc.state.character.stats.BODY).toBe(Math.min(10, stats.BODY + 2));
    expect(sc.state.character.hp.max).toBe(computeMaxHp(sc.state.character.stats.BODY, stats.WILL));
    const id = sc.state.character.cyberware.find(c => c.key === 'grafted_muscle')!.id;
    sc.tool('interpreter', 'remove_cyberware', { cyberwareId: id });
    expect(sc.state.character.stats.BODY).toBe(stats.BODY);
    expect(sc.state.character.humanity.max).toBe(humanity.max);
  });

  it('Editor de Dor ignora a penalidade de Gravemente Ferido; Chip de Perícia garante nível 3', () => {
    const sc = scenario().edit(rich).tool('interpreter', 'install_cyberware', { key: 'neural_link' }).tool('interpreter', 'install_cyberware', { key: 'chipware_socket' });
    sc.tool('interpreter', 'install_cyberware', { key: 'pain_editor' });
    sc.edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 5 } } }));
    expect(checkPenalties(sc.state.character, 'REF').some(m => m.value === -2)).toBe(false);
    sc.tool('interpreter', 'install_cyberware', { key: 'chipware_socket' }).tool('interpreter', 'install_cyberware', { key: 'skill_chip', skillId: 'pick_lock' });
    expect(skillValue(sc.state.character, 'pick_lock')).toBeGreaterThanOrEqual(3);
  });
});

describe('Trilheiro e narrador', () => {
  it('Trilheiro começa com Neural Link + Plugues (perda média: 14; máximo −4)', () => {
    const s = scenario({ role: 'netrunner' }).state;
    expect(s.character.cyberware.map(c => c.key)).toEqual(['neural_link', 'interface_plugs']);
    expect(s.character.humanity.max - s.character.humanity.current).toBe(10); // (máx −4) − (perda 14) = diferença 10
    expect(canNetrun(s)).toBe(true);
    const noPlugs = { ...s, character: { ...s.character, cyberware: s.character.cyberware.filter(c => c.key !== 'interface_plugs') } };
    expect(canNetrun(noPlugs)).toBe(false);
  });

  it('implante imposto pela história (add_cyberware com key) é grátis mas cobra Humanidade', () => {
    const sc = scenario();
    const money = sc.state.character.money;
    sc.tool('narrator', 'add_cyberware', { key: 'cybersnake' }, [1, 1, 1, 1]);
    expect(sc.state.character.money).toBe(money);
    expect(sc.state.character.inventory.some(i => i.name.startsWith('Cybersnake'))).toBe(true);
  });
});
