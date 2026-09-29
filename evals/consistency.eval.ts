/**
 * Evals de consistência do RPG (motor real, sem LLM).
 * Cada caso descreve uma garantia que o jogo precisa manter para sempre.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { validateSave } from '../src/services/saves';
import { checkNarration } from '../shared/engine/consistency';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import { memoriesFromEvents } from '../shared/engine/memory';

describe('TEST 001 — arma sem munição', () => {
  it('ataque falha, munição continua 0 e a narração não pode afirmar disparo', () => {
    const sc = scenario().edit(s => ({
      ...s,
      character: { ...s.character, inventory: s.character.inventory.map(i => (i.weapon ? { ...i, weapon: { ...i.weapon, loaded: 0 } } : i)) },
    }));
    sc.tool('interpreter', 'attack', { targetName: 'Segurança' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.pendingRoll).toBeNull();
    expect(sc.item('item_starter_weapon')?.weapon?.loaded).toBe(0);

    const result = { intent: null, tools: [{ tool: 'attack', ok: false, summary: sc.last().summary }], roll: null, offscreen: [] };
    expect(checkNarration(result, 'Você dispara duas vezes e a bala atravessa o colete.', [], sc.state.npcs)).not.toHaveLength(0);
    expect(checkNarration(result, 'Clique seco. O tambor está vazio.', [], sc.state.npcs)).toHaveLength(0);
  });
});

describe('TEST 002 — NPC morto continua morto', () => {
  it('morte no turno 20 persiste no turno 50 e bloqueia interações incompatíveis', () => {
    const sc = scenario().atTurn(20).tool('narrator', 'npc_status', { npcId: 'npc_rafa', status: 'dead', reason: 'baleado pela Militech' });
    expect(sc.last().ok).toBe(true);
    sc.atTurn(50).advance(600);

    expect(sc.npc('npc_rafa')?.status).toBe('dead');
    expect(sc.state.flags.npc_rafa_alive?.value).toBe(false);
    for (const [origin, tool, args] of [
      ['interpreter', 'speak', { npcId: 'npc_rafa' }],
      ['interpreter', 'persuade', { dv: 13, reason: 'x', targetNpcId: 'npc_rafa' }],
      ['narrator', 'send_message', { npcId: 'npc_rafa', text: 'oi' }],
      ['narrator', 'modify_relationship', { npcId: 'npc_rafa', trust: 5 }],
      ['narrator', 'npc_status', { npcId: 'npc_rafa', status: 'alive' }],
    ] as const) {
      sc.tool(origin, tool, args);
      expect(sc.last().ok, tool).toBe(false);
    }
    // O agendamento "Rafa insiste" foi cancelado com a morte.
    expect(sc.state.phone.find(t => t.npcId === 'npc_rafa')?.messages).toHaveLength(1);
    // Narrador que faz o morto falar é pego pelo verificador.
    expect(checkNarration(null, '[DIALOGUE: Rafa]\nVoltei, choom.\n[/DIALOGUE]', [], sc.state.npcs)[0]).toMatch(/MORTO/);
  });
});

describe('TEST 003 — segredo não vira conhecimento do jogador', () => {
  it('segredo do NPC aparece só como segredo no contexto do Mestre', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Dex', role: 'Canal', knowledge: 'Dex vai trair o jogador na entrega', secret: true });
    const ctx = sc.context('Dex');
    expect(ctx.playerKnowledge.join(' ')).not.toMatch(/trair/);
    const prompt = buildNarratePrompt(ctx, { kind: 'action', playerInput: 'falo com o Dex', engineResult: null }, false);
    expect(prompt).toMatch(/SEGREDOS \(o jogador NÃO sabe\): Dex vai trair/);
    expect(prompt.split('O jogador sabe:')[1].split('\n')[0]).not.toMatch(/trair/);
  });
});

describe('TEST 004 — economia', () => {
  it('100 eddies, compra item de 80 → saldo 20', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 100 } }));
    sc.tool('interpreter', 'buy_item', { name: 'Armadura de couro', category: 'armor', armorSP: 4, price: 80 });
    // Tabela do motor: SP 4 custa 20 → o LLM não define o preço quando há referência.
    expect(sc.state.character.money).toBe(80);
    sc.tool('interpreter', 'buy_item', { name: 'Chip de dados raro', category: 'datashard', price: 80 });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(0);
    sc.tool('interpreter', 'buy_item', { name: 'Chip caro', category: 'datashard', price: 80 });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(0);
  });

  it('compra livre de 80 com 100 no bolso deixa 20', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 100 } }));
    sc.tool('interpreter', 'buy_item', { name: 'Holo-mapa de Heywood', category: 'gear', price: 80 });
    expect(sc.state.character.money).toBe(20);
    expect(sc.item('Holo-mapa de Heywood')).toBeDefined();
  });

  it('o narrador não inventa dinheiro sem limite nem sem origem', () => {
    const sc = scenario();
    const before = sc.state.character.money;
    sc.tool('narrator', 'transfer_money', { amount: 50000, counterpart: 'Rafa', reason: 'bônus' });
    expect(sc.state.character.money).toBe(before + 1000);
    sc.tool('narrator', 'transfer_money', { amount: 300, reason: 'x' });
    expect(sc.last().ok).toBe(false);
  });
});

describe('TEST 005 — relacionamento persiste e influencia', () => {
  it('aumento de confiança fica salvo e modifica testes futuros', () => {
    const sc = scenario().tool('narrator', 'modify_relationship', { npcId: 'npc_rafa', trust: 25, reason: 'cumpriu a entrega' });
    sc.tool('narrator', 'modify_relationship', { npcId: 'npc_rafa', trust: 25 });
    expect(sc.reload().npc('npc_rafa')?.trust).toBe(60);
    sc.tool('interpreter', 'persuade', { dv: 15, reason: 'pedir adiantamento', targetNpcId: 'npc_rafa' });
    expect(sc.state.pendingRoll?.modifiers?.some(m => m.value === 2)).toBe(true);
  });
});

describe('TEST 006 — recarregar a campanha', () => {
  it('estado recarregado é idêntico e continua válido', () => {
    const sc = scenario()
      .tool('narrator', 'start_quest', { title: 'Entrega', objective: 'Levar o pacote', rewardEddies: 600 })
      .tool('narrator', 'set_flag', { key: 'militech_package_stolen', value: true })
      .tool('narrator', 'schedule_event', { inMinutes: 30, description: 'Militech detecta movimentação', kind: 'set_flag', flag: 'militech_alerted' });
    const before = JSON.stringify(sc.state);
    const restored = validateSave(JSON.parse(before));
    expect(restored).toEqual(JSON.parse(before));
    sc.state = restored;
    sc.advance(40);
    expect(sc.state.flags.militech_alerted?.value).toBe(true);
  });
});

describe('Consistência adicional', () => {
  it('combatente abatido não volta a lutar; corpo só é revistado uma vez', () => {
    const sc = scenario()
      .tool('narrator', 'start_combat', { combatants: [{ id: 'foe_guard', name: 'Guarda', hp: 5, sp: 0, weaponClass: 'pistol_medium', distance: '0-6m' }] })
      .tool('interpreter', 'attack', { targetId: 'foe_guard' })
      .roll([9, 6, 5]);
    expect(sc.state.combat.combatants[0].status).toBe('down');
    sc.tool('narrator', 'update_combatant', { id: 'foe_guard', status: 'active' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'end_combat', {}).tool('narrator', 'loot', { combatantId: 'foe_guard' }, [3, 2]);
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'loot', { combatantId: 'foe_guard' });
    expect(sc.last().ok).toBe(false);
  });

  it('flags alimentam a dificuldade (guarda em alerta dificulta furtividade)', () => {
    const sc = scenario().tool('narrator', 'set_flag', { key: 'guard_alerted', value: true });
    sc.tool('interpreter', 'skill_check', { skillId: 'stealth', dv: 15, reason: 'passar pelo guarda' });
    expect(sc.state.pendingRoll?.modifiers).toContainEqual({ label: 'Guardas em alerta', value: -2 });
  });

  it('eventos importantes geram memórias automáticas', () => {
    const sc = scenario().tool('narrator', 'start_quest', { title: 'Resgate', objective: 'Achar a Lu' });
    const { created, state } = memoriesFromEvents(sc.state, sc.state.events);
    expect(created.length).toBe(1);
    expect(state.memories.at(-1)).toMatchObject({ type: 'CAMPAIGN_MEMORY', importance: 6 });
  });

  it('eventos têm ids rastreáveis por turno', () => {
    const sc = scenario().atTurn(7).tool('narrator', 'modify_heat', { delta: 1 }).tool('narrator', 'modify_heat', { delta: 1 });
    const heat = sc.state.events.filter(e => e.type === 'HEAT_CHANGED');
    expect(heat.map(e => e.id)).toEqual([`${sc.state.id}:main:t7:e0`, `${sc.state.id}:main:t7:e1`]);
  });
});

describe('DV é segredo do Mestre', () => {
  it('narração que revela o DV é reprovada; ficção sem números passa', () => {
    const npcs = scenario().state.npcs;
    expect(checkNarration(null, 'Você precisava de DV 15 e tirou 12.', [], npcs)[0]).toMatch(/segredo/);
    expect(checkNarration(null, 'A dificuldade de 17 era alta demais.', [], npcs)[0]).toMatch(/segredo/);
    expect(checkNarration(null, 'O guarda te encara, desconfiado, e nega com a cabeça.', [], npcs)).toEqual([]);
  });

  it('eventos visíveis ao jogador não trazem o DV no texto', () => {
    const sc = scenario().tool('interpreter', 'persuade', { dv: 21, reason: 'Convencer o guarda' }).roll([5]);
    const ev = sc.state.events.find(e => e.type === 'CHECK_RESOLVED')!;
    expect(ev.summary).not.toMatch(/21/);
    expect(ev.data).toMatchObject({ dv: 21 });
  });
});

describe('Dinheiro só se move pelo motor', () => {
  const NARRATION =
    'Com os dedos ágeis sobre a interface tátil, você seleciona a quitação prioritária e autoriza a transferência de €$600 para o aluguel em atraso.';

  it('pagamento pedido pelo jogador desconta do saldo e anota na missão', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 1100 } }));
    sc.tool('interpreter', 'pay_money', { amount: 600, recipient: 'Administradora do bloco', reason: 'aluguel atrasado', questId: 'm_rent' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(500);
    expect(sc.state.missions.find(m => m.id === 'm_rent')?.notes.at(-1)).toMatch(/Pagou €\$600/);
    expect(sc.state.events.some(e => e.type === 'MONEY_CHANGED' && e.value === -600)).toBe(true);
  });

  it('sem saldo, o pagamento falha e nada é descontado', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 100 } }));
    sc.tool('interpreter', 'pay_money', { amount: 600, recipient: 'Administradora', reason: 'aluguel' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(100);
  });

  it('narração que descreve pagamento sem registro do motor é reprovada', () => {
    const npcs = scenario().state.npcs;
    const noTools = { intent: null, tools: [], roll: null, offscreen: [] };
    expect(checkNarration(noTools, NARRATION, [], npcs)[0]).toMatch(/NÃO registrou nenhum pagamento/);
    const failedPay = { ...noTools, tools: [{ tool: 'pay_money', ok: false, summary: 'Saldo insuficiente' }] };
    expect(checkNarration(failedPay, NARRATION, [], npcs)).not.toHaveLength(0);
    const paid = { ...noTools, tools: [{ tool: 'pay_money', ok: true, summary: 'Pagou €$600' }] };
    expect(checkNarration(paid, NARRATION, [], npcs)).toEqual([]);
    // Cobrança imposta pela cena, feita pelo narrador com ferramenta, também é válida.
    expect(checkNarration(noTools, NARRATION, [], npcs, [{ tool: 'transfer_money', args: { amount: -600 } }])).toEqual([]);
    // Menção a dinheiro sem o jogador pagar não dispara.
    expect(checkNarration(noTools, 'O Rafa oferece €$600 pelo corre.', [], npcs)).toEqual([]);
  });
});
