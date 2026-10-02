/**
 * Fichas prontas + combate sem duplicatas, briga avançada, ciberpsicose e Sandbox.
 */
import { describe, expect, it } from 'vitest';
import { scenario, withRipperdoc } from './harness';
import { gameReducer } from '../shared/engine/reducer';
import { resolveEnemyAttack } from '../shared/engine/combat';
import { checkPenalties } from '../shared/engine/health';
import { applyNarration, beginTurn } from '../shared/engine/turn';
import { rollD10, seededRng, sequenceRng } from '../shared/engine/dice';
import { NPC_TEMPLATES } from '../shared/rules/npcTemplates';
import { CYBERPSYCHO_ACTIONS, humanityBand, isCyberpsycho } from '../shared/rules/humanity';
import { applySandboxRole, createSandboxState, sbx } from '../shared/engine/sandbox';
import { buildGameContext } from '../shared/engine/context';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import type { NarrateResponse } from '../shared/types/gm';

const narr = (over: Partial<NarrateResponse> = {}): NarrateResponse => ({ narration: 'x', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [], ...over });

describe('Fichas prontas e combate sem duplicatas', () => {
  it('template aplica a ficha oficial inteira; count cria um grupo numerado', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger da Maelstrom', template: 'maelstrom_ganger', count: 3, hp: 999 }] });
    const foes = sc.state.combat.combatants;
    expect(foes.map(f => f.name)).toEqual(['Ganger da Maelstrom 1', 'Ganger da Maelstrom 2', 'Ganger da Maelstrom 3']);
    const t = NPC_TEMPLATES.maelstrom_ganger;
    expect(foes[0]).toMatchObject({ hp: { current: t.hp, max: t.hp }, sp: t.sp, attackBase: t.weapons[0].base, evasionBase: t.skills.evasion, template: 'maelstrom_ganger' });
    expect(foes[0].hp.max).not.toBe(999); // a ficha manda
  });

  it('grupo repetido pelo narrador (ex.: ao ativar o Sandevistan) NÃO cria mais gente', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger da Maelstrom', template: 'maelstrom_ganger', count: 2 }] });
    expect(sc.state.combat.combatants.map(c => c.name)).toEqual(['Ganger da Maelstrom 1', 'Ganger da Maelstrom 2']);
    sc.tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger da Maelstrom', template: 'maelstrom_ganger' }] });
    expect(sc.state.combat.combatants).toHaveLength(2);
    expect(sc.last().summary).toMatch(/não duplicados/);
  });

  it('reforço: count com o total desejado só acrescenta quem falta; nome novo é outro grupo', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger da Maelstrom', template: 'maelstrom_ganger', count: 2 }] });
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger da Maelstrom', template: 'maelstrom_ganger', count: 4 }] });
    expect(sc.state.combat.combatants.map(c => c.name)).toEqual(['Ganger da Maelstrom 1', 'Ganger da Maelstrom 2', 'Ganger da Maelstrom 3', 'Ganger da Maelstrom 4']);
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Reforço da Maelstrom', template: 'maelstrom_ganger' }] });
    expect(sc.state.combat.combatants).toHaveLength(5);
  });

  it('lista com ficha pronta sem nome (como o modelo real mandou): o nome vem da ficha', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 3 }] });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.combat.combatants).toHaveLength(3);
    expect(sc.state.combat.combatants.every(c => c.template === 'maelstrom_ganger')).toBe(true);
  });

  it('narrador repetindo start_combat NÃO duplica quem já está na luta', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Segurança', template: 'security_operative' }] });
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Segurança', template: 'security_operative', distance: '0-6m' }] });
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'segurança' }] });
    expect(sc.state.combat.combatants).toHaveLength(1);
    expect(sc.state.combat.combatants[0].distance).toBe('0-6m');
    expect(sc.last().summary).toMatch(/não duplicados/);
  });

  it('attack por apelido acha o combatente existente em vez de criar outro', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger da Maelstrom', template: 'maelstrom_ganger', distance: '0-6m' }] });
    sc.tool('interpreter', 'attack', { targetName: 'ganger' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.combat.combatants).toHaveLength(1);
  });

  it('NPC único sem ficha completa é avisado e completado com a ficha oficial mais básica', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Rook, o Chefe', hp: 45 }] });
    expect(sc.state.combat.combatants[0].hp.max).toBe(45);
    expect(sc.state.combat.combatants[0].attackBase).toBe(NPC_TEMPLATES.boosterganger.weapons[0].base);
    expect(sc.last().summary).toMatch(/Ficha incompleta/);
  });
});

