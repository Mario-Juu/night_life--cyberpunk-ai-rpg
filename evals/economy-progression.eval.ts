import { describe, expect, it } from 'vitest';
import { scenario } from './harness';

describe('Economia determinística: proposta → confirmação → liquidação', () => {
  it('a IA abre uma oferta, mas não pode alterar saldo ou inventário', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 1_000 } }));
    const before = sc.state.character.money;
    sc.tool('interpreter', 'propose_trade', { seller: 'Nix', merchantType: 'medical', catalogKey: 'medical_stim', name: 'Injector de Stim' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(before);
    expect(sc.item('Injector de Stim')).toBeUndefined();
    expect(sc.state.world.tradeOffer).toMatchObject({ seller: 'Nix', price: 50 });
  });

  it('a confirmação do jogador cria exatamente um débito e um item; repetir é impossível', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 1_000 } }));
    sc.tool('narrator', 'propose_trade', { seller: 'Nix', merchantType: 'medical', catalogKey: 'medical_stim', name: 'Injector de Stim' });
    const offerId = sc.state.world.tradeOffer!.id;
    // A quantidade Ã© um rascunho local da interface: entra no motor apenas nesta confirmaÃ§Ã£o.
    sc.atTurn(sc.state.turn + 1).tool('player', 'settle_trade', { offerId, quantity: 3 });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(850);
    expect(sc.item('Injector de Stim')).toMatchObject({ drug: 'stim', quantity: 3 });
    expect(sc.state.events.filter(e => e.type === 'MONEY_CHANGED' && (e.data as { kind?: string } | undefined)?.kind === 'trade')).toHaveLength(1);
    sc.tool('player', 'settle_trade', { offerId });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(850);
  });

  it('narrador não possui mais crédito/débito livre', () => {
    const sc = scenario();
    const before = sc.state.character.money;
    sc.tool('narrator', 'transfer_money', { amount: 800, counterpart: 'Vendedor', reason: 'Compra' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(before);
  });

  it('banca expõe apenas estoque canônico e venda/recebimento têm fluxos próprios', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 1_000 } }));
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'Doc', merchantType: 'medical', stock: 'medical_stim,biocurativo' });
    expect(sc.state.world.merchantCatalog?.stock).toEqual(['medical_stim', 'biocurativo']);
    sc.tool('player', 'propose_catalog_item', { catalogKey: 'street_boost' });
    expect(sc.last().ok).toBe(false);
    sc.tool('player', 'propose_catalog_item', { catalogKey: 'medical_stim' });
    expect(sc.last().ok).toBe(true);
    sc.tool('player', 'decline_trade', { offerId: sc.state.world.tradeOffer!.id });
    sc.tool('narrator', 'receive_payment', { amount: 30, counterpart: 'Doc', kind: 'service', reason: 'curativo rápido' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(1030);
  });

  it('recusa item mecânico improvisado e dinheiro de roubo sem sucesso registrado', () => {
    const sc = scenario();
    sc.tool('narrator', 'give_item', { name: 'Injector milagroso', category: 'consumable', source: 'vendedor' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'receive_payment', { amount: 40, counterpart: 'Caixa', kind: 'robbery', reason: 'caixa arrombado' });
    expect(sc.last().ok).toBe(false);
  });
});

describe('Progressão: competência antes do dado', () => {
  it('Técnico sem especialidade suficiente não fabrica item caro mesmo com dado alto', () => {
    const sc = scenario({ role: 'tech' }).edit(s => ({ ...s, character: { ...s.character, money: 2_000 } }));
    sc.tool('interpreter', 'craft', { mode: 'fabricate', name: 'Fuzil de assalto', category: 'weapon', weaponClass: 'assault_rifle' }, [10]);
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/precisa de Fabricação 4/);
    expect(sc.item('Fuzil de assalto')).toBeUndefined();
  });

  it('Trilheiro de rank 4 não pula para arquitetura avançada só por um d10 alto', () => {
    const sc = scenario({ role: 'netrunner' }).tool('narrator', 'net_architecture', { name: 'Cofre Arasaka', difficulty: 'advanced', floors: 3 });
    sc.tool('interpreter', 'jack_in', {}, [10]);
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/exige Interface 8/);
    expect(sc.state.net.run).toBeNull();
  });
});
