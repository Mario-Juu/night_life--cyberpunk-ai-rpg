/**
 * Habilidades de Papel (Cyberpunk RED): rank, alocações e efeitos aplicados pelo motor.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { gameReducer } from '../shared/engine/reducer';
import { resolveEnemyAttack, resolvePlayerAttack } from '../shared/engine/combat';
import { resolveCheck } from '../shared/engine/checks';
import { sequenceRng } from '../shared/engine/dice';
import { SKILLS } from '../shared/rules/skills';
import { VEHICLE_ITEM_ID } from '../shared/engine/roles';
import { buildGameContext } from '../shared/engine/context';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import { startChase } from '../shared/engine/citySystems';
import type { GameState, RoleData } from '../shared/types/game';

const withRole = (s: GameState, roleData: RoleData): GameState => ({ ...s, character: { ...s.character, roleData } });
const withIp = (s: GameState, ip: number): GameState => ({ ...s, character: { ...s.character, ip } });

describe('Rank de papel', () => {
  it('todo personagem começa com rank 4; Interface não é mais perícia', () => {
    for (const role of ['solo', 'netrunner', 'tech', 'medtech', 'fixer', 'nomad'] as const) {
      expect(scenario({ role }).state.character.roleRank).toBe(4);
    }
    expect(SKILLS.some(s => s.id === 'interface')).toBe(false);
    expect(scenario({ role: 'netrunner' }).state.character.deck?.slots).toBe(7);
    expect(scenario({ role: 'nomad' }).item(VEHICLE_ITEM_ID)).toBeDefined();
  });

  it('subir de rank custa 60 × o novo rank em PM', () => {
    const sc = scenario().edit(s => withIp(s, 299));
    sc.edit(s => gameReducer(s, { type: 'improveRole' }));
    expect(sc.state.character.roleRank).toBe(4);
    sc.edit(s => gameReducer(withIp(s, 300), { type: 'improveRole' }));
    expect(sc.state.character.roleRank).toBe(5);
    expect(sc.state.character.ip).toBe(0);
  });
});

describe('Solo — Consciência de Combate', () => {
  it('alocação respeita passos; em combate a redistribuição é uma Ação atômica', () => {
    const sc = scenario({ role: 'solo' }).edit(s => withRole(s, {}));
    sc.edit(s => gameReducer(s, { type: 'allocateRole', section: 'combatAwareness', key: 'precision', delta: 1 }));
    expect(sc.state.character.roleData.combatAwareness?.precision).toBe(3); // passo de 3
    sc.edit(s => gameReducer(s, { type: 'allocateRole', section: 'combatAwareness', key: 'deflection', delta: 1 }));
    expect(sc.state.character.roleData.combatAwareness?.deflection).toBeUndefined(); // só 1 livre, passo 2
    sc.edit(s => gameReducer(s, { type: 'allocateRole', section: 'combatAwareness', key: 'initiative', delta: 1 }));
    expect(sc.state.character.roleData.combatAwareness?.initiative).toBe(1);
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger' }] });
    sc.tool('player', 'reconfigure_awareness', { deflection: 2, initiative: 1, spotWeakness: 1 });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.roleData.combatAwareness).toMatchObject({ deflection: 2, initiative: 1, spotWeakness: 1 });
  });

  it('Ataque Preciso soma no ataque; Recuperação de Falha anula o 1 natural', () => {
    const sc = scenario({ role: 'solo' }).tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger', distance: '0-6m' }] });
    const foe = sc.state.combat.combatants[0];
    const req = { id: 'a', kind: 'attack' as const, origin: 'player' as const, reason: 'tiro', stat: 'REF' as const, skillId: 'handgun', dv: 13, modifier: 0, targetId: foe.id, weaponId: 'item_starter_weapon' };
    const precise = resolvePlayerAttack(withRole(sc.state, { combatAwareness: { precision: 3 } }), req, 0, sequenceRng([5, 3, 3, 3]));
    expect(precise.check.modifiers).toContainEqual({ label: 'Ataque Preciso', value: 1 });
    const fumble = resolvePlayerAttack(withRole(sc.state, { combatAwareness: { fumbleRecovery: 4 } }), req, 0, sequenceRng([1, 9]));
    expect(fumble.check.d10.fumble).toBe(false);
    expect(fumble.check.d10.total).toBe(1);
  });

  it('Desvio de Dano reduz só o primeiro dano da rodada', () => {
    const sc = scenario({ role: 'solo' })
      .tool('narrator', 'start_combat', { combatants: [{ name: 'Atirador', weaponClass: 'pistol_medium', damage: '2d6', attackBase: 20, distance: '0-6m' }] })
      .edit(s => withRole(s, { combatAwareness: { deflection: 4 } })); // −2
    const foe = sc.state.combat.combatants[0].id;
    const first = resolveEnemyAttack(sc.state, foe, sequenceRng([5, 6, 5]))!; // 2d6 = 11 − SP 7 = 4 → 2
    expect(first.result.deflected).toBe(2);
    expect(first.result.application?.hpDamage).toBe(2);
    sc.edit(s => gameReducer(s, { type: 'enemyAttack', result: first.result }));
    const second = resolveEnemyAttack(sc.state, foe, sequenceRng([5, 6, 5]))!;
    expect(second.result.deflected).toBeUndefined();
    expect(second.result.application?.hpDamage).toBe(5); // 11 − SP 6 (a jaqueta sofreu ablação no 1º tiro)
  });

  it('Detecção de Ameaça soma em Percepção', () => {
    const c = withRole(scenario({ role: 'solo' }).state, { combatAwareness: { threatDetection: 3 } }).character;
    const r = resolveCheck(c, { stat: 'INT', skillId: 'perception', dv: 13 }, sequenceRng([5]));
    expect(r.modifiers).toContainEqual({ label: 'Detecção de Ameaça', value: 3 });
  });
});

describe('Técnico — Fabricante', () => {
  it('Especialista de Campo soma nas perícias técnicas', () => {
    const c = scenario({ role: 'tech' }).state.character;
    expect(resolveCheck(c, { stat: 'TECH', skillId: 'basic_tech', dv: 13 }, sequenceRng([5])).modifiers).toContainEqual({ label: 'Especialista de Campo', value: 4 });
  });

  it('fabricar cobra materiais (categoria abaixo), passa o tempo e entrega o item', () => {
    const sc = scenario({ role: 'tech' });
    const money = sc.state.character.money;
    sc.tool('interpreter', 'craft', { mode: 'fabricate', name: 'Colete de Kevlar', category: 'armor', armorSP: 7, armorSlot: 'body' }, [9]);
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(money - 20); // Kevlar €$50 (Custoso) → materiais Cotidiano €$20
    expect(sc.item('Colete de Kevlar')?.armor?.sp).toBe(7);
    expect(sc.state.chat.some(e => e.kind === 'roll')).toBe(true);
  });

  it('aprimorar uma arma dá +1 para acertar, uma vez por item', () => {
    const sc = scenario({ role: 'tech' }).tool('interpreter', 'craft', { mode: 'upgrade', itemId: 'item_starter_weapon' }, [9]);
    expect(sc.item('item_starter_weapon')?.upgrade).toBeTruthy();
    sc.tool('interpreter', 'craft', { mode: 'upgrade', itemId: 'item_starter_weapon' }, [9]);
    expect(sc.last().ok).toBe(false);
  });

  it('quem não é Técnico não usa craft', () => {
    expect(scenario({ role: 'solo' }).tool('interpreter', 'craft', { mode: 'fabricate', name: 'X', category: 'gear' }).last().ok).toBe(false);
  });
});

describe('Medicânico — Medicina', () => {
  it('fabrica 2 doses de Speedheal (DV13 de Tecnologia Médica, €$100) e a droga cura CORPO + VONTADE uma vez por dia', () => {
    const sc = scenario({ role: 'medtech' }).edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 5 } } }));
    const money = sc.state.character.money;
    sc.tool('interpreter', 'brew_drug', { drug: 'speedheal' }, [9]);
    expect(sc.last().ok).toBe(true);
    const dose = sc.item('Speedheal')!;
    expect(dose.drug).toBe('speedheal');
    expect(dose.quantity).toBe(2);
    expect(sc.state.character.money).toBe(money - 100);
    sc.tool('interpreter', 'use_item', { itemId: dose.id });
    const { BODY, WILL } = sc.state.character.stats;
    expect(sc.state.character.hp.current).toBe(Math.min(sc.state.character.hp.max, 5 + BODY + WILL));
    if (sc.item('Speedheal')) {
      sc.tool('interpreter', 'use_item', { itemId: sc.item('Speedheal')!.id });
      expect(sc.last().ok).toBe(false);
    }
  });

  it('droga não liberada é recusada; remendo suspende as penalidades do ferimento', () => {
    const sc = scenario({ role: 'medtech' });
    expect(sc.tool('interpreter', 'brew_drug', { drug: 'surge' }).last().ok).toBe(false);
    sc.tool('narrator', 'add_injury', { key: 'broken_ribs', location: 'body' });
    const inj = sc.state.character.criticalInjuries[0];
    sc.tool('interpreter', 'treat_injury', { injuryId: inj.id, method: 'quick_fix' }, [9]);
    expect(sc.state.character.criticalInjuries[0].quickFixed).toBe(true);
    sc.tool('interpreter', 'treat_injury', { injuryId: inj.id, method: 'treatment' }, [9]);
    expect(sc.state.character.criticalInjuries).toHaveLength(0);
  });

  it('Criossistemas estabiliza a 0 PV, suspende o Teste de Morte e expira em uma semana', () => {
    const sc = scenario({ role: 'medtech' }).edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 0 }, stabilized: false } }));
    sc.tool('player', 'cryo_stasis');
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.cryoStasis).toBeDefined();
    expect(sc.state.character.stabilized).toBe(true);
    sc.advance(7 * 24 * 60 + 1);
    expect(sc.state.character.cryoStasis).toBeUndefined();
    expect(sc.state.character.conditions?.some(c => c.key === 'unconscious')).toBe(false);
  });
});

describe('Canal — Operador e Nômade — Moto', () => {
  it('Canal só recebe Pechincha após vencer a disputa; compra de 5+ iguais rende uma unidade', () => {
    const sc = scenario({ role: 'fixer' });
    const money = sc.state.character.money;
    sc.tool('narrator', 'propose_trade', { seller: 'Vendedor', merchantType: 'weapons', catalogKey: 'ammo_H_PISTOL', quantity: 10 });
    const offerId = sc.state.world.tradeOffer!.id;
    sc.tool('player', 'haggle_trade', { offerId }, [10]);
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.tradeOffer?.item.quantity).toBe(11);
    sc.tool('player', 'settle_trade', { offerId });
    expect(money - sc.state.character.money).toBe(9); // preço de tabela 10 − 10%
    expect(sc.last().summary).toMatch(/11× /);
  });

  it('Canal negocia o pagamento uma vez e a missão paga exatamente o valor negociado', () => {
    const sc = scenario({ role: 'fixer' }).edit(s => ({ ...s, character: { ...s.character, roleRank: 5 } }));
    sc.tool('narrator', 'start_quest', { id: 'm_job', title: 'Entrega', objective: 'Entregar o pacote', rewardEddies: 500 });
    sc.tool('player', 'haggle_quest', { questId: 'm_job' }, [10]);
    expect(sc.last().ok).toBe(true);
    const money = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(sc.state.character.money - money).toBe(550);
  });

  it('Nômade soma o rank em Condução', () => {
    const c = scenario({ role: 'nomad' }).state.character;
    expect(resolveCheck(c, { stat: 'REF', skillId: 'drive', dv: 13 }, sequenceRng([5])).modifiers).toContainEqual({ label: 'Moto', value: 4 });
  });

  it('Nômade escolhe melhorias da Moto e o chassi pesado fortalece a perseguição', () => {
    let state = scenario({ role: 'nomad' }).state;
    state = gameReducer(state, { type: 'toggleNomadUpgrade', key: 'heavy_chassis' });
    expect(state.character.nomadUpgrades).toContain('heavy_chassis');
    expect(state.character.inventory.find(i => i.id === 'item_family_vehicle')?.name).toMatch(/Chassi pesado/);
    state = startChase(state, { opponent: 'Interceptor', reason: 'teste', vehicleIntegrity: 4, opponentIntegrity: 4 });
    expect(state.world.chase?.vehicleIntegrity).toBe(6);
  });
});

describe('Contexto do Mestre', () => {
  it('a ficha mostra a Habilidade de Papel', () => {
    const sc = scenario({ role: 'solo' });
    const prompt = buildNarratePrompt(buildGameContext(sc.state, ''), { kind: 'action', playerInput: 'olho em volta', engineResult: null });
    expect(prompt).toMatch(/HABILIDADE DE PAPEL: Consciência de Combate rank 4/);
  });

  it('expõe daemons plantados para a narração seguinte', () => {
    const sc = scenario({ role: 'netrunner' }).edit(s => ({
      ...s,
      world: {
        ...s.world,
        daemons: [{ name: 'Imp', directive: 'atacar intrusos', alert: 0, controlledNodes: ['porta'], owner: 'player', architectureId: 'net_test', architectureName: 'Cofre', accessPoint: 'terminal', plantedTurn: 1 }],
      },
    }));
    const prompt = buildNarratePrompt(buildGameContext(sc.state, ''), { kind: 'action', playerInput: 'saio do local', engineResult: null });
    expect(prompt).toMatch(/DAEMONS PLANTADOS PELO JOGADOR: Imp em Cofre/);
  });
});
