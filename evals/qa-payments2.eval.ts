/**
 * Dinheiro "lisinho" (rodada 2): negociação, adiantamento de missão, empréstimo/dívida, telefone,
 * verificador de narração e exploits. Cada bloco cobre uma correção desta rodada.
 */
import { describe, expect, it } from 'vitest';
import { scenario, type Scenario } from './harness';
import { checkNarration } from '../shared/engine/consistency';
import { isSevereWarning } from '../server/gamemaster/gameMaster';
import { buildPhonePrompt } from '../server/gamemaster/promptBuilder';

const rich = (sc: Scenario, money = 5_000) => sc.edit(s => ({ ...s, character: { ...s.character, money } }));
const money = (sc: Scenario) => sc.state.character.money;
const next = (sc: Scenario, n = 1) => sc.atTurn(sc.state.turn + n);
const quest = (sc: Scenario, id: string) => sc.state.missions.find(m => m.id === id)!;
const withJob = (reward = 600, extra: Record<string, unknown> = {}) =>
  next(scenario().tool('narrator', 'start_quest', { id: 'm_job', title: 'Entrega no Porto', objective: 'Levar a carga', rewardEddies: reward, giverId: 'npc_rafa', ...extra }));
const withNpc = (sc: Scenario, name: string, extra: Record<string, unknown> = {}) => sc.tool('narrator', 'upsert_npc', { name, role: 'Contato', present: true, ...extra });

describe('MISSÃO — adiantamento ("metade agora, metade na entrega")', () => {
  it('start_quest com advanceEddies paga agora e a conclusão paga só o restante (total = recompensa, uma vez)', () => {
    const sc = scenario();
    const m0 = money(sc);
    sc.tool('narrator', 'start_quest', { id: 'm_job', title: 'Entrega no Porto', objective: 'o', rewardEddies: 600, giverId: 'npc_rafa', advanceEddies: 300 });
    expect(sc.last().ok).toBe(true);
    expect(money(sc)).toBe(m0 + 300);
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(sc.last().summary).toMatch(/\+€\$300.*adiantados/);
    expect(money(sc)).toBe(m0 + 600);
    sc.tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(m0 + 600);
  });

  it('quest_advance depois: até metade da recompensa, somando os adiantamentos', () => {
    const sc = withJob(600);
    const m0 = money(sc);
    sc.tool('narrator', 'quest_advance', { questId: 'm_job', amount: 200 });
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'quest_advance', { questId: 'm_job', amount: 200 });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/Disponível agora: €\$100/);
    sc.tool('narrator', 'quest_advance', { questId: 'm_job', amount: 100 });
    expect(quest(sc, 'm_job').advancePaid).toBe(300);
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(money(sc)).toBe(m0 + 600);
  });

  it('adiantamento acima da metade na abertura é recusado e a missão NÃO é criada', () => {
    const sc = scenario();
    const m0 = money(sc);
    sc.tool('narrator', 'start_quest', { id: 'm_x', title: 'Golpe', objective: 'o', rewardEddies: 1000, advanceEddies: 800 });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.missions.some(m => m.id === 'm_x')).toBe(false);
    expect(money(sc)).toBe(m0);
  });

  it('receive_payment do contratante com missão ativa é recusado e aponta quest_advance', () => {
    const sc = withJob(600);
    const m0 = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 300, counterpart: 'Rafa', kind: 'service', reason: 'metade agora' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/quest_advance/);
    expect(money(sc)).toBe(m0);
  });

  it('missão falhada/abandonada com adiantamento: o dinheiro fica, mas vira dívida com o contratante', () => {
    const sc = withJob(600);
    sc.tool('narrator', 'quest_advance', { questId: 'm_job', amount: 300 });
    const m0 = money(sc);
    sc.tool('narrator', 'fail_quest', { questId: 'm_job', abandoned: true });
    expect(money(sc)).toBe(m0);
    expect(sc.npc('npc_rafa')?.playerOwes).toBe(300);
    // Devolver quita a dívida.
    next(sc).tool('interpreter', 'pay_money', { amount: 300, recipient: 'Rafa', reason: 'devolvo o adiantamento' });
    expect(sc.last().summary).toMatch(/quitada/);
    expect(sc.npc('npc_rafa')?.playerOwes).toBeUndefined();
  });

  it('equipe leva a parte do trabalho INTEIRO mesmo com adiantamento (jogador fica com 80%)', () => {
    const sc = withNpc(scenario(), 'Jax').tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 20, template: 'bodyguard' });
    const m0 = money(sc);
    sc.tool('narrator', 'start_quest', { id: 'm_big', title: 'Extração', objective: 'o', rewardEddies: 1000, giverId: 'npc_rafa', advanceEddies: 500 });
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_big' });
    expect(money(sc)).toBe(m0 + 800);
  });
});