describe('Briga (Cyberpunk RED)', () => {
  const fight = () => scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Capanga', template: 'boosterganger', distance: 'melee' }] });

  it('agarrar: teste resistido; ambos com −2; estrangular causa CORPO direto nos PV', () => {
    const sc = fight();
    const foe = sc.state.combat.combatants[0];
    sc.tool('interpreter', 'grapple', { action: 'grab', targetId: foe.id }, [1, 1, 9]); // defesa 9+1 = 10 × você DEX+Briga+9
    expect(sc.state.character.grappling).toBe(foe.id);
    expect(checkPenalties(sc.state.character, 'DEX')).toContainEqual({ label: 'Agarrando alguém', value: -2 });
    expect(sc.state.combat.combatants[0].conditions?.some(c => c.key === 'grappled')).toBe(true);
    const hp = sc.state.combat.combatants[0].hp.current;
    sc.tool('interpreter', 'grapple', { action: 'choke', targetId: foe.id });
    expect(sc.state.combat.combatants[0].hp.current).toBe(hp - sc.state.character.stats.BODY);
  });

  it('3 rodadas estrangulado = apaga; quem ia a 0 fica com 1 PV e desacordado', () => {
    const sc = fight();
    const id = sc.state.combat.combatants[0].id;
    sc.edit(s => ({ ...s, character: { ...s.character, grappling: id }, combat: { ...s.combat, combatants: s.combat.combatants.map(c => ({ ...c, hp: { ...c.hp, current: 3 }, conditions: [{ key: 'grappled', sinceTurn: 0 }] })) } }));
    sc.tool('interpreter', 'grapple', { action: 'choke', targetId: id });
    const foe = sc.state.combat.combatants[0];
    expect(foe.hp.current).toBe(1);
    expect(foe.status).toBe('down');
    expect(foe.conditions?.some(c => c.key === 'unconscious')).toBe(true);
    expect(sc.state.character.grappling).toBeUndefined();
  });

  it('arremessar encerra o agarrão e deixa o alvo caído', () => {
    const sc = fight();
    const id = sc.state.combat.combatants[0].id;
    sc.edit(s => ({ ...s, character: { ...s.character, grappling: id } }));
    sc.tool('interpreter', 'grapple', { action: 'throw', targetId: id });
    expect(sc.state.character.grappling).toBeUndefined();
    expect(sc.state.combat.combatants[0].conditions?.some(c => c.key === 'prone')).toBe(true);
  });

  it('escudo humano: o tiro inimigo acerta o agarrado, não você', () => {
    const sc = scenario()
      .tool('narrator', 'start_combat', { combatants: [{ name: 'Refém', template: 'boosterganger', distance: 'melee' }, { name: 'Atirador', template: 'security_operative', distance: '0-6m' }] });
    const [shield, shooter] = sc.state.combat.combatants;
    sc.edit(s => ({ ...s, character: { ...s.character, grappling: shield.id, humanShield: { id: shield.id } } }));
    const hp = sc.state.character.hp.current;
    const res = resolveEnemyAttack(sc.state, shooter.id, sequenceRng([9, 6, 6, 6, 6, 6]))!;
    expect(res.result.hit).toBe(true);
    expect(res.result.shield?.id).toBe(shield.id);
    sc.edit(s => gameReducer(s, { type: 'enemyAttack', result: res.result }));
    expect(sc.state.character.hp.current).toBe(hp);
    expect(sc.state.combat.combatants[0].hp.current).toBeLessThan(shield.hp.max);
  });

  it('inimigo agarrado ataca com −2', () => {
    const sc = fight().edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(c => ({ ...c, conditions: [{ key: 'grappled' as const, sinceTurn: 0 }] })) } }));
    const res = resolveEnemyAttack(sc.state, sc.state.combat.combatants[0].id, sequenceRng([5, 5]))!;
    expect(res.result.attackTotal).toBe(NPC_TEMPLATES.boosterganger.weapons[0].base + 5 - 2);
  });
});

