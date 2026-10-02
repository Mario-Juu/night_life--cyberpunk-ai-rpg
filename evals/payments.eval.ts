/**
 * Duplicações que o narrador causava: pagamento do trabalho (missão + transferência), item comprado
 * e entregue de novo, e implante virando item comum (usado sem cirurgia).
 */
import { describe, expect, it } from 'vitest';
import { scenario, withRipperdoc } from './harness';
import { migrateState } from '../shared/engine/migrate';
import { amountsIn, checkNarration } from '../shared/engine/consistency';
import { isSevereWarning } from '../server/gamemaster/gameMaster';

const withJob = () => {
  const sc = scenario().tool('narrator', 'start_quest', { id: 'm_entrega', title: 'Entrega Noturna em Heywood', objective: 'Levar a carga', rewardEddies: 600, giverId: 'npc_rafa' });
  return sc.atTurn(sc.state.turn + 1);
};
const next = (sc: ReturnType<typeof withJob>) => sc.atTurn(sc.state.turn + 1);

describe('Recompensa de missão × transferência do narrador', () => {
  it('conclui a missão e transfere o mesmo pagamento no mesmo turno: a transferência é recusada', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa "Zero-Um"', reason: 'Pagamento pelo corre de entrega' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/não permitida/);
    expect(sc.state.character.money).toBe(before + 600);
  });

  it('conclui num turno e o narrador "paga" no turno seguinte: também é recusado', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    next(sc).tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa', reason: 'pagamento do corre' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(before + 600);
  });

  it('transfere num turno e conclui a missão depois: a recompensa só completa o que faltar', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa', reason: 'pagamento do corre' });
    next(next(sc)).tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(before + 600);
  });

  it('adiantamento parcial do contratante: a recompensa paga só o restante', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'transfer_money', { amount: 200, counterpart: 'Rafa', reason: 'adiantamento' });
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    expect(sc.state.character.money).toBe(before + 600);
  });

  it('crédito narrativo de outra pessoa também é bloqueado; só contratos liquidam recompensas', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.tool('narrator', 'transfer_money', { amount: 50, counterpart: 'Gorjeta do cliente', reason: 'gorjeta' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(before + 600);
  });

  it('novo crédito do contratante continua exigindo uma nova missão, mesmo fora da janela antiga', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.atTurn(sc.state.turn + 5).tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa', reason: 'outro trabalho' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(before + 600);
  });
});

describe('Item comprado e entregue de novo pelo narrador (log do T43)', () => {
  it('buy_item + give_item do mesmo item no mesmo turno: entra UMA vez', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 5000 } }));
    sc.tool('player', 'buy_item', { name: 'Kit Médico', category: 'consumable', quantity: 1 });
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'give_item', { name: 'Kit médico de trauma', category: 'consumable', catalogKey: 'biocurativo', source: 'vendedor' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/duplicado/);
    expect(sc.state.character.inventory.filter(i => /kit m[eé]dico/i.test(i.name)).reduce((n, i) => n + i.quantity, 0)).toBe(1);
  });

  it('um item diferente entregue no mesmo turno continua valendo', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 5000 } }));
    sc.tool('player', 'buy_item', { name: 'Kit Médico', category: 'consumable', quantity: 1 });
    sc.tool('narrator', 'give_item', { name: 'Cartão de visita do Doc', category: 'gear', source: 'Doc' });
    expect(sc.last().ok).toBe(true);
  });
});

describe('Implante não é item comum', () => {
  it('a loja não vende Sandevistan/Braços Gorila como mercadoria (manda instalar com um ripperdoc)', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 50_000 } }));
    sc.tool('player', 'buy_item', { name: 'Sandevistan', category: 'gear' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/install_cyberware/);
    sc.tool('player', 'buy_item', { name: 'Braços Gorila', category: 'weapon' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(50_000);
  });

  it('na clínica do ripperdoc, nomes inventados de cromo ("Kit Neural", "Amplificador de Áudio") também não viram compra de balcão', () => {
    const sc = scenario().edit(s => withRipperdoc({ ...s, character: { ...s.character, money: 5000 } }, 3, true));
    sc.tool('player', 'buy_item', { name: 'Kit Neural', category: 'gear', price: 500 });
    expect(sc.last().ok).toBe(false);
    sc.tool('player', 'buy_item', { name: 'Amplificador de Áudio', category: 'gear', price: 500 });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(5000);
    // Fora de clínica, um "kit de ferramentas" continua sendo item comum.
    const shop = scenario().edit(s => ({ ...s, character: { ...s.character, money: 5000 } }));
    shop.tool('player', 'buy_item', { name: 'Kit de ferramentas', category: 'gear' });
    expect(shop.last().ok).toBe(true);
  });

  it('implante entregue pela cena vira PEÇA SOLTA (não é arma usável)', () => {
    const sc = scenario();
    sc.tool('narrator', 'give_item', { name: 'Lâminas Louva-a-deus', category: 'weapon', source: 'caixa roubada' });
    const item = sc.state.character.inventory.find(i => /louva/i.test(i.name))!;
    expect(item.weapon).toBeUndefined();
    expect(item.cyberKey).toBe('popup_melee');
    expect(sc.state.character.cyberware).toHaveLength(0);
  });

  it('saves antigos: implante que tinha virado arma comum é convertido em peça solta ao carregar', () => {
    const sc = scenario();
    const bad = JSON.parse(JSON.stringify(sc.state));
    bad.character.inventory.push({ id: 'item_x', name: 'Lâminas Louva-a-deus', category: 'weapon', quantity: 1, description: '', weapon: { weaponClass: 'melee_light', damage: '1d6', magSize: null, loaded: 0, ammo: null } });
    const fixed = migrateState(bad).character.inventory.find(i => i.id === 'item_x')!;
    expect(fixed.weapon).toBeUndefined();
    expect(fixed.cyberKey).toBe('popup_melee');
  });
});

