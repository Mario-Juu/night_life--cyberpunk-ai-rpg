/**
 * Quickhacks do Trilheiro: árvore (PM + rank), RAM do deck, teste de Interface contra a defesa do alvo
 * e efeitos no combate (perder ataque, dano sem armadura, bônus para acertar, dano por rodada).
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { gameReducer } from '../shared/engine/reducer';
import { buildAttackRequest, getPlayerWeapon, resolveEnemyAttack } from '../shared/engine/combat';
import { sequenceRng } from '../shared/engine/dice';
import { quickhackDv, ramMax, unlockBlocker } from '../shared/engine/quickhacks';
import { migrateState } from '../shared/engine/migrate';
import { runEnemyPhase } from '../shared/engine/initiative';
import { QUICKHACK_DV, STARTER_QUICKHACKS } from '../shared/rules/quickhacks';

/** Trilheiro em combate contra um capanga (defesa 8). Interface rank 4: d10 ≥ 5 passa. */
const fight = () => scenario({ role: 'netrunner' }).tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
const foes = (sc: ReturnType<typeof fight>) => sc.state.combat.combatants;
const ram = (sc: ReturnType<typeof fight>) => sc.state.character.deck!.ram!;

describe('Árvore e RAM', () => {
  it('Trilheiro novo já vem com o nível 1 de cada ramo e RAM no deck; outros papéis não', () => {
    const net = scenario({ role: 'netrunner' }).state.character;
    expect(net.quickhacks).toEqual(STARTER_QUICKHACKS);
    expect(net.deck?.ram).toEqual({ current: ramMax(net), max: ramMax(net) });
    expect(scenario().state.character.quickhacks).toBeUndefined();
  });

  it('desbloquear pede o nível anterior, rank de Interface e PM; desconta os PM', () => {
    let s = scenario({ role: 'netrunner' }).state;
    expect(unlockBlocker(s.character, 'sonic_shock')).toMatch(/Reiniciar Ótica antes/);
    expect(unlockBlocker(s.character, 'reboot_optics')).toMatch(/20 PM/);
    s = { ...s, character: { ...s.character, ip: 25 } };
    s = gameReducer(s, { type: 'unlockQuickhack', key: 'reboot_optics' });
    expect(s.character.quickhacks).toContain('reboot_optics');
    expect(s.character.ip).toBe(5);
    s = { ...s, character: { ...s.character, ip: 100 } };
    expect(unlockBlocker(s.character, 'sonic_shock')).toMatch(/rank 6/);
  });

  it('save antigo de Trilheiro ganha os hacks iniciais e a RAM ao carregar', () => {
    const s = scenario({ role: 'netrunner' }).state;
    const old = { ...s, character: { ...s.character, quickhacks: undefined, deck: { ...s.character.deck!, ram: undefined } } };
    const loaded = migrateState(JSON.parse(JSON.stringify(old)));
    expect(loaded.character.quickhacks).toEqual(STARTER_QUICKHACKS);
    expect(loaded.character.deck?.ram?.max).toBeGreaterThan(0);
  });
});