describe('Humanidade e ciberpsicose', () => {
  it('faixas: estável → dissociação → desgaste → à beira → ciberpsicose', () => {
    const at = (h: number) => humanityBand({ humanity: { current: h, max: 60 }, dead: false }).band;
    expect([at(60), at(30), at(15), at(5), at(0)]).toEqual(['stable', 'detached', 'fraying', 'edge', 'cyberpsycho']);
  });

  it('chegar a 0 anuncia a ciberpsicose; implantes baixam o máximo (2, Borgware 4)', () => {
    const sc = scenario();
    const max = sc.state.character.humanity.max;
    sc.tool('narrator', 'add_cyberware', { name: 'Ciberbraço', category: 'Membro Cibernético', humanityLoss: 7 });
    expect(sc.state.character.humanity.max).toBe(max - 2);
    for (let i = 0; i < 8 && !isCyberpsycho(sc.state.character); i++) sc.tool('narrator', 'modify_humanity', { delta: -10 });
    expect(isCyberpsycho(sc.state.character)).toBe(true);
    expect(sc.state.events.some(e => e.type === 'CYBERPSYCHOSIS')).toBe(true);
  });

  it('em ciberpsicose o jogador nunca fica sem impulsos para escolher', () => {
    const sc = scenario().edit(s => sbx.humanity(s, 0));
    const step = applyNarration(beginTurn(sc.state, 'ATACAR quem estiver mais perto'), narr({ suggestedActions: [] }));
    expect(step.state.suggestedActions).toEqual(CYBERPSYCHO_ACTIONS);
  });

  it('terapia recupera 2d6 (€$500) sem passar do máximo; recusada em ciberpsicose', () => {
    const sc = scenario().edit(s => sbx.humanity(s, 20));
    const money = sc.state.character.money;
    sc.tool('interpreter', 'therapy', { mode: 'standard' }, [4, 5]);
    expect(sc.state.character.humanity.current).toBe(29);
    expect(sc.state.character.money).toBe(money - 500);
    expect(scenario().edit(s => sbx.humanity(s, 0)).tool('interpreter', 'therapy', { mode: 'standard' }).last().ok).toBe(false);
  });

  it('o narrador recebe a instrução da faixa de Humanidade', () => {
    const sc = scenario().edit(s => sbx.humanity(s, 5));
    const prompt = buildNarratePrompt(buildGameContext(sc.state, ''), { kind: 'action', playerInput: 'olho', engineResult: null });
    expect(prompt).toMatch(/HUMANIDADE 5\/\d+ — À beira/);
  });
});