describe('Saldo citado na narração × saldo do motor (relato do T95)', () => {
  const KIRO =
    'O visor vibra e exibe a transferência eletrônica imediata no valor de quatro mil e quinhentos eddies despachada direto da conta codificada de Kiro para o seu terminal.\n\nCom metade da sua dívida urgente quitada com o dinheiro fresco na conta, você vê o saldo subir para quatro mil quinhentos e dez eddies, restando ainda correr atrás do restante antes da meia-noite.';
  const kiroTransfer = { tool: 'transfer_money', args: { amount: 4500, counterpart: 'Kiro', reason: 'investimento' } };

  it('lê valores por extenso e em dígitos', () => {
    expect(amountsIn('quatro mil quinhentos e dez eddies')).toEqual([4510]);
    expect(amountsIn('quatro mil e quinhentos')).toEqual([4500]);
    expect(amountsIn('€$4.510 e depois 1010 eddies')).toEqual([4510, 1010]);
    expect(amountsIn('uns 4 mil')).toEqual([]);
    expect(amountsIn('um pagamento de seiscentos')).toEqual([600]);
  });

  it('entrada acima do teto: pede reescrita (o motor só creditaria €$1000)', () => {
    const w = checkNarration(null, KIRO, [], [], [kiroTransfer], { money: 10 });
    expect(w.some(x => /teto de €\$1000/.test(x))).toBe(true);
    expect(w.some(x => /saldo real é €\$1010/.test(x))).toBe(true);
    expect(w.every(isSevereWarning)).toBe(true);
  });

  it('saldo que bate com o motor não gera aviso', () => {
    const text = 'O Agent apita: mil eddies de Kiro. Você vê o saldo subir para mil e dez eddies.';
    expect(checkNarration(null, text, [], [], [{ tool: 'transfer_money', args: { amount: 1000, counterpart: 'Kiro' } }], { money: 10 })).toEqual([]);
    expect(checkNarration(null, 'Seu saldo continua em €$1.010.', [], [], [], { money: 1010 })).toEqual([]);
  });

  it('saldo devedor (dívida) não é o saldo da conta', () => {
    expect(checkNarration(null, 'O saldo devedor com o cassino ainda é de nove mil eddies.', [], [], [], { money: 1010 })).toEqual([]);
  });
});