describe('MISSÃO — recompensa alterada, duplicada, concluída no mesmo turno', () => {
  it('update_quest renegocia até +50% do combinado; acima disso ou abaixo do adiantado é recusado', () => {
    const sc = withJob(600);
    sc.tool('narrator', 'update_quest', { questId: 'm_job', rewardEddies: 1000 });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'update_quest', { questId: 'm_job', rewardEddies: 900 });
    expect(sc.last().ok).toBe(true);
    expect(quest(sc, 'm_job').originalReward).toBe(600);
    // Segunda renegociação continua presa ao combinado original (não vira escada).
    sc.tool('narrator', 'update_quest', { questId: 'm_job', rewardEddies: 1300 });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'quest_advance', { questId: 'm_job', amount: 400 });
    sc.tool('narrator', 'update_quest', { questId: 'm_job', rewardEddies: 300 });
    expect(sc.last().ok).toBe(false);
    const m0 = money(sc);
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(money(sc)).toBe(m0 + 500);
  });

  it('recompensa de missão encerrada não muda mais', () => {
    const sc = withJob(600).tool('narrator', 'complete_quest', { questId: 'm_job' });
    sc.tool('narrator', 'update_quest', { questId: 'm_job', rewardEddies: 800 });
    expect(sc.last().ok).toBe(false);
  });

  it('o mesmo trabalho aberto de novo com outro título (mesmo contratante) é recusado; outro contratante pode', () => {
    const sc = withJob(600);
    sc.tool('phone', 'start_quest', { title: 'Entrega da carga no porto (renegociado)', objective: 'o', rewardEddies: 800, giverId: 'npc_rafa' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/update_quest/);
    sc.tool('narrator', 'start_quest', { title: 'Outro bico', objective: 'o', rewardEddies: 600, giverId: 'npc_rafa' });
    expect(sc.last().ok).toBe(false);
    withNpc(sc, 'Kiro');
    sc.tool('narrator', 'start_quest', { title: 'Outro bico', objective: 'o', rewardEddies: 600, giverId: 'Kiro' });
    expect(sc.last().ok).toBe(true);
  });

  it('bico combinado e pago no mesmo turno: até €$1000 somando o turno; o resto fica ativo e paga depois', () => {
    const sc = scenario();
    const m0 = money(sc);
    sc.tool('narrator', 'start_quest', { id: 'm_a', title: 'Bico A', objective: 'o', rewardEddies: 800 }).tool('narrator', 'complete_quest', { questId: 'm_a' });
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'start_quest', { id: 'm_b', title: 'Bico B', objective: 'o', rewardEddies: 800 }).tool('narrator', 'complete_quest', { questId: 'm_b' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/precisa acontecer em cena/);
    expect(money(sc)).toBe(m0 + 800);
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_b' });
    expect(money(sc)).toBe(m0 + 1600);
  });

  it('missão grande concluída em turno posterior paga inteira', () => {
    const sc = withJob(5000).tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(sc.last().ok).toBe(true);
    expect(sc.last().summary).toMatch(/\+€\$5000/);
  });

  it('concluída por SMS: a cena depois não paga de novo (nem complete_quest nem receive_payment)', () => {
    const sc = withJob(600);
    const m0 = money(sc);
    sc.tool('phone', 'complete_quest', { questId: 'm_job' });
    expect(money(sc)).toBe(m0 + 600);
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'receive_payment', { amount: 600, counterpart: 'Rafa "Zero-Um"', kind: 'gift', reason: 'pagamento do corre' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(m0 + 600);
  });

  it('recompensa em item: give_item depois da conclusão entra uma vez', () => {
    const sc = withJob(600).tool('narrator', 'complete_quest', { questId: 'm_job' });
    sc.tool('narrator', 'give_item', { name: 'Chip de acesso do porto', category: 'datashard', source: 'Rafa' });
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'give_item', { name: 'Chip de acesso do porto', category: 'datashard', source: 'Rafa' });
    expect(sc.last().ok).toBe(false);
  });
});