describe('Sandbox', () => {
  it('personagem de testes: atributos 10, perícias 10, rank 10, arsenal completo', () => {
    const s = createSandboxState('netrunner');
    expect(s.sandbox).toBe(true);
    expect(Object.values(s.character.stats).every(v => v === 10)).toBe(true);
    expect(Object.values(s.character.skills).every(v => v === 10)).toBe(true);
    expect(s.character.roleRank).toBe(10);
    expect(s.character.deck?.quality).toBe('excellent');
    expect(s.character.inventory.filter(i => i.weapon).length).toBeGreaterThanOrEqual(10);
    expect(s.chat.some(e => e.kind === 'narration')).toBe(true); // sem prólogo da IA
  });

  it('trocar papel/rank mantém alocações de Papel válidas, inclusive Técnico de rank baixo', () => {
    const tech = applySandboxRole(createSandboxState(), 'tech', 1);
    expect(Object.values(tech.character.roleData.maker ?? {}).reduce((n, v) => n + v, 0)).toBe(2);
    expect(Object.values(tech.character.roleData.maker ?? {}).every(v => v >= 0 && v <= 1)).toBe(true);
    const med = sbx.rank(applySandboxRole(createSandboxState(), 'medtech', 4), 1);
    expect(Object.values(med.character.roleData.medicine ?? {}).reduce((n, v) => n + v, 0)).toBe(1);
  });

  it('d10 forçado pela seed (reproduzível)', () => {
    expect(rollD10(seededRng('force:10:abc')).crit).toBe(true);
    expect(rollD10(seededRng('force:1:abc')).fumble).toBe(true);
    expect(rollD10(seededRng('force:7:abc')).total).toBe(7);
  });

  it('o prompt avisa o Mestre do modo Sandbox', () => {
    const s = createSandboxState();
    expect(buildNarratePrompt(buildGameContext(s, ''), { kind: 'action', playerInput: 'spawna 3 gangers', engineResult: null })).toMatch(/MODO SANDBOX/);
  });
});

describe('IA fora do formato', () => {
  it('genérico sem ficha é reconhecido pelo nome; {ficha: quantidade} vira grupo', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Policial da NCPD' }] });
    expect(sc.state.combat.combatants[0].template).toBe('ncpd_officer');
    const sc2 = scenario().tool('narrator', 'start_combat', { combatants: { maelstrom_ganger: 2 } });
    expect(sc2.state.combat.combatants.map(c => c.template)).toEqual(['maelstrom_ganger', 'maelstrom_ganger']);
  });

  it('alvo em parâmetro com nome trocado (targetNpcId) não se perde', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Capanga', template: 'boosterganger', distance: 'melee' }] });
    sc.tool('interpreter', 'grapple', { action: 'grab', targetNpcId: sc.state.combat.combatants[0].id }, [1, 1, 9]);
    expect(sc.last().ok).toBe(true);
  });
});

describe('Ação de Movimento (MOVE × 2 m)', () => {
  it('lâmina contra alvo a 0–6 m: avança e golpeia no mesmo turno', () => {
    const sc = scenario().edit(s => withRipperdoc({ ...s, character: { ...s.character, money: 5000 } }))
      .tool('interpreter', 'install_cyberware', { key: 'cyberarm' })
      .tool('interpreter', 'install_cyberware', { key: 'popup_melee' })
      .tool('narrator', 'start_combat', { combatants: [{ name: 'Policial da NCPD', template: 'ncpd_officer', distance: '0-6m' }] });
    const blade = sc.state.character.inventory.find(i => i.implant && i.weapon)!;
    sc.tool('interpreter', 'attack', { targetId: sc.state.combat.combatants[0].id, weaponId: blade.id }).roll([9, 5, 5, 5, 5]);
    expect(sc.lastOutcome?.attack?.failure).toBeUndefined();
    expect(sc.lastOutcome?.attack?.closedIn).toBe(true);
    expect(sc.state.combat.combatants[0].distance).toBe('melee');
  });

  it('alvo longe demais para um turno: approach encurta a distância', () => {
    const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Atirador', template: 'sniper', distance: '26-50m' }] });
    const id = sc.state.combat.combatants[0].id;
    sc.tool('interpreter', 'approach', { targetId: id });
    expect(sc.last().ok).toBe(true);
    expect(['0-6m', '7-12m', '13-25m']).toContain(sc.state.combat.combatants[0].distance);
  });
});
