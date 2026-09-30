/**
 * Duplicações que o narrador causava: pagamento do trabalho (missão + transferência), item comprado
 * e entregue de novo, e implante virando item comum (usado sem cirurgia).
 */
import { describe, expect, it } from 'vitest';
import { scenario, withRipperdoc } from './harness';
import { migrateState } from '../shared/engine/migrate';

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
    expect(sc.last().summary).toMatch(/duplicado/);
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

  it('dinheiro de OUTRA pessoa, de outro valor, continua valendo', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.tool('narrator', 'transfer_money', { amount: 50, counterpart: 'Gorjeta do cliente', reason: 'gorjeta' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(before + 650);
  });

  it('bem depois (fora da janela de 3 turnos) um novo pagamento do contratante vale', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.atTurn(sc.state.turn + 5).tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa', reason: 'outro trabalho' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(before + 1200);
  });
});

describe('Item comprado e entregue de novo pelo narrador (log do T43)', () => {
  it('buy_item + give_item do mesmo item no mesmo turno: entra UMA vez', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 5000 } }));
    sc.tool('interpreter', 'buy_item', { name: 'Kit Médico', category: 'consumable', quantity: 1 });
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'give_item', { name: 'Kit médico de trauma', category: 'consumable', source: 'vendedor' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/duplicado/);
    expect(sc.state.character.inventory.filter(i => /kit m[eé]dico/i.test(i.name)).reduce((n, i) => n + i.quantity, 0)).toBe(1);
  });

  it('um item diferente entregue no mesmo turno continua valendo', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 5000 } }));
    sc.tool('interpreter', 'buy_item', { name: 'Kit Médico', category: 'consumable', quantity: 1 });
    sc.tool('narrator', 'give_item', { name: 'Cartão de visita do Doc', category: 'gear', source: 'Doc' });
    expect(sc.last().ok).toBe(true);
  });
});

describe('Implante não é item comum', () => {
  it('a loja não vende Sandevistan/Braços Gorila como mercadoria (manda instalar com um ripperdoc)', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 50_000 } }));
    sc.tool('interpreter', 'buy_item', { name: 'Sandevistan', category: 'gear' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/install_cyberware/);
    sc.tool('interpreter', 'buy_item', { name: 'Braços Gorila', category: 'weapon' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(50_000);
  });

  it('na clínica do ripperdoc, nomes inventados de cromo ("Kit Neural", "Amplificador de Áudio") também não viram compra de balcão', () => {
    const sc = scenario().edit(s => withRipperdoc({ ...s, character: { ...s.character, money: 5000 } }, 3, true));
    sc.tool('interpreter', 'buy_item', { name: 'Kit Neural', category: 'gear', price: 500 });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'buy_item', { name: 'Amplificador de Áudio', category: 'gear', price: 500 });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(5000);
    // Fora de clínica, um "kit de ferramentas" continua sendo item comum.
    const shop = scenario().edit(s => ({ ...s, character: { ...s.character, money: 5000 } }));
    shop.tool('interpreter', 'buy_item', { name: 'Kit de ferramentas', category: 'gear' });
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