describe('Pagamento do mesmo trabalho repetido nos turnos seguintes (run real do T7–T9)', () => {
  it('pago na cena + missão concluída; o narrador "paga" de novo em t8 e t9: as duas são recusadas', () => {
    let sc = scenario().tool('narrator', 'start_quest', { id: 'm_corre_rafa', title: 'Entrega Discreta', objective: 'Recuperar a carga no terminal 4-B em Heywood.', rewardEddies: 600, giverId: 'npc_rafa' });
    sc = sc.atTurn(7);
    const before = sc.state.character.money;
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa "Zero-Um"', reason: 'Pagamento pelo corre de entrega do pacote da Militech' });
    sc.tool('narrator', 'complete_quest', { questId: 'm_corre_rafa' });
    expect(sc.state.character.money).toBe(before + 600);
    sc.atTurn(8).tool('narrator', 'transfer_money', { amount: 600, counterpart: 'npc_rafa', reason: 'Pagamento pelo corre de entrega do chip' });
    expect(sc.last().ok).toBe(false);
    sc.atTurn(9).tool('narrator', 'transfer_money', { amount: 600, counterpart: "Rafa 'Zero-Um'", reason: 'Pagamento pelo corre de entrega do chip da Militech' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(before + 600);
  });

  it('missão concluída limpa o que o contratante "oferecia/queria" sobre aquele trabalho', () => {
    const sc = scenario().tool('narrator', 'start_quest', { id: 'm_corre_rafa', title: 'Entrega Discreta', objective: 'Recuperar a carga no terminal 4-B em Heywood.', rewardEddies: 600, giverId: 'npc_rafa' });
    expect(sc.npc('npc_rafa')?.pendingMatters).toMatch(/600/);
    sc.tool('narrator', 'complete_quest', { questId: 'm_corre_rafa' });
    const rafa = sc.npc('npc_rafa')!;
    expect(rafa.pendingMatters).toBeUndefined();
    expect(rafa.currentGoal).toBeUndefined();
  });

  it('pendência sobre OUTRO assunto continua', () => {
    const sc = scenario()
      .tool('narrator', 'start_quest', { id: 'm_corre_rafa', title: 'Entrega Discreta', objective: 'Levar a carga', rewardEddies: 600, giverId: 'npc_rafa' })
      .tool('narrator', 'upsert_npc', { name: 'Rafa "Zero-Um"', pendingMatters: 'Quer saber se o jogador topa vigiar o Kiro', currentGoal: 'Descobrir quem dedurou o galpão' });
    sc.tool('narrator', 'complete_quest', { questId: 'm_corre_rafa' });
    expect(sc.npc('npc_rafa')).toMatchObject({ pendingMatters: 'Quer saber se o jogador topa vigiar o Kiro', currentGoal: 'Descobrir quem dedurou o galpão' });
  });
});

describe('Coerência do dinheiro nas runs reais (T6 e T8)', () => {
  const doneQuest = () => {
    const sc = scenario().tool('narrator', 'start_quest', { id: 'm_corre_rafa', title: 'Entrega Discreta', objective: 'Levar a carga', rewardEddies: 600, giverId: 'npc_rafa' }).atTurn(4);
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'npc_rafa' }).tool('narrator', 'complete_quest', { questId: 'm_corre_rafa' });
    return sc.atTurn(6);
  };

  it('T6: narrador "paga" a entrega de novo e soma no saldo → aviso grave, e o saldo com o duplicado não vale', () => {
    const sc = doneQuest();
    const money = sc.state.character.money;
    const ctx = sc.context('Rafa');
    const tools = [
      { tool: 'transfer_money', args: { amount: 600, counterpart: 'Rafa "Zero-Um"' } },
      { tool: 'complete_quest', args: { questId: 'm_corre_rafa' } },
    ];
    const w = checkNarration(null, `O dinheiro de fato já brilha na sua conta, somando agora €$${(money + 600).toLocaleString('pt-BR')} no seu saldo.`, [], ctx.npcs, tools, { money, turn: ctx.turn, quests: ctx.quests });
    expect(w.some(x => /Pagamento duplicado: "Entrega Discreta"/.test(x))).toBe(true);
    expect(w.some(x => x.includes(`saldo real é €$${money}`))).toBe(true);
    expect(w.every(isSevereWarning)).toBe(true);
    // E o motor recusa de fato.
    sc.tool('narrator', 'transfer_money', tools[0].args);
    expect(sc.last().ok).toBe(false);
  });

  it('T8: jogador paga a mãe (pay_money −600) e o narrador registra +600 "da mãe" → o motor recusa o eco', () => {
    const sc = scenario().atTurn(8);
    sc.edit(s => ({ ...s, character: { ...s.character, money: 1100 } }));
    sc.tool('interpreter', 'pay_money', { amount: 600, recipient: 'Minha irmã', reason: 'Ajuda para o aluguel atrasado', questId: 'm_rent' });
    expect(sc.state.character.money).toBe(500);
    const paid = sc.last();
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Minha irmã', reason: 'Ajuda para o aluguel atrasado' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(500);
    // O verificador também reconhece o eco e não aceita o saldo "devolvido".
    const result = { intent: null, tools: [{ tool: 'pay_money', ok: true, summary: paid.summary }], roll: null, offscreen: [] };
    const w = checkNarration(result as never, 'Ela aperta sua mão. Seu saldo volta a €$1.100.', [], sc.state.npcs, [{ tool: 'transfer_money', args: { amount: 600, counterpart: 'Minha irmã' } }], { money: 500, turn: 8, quests: sc.state.missions });
    expect(w.some(x => /sinal trocado/.test(x))).toBe(true);
    expect(w.some(x => /saldo real é €\$500/.test(x))).toBe(true);
  });

  it('entradas de terceiros não são mais inventadas pelo narrador', () => {
    const sc = scenario().atTurn(8);
    sc.edit(s => ({ ...s, character: { ...s.character, money: 1100 } }));
    sc.tool('interpreter', 'pay_money', { amount: 600, recipient: 'Minha irmã', reason: 'aluguel' });
    sc.tool('narrator', 'transfer_money', { amount: 200, counterpart: 'Minha irmã', reason: 'devolveu o troco' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa "Zero-Um"', reason: 'adiantamento de outro corre' });
    expect(sc.last().ok).toBe(false);
  });
});
