/**
 * Morte sem rolagem: execução de indefesos e catástrofes (bomba, Soulkiller) — sempre com aviso prévio.
 * Caso real: jogador com 15 PV, capturado, arma na cabeça, tiro → a IA narrava a morte mas o motor tirava 3 PV.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { checkNarration } from '../shared/engine/consistency';
import { checkPenalties } from '../shared/engine/health';
import { buildGameContext } from '../shared/engine/context';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';

const NO_TOOLS = { intent: null, tools: [], roll: null, offscreen: [] };

describe('Execução do jogador', () => {
  it('capturado no turno anterior + tiro na cabeça = flatline, com qualquer PV', () => {
    const sc = scenario().atTurn(5).tool('narrator', 'set_condition', { target: 'player', condition: 'restrained', source: 'amarrado pela Maelstrom' });
    expect(sc.state.character.hp.current).toBeGreaterThan(10);
    sc.atTurn(6).tool('narrator', 'execute', { targetId: 'player', cause: 'tiro na nuca à queima-roupa' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.dead).toBe(true);
    expect(sc.state.character.hp.current).toBe(0);
    expect(sc.state.events.at(-1)?.type).toBe('PLAYER_DIED');
  });

  it('sem aviso prévio a execução é recusada (o jogador precisa de um turno para reagir)', () => {
    const sc = scenario().atTurn(5).tool('narrator', 'execute', { targetId: 'player', cause: 'do nada' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.dead).toBe(false);
    // Capturado NESTE turno: ainda não pode.
    sc.tool('narrator', 'set_condition', { target: 'player', condition: 'restrained' }).tool('narrator', 'execute', { targetId: 'player' });
    expect(sc.last().ok).toBe(false);
  });

  it('se ele se soltou, não pode mais ser executado', () => {
    const sc = scenario().atTurn(5).tool('narrator', 'set_condition', { target: 'player', condition: 'restrained' });
    sc.atTurn(6).tool('narrator', 'set_condition', { target: 'player', condition: 'restrained', active: false }).tool('narrator', 'execute', { targetId: 'player' });
    expect(sc.last().ok).toBe(false);
  });

  it('o jogador (intérprete) não pode chamar execute em si mesmo', () => {
    const sc = scenario().atTurn(5).tool('narrator', 'set_condition', { target: 'player', condition: 'restrained' }).atTurn(6);
    sc.tool('interpreter', 'execute', { targetId: 'player' });
    expect(sc.last().ok).toBe(false);
  });

  it('imobilizado não ataca; agarrado leva −2 em tudo', () => {
    const sc = scenario().atTurn(5).tool('narrator', 'set_condition', { target: 'player', condition: 'restrained' });
    sc.tool('interpreter', 'attack', { targetName: 'Capanga' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/imobilizado/);
    const grab = scenario().tool('narrator', 'set_condition', { target: 'player', condition: 'grappled' });
    expect(checkPenalties(grab.state.character, 'DEX')).toContainEqual({ label: 'Agarrado', value: -2 });
  });
});

describe('Catástrofes (bomba, Soulkiller)', () => {
  it('ameaça letal anunciada num turno anterior → morte sem rolagem', () => {
    const sc = scenario().atTurn(3).tool('narrator', 'lethal_threat', { description: 'Soulkiller rastreando sua conexão — desconecte antes que ele te alcance' });
    expect(sc.state.scene.threat).toBe('extreme');
    sc.tool('narrator', 'execute', { targetId: 'player', cause: 'Soulkiller' });
    expect(sc.last().ok).toBe(false); // mesmo turno do anúncio: ainda pode reagir
    sc.atTurn(4).tool('narrator', 'execute', { targetId: 'player', cause: 'a mente foi copiada pelo Soulkiller' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.dead).toBe(true);
  });

  it('escapou (ameaça encerrada) → não morre', () => {
    const sc = scenario().atTurn(3).tool('narrator', 'lethal_threat', { description: 'Bomba nuclear em contagem regressiva' });
    sc.atTurn(4).tool('narrator', 'lethal_threat', { active: false }).tool('narrator', 'execute', { targetId: 'player', cause: 'explosão' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.dead).toBe(false);
  });

  it('o prompt mostra a ameaça e as condições para o narrador', () => {
    const sc = scenario().atTurn(3).tool('narrator', 'lethal_threat', { description: 'Prédio desabando' }).tool('narrator', 'set_condition', { target: 'player', condition: 'grappled' });
    const prompt = buildNarratePrompt(buildGameContext(sc.atTurn(4).state, ''), { kind: 'action', playerInput: 'corro', engineResult: null });
    expect(prompt).toMatch(/AMEAÇA LETAL.*Prédio desabando.*execute/);
    expect(prompt).toMatch(/CONDIÇÕES: Agarrado/);
  });
});

describe('Execução de NPCs pelo jogador', () => {
  const withFoe = () =>
    scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Capanga Maelstrom', hp: 30 }] });

  it('inimigo caído/rendido morre sem rolagem e gasta 1 bala', () => {
    const sc = withFoe();
    const foe = sc.state.combat.combatants[0];
    sc.tool('narrator', 'update_combatant', { id: foe.id, status: 'surrendered' });
    const before = sc.item('item_starter_weapon')!.weapon!.loaded;
    sc.tool('interpreter', 'execute', { targetId: foe.id, cause: 'tiro na cabeça' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.combat.combatants[0].status).toBe('dead');
    expect(sc.item('item_starter_weapon')!.weapon!.loaded).toBe(before - 1);
  });

  it('inimigo de pé não pode ser "executado" (use attack)', () => {
    const sc = withFoe();
    sc.tool('interpreter', 'execute', { targetId: sc.state.combat.combatants[0].id });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.combat.combatants[0].status).toBe('active');
  });

  it('arma descarregada: clique seco, o alvo continua vivo', () => {
    const sc = withFoe();
    const foe = sc.state.combat.combatants[0];
    sc.tool('narrator', 'update_combatant', { id: foe.id, status: 'surrendered' }).edit(s => ({
      ...s,
      character: { ...s.character, inventory: s.character.inventory.map(i => (i.weapon ? { ...i, weapon: { ...i.weapon, loaded: 0 } } : i)) },
    }));
    sc.tool('interpreter', 'execute', { targetId: foe.id });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/clique seco/);
  });

  it('refém amarrado (NPC) pode ser executado e passa a constar como morto', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Refém Arasaka', present: true });
    sc.tool('narrator', 'set_condition', { target: 'Refém Arasaka', condition: 'restrained' });
    sc.tool('interpreter', 'execute', { targetId: 'Refém Arasaka' });
    expect(sc.last().ok).toBe(true);
    expect(sc.npc('Refém Arasaka')?.status).toBe('dead');
  });
});

describe('Narração × motor', () => {
  const npcs = scenario().state.npcs;

  it('narrar a morte do jogador sem o motor matar é reprovado', () => {
    expect(checkNarration(NO_TOOLS, 'O cano encosta na sua têmpora. O estampido. Você morre ali mesmo, no chão frio.', [], npcs)[0]).toMatch(/MORTE do jogador/);
  });

  it('com execute do jogador (ou já morto) passa', () => {
    const text = 'O estampido. Seu corpo tomba sem vida no concreto.';
    expect(checkNarration(NO_TOOLS, text, [], npcs, [{ tool: 'execute', args: { targetId: 'player' } }])).toEqual([]);
    expect(checkNarration(NO_TOOLS, text, [], npcs, [], { playerDead: true })).toEqual([]);
  });

  it('ameaças e quase-mortes não disparam', () => {
    expect(checkNarration(NO_TOOLS, 'Paga até meia-noite ou você morre, choom.', [], npcs)).toEqual([]);
    expect(checkNarration(NO_TOOLS, 'A bala passa a um centímetro. Você quase morre ali.', [], npcs)).toEqual([]);
  });
});
