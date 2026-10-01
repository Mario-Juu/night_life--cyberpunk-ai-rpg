/**
 * Regressões da rodada de QA de 2026-10-01 (docs/RELATORIO-TESTES-2026-10-01.md, lotes 6 e 7):
 * cada teste reproduz o caminho infeliz que o relatório achou e confere a correção.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { askAlly, members, withPartyInCombat } from '../shared/engine/party';
import { betweenCombatants } from '../shared/engine/combat';
import { contractions } from '../shared/engine/fronts';
import { sequenceRng } from '../shared/engine/dice';
import { REGISTRY } from '../shared/engine/tools';
import { runToolCalls } from '../shared/engine/tools/registry';
import { setCondition } from '../shared/engine/conditions';
import { humanityAfter } from '../shared/rules/stats';
import { amountsIn, checkNarration, claimedBalances } from '../shared/engine/consistency';
import type { GameState } from '../shared/types/game';

const withJax = () =>
  scenario()
    .tool('narrator', 'upsert_npc', { name: 'Jax', role: 'Solo de aluguel', present: true })
    .tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 20, template: 'bodyguard' });
const fight = () => withJax().tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
const ally = (s: GameState) => s.combat.combatants.find(t => t.side === 'ally')!;
const foe = (s: GameState) => s.combat.combatants.find(t => t.side !== 'ally')!;

describe('Aliado não é alvo (CMB-03, CMB-05, CMB-17)', () => {
  it('atacar um membro da equipe fora de combate não cria um inimigo duplicado', () => {
    const sc = withJax().tool('interpreter', 'attack', { targetId: 'Jax' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.combat.combatants).toEqual([]);
  });

  it('execução, saque e agarrão recusam o aliado', () => {
    const sc = fight().edit(withPartyInCombat);
    const id = ally(sc.state).id;
    expect(sc.tool('interpreter', 'execute', { targetId: id }).last().ok).toBe(false);
    expect(sc.tool('interpreter', 'loot', { combatantId: id }).last().ok).toBe(false);
    expect(sc.tool('interpreter', 'grapple', { targetId: id }).last().ok).toBe(false);
  });

  it('o narrador não derruba nem mata aliado por update_combatant', () => {
    const sc = fight().edit(withPartyInCombat);
    const id = ally(sc.state).id;
    sc.tool('narrator', 'update_combatant', { id, status: 'dead' });
    expect(sc.last().ok).toBe(false);
    expect(ally(sc.state).status).toBe('active');
  });
});

describe('Equipe (CMB-14, ENG-7, ENG-9)', () => {
  it('quem recuou volta à luta quando o jogador pede outra coisa', () => {
    const s0 = withPartyInCombat(fight().state);
    const id = members(s0)[0].npcId;
    const out = askAlly(s0, id, { stance: 'retreat' }, sequenceRng([1]));
    if (!('state' in out)) throw new Error(out.error);
    expect(ally(out.state).status).toBe('fled');
    const back = askAlly(out.state, id, { stance: 'aggressive' }, sequenceRng([1]));
    if (!('state' in back)) throw new Error(back.error);
    expect(ally(back.state).status).toBe('active');
  });

  it('dispensar e recrutar de novo na mesma luta traz o aliado de volta', () => {
    const sc = fight().edit(withPartyInCombat);
    sc.tool('narrator', 'dismiss_npc', { npcId: 'Jax' });
    sc.tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 20 });
    const s = withPartyInCombat(sc.state);
    expect(s.combat.combatants.filter(t => t.side === 'ally').map(t => t.status)).toEqual(['active']);
  });

  it('focus sem alvo válido é recusado; com alvo, vale mesmo antes de o aliado entrar na luta', () => {
    // O aliado ainda não virou combatente (chegou à cena depois de a luta começar).
    const s0 = fight().state;
    const s: GameState = { ...s0, combat: { ...s0.combat, combatants: s0.combat.combatants.filter(t => t.side !== 'ally') } };
    const id = members(s)[0].npcId;
    expect(askAlly(s, id, { stance: 'focus', targetId: 'ninguem' }, sequenceRng([1]))).toHaveProperty('error');
    const ok = askAlly(s, id, { stance: 'focus', targetId: foe(s).id }, sequenceRng([1]));
    if (!('state' in ok)) throw new Error(ok.error);
    expect(ally(withPartyInCombat(ok.state)).focusId).toBe(foe(s).id);
  });

  it('membro da equipe não vira animal', () => {
    const sc = withJax().tool('narrator', 'upsert_npc', { name: 'Jax', kind: 'animal' });
    expect(sc.last().ok).toBe(false);
    expect(sc.npc('Jax')!.kind).not.toBe('animal');
  });
});

describe('Regras de combate (CMB-07, CMB-10, CMB-11, CMB-13)', () => {
  it('agarrão solta quando o agarrado cai', () => {
    const sc = fight();
    const [a, b] = sc.state.combat.combatants.filter(t => t.side !== 'ally');
    sc.edit(s => ({
      ...s,
      character: { ...s.character, grappling: a.id },
      combat: { ...s.combat, combatants: s.combat.combatants.map(t => (t.id === a.id ? { ...t, status: 'down' as const, hp: { ...t.hp, current: 0 } } : t)) },
    }));
    sc.tool('interpreter', 'grapple', { targetId: b.id });
    expect(sc.last().summary).not.toMatch(/já está agarrando/);
  });

  it('emboscada que erra não deixa ninguém desprevenido', () => {
    const sc = fight();
    sc.tool('interpreter', 'attack', { targetId: foe(sc.state).id, ambush: true });
    sc.roll([1]); // erra
    expect(sc.state.combat.combatants.some(t => t.skipNextAttack === 'pego de surpresa')).toBe(false);
  });

  it('uma Ação por turno em combate: o segundo ataque/quickhack da mesma frase é recusado', () => {
    const s = fight().state;
    const res = runToolCalls(
      REGISTRY,
      s,
      [
        { tool: 'reload', args: {} },
        { tool: 'grapple', args: { targetId: foe(s).id } },
      ],
      { rng: sequenceRng([5]), origin: 'interpreter' },
    );
    const okCalls = res.records.filter(r => r.ok && ['reload', 'grapple'].includes(r.tool));
    expect(okCalls.length).toBeLessThanOrEqual(1);
    expect(res.records.some(r => r.error === 'ação já usada' || !r.ok)).toBe(true);
  });

  it('aliado e inimigo trocam tiros na maior das duas distâncias', () => {
    expect(betweenCombatants({ distance: '0-6m' }, { distance: '26-50m' })).toBe('26-50m');
    expect(betweenCombatants({ distance: '13-25m' }, { distance: 'melee' })).toBe('13-25m');
  });
});

describe('Quickhacks (CMB-12, CMB-16, ENG-5)', () => {
  const runner = () => scenario({ role: 'netrunner' }).tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });

  it('jogador inconsciente não hackeia', () => {
    const sc = runner().edit(s => ({ ...s, character: { ...s.character, conditions: setCondition(s.character.conditions, 'unconscious', true, s.turn) } }));
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: foe(sc.state).id }, [9]);
    expect(sc.last().ok).toBe(false);
  });

  it('alvo inexistente não cai no primeiro inimigo', () => {
    const sc = runner();
    const ram = sc.state.character.deck!.ram;
    sc.tool('interpreter', 'quickhack', { hack: 'short_circuit', targetId: 'fantasma' }, [9]);
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.deck!.ram).toEqual(ram);
  });
});

describe('Ficha e mundo (ENG-3, ENG-4, ENG-8, ENG-10, ENG-11)', () => {
  it('Humanidade atual nunca passa do novo máximo', () => {
    expect(humanityAfter({ current: 60, max: 60 }, 1, 2)).toEqual({ current: 58, max: 58 });
    expect(humanityAfter({ current: 60, max: 60 }, 0, 0)).toEqual({ current: 60, max: 60 });
    const sc = scenario().tool('narrator', 'add_cyberware', { name: 'Chip estranho', category: 'Neuralware', humanityLoss: 1 });
    expect(sc.state.character.humanity.current).toBeLessThanOrEqual(sc.state.character.humanity.max);
  });

  it('armadura implantada não sai por equip_item', () => {
    const sc = scenario().edit(s => ({
      ...s,
      character: {
        ...s.character,
        inventory: [...s.character.inventory, { id: 'item_skin', name: 'Pele Blindada (corpo)', category: 'armor', quantity: 1, description: '', equipped: true, value: 0, implant: 'cw_x', armor: { slot: 'body', sp: 7, maxSp: 7 } }],
      },
    }));
    sc.tool('interpreter', 'equip_item', { itemId: 'item_skin', equipped: false });
    expect(sc.last().ok).toBe(false);
    expect(sc.item('item_skin')!.equipped).toBe(true);
  });

  it('NPC desaparecido não volta para a cena por update_scene', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Vik', role: 'Ripper', present: true });
    const id = sc.state.npcs.find(n => n.name === 'Vik')!.id;
    sc.tool('narrator', 'npc_status', { npcId: id, status: 'missing' });
    expect(sc.state.scene.presentNpcIds).not.toContain(id);
    sc.tool('narrator', 'update_scene', { presentNpcIds: id });
    expect(sc.state.scene.presentNpcIds).not.toContain(id);
  });

  it('frentes: preposição + artigo viram contração', () => {
    expect(contractions('Negócios em o mercado noturno, perto de a central de despacho')).toBe('Negócios no mercado noturno, perto da central de despacho');
    expect(contractions('Em a calada da noite')).toBe('Na calada da noite');
    expect(contractions('Sem o chefe')).toBe('Sem o chefe');
  });

  it('ferramentas que não fazem nada não dizem que fizeram', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Kiro', present: true });
    expect(sc.tool('narrator', 'npc_profile', { npcId: 'Kiro' }).last().ok).toBe(false);
    expect(sc.tool('narrator', 'transfer_money', { amount: 0, counterpart: 'Kiro' }).last().ok).toBe(false);
  });
});

describe('Verificador de consistência: ataque do jogador × fase dos inimigos', () => {
  const miss = { tools: [], offscreen: [], intent: null, roll: { attack: { hit: false, targetName: 'Ganger' } } } as unknown as Parameters<typeof checkNarration>[0];
  const hit = { tools: [], offscreen: [], intent: null, roll: { attack: { hit: true, targetName: 'Ganger' } } } as unknown as Parameters<typeof checkNarration>[0];

  it('o inimigo acertar você não contradiz o seu tiro errado (e vice-versa)', () => {
    expect(checkNarration(miss, 'Seu tiro passa longe e estoura o neon. O ganger acerta você no ombro.', [], [])).toEqual([]);
    // Sem nenhuma palavra de erro: só o acerto do inimigo, que não é sobre o seu tiro.
    expect(checkNarration(miss, 'O neon estoura atrás dele. O ganger acerta você no ombro.', [], [])).toEqual([]);
    expect(checkNarration(hit, 'Você acerta o ganger no peito. Ele revida, mas você se esquiva e a bala erra.', [], [])).toEqual([]);
  });

  it('continua pegando a contradição de verdade', () => {
    expect(checkNarration(miss, 'Você dispara e acerta o ganger em cheio.', [], [])).toHaveLength(1);
    expect(checkNarration(hit, 'Você atira e erra feio.', [], [])).toHaveLength(1);
  });
});

describe('Verificador de consistência: falsos positivos do corpus (§4)', () => {
  const none = { tools: [], offscreen: [], intent: null, roll: null } as unknown as Parameters<typeof checkNarration>[0];
  const dead = (name: string) => ({ id: 'npc_x', name, role: '', description: '', trust: 0, respect: 0, fear: 0, anger: 0, knowledge: [], status: 'dead' as const, isContact: false });

  it('NPC morto: só o nome inteiro conta', () => {
    expect(checkNarration(none, '[DIALOGUE: Mariana] Oi.', [], [dead('Ana')])).toEqual([]);
    expect(checkNarration(none, '[DIALOGUE: Jaxon] Oi.', [], [dead('Jax')])).toEqual([]);
    expect(checkNarration(none, '[DIALOGUE: Ana] Oi.', [], [dead('Ana')])).toHaveLength(1);
  });

  it('dinheiro: "1,1 mil" e "1 100" são 1100; saldo da noite e conta de outro não são saldo', () => {
    expect(amountsIn('1,1 mil')).toEqual([1100]);
    expect(amountsIn('€$1 100')).toEqual([1100]);
    expect(claimedBalances('O saldo da noite foi de três mortos.')).toEqual([]);
    expect(claimedBalances('Caem 500 eddies na conta de Rafa.')).toEqual([]);
    expect(claimedBalances('Seu saldo fica em €$1,1 mil.')).toEqual([[1100]]);
  });

  it('pagamento: futuro, negação e NPC pagando não são o jogador pagando', () => {
    for (const t of ['Você vai pagar €$200 amanhã.', 'Você não paga os €$200.', 'O barman pagou a rodada de 30 eddies.', 'Se você pagar €$100, ele fala.'])
      expect(checkNarration(none, t, [], [])).toEqual([]);
    expect(checkNarration(none, 'Você transfere €$200 para o fixer.', [], [])).toHaveLength(1);
  });

  it('morte do jogador: expressões e falas não contam', () => {
    for (const t of ['Você morre de rir da piada.', 'O ICE ameaça dar flatline em quem chegar perto.', '“Você morreu, choom”, rosna o ganger.'])
      expect(checkNarration(none, t, [], [])).toEqual([]);
    expect(checkNarration(none, 'Você morre ali mesmo, no asfalto.', [], [])).toHaveLength(1);
  });
});