describe('Em combate', () => {
  it('Pane de Arma: passa no teste, o inimigo perde o próximo ataque e a RAM volta na virada da rodada', () => {
    const sc = fight();
    const round = sc.state.combat.round;
    const before = ram(sc).current;
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: foes(sc)[0].id }).roll([9]);
    expect(sc.last().ok).toBe(true);
    expect(foes(sc)[0].skipNextAttack).toBe('arma em pane');
    expect(ram(sc).current).toBe(before - 2);
    sc.edit(s => runEnemyPhase(s, sequenceRng([5])).state);
    expect(sc.state.combat.round).toBe(round + 1);
    expect(ram(sc).current).toBe(before); // +2 na virada
    expect(foes(sc)[0].skipNextAttack).toBeUndefined(); // a vez dele foi consumida
  });

  it('quickhack vira rolagem na tela: pendente até rolar, e a Sorte pode virar o resultado', () => {
    const sc = fight();
    const foe = foes(sc)[0].id;
    const ramBefore = ram(sc).current;
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: foe });
    expect(sc.state.pendingRoll).toMatchObject({ kind: 'quickhack', quickhack: 'weapon_glitch', targetId: foe, dv: QUICKHACK_DV.mook });
    expect(ram(sc).current).toBe(ramBefore); // nada gasto antes do dado
    expect(foes(sc)[0].skipNextAttack).toBeUndefined();
    // Interface 4 + d10 4 = 8: empata com a defesa 8 e falha; com 1 de Sorte, passa.
    const luckBefore = sc.state.character.luck.current;
    sc.roll([4], 1);
    expect(sc.lastOutcome!.check).toMatchObject({ total: 9, success: true, luckSpent: 1 });
    expect(sc.state.character.luck.current).toBe(luckBefore - 1);
    expect(foes(sc)[0].skipNextAttack).toBe('arma em pane');
    expect(sc.state.pendingRoll).toBeNull();
  });

  it('o efeito aplicado é o mesmo que a rolagem mostrou (dano gravado e repetido)', () => {
    const sc = fight();
    const hp = foes(sc)[0].hp.current;
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: foes(sc)[0].id }).roll([9, 2, 5]);
    expect(sc.lastOutcome!.quickhack!.effectRolls).toEqual([2, 5]);
    expect(foes(sc)[0].hp.current).toBe(hp - 7);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/7 de dano direto/);
  });

  it('teste falho: RAM gasta e nada acontece; 1 natural zera a RAM (retroalimentação)', () => {
    const sc = fight();
    sc.tool('interpreter', 'quickhack', { hack: 'weapon_glitch', targetId: foes(sc)[0].id }).roll([3]);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/falhou/);
    expect(foes(sc)[0].skipNextAttack).toBeUndefined();
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: foes(sc)[0].id }).roll([1]);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/retroalimentação/);
    expect(ram(sc).current).toBe(0);
  });

  it('Curto-Circuito ignora armadura', () => {
    const sc = fight();
    const hp = foes(sc)[0].hp.current;
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: foes(sc)[0].id }).roll([9, 6, 6]);
    expect(foes(sc)[0].hp.current).toBe(hp - 12);
  });

  it('Ping marca todos: o ataque do jogador ganha +1 contra eles', () => {
    const sc = fight();
    sc.tool('interpreter', 'quickhack', { hack: 'ping' }, [5]);
    for (const f of foes(sc)) expect(f.hacks?.[0]).toMatchObject({ key: 'ping', hitBonus: 1 });
    const req = buildAttackRequest(sc.state.character, getPlayerWeapon(sc.state.character), foes(sc)[0], {}, 'player');
    expect(req.modifiers).toEqual([{ label: 'Ping', value: 1 }]);
  });

  it('Choque Sônico: −2 nos ataques do alvo', () => {
    let sc = fight();
    sc.edit(s => ({ ...s, character: { ...s.character, roleRank: 6, ip: 200, quickhacks: ['ping', 'reboot_optics', 'sonic_shock', 'weapon_glitch', 'short_circuit'] } }));
    const foe = foes(sc)[0];
    const base = resolveEnemyAttack(sc.state, foe.id, sequenceRng([5, 5, 5]))!.result.attackTotal;
    sc.tool('interpreter', 'quickhack', { hack: 'sonic_shock', targetId: foe.id }).roll([9]);
    expect(resolveEnemyAttack(sc.state, foe.id, sequenceRng([5, 5, 5]))!.result.attackTotal).toBe(base - 2);
  });

  it('Superaquecimento: dano agora e 3 por rodada por 2 rodadas; depois o efeito sai', () => {
    const sc = fight();
    sc.edit(s => ({ ...s, character: { ...s.character, quickhacks: [...STARTER_QUICKHACKS, 'overheat'] } }));
    const foe = foes(sc)[0];
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => (t.id === foe.id ? { ...t, hp: { current: 60, max: 60 } } : t)) } }));
    sc.tool('interpreter', 'quickhack', { hack: 'overheat', targetId: foe.id }).roll([9, 1, 1]);
    expect(foes(sc)[0].hp.current).toBe(60 - 2);
    const phase = () => sc.edit(s => runEnemyPhase(s, sequenceRng([5])).state);
    phase();
    expect(foes(sc)[0].hp.current).toBe(60 - 2 - 3);
    phase();
    expect(foes(sc)[0].hp.current).toBe(60 - 2 - 3 - 3);
    phase();
    expect(foes(sc)[0].hp.current).toBe(60 - 2 - 3 - 3);
    expect(foes(sc)[0].hacks).toEqual([]);
  });

  it('defesa: capanga 8, tenente 11, chefe 14; netrunner +2', () => {
    const t = (template: string, name = 'X') => ({ ...foes(fight())[0], template, name });
    expect(quickhackDv(t('maelstrom_ganger'))).toBe(QUICKHACK_DV.mook);
    expect(quickhackDv({ ...t('x'), template: undefined, name: 'Netrunner da Arasaka' })).toBe(QUICKHACK_DV.unknown + 2);
  });

  it('sem RAM, hack não desbloqueado ou fora de alcance: recusado com motivo', () => {
    const sc = fight();
    sc.edit(s => ({ ...s, character: { ...s.character, deck: { ...s.character.deck!, ram: { current: 1, max: 6 } } } }));
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: foes(sc)[0].id });
    expect(sc.last()).toMatchObject({ ok: false });
    expect(sc.last().summary).toMatch(/RAM insuficiente/);
    sc.tool('interpreter', 'quickhack', { hack: 'system_collapse', targetId: foes(sc)[0].id });
    expect(sc.last().summary).toMatch(/ainda não foi desbloqueado/);
  });
});

describe('Fora de combate', () => {
  it('Ping funciona como reconhecimento; hack de alvo único pede combate', () => {
    const sc = scenario({ role: 'netrunner' });
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(sc.last().summary).toMatch(/revela câmeras/);
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'Rafa' });
    expect(sc.last()).toMatchObject({ ok: false });
  });

  it('Apagar Memória num NPC: ele esquece o que sabia de você', () => {
    const sc = scenario({ role: 'netrunner' }).tool('narrator', 'upsert_npc', { name: 'Kiro', present: true, learnsAboutPlayer: 'O jogador roubou o lote' });
    sc.edit(s => ({ ...s, character: { ...s.character, roleRank: 8, quickhacks: [...STARTER_QUICKHACKS, 'memory_wipe'] } }));
    sc.tool('interpreter', 'quickhack', { hack: 'memory_wipe', targetId: 'Kiro' }).roll([9]);
    expect(sc.lastOutcome!.quickhack!.summary).toMatch(/esquece o encontro/);
    expect(sc.npc('Kiro')?.knowsAboutPlayer).toBeUndefined();
  });

  it('a RAM enche quando o combate acaba', () => {
    const sc = fight();
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: foes(sc)[0].id }).roll([9, 1, 1]);
    expect(ram(sc).current).toBeLessThan(ram(sc).max);
    sc.tool('narrator', 'end_combat', {});
    expect(ram(sc).current).toBe(ram(sc).max);
  });
});