describe('PEDIR/COBRAR DINHEIRO — empréstimo, dívida, reembolso, quitação', () => {
  it('empréstimo (loan) entra e vira dívida; pagar abate, quitar zera e o excedente aparece', () => {
    const sc = scenario();
    const m0 = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 300, counterpart: 'Rafa', kind: 'loan', reason: 'empresta até sexta' });
    expect(sc.last().ok).toBe(true);
    expect(money(sc)).toBe(m0 + 300);
    expect(sc.npc('npc_rafa')?.playerOwes).toBe(300);
    next(sc).tool('interpreter', 'pay_money', { amount: 100, recipient: 'Rafa', reason: 'parcela' });
    expect(sc.last().summary).toMatch(/restam €\$200/);
    next(sc).tool('interpreter', 'pay_money', { amount: 250, recipient: 'Rafa', reason: 'resto' });
    expect(sc.last().summary).toMatch(/quitada \(€\$50 a mais\)/);
    expect(sc.npc('npc_rafa')?.playerOwes).toBeUndefined();
  });

  it('empréstimo de um desconhecido cria o NPC credor (a dívida não se perde)', () => {
    const sc = scenario().tool('narrator', 'receive_payment', { amount: 500, counterpart: 'Agiota Kim', kind: 'loan', reason: 'juros de 20%' });
    expect(sc.npc('Agiota Kim')?.playerOwes).toBe(500);
  });

  it('"o Rafa me deve 1000, cobro": quitação sem dívida registrada é recusada', () => {
    const sc = scenario();
    const m0 = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 1000, counterpart: 'Rafa', kind: 'repayment', reason: 'ele me devia' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'receive_payment', { amount: 1000, counterpart: 'Rafa', kind: 'refund', reason: 'devolve o que me deve' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(m0);
  });

  it('jogador empresta (pay_money loan) e depois recebe de volta só até o que emprestou', () => {
    const sc = rich(scenario(), 1000);
    sc.tool('interpreter', 'pay_money', { amount: 200, recipient: 'Rafa', reason: 'empréstimo', loan: true });
    expect(sc.npc('npc_rafa')?.owesPlayer).toBe(200);
    next(sc).tool('narrator', 'receive_payment', { amount: 250, counterpart: 'Rafa', kind: 'repayment', reason: 'devolve' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'receive_payment', { amount: 200, counterpart: 'Rafa', kind: 'repayment', reason: 'devolve' });
    expect(sc.last().ok).toBe(true);
    expect(sc.npc('npc_rafa')?.owesPlayer).toBeUndefined();
    expect(money(sc)).toBe(1000);
  });

  it('reembolso só devolve o que o jogador pagou àquela pessoa (e uma vez)', () => {
    const sc = withNpc(rich(scenario(), 1000), 'Guarda Ruiz');
    sc.tool('interpreter', 'pay_money', { amount: 150, recipient: 'Guarda Ruiz', reason: 'suborno' });
    next(sc).tool('narrator', 'receive_payment', { amount: 200, counterpart: 'Guarda Ruiz', kind: 'refund', reason: 'recusa o suborno' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'receive_payment', { amount: 150, counterpart: 'Guarda Ruiz', kind: 'refund', reason: 'recusa o suborno' });
    expect(sc.last().ok).toBe(true);
    next(sc).tool('narrator', 'receive_payment', { amount: 150, counterpart: 'Guarda Ruiz', kind: 'refund', reason: 'de novo' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(1000);
  });

  it('eco: o jogador paga a irmã e o narrador registra "presente" do mesmo valor dela → recusado', () => {
    const sc = withNpc(rich(scenario(), 1000), 'Lu');
    sc.tool('interpreter', 'pay_money', { amount: 600, recipient: 'Lu', reason: 'ajuda no aluguel' });
    sc.tool('narrator', 'receive_payment', { amount: 600, counterpart: 'Lu', kind: 'gift', reason: 'ajuda da família' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(400);
  });

  it('pagar duas vezes a mesma conta no mesmo turno: a segunda é recusada; no turno seguinte é outro pagamento', () => {
    const sc = rich(scenario(), 1000);
    sc.tool('interpreter', 'pay_money', { amount: 300, recipient: 'Senhorio', reason: 'aluguel' });
    sc.tool('interpreter', 'pay_money', { amount: 300, recipient: 'senhorio', reason: 'aluguel' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(700);
    next(sc).tool('interpreter', 'pay_money', { amount: 300, recipient: 'Senhorio', reason: 'semana seguinte' });
    expect(money(sc)).toBe(400);
  });

  it('pagamento parcial e sem saldo: parcial passa; acima do saldo nada sai', () => {
    const sc = rich(scenario(), 100);
    sc.tool('interpreter', 'pay_money', { amount: 500, recipient: 'Senhorio' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(100);
    sc.tool('interpreter', 'pay_money', { amount: 80, recipient: 'Senhorio', reason: 'parte do aluguel' });
    expect(money(sc)).toBe(20);
  });

  it('pagar quem não está na cena pelo intérprete vale (transferência pelo Agent); morto não recebe', () => {
    const sc = withNpc(rich(scenario(), 500), 'Kiro', { present: false });
    sc.tool('interpreter', 'pay_money', { amount: 100, recipient: 'Kiro', reason: 'transferência' });
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'npc_status', { npcId: 'Kiro', status: 'dead' });
    next(sc).tool('interpreter', 'pay_money', { amount: 50, recipient: 'Kiro' });
    expect(sc.last().ok).toBe(false);
  });
});

describe('TELEFONE — dinheiro por SMS', () => {
  it('contato não rouba nem "acha" dinheiro por SMS', () => {
    const sc = scenario();
    sc.tool('phone', 'receive_payment', { amount: 100, counterpart: 'Rafa', kind: 'robbery', reason: 'x' });
    expect(sc.last().ok).toBe(false);
  });

  it('jogador manda dinheiro pelo Agent: só para um contato salvo', () => {
    const sc = withNpc(rich(scenario(), 500), 'Estranho');
    sc.tool('phone', 'pay_money', { amount: 100, recipient: 'Estranho', reason: 'cobrança por SMS' });
    expect(sc.last().ok).toBe(false);
    sc.tool('phone', 'pay_money', { amount: 100, recipient: 'Rafa', reason: 'te mandei' });
    expect(sc.last().ok).toBe(true);
    expect(money(sc)).toBe(400);
  });

  it('"te mandei 200" por SMS e a cena seguinte "o dinheiro cai": entra uma vez', () => {
    const sc = scenario();
    const m0 = money(sc);
    sc.tool('phone', 'receive_payment', { amount: 200, counterpart: 'Rafa', kind: 'gift', reason: 'ajuda' });
    next(sc).tool('narrator', 'receive_payment', { amount: 200, counterpart: 'Rafa "Zero-Um"', kind: 'gift', reason: 'o dinheiro cai' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(m0 + 200);
  });

  it('adiantamento combinado por SMS e entrega em cena: total = recompensa', () => {
    const sc = withJob(800);
    const m0 = money(sc);
    sc.tool('phone', 'quest_advance', { questId: 'm_job', amount: 400, reason: 'metade agora' });
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(money(sc)).toBe(m0 + 800);
  });

  it('Canal pechincha o trabalho por SMS (uma vez) e o bônus entra só na conclusão', () => {
    const sc = scenario({ role: 'fixer' }).tool('narrator', 'start_quest', { id: 'm_job', title: 'Entrega no Porto', objective: 'o', rewardEddies: 600, giverId: 'npc_rafa' });
    next(sc);
    const m0 = money(sc);
    sc.tool('phone', 'haggle_quest', { questId: 'm_job' }, [10, 10]);
    expect(sc.last().ok).toBe(true);
    const reward = quest(sc, 'm_job').rewardEddies;
    expect(reward).toBeGreaterThan(600);
    expect(money(sc)).toBe(m0);
    sc.tool('phone', 'haggle_quest', { questId: 'm_job' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    next(sc).tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(money(sc)).toBe(m0 + reward);
  });

  it('pechincha de oferta por SMS vale; confirmar a compra continua só na tela', () => {
    const sc = rich(scenario({ role: 'fixer' }));
    sc.tool('phone', 'propose_trade', { seller: 'Rafa', catalogKey: 'medical_stim' });
    const id = sc.state.world.tradeOffer!.id;
    sc.tool('phone', 'haggle_trade', { offerId: id }, [10, 10]);
    expect(sc.last().ok).toBe(true);
    sc.tool('phone', 'settle_trade', { offerId: id });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(5000);
  });

  it('o prompt do telefone mostra recompensa, adiantamento e dívida em aberto', () => {
    const sc = withJob(600).tool('narrator', 'quest_advance', { questId: 'm_job', amount: 300 }).tool('narrator', 'receive_payment', { amount: 100, counterpart: 'Rafa', kind: 'loan', reason: 'x' });
    const prompt = buildPhonePrompt(sc.context('Rafa'), 'npc_rafa', 'e aí?');
    expect(prompt).toMatch(/paga €\$600, €\$300 já adiantados/);
    expect(prompt).toMatch(/o jogador deve €\$100 a ele/);
  });
});

describe('NEGOCIAÇÃO — venda e ciclos', () => {
  it('vender para comprador morto ou ausente (que não é contato) é recusado; contato ou receptador da cena vale', () => {
    const sc = withNpc(scenario(), 'Viktor', { present: false });
    withNpc(sc, 'Morto');
    sc.tool('narrator', 'npc_status', { npcId: 'Morto', status: 'dead' });
    const gun = sc.state.character.inventory.find(i => i.weapon && (i.value ?? 0) > 0)!;
    sc.tool('interpreter', 'sell_item', { itemId: gun.id, buyer: 'Morto' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'sell_item', { itemId: gun.id, buyer: 'Viktor' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'sell_item', { itemId: gun.id, buyer: 'Rafa' });
    expect(sc.last().ok).toBe(true);
  });

  it('comprar (com pechincha) e revender nunca dá lucro', () => {
    const sc = rich(scenario({ role: 'fixer' }), 2000);
    for (const key of ['medical_stim', 'weapon_grenade', 'biocurativo']) {
      const m0 = money(sc);
      sc.tool('narrator', 'propose_trade', { seller: 'Nix', catalogKey: key, quantity: 5 });
      const id = sc.state.world.tradeOffer!.id;
      sc.tool('player', 'haggle_trade', { offerId: id }, [10, 10]);
      sc.tool('player', 'settle_trade', { offerId: id });
      const bought = sc.state.character.inventory.find(i => i.id === sc.state.events.filter(e => e.type === 'ITEM_ACQUIRED').at(-1)?.target)!;
      sc.tool('player', 'sell_item', { itemId: bought.id, buyer: 'Fence' });
      expect(money(sc), key).toBeLessThan(m0);
      next(sc);
    }
  });
});

describe('CONSISTÊNCIA — narração × motor', () => {
  const npcs = scenario().state.npcs;

  it('fala de NPC cobrando ("você me paga 500 amanhã") não é pagamento do jogador', () => {
    expect(checkNarration(null, 'Rafa cruza os braços.\n[DIALOGUE: Rafa]\nVocê me paga 500 eddies amanhã, choom.\n[/DIALOGUE]', [], npcs)).toEqual([]);
    expect(checkNarration(null, 'Ele rosna: “Você me transfere 300 eddies agora.”', [], npcs)).toEqual([]);
    // Narração afirmando o pagamento sem ferramenta continua pega.
    expect(checkNarration(null, 'Você transfere 300 eddies para Rafa e fecha o Agent.', [], npcs)[0]).toMatch(/NÃO registrou/);
  });

  it('"metade agora" sem número não gera aviso; saldo depois do adiantamento bate', () => {
    const quests = [{ id: 'm_job', title: 'Entrega', status: 'ACTIVE' as const, rewardEddies: 600, giverId: 'npc_rafa' }];
    const tools = [{ tool: 'quest_advance', args: { questId: 'm_job', amount: 300 } }];
    expect(checkNarration(null, 'Rafa te passa metade agora; o resto na entrega.', [], npcs, tools, { money: 100, quests })).toEqual([]);
    expect(checkNarration(null, 'Seu saldo sobe para €$400.', [], npcs, tools, { money: 100, quests })).toEqual([]);
    expect(checkNarration(null, 'Seu saldo sobe para €$700.', [], npcs, tools, { money: 100, quests }).some(w => /saldo real/.test(w))).toBe(true);
  });

  it('adiantamento acima da metade e receive_payment de missão ativa geram aviso grave', () => {
    const quests = [{ id: 'm_job', title: 'Entrega', status: 'ACTIVE' as const, rewardEddies: 600, giverId: 'npc_rafa' }];
    const w1 = checkNarration(null, 'Rafa adianta o dinheiro.', [], npcs, [{ tool: 'quest_advance', args: { questId: 'm_job', amount: 400 } }], { money: 100, quests });
    expect(w1.some(w => /METADE/.test(w))).toBe(true);
    const w2 = checkNarration(null, 'Rafa paga.', [], npcs, [{ tool: 'receive_payment', args: { amount: 300, counterpart: 'Rafa', kind: 'service' } }], { money: 100, quests });
    expect(w2.some(w => /quest_advance/.test(w))).toBe(true);
    expect([...w1, ...w2].every(isSevereWarning)).toBe(true);
  });

  it('conclusão com adiantamento: saldo = saldo + restante (não + recompensa inteira)', () => {
    const quests = [{ id: 'm_job', title: 'Entrega', status: 'ACTIVE' as const, rewardEddies: 600, giverId: 'npc_rafa', advancePaid: 300 }];
    const tools = [{ tool: 'complete_quest', args: { questId: 'm_job' } }];
    expect(checkNarration(null, 'Seu saldo fecha em €$400.', [], npcs, tools, { money: 100, quests })).toEqual([]);
    expect(checkNarration(null, 'Seu saldo fecha em €$700.', [], npcs, tools, { money: 100, quests }).length).toBeGreaterThan(0);
  });

  it('equipe: o saldo narrado já sem a parte do aliado é aceito', () => {
    const quests = [{ id: 'm_job', title: 'Entrega', status: 'ACTIVE' as const, rewardEddies: 1000, giverId: 'npc_rafa' }];
    const tools = [{ tool: 'complete_quest', args: { questId: 'm_job' } }];
    expect(checkNarration(null, 'Seu saldo fecha em €$900.', [], npcs, tools, { money: 100, quests, partyShare: 20 })).toEqual([]);
  });

  it('missão aberta e concluída na mesma resposta: até €$1000 o saldo bate; acima, aviso grave', () => {
    const small = [
      { tool: 'start_quest', args: { title: 'Bico rápido', objective: 'o', rewardEddies: 800 } },
      { tool: 'complete_quest', args: { questId: 'm_bico_rapido' } },
    ];
    expect(checkNarration(null, 'Seu saldo sobe para €$900.', [], npcs, small, { money: 100, quests: [] })).toEqual([]);
    const big = [
      { tool: 'start_quest', args: { id: 'm_big', title: 'Assalto', objective: 'o', rewardEddies: 3000 } },
      { tool: 'complete_quest', args: { questId: 'm_big' } },
    ];
    const w = checkNarration(null, 'O dinheiro cai.', [], npcs, big, { money: 100, quests: [] });
    expect(w.some(x => /RECUSAR/.test(x))).toBe(true);
    expect(w.every(isSevereWarning)).toBe(true);
  });
});

describe('EXPLOITS remanescentes', () => {
  it('transfer_money não credita por nenhuma origem', () => {
    const sc = scenario();
    const m0 = money(sc);
    for (const o of ['player', 'narrator', 'phone', 'interpreter', 'engine'] as const) sc.tool(o, 'transfer_money', { amount: 1000, counterpart: 'X' });
    expect(money(sc)).toBe(m0);
  });

  it('granadas e munição (já corrigidos): preço escala com a quantidade e a revenda não lucra', () => {
    const sc = rich(scenario(), 10_000);
    const m0 = money(sc);
    for (let i = 0; i < 4; i++) {
      sc.tool('narrator', 'propose_trade', { seller: 'Nix', catalogKey: 'weapon_grenade', quantity: 50 });
      sc.tool('player', 'settle_trade', { offerId: sc.state.world.tradeOffer!.id });
      next(sc);
    }
    for (const it of sc.state.character.inventory.filter(i => /granada/i.test(i.name))) sc.tool('player', 'sell_item', { itemId: it.id, buyer: 'Fence' });
    expect(money(sc)).toBeLessThanOrEqual(m0);
  });
});
