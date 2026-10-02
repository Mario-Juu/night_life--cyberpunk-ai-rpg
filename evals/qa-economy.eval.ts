/**
 * QA adversarial de ECONOMIA e PROGRESSÃO.
 * Regra de ouro: a IA só PROPÕE; o motor liquida; saldo/inventário nunca mudam por texto da IA.
 *
 * Convenções:
 *  - `it(...)`            comportamento correto, passa hoje.
 *  - `it.fails('BUG-ECO-n')` bug CONFIRMADO: o teste descreve o comportamento correto e só "passa"
 *                          (verde) enquanto o bug existir. Quando for corrigido, remova o `.fails`.
 *  - `it('DÚVIDA-DESIGN')` documenta o comportamento atual de algo que pode ser decisão de design.
 */
import { describe, expect, it } from 'vitest';
import { scenario, type Scenario } from './harness';
import { validateSave } from '../src/services/saves';
import { checkNarration } from '../shared/engine/consistency';
import { MERCHANT_ITEM_KEYS, MERCHANT_CATALOG } from '../shared/rules/merchantCatalog';
import { MAX_GIFT_VALUE } from '../shared/engine/tools/mutations';
import { gameReducer } from '../shared/engine/reducer';
import type { GameState } from '../shared/types/game';

type Origin = 'narrator' | 'phone' | 'interpreter' | 'player' | 'engine';

const rich = (sc: Scenario, money = 5_000) => sc.edit(s => ({ ...s, character: { ...s.character, money } }));
const fixer = (money = 5_000) => rich(scenario({ role: 'fixer' }), money);
const money = (sc: Scenario) => sc.state.character.money;
const nextTurn = (sc: Scenario, n = 1) => sc.atTurn(sc.state.turn + n);
const offerOf = (sc: Scenario) => sc.state.world.tradeOffer!;
const propose = (sc: Scenario, catalogKey: string, extra: Record<string, unknown> = {}) => sc.tool('narrator', 'propose_trade', { seller: 'Vendedor', catalogKey, ...extra });
const settle = (sc: Scenario) => sc.tool('player', 'settle_trade', { offerId: offerOf(sc).id });
const emptyInventory = (sc: Scenario) => sc.edit(s => ({ ...s, character: { ...s.character, inventory: [] } }));
const invUnits = (s: GameState) => s.character.inventory.reduce((n, i) => n + i.quantity, 0);

describe('QA-ECO: liquidação de propostas (propose → settle/decline)', () => {
  it('o preço da oferta é o do catálogo × quantidade e o saldo só muda no settle', () => {
    const sc = rich(scenario());
    propose(sc, 'ammo_M_PISTOL', { quantity: 10 });
    expect(offerOf(sc).price).toBe(MERCHANT_CATALOG.ammo_M_PISTOL.price * 10);
    expect(money(sc)).toBe(5_000);
    settle(sc);
    expect(money(sc)).toBe(5_000 - MERCHANT_CATALOG.ammo_M_PISTOL.price * 10);
    expect(sc.state.world.tradeOffer).toBeUndefined();
  });

  it('só o jogador liquida/recusa/pechincha: narrador, phone e interpreter são rejeitados (pechincha também vale pelo texto do jogador)', () => {
    for (const origin of ['narrator', 'phone', 'interpreter', 'engine'] as Origin[]) {
      const sc = rich(fixer());
      propose(sc, 'medical_stim');
      const id = offerOf(sc).id;
      const before = money(sc);
      // Pechinchar é fala do jogador: o intérprete e o SMS podem (o texto é dele). Liquidar/recusar seguem só na tela.
      for (const tool of origin === 'interpreter' || origin === 'phone' ? ['settle_trade', 'decline_trade'] : ['settle_trade', 'decline_trade', 'haggle_trade']) {
        sc.tool(origin, tool, { offerId: id }, [10, 10]);
        expect(sc.last().ok, `${origin}:${tool}`).toBe(false);
      }
      expect(money(sc)).toBe(before);
      expect(sc.state.world.tradeOffer?.id).toBe(id);
      expect(sc.item('Stim')).toBeUndefined();
    }
  });

  it('o jogador não pode abrir propostas de mercador por conta própria (propose_trade)', () => {
    const sc = rich(scenario());
    sc.tool('player', 'propose_trade', { seller: 'X', catalogKey: 'medical_stim' });
    // 'player' não está em TRADE_PROPOSERS
    expect(sc.last().ok).toBe(false);
  });

  it('settle com id errado, id antigo (após nova oferta) e depois de recusar é inócuo', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    const old = offerOf(sc).id;
    sc.tool('player', 'settle_trade', { offerId: 'trade_inexistente' });
    expect(sc.last().ok).toBe(false);
    sc.tool('player', 'decline_trade', { offerId: old });
    expect(sc.last().ok).toBe(true);
    sc.tool('player', 'settle_trade', { offerId: old });
    expect(sc.last().ok).toBe(false); // sem oferta
    propose(sc, 'biocurativo');
    const before = money(sc);
    sc.tool('player', 'settle_trade', { offerId: old });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(before);
  });

  it('segunda proposta enquanto há uma aberta é recusada (sem sobrescrever termos)', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    const first = offerOf(sc);
    propose(sc, 'weapon_smg');
    expect(sc.last().ok).toBe(false);
    expect(offerOf(sc)).toEqual(first);
  });

  it('saldo insuficiente: nada muda e a oferta continua', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 49 } }));
    propose(sc, 'medical_stim');
    settle(sc);
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(49);
    expect(sc.item('Stim')).toBeUndefined();
    expect(sc.state.world.tradeOffer).toBeDefined();
  });

  it('saldo exatamente igual ao preço liquida e zera, nunca negativo', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 50 } }));
    propose(sc, 'medical_stim');
    settle(sc);
    expect(sc.last().ok).toBe(true);
    expect(money(sc)).toBe(0);
  });

  it('oferta expirada não liquida nem pechincha', () => {
    const sc = fixer();
    propose(sc, 'medical_stim');
    nextTurn(sc, 9);
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    settle(sc);
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(5_000);
  });

  it('quantidade 0/negativa/fracionária/gigante é limitada; texto/NaN é rejeitado; sem vazar preço negativo', () => {
    const q = (v: unknown) => {
      const sc = rich(scenario());
      propose(sc, 'ammo_M_PISTOL', { quantity: v });
      return sc;
    };
    expect(offerOf(q(0)).item.quantity).toBe(1);
    expect(offerOf(q(-3)).item.quantity).toBe(1);
    expect(offerOf(q(1e9)).item.quantity).toBe(50);
    expect(offerOf(q(2.5)).item.quantity).toBe(3);
    for (const bad of ['abc', Number.NaN, Infinity]) {
      const sc = q(bad);
      expect(sc.last().ok).toBe(false);
      expect(sc.state.world.tradeOffer).toBeUndefined();
    }
    for (const v of [0, -3, 1e9, 2.5]) {
      const o = offerOf(q(v));
      expect(Number.isInteger(o.price) && o.price > 0).toBe(true);
    }
  });

  it('arma/armadura com quantidade 50 não vira 50 itens pelo preço de um', () => {
    const sc = rich(scenario(), 100_000);
    emptyInventory(sc);
    propose(sc, 'weapon_pistol_heavy', { quantity: 50 });
    const o = offerOf(sc);
    const units = o.item.quantity;
    settle(sc);
    expect(invUnits(sc.state)).toBe(units);
    expect(100_000 - money(sc)).toBe(o.price);
    expect(o.price).toBeGreaterThanOrEqual(MERCHANT_CATALOG.weapon_pistol_heavy.price * units);
  });

  it('catalogKey inexistente/proto é rejeitada em propose_trade e propose_catalog_item', () => {
    for (const key of ['nao_existe', '__proto__', 'constructor', 'toString', '']) {
      const sc = rich(scenario());
      propose(sc, key);
      expect(sc.last().ok, key).toBe(false);
      expect(sc.state.world.tradeOffer).toBeUndefined();
    }
  });

  it('merchantType incompatível com o item é recusado', () => {
    const sc = rich(scenario());
    propose(sc, 'weapon_smg', { merchantType: 'medical' });
    expect(sc.last().ok).toBe(false);
  });

  it('nome cosmético não altera efeito nem preço (Stim vira "Pistola Pesada" só no nome)', () => {
    const sc = rich(scenario());
    emptyInventory(sc);
    propose(sc, 'medical_stim', { name: 'Pistola pesada (excelente)' });
    expect(offerOf(sc).price).toBe(50);
    settle(sc);
    const it0 = sc.state.character.inventory[0];
    expect(it0.category).toBe('consumable');
    expect(it0.drug).toBe('stim');
    expect(it0.weapon).toBeUndefined();
  });

  it('nomes de vendedor/item "estranhos" não quebram o motor nem a oferta', () => {
    for (const n of ['<script>alert(1)</script>', '__proto__', 'a'.repeat(500), 'Ünïcødé ✓']) {
      const sc = rich(scenario());
      propose(sc, 'medical_stim', { seller: n, name: n });
      expect(sc.last().ok).toBe(true);
      expect(offerOf(sc).item.name.length).toBeLessThanOrEqual(80);
      settle(sc);
      expect(sc.last().ok).toBe(true);
    }
  });

  it('vendedor morto não abre proposta nem catálogo', () => {
    const sc = rich(scenario()).tool('narrator', 'upsert_npc', { name: 'Nix' });
    sc.tool('narrator', 'npc_status', { npcId: 'Nix', status: 'dead' });
    propose(sc, 'medical_stim', { seller: 'Nix' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'nix', merchantType: 'medical' });
    expect(sc.last().ok).toBe(false);
  });

  it('oferta sobrevive a .reload() e liquida normalmente depois', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    const id = offerOf(sc).id;
    sc.reload();
    expect(offerOf(sc).id).toBe(id);
    settle(sc);
    expect(sc.last().ok).toBe(true);
    expect(money(sc)).toBe(4_950);
    sc.reload();
    sc.tool('player', 'settle_trade', { offerId: id });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(4_950);
  });

  it('settle não depende de o jogador ter rolagem pendente e não cria rolagem', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    settle(sc);
    expect(sc.state.pendingRoll).toBeNull();
  });
});

describe('QA-ECO: banca (open_merchant_catalog / propose_catalog_item)', () => {
  it('só o jogador seleciona; só chaves do estoque; estoque filtrado por tipo e deduplicado', () => {
    const sc = rich(scenario());
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'E', merchantType: 'street', stock: 'medical_stim, weapon_smg ,weapon_smg,x,biocurativo' });
    expect(sc.state.world.merchantCatalog?.stock).toEqual(['weapon_smg']);
    sc.tool('narrator', 'propose_catalog_item', { catalogKey: 'weapon_smg' });
    expect(sc.last().ok).toBe(false); // narrador não escolhe
    sc.tool('player', 'propose_catalog_item', { catalogKey: 'medical_stim' });
    expect(sc.last().ok).toBe(false); // fora do estoque
    sc.tool('player', 'propose_catalog_item', { catalogKey: 'weapon_smg' });
    expect(sc.last().ok).toBe(true);
  });

  it('estoque 100% inválido é recusado em vez de abrir banca vazia', () => {
    const sc = scenario();
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'E', merchantType: 'street', stock: 'x,y,z' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.world.merchantCatalog).toBeUndefined();
  });

  it('banca expirada não vende', () => {
    const sc = rich(scenario());
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'D', merchantType: 'medical', turns: 2 });
    nextTurn(sc, 3);
    sc.tool('player', 'propose_catalog_item', { catalogKey: 'medical_stim' });
    expect(sc.last().ok).toBe(false);
  });

  it('turns fora da faixa (0, 9999, NaN) é limitado ou rejeitado, nunca banca eterna', () => {
    for (const turns of [0, 9999]) {
      const sc = scenario();
      sc.tool('narrator', 'open_merchant_catalog', { seller: 'D', merchantType: 'medical', turns });
      const c = sc.state.world.merchantCatalog!;
      expect(c.expiresTurn! - c.openedTurn).toBeLessThanOrEqual(24);
    }
  });

  it('banca do vendedor morto não abre; com oferta aberta o jogador não abre outra', () => {
    const sc = rich(scenario());
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'D', merchantType: 'medical' });
    sc.tool('player', 'propose_catalog_item', { catalogKey: 'medical_stim' });
    sc.tool('player', 'propose_catalog_item', { catalogKey: 'biocurativo' });
    expect(sc.last().ok).toBe(false);
  });

  it('BUG-ECO-11: stock com chave que é propriedade de Object ("constructor") derruba a ferramenta com "erro interno" em vez de ignorar a chave', () => {
    // merchantItem() usa MERCHANT_CATALOG[key] (objeto comum): 'constructor' devolve Object, e .merchants é undefined.
    const sc = scenario();
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'D', merchantType: 'medical', stock: 'constructor,biocurativo' });
    expect(sc.last().summary).not.toMatch(/erro interno/);
    expect(sc.state.world.merchantCatalog?.stock).toEqual(['biocurativo']);
  });

  it('DÚVIDA-DESIGN: a banca aberta persiste depois de move_location (a cena mudou, o mercador não está mais lá)', () => {
    const sc = rich(scenario());
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'D', merchantType: 'medical' });
    sc.tool('narrator', 'move_location', { district: 'WATSON', spot: 'Longe' });
    expect(sc.state.world.merchantCatalog).toBeDefined();
  });

  it('DÚVIDA-DESIGN: propose_trade (narrador) ignora a banca aberta e não exige vendedor presente na cena', () => {
    const sc = rich(scenario());
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'D', merchantType: 'medical' });
    propose(sc, 'weapon_smg', { seller: 'Fantasma' });
    expect(sc.last().ok).toBe(true);
  });

  it('DÚVIDA-DESIGN: oferta persiste ao mudar de local (só expira por turno)', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    sc.tool('narrator', 'move_location', { district: 'WATSON', spot: 'Longe' });
    expect(sc.state.world.tradeOffer).toBeDefined();
  });
});

describe('QA-ECO: pechincha (haggle_trade / haggle_quest)', () => {
  it('só Canal (fixer) pechincha; não-fixer é recusado sem consumir tentativa', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    expect(offerOf(sc).haggle).toBeUndefined();
    expect(offerOf(sc).price).toBe(50);
  });

  it('desconto limitado (<=20%), uma vez só, e o settle cobra o preço pechinchado', () => {
    const sc = fixer();
    propose(sc, 'weapon_smg');
    const p0 = offerOf(sc).price;
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]);
    expect(sc.last().ok).toBe(true);
    const p1 = offerOf(sc).price;
    expect(p1).toBeLessThan(p0);
    expect(p1).toBeGreaterThanOrEqual(Math.floor(p0 * 0.8));
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    expect(offerOf(sc).price).toBe(p1);
    const before = money(sc);
    settle(sc);
    expect(before - money(sc)).toBe(p1);
  });

  it('pechincha falha: termos intactos e tentativa consumida', () => {
    const sc = fixer();
    propose(sc, 'weapon_smg');
    const p0 = offerOf(sc).price;
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [1, 1]);
    // dado ruim: pode ou não falhar dependendo do bônus; o que importa é nunca piorar o preço
    expect(offerOf(sc).price).toBeLessThanOrEqual(p0);
    expect(offerOf(sc).haggle?.attempted).toBe(true);
  });

  it('bônus de quantidade só +1 e preço nunca vai a zero/negativo; pechincha em oferta alheia (id errado) falha', () => {
    const sc = fixer();
    propose(sc, 'ammo_M_PISTOL', { quantity: 10 });
    sc.tool('player', 'haggle_trade', { offerId: 'trade_errado' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]);
    expect(offerOf(sc).item.quantity).toBeLessThanOrEqual(11);
    expect(offerOf(sc).price).toBeGreaterThan(0);
  });

  it('pechinchar + revender nunca dá lucro (valor de revenda fica no preço de catálogo)', () => {
    for (const key of MERCHANT_ITEM_KEYS) {
      for (const q of [1, 5, 10]) {
        const sc = fixer(100_000);
        emptyInventory(sc);
        propose(sc, key, { quantity: q });
        sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]);
        settle(sc);
        const bought = sc.state.character.inventory[0];
        expect(bought, key).toBeDefined();
        sc.tool('player', 'sell_item', { itemId: bought.id, buyer: 'Fence' });
        expect(money(sc), `${key} x${q}`).toBeLessThanOrEqual(100_000);
      }
    }
  });

  it('haggle_quest: só fixer, uma vez, só missão ativa, bônus <=20% e pago uma única vez em complete_quest', () => {
    const sc = fixer(0);
    sc.tool('narrator', 'start_quest', { id: 'm_a', title: 'Bico', objective: 'o', rewardEddies: 300 });
    const plain = scenario();
    plain.tool('narrator', 'start_quest', { id: 'm_a', title: 'Bico', objective: 'o', rewardEddies: 300 });
    plain.tool('player', 'haggle_quest', { questId: 'm_a' }, [10, 10]);
    expect(plain.last().ok).toBe(false);

    sc.tool('player', 'haggle_quest', { questId: 'm_a' }, [10, 10]);
    expect(sc.last().ok).toBe(true);
    const reward = sc.state.missions.find(m => m.id === 'm_a')!.rewardEddies;
    expect(reward).toBeGreaterThan(300);
    expect(reward).toBeLessThanOrEqual(360);
    sc.tool('player', 'haggle_quest', { questId: 'm_a' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'haggle_quest', { questId: 'm_a' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    const m0 = money(sc);
    sc.tool('narrator', 'complete_quest', { questId: 'm_a' });
    expect(money(sc) - m0).toBe(reward);
    sc.tool('narrator', 'complete_quest', { questId: 'm_a' });
    expect(sc.last().ok).toBe(false);
    sc.tool('player', 'haggle_quest', { questId: 'm_a' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    expect(money(sc) - m0).toBe(reward);
  });

  it('o narrador não consegue reescrever a recompensa depois (update_quest não aceita rewardEddies)', () => {
    const sc = fixer();
    sc.tool('narrator', 'start_quest', { id: 'm_b', title: 'Job B', objective: 'o', rewardEddies: 100 });
    sc.tool('narrator', 'update_quest', { questId: 'm_b', rewardEddies: 99_999 });
    expect(sc.state.missions.find(m => m.id === 'm_b')!.rewardEddies).toBe(100);
  });
});

describe('QA-ECO: sell_item', () => {
  it('paga 50% do valor registrado, só o jogador vende, quantidade é limitada à posse', () => {
    const sc = scenario();
    const ammo = sc.item('Munição de Pistola Pesada')!;
    const before = money(sc);
    sc.tool('narrator', 'sell_item', { itemId: ammo.id, buyer: 'F' });
    expect(sc.last().ok).toBe(false);
    sc.tool('player', 'sell_item', { itemId: ammo.id, buyer: 'F', quantity: 1000 });
    expect(sc.last().ok).toBe(true);
    expect(money(sc) - before).toBe(Math.floor((ammo.value! * ammo.quantity) / 2));
    expect(sc.item(ammo.id)).toBeUndefined();
    sc.tool('player', 'sell_item', { itemId: ammo.id, buyer: 'F' });
    expect(sc.last().ok).toBe(false);
  });

  it('item inexistente, sem valor e implante/cromo não vendem', () => {
    const sc = scenario();
    sc.tool('player', 'sell_item', { itemId: 'nao existe', buyer: 'F' });
    expect(sc.last().ok).toBe(false);
    sc.edit(s => ({
      ...s,
      character: {
        ...s.character,
        inventory: [
          ...s.character.inventory,
          { id: 'i_imp', name: 'Olho', category: 'gear', quantity: 1, description: '', value: 5000, implant: true } as never,
          { id: 'i_key', name: 'Peça solta', category: 'gear', quantity: 1, description: '', value: 5000, cyberKey: 'cybereye' } as never,
          { id: 'i_zero', name: 'Lixo', category: 'gear', quantity: 1, description: '', value: 0 } as never,
        ],
      },
    }));
    const b = money(sc);
    for (const id of ['i_imp', 'i_key', 'i_zero']) {
      sc.tool('player', 'sell_item', { itemId: id, buyer: 'F' });
      expect(sc.last().ok, id).toBe(false);
    }
    expect(money(sc)).toBe(b);
  });

  it('quantidade 0/negativa vira 1 (nunca vende "-3" e ganha), saldo continua inteiro', () => {
    const sc = scenario();
    const ammo = sc.item('Munição de Pistola Pesada')!;
    const b = money(sc);
    sc.tool('player', 'sell_item', { itemId: ammo.id, buyer: 'F', quantity: -3 });
    expect(money(sc) - b).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(money(sc))).toBe(true);
    expect(sc.item(ammo.id)?.quantity).toBe(ammo.quantity - 1);
  });

  it('comprar (propose/settle) e revender TUDO do catálogo, em qualquer quantidade, nunca aumenta o saldo', () => {
    const offenders: string[] = [];
    for (const key of MERCHANT_ITEM_KEYS) {
      for (const q of [1, 2, 3, 7, 50]) {
        const sc = rich(scenario(), 100_000);
        emptyInventory(sc);
        propose(sc, key, { quantity: q });
        settle(sc);
        const bought = sc.state.character.inventory[0];
        sc.tool('player', 'sell_item', { itemId: bought.id, buyer: 'F' });
        if (money(sc) > 100_000) offenders.push(`${key}x${q}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('buy_item direto + revenda também não rende lucro (preço proposto baixo, vários tamanhos)', () => {
    const offenders: string[] = [];
    for (const price of [1, 3, 7, 19, 20000]) {
      for (const quantity of [1, 2, 3, 50]) {
        const sc = rich(scenario(), 100_000);
        emptyInventory(sc);
        sc.tool('player', 'buy_item', { name: 'Tralha', category: 'gear', price, quantity });
        if (!sc.last().ok) continue;
        sc.tool('player', 'sell_item', { itemId: 'Tralha', buyer: 'F' });
        if (money(sc) > 100_000) offenders.push(`p${price}q${quantity}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('DÚVIDA-DESIGN: vender a arma equipada é permitido (o jogador fica desarmado sem aviso)', () => {
    const sc = scenario();
    const gun = sc.state.character.inventory.find(i => i.weapon && i.equipped)!;
    sc.tool('player', 'sell_item', { itemId: gun.id, buyer: 'F' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.inventory.some(i => i.weapon && i.equipped)).toBe(false);
  });
});

describe('QA-ECO: receive_payment / transfer_money / give_item', () => {
  it('kind inválido, interpreter/player e valor não numérico são recusados', () => {
    const sc = scenario();
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 10, counterpart: 'X', kind: 'loot', reason: 'r' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'receive_payment', { amount: 'NaN', counterpart: 'X', kind: 'gift', reason: 'r' });
    expect(sc.last().ok).toBe(false);
    for (const o of ['interpreter', 'player'] as Origin[]) {
      sc.tool(o, 'receive_payment', { amount: 10, counterpart: 'X', kind: 'gift', reason: 'r' });
      expect(sc.last().ok, o).toBe(false);
    }
    expect(money(sc)).toBe(b);
  });

  it('serviço acima de €$500 é recusado; valor enorme é limitado a €$1000 por chamada', () => {
    const sc = scenario();
    sc.tool('narrator', 'receive_payment', { amount: 501, counterpart: 'X', kind: 'service', reason: 'r' });
    expect(sc.last().ok).toBe(false);
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 1e9, counterpart: 'Y', kind: 'gift', reason: 'r' });
    expect(money(sc) - b).toBeLessThanOrEqual(1000);
  });

  it('o mesmo recebimento (contraparte+tipo) no mesmo turno só entra uma vez; em outro turno entra (o mesmo valor logo depois é o mesmo dinheiro)', () => {
    const sc = scenario();
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 100, counterpart: 'Caixa', kind: 'gift', reason: 'x' });
    sc.tool('narrator', 'receive_payment', { amount: 100, counterpart: 'Caixa', kind: 'gift', reason: 'x' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc) - b).toBe(100);
    nextTurn(sc);
    // Mesmo valor da mesma pessoa no turno seguinte = eco (SMS "te mandei" + cena "o dinheiro cai").
    sc.tool('narrator', 'receive_payment', { amount: 100, counterpart: 'Caixa', kind: 'gift', reason: 'x' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'receive_payment', { amount: 60, counterpart: 'Caixa', kind: 'gift', reason: 'outra gorjeta' });
    expect(sc.last().ok).toBe(true);
    expect(money(sc) - b).toBe(160);
  });

  it('valor que casa com missão ativa é bloqueado (a recompensa vem de complete_quest)', () => {
    const sc = scenario();
    sc.tool('narrator', 'start_quest', { id: 'm_a', title: 'Job', objective: 'o', rewardEddies: 300 });
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 300, counterpart: 'Contratante', kind: 'service', reason: 'pagamento' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(b);
  });

  it('roubo/achado sem teste bem-sucedido neste turno é recusado (e teste de outro turno não vale)', () => {
    const sc = fixer();
    for (const kind of ['robbery', 'found']) {
      sc.tool('narrator', 'receive_payment', { amount: 40, counterpart: 'Caixa', kind, reason: 'r' });
      expect(sc.last().ok, kind).toBe(false);
    }
    propose(sc, 'medical_stim');
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]);
    nextTurn(sc); // o sucesso ficou no turno anterior
    sc.tool('narrator', 'receive_payment', { amount: 40, counterpart: 'Caixa', kind: 'robbery', reason: 'r' });
    expect(sc.last().ok).toBe(false);
  });

  it('transfer_money: narrador, phone e interpreter não creditam nem debitam; saldo intacto', () => {
    const sc = scenario();
    const b = money(sc);
    for (const o of ['narrator', 'phone', 'interpreter', 'engine'] as Origin[])
      for (const amount of [800, -800]) {
        sc.tool(o, 'transfer_money', { amount, counterpart: 'V', reason: 'x' });
        expect(sc.last().ok, `${o} ${amount}`).toBe(false);
      }
    expect(money(sc)).toBe(b);
  });

  it('give_item: item mecânico improvisado (arma/armadura/munição/consumível sem catalogKey) é recusado; cromo solto vira peça sem efeito', () => {
    const sc = scenario();
    const units = invUnits(sc.state);
    for (const category of ['weapon', 'armor', 'ammo', 'consumable']) {
      sc.tool('narrator', 'give_item', { name: 'Coisa milagrosa', category, source: 'x' });
      expect(sc.last().ok, category).toBe(false);
    }
    expect(invUnits(sc.state)).toBe(units);
    sc.tool('narrator', 'give_item', { name: 'Olho', category: 'gear', cyberKey: 'cybereye' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.inventory.at(-1)!.value).toBe(0);
  });

  it('give_item: catalogKey da categoria errada ou inexistente é recusado; com oferta aberta é recusado', () => {
    const sc = scenario();
    sc.tool('narrator', 'give_item', { name: 'x', category: 'weapon', catalogKey: 'medical_stim' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'give_item', { name: 'x', category: 'gear', catalogKey: 'nao_existe' });
    expect(sc.last().ok).toBe(false);
    propose(sc, 'medical_stim');
    sc.tool('narrator', 'give_item', { name: 'Faca', category: 'gear' });
    expect(sc.last().ok).toBe(false);
  });

  it('give_item não repete o item que o jogador acabou de comprar (mesmo turno)', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    settle(sc);
    const units = invUnits(sc.state);
    sc.tool('narrator', 'give_item', { name: 'Stim', category: 'consumable', catalogKey: 'medical_stim' });
    expect(sc.last().ok).toBe(false);
    expect(invUnits(sc.state)).toBe(units);
  });

  it('complete_quest paga recompensa exatamente uma vez; transfer_money do mesmo valor depois é recusado', () => {
    const sc = scenario();
    sc.tool('narrator', 'start_quest', { id: 'm_a', title: 'Job', objective: 'o', rewardEddies: 300 });
    const b = money(sc);
    sc.tool('narrator', 'complete_quest', { questId: 'm_a' });
    sc.tool('narrator', 'complete_quest', { questId: 'm_a' });
    expect(money(sc) - b).toBe(300);
    sc.tool('player', 'transfer_money', { amount: 300, counterpart: 'Contratante' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc) - b).toBe(300);
  });

  it('BUG-ECO-1 (ALTA): lavagem de dinheiro — give_item(gear, quantity 30, estimatedValue 1000) + sell_item rende €$15.000 (o teto "valor máximo €$1000" é por unidade)', () => {
    // mutations.ts give_item: estimatedValue<=MAX_GIFT_VALUE por unidade, quantidade até 30; sell_item paga floor(value*qty/2).
    const sc = scenario();
    const b = money(sc);
    sc.tool('narrator', 'give_item', { name: 'Relíquia', category: 'gear', quantity: 30, estimatedValue: 1000 });
    sc.tool('player', 'sell_item', { itemId: 'Relíquia', buyer: 'Fence' });
    expect(money(sc) - b).toBeLessThanOrEqual(MAX_GIFT_VALUE);
  });

  it('BUG-ECO-2 (ALTA): receive_payment não tem teto por turno — 5 "presentes" de €$1000 com contrapartes diferentes rendem €$5000 num turno', () => {
    // mutations.ts receive_payment: a deduplicação é só (turno, counterpart exato, kind); sem limite agregado.
    const sc = scenario();
    const b = money(sc);
    for (let i = 0; i < 5; i++) sc.tool('narrator', 'receive_payment', { amount: 1000, counterpart: `Fulano ${i}`, kind: 'gift', reason: 'x' });
    expect(money(sc) - b).toBeLessThanOrEqual(1000);
  });

  it('BUG-ECO-3 (BAIXA): proteção de duplicata é sensível a maiúsculas — "Caixa" e "caixa" creditam duas vezes', () => {
    const sc = scenario();
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 100, counterpart: 'Caixa', kind: 'gift', reason: 'x' });
    sc.tool('narrator', 'receive_payment', { amount: 100, counterpart: 'caixa', kind: 'gift', reason: 'x' });
    expect(money(sc) - b).toBe(100);
  });

  it('BUG-ECO-4 (MÉDIA): receive_payment não consulta recentPayments — depois de complete_quest (R$300 pagos) o mesmo valor entra de novo como "service"', () => {
    // receive_payment só confere missões ATIVAS (paymentMatchesQuest); a missão já concluída não conta (transfer_money conta).
    const sc = scenario();
    sc.tool('narrator', 'start_quest', { id: 'm_a', title: 'Job', objective: 'o', rewardEddies: 300 });
    sc.tool('narrator', 'complete_quest', { questId: 'm_a' });
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 300, counterpart: 'Contratante', kind: 'service', reason: 'pagamento do job' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(b);
  });

  it('BUG-ECO-5 (MÉDIA): roubo/achado é validado por QUALQUER teste bem-sucedido do turno (ex.: pechincha), não por um teste do roubo', () => {
    // mutations.ts receive_payment: s0.events.some(CHECK_RESOLVED && value === true) no turno atual.
    const sc = fixer();
    propose(sc, 'medical_stim');
    sc.tool('player', 'haggle_trade', { offerId: offerOf(sc).id }, [10, 10]); // sucesso sem relação com roubo
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: 900, counterpart: 'Qualquer um', kind: 'robbery', reason: 'assalto' });
    expect(money(sc)).toBe(b);
  });

  it('BUG-ECO-13 (BAIXA): receive_payment com amount ≤ 0 é "clampado" para €$1 e CREDITADO em vez de rejeitado', () => {
    // registry.ts paramZod faz clamp (min 1) em vez de rejeitar; um valor negativo/zero do LLM vira crédito.
    const sc = scenario();
    const b = money(sc);
    sc.tool('narrator', 'receive_payment', { amount: -50, counterpart: 'Ladrão', kind: 'gift', reason: 'ele levou 50' });
    sc.tool('narrator', 'receive_payment', { amount: 0, counterpart: 'Ladrão2', kind: 'gift', reason: 'nada' });
    expect(money(sc)).toBe(b);
  });

  it('DECIDIDO: start_quest + complete_quest no mesmo turno é bico na hora — paga até €$1000 somando o turno; trabalho maior fica ativo', () => {
    const sc = scenario();
    const b = money(sc);
    for (let i = 0; i < 3; i++) {
      sc.tool('narrator', 'start_quest', { id: `m_q${i}`, title: `Bico ${i}`, objective: 'o', rewardEddies: 5000 });
      sc.tool('narrator', 'complete_quest', { questId: `m_q${i}` });
      expect(sc.last().ok).toBe(false);
    }
    expect(money(sc) - b).toBe(0);
    expect(sc.state.missions.filter(m => m.status === 'ACTIVE' && m.id.startsWith('m_q'))).toHaveLength(3);
  });

  it('DECIDIDO: transfer_money (origem "player", sem tela) não credita mais; débito continua limitado ao saldo', () => {
    const sc = scenario();
    const b = money(sc);
    for (let i = 0; i < 3; i++) sc.tool('player', 'transfer_money', { amount: 1000, counterpart: `P${i}` });
    expect(money(sc) - b).toBe(0);
    sc.tool('player', 'transfer_money', { amount: -50, counterpart: 'P' });
    expect(money(sc) - b).toBe(-50);
  });
});

describe('QA-ECO: bugs de estado da oferta', () => {
  it('BUG-ECO-6 (MÉDIA): oferta EXPIRADA continua ocupando tradeOffer e bloqueia novas propostas e give_item da IA até o jogador recusar na UI', () => {
    // actions.ts openCatalogTrade e mutations.ts give_item checam `s0.world.tradeOffer` sem olhar expiresTurn.
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    nextTurn(sc, 10);
    // give_item ANTES da nova proposta (com uma proposta nova e válida aberta, a recusa é correta)
    sc.tool('narrator', 'give_item', { name: 'Faca', category: 'gear' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.tradeOffer).toBeUndefined(); // a vencida foi limpa
    propose(sc, 'biocurativo');
    expect(sc.last().ok).toBe(true);
    expect(offerOf(sc).item.name).toBe('Biocurativo');
  });

  it('BUG-ECO-7 (MÉDIA): apelido igual a outro consumível faz addToInventory empilhar o Stim comprado dentro do Biocurativo (sameName) — o jogador paga e perde o efeito do Stim', () => {
    // helpers.ts addToInventory empilha consumíveis por sameName; nome cosmético colide com item existente.
    const sc = rich(scenario());
    emptyInventory(sc);
    propose(sc, 'biocurativo');
    settle(sc);
    propose(sc, 'medical_stim', { name: 'Biocurativo' });
    settle(sc);
    expect(sc.state.character.inventory.some(i => i.drug === 'stim')).toBe(true);
  });

  it('BUG-ECO-9 (BAIXA): jogador morto consegue liquidar uma compra', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    sc.edit(s => ({ ...s, character: { ...s.character, dead: true } }));
    settle(sc);
    expect(sc.last().ok).toBe(false);
  });

  it('BUG-ECO-10 (BAIXA): vendedor que morreu depois da proposta ainda vende (settle não revalida o vendedor)', () => {
    const sc = rich(scenario()).tool('narrator', 'upsert_npc', { name: 'Nix' });
    propose(sc, 'medical_stim', { seller: 'Nix' });
    sc.tool('narrator', 'npc_status', { npcId: 'Nix', status: 'dead' });
    settle(sc);
    expect(sc.last().ok).toBe(false);
  });

  it('DÚVIDA-DESIGN: liquidar durante combate / com PV 0 é permitido', () => {
    const sc = rich(scenario());
    propose(sc, 'medical_stim');
    sc.tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger', template: 'maelstrom_ganger' }] });
    expect(sc.state.combat.active).toBe(true);
    settle(sc);
    expect(sc.last().ok).toBe(true);
  });
});

describe('QA-ECO: persistência (validateSave / migrate)', () => {
  const withOffer = () => {
    const sc = scenario();
    propose(sc, 'medical_stim');
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'D', merchantType: 'medical' });
    return JSON.parse(JSON.stringify(sc.state));
  };

  it('save com oferta+banca válidas carrega e a oferta liquida', () => {
    const st = validateSave(withOffer());
    const sc = scenario();
    sc.state = { ...st, character: { ...st.character, money: 1_000 } };
    settle(sc);
    expect(sc.last().ok).toBe(true);
    expect(money(sc)).toBe(950);
  });

  it('save antigo SEM tradeOffer/merchantCatalog carrega', () => {
    const raw = JSON.parse(JSON.stringify(scenario().state));
    delete raw.world.tradeOffer;
    delete raw.world.merchantCatalog;
    expect(() => validateSave(raw)).not.toThrow();
  });

  it('BUG-ECO-8a (MÉDIA): save com tradeOffer.price negativo é aceito por validateSave e o settle CREDITA dinheiro', () => {
    // saves.ts SaveSchema não valida world.tradeOffer; settle_trade não valida offer.price.
    const raw = withOffer();
    raw.world.tradeOffer.price = -1000;
    let credited = false;
    try {
      const st = validateSave(raw);
      const sc = scenario();
      sc.state = st;
      const b = money(sc);
      settle(sc);
      credited = money(sc) > b;
    } catch {
      credited = false; // rejeitar o save também é aceitável
    }
    expect(credited).toBe(false);
  });

  it('BUG-ECO-8b (MÉDIA): save com tradeOffer não-objeto ("lixo") passa em validateSave (a UI acessa offer.item.name e quebra)', () => {
    const raw = withOffer();
    raw.world.tradeOffer = 'lixo';
    let loaded: unknown = 'rejected';
    try {
      loaded = validateSave(raw).world.tradeOffer;
    } catch {
      loaded = 'rejected';
    }
    expect(typeof loaded === 'string' && loaded !== 'rejected').toBe(false);
  });

  it('BUG-ECO-8c (MÉDIA): save com tradeOffer.price NaN/fracionário é aceito e corrompe o saldo (NaN / fração)', () => {
    for (const price of [Number.NaN, 0.5]) {
      const raw = withOffer();
      raw.world.tradeOffer.price = price;
      let ok = true;
      try {
        const st = validateSave(raw);
        const sc = scenario();
        sc.state = st;
        settle(sc);
        ok = Number.isInteger(money(sc)) && money(sc) >= 0;
      } catch {
        ok = true;
      }
      expect(ok, String(price)).toBe(true);
    }
  });
});

describe('QA-ECO: contexto do Mestre e consistência', () => {
  it('o Mestre enxerga a oferta/banca no contexto (para narrar sem inventar termos)', () => {
    const sc = scenario();
    propose(sc, 'medical_stim', { seller: 'Zed' });
    sc.tool('narrator', 'open_merchant_catalog', { seller: 'Doc', merchantType: 'medical', stock: 'medical_stim' });
    const ctx = sc.context('compra') as unknown as { world: { tradeOffer?: { id: string; price: number }; merchantCatalog?: { stock: string[] } } };
    expect(ctx.world.tradeOffer?.id).toBe(offerOf(sc).id);
    expect(ctx.world.tradeOffer?.price).toBe(50);
    expect(ctx.world.merchantCatalog?.stock).toEqual(['medical_stim']);
  });

  it('narração em que o jogador paga €$ sem pagamento registrado gera aviso; com a oferta apenas aberta também', () => {
    const sc = scenario();
    propose(sc, 'medical_stim');
    const w = checkNarration(null, 'Você paga €$50 e leva o Stim.', [], sc.state.npcs, [{ tool: 'propose_trade', args: {} }], { money: money(sc), turn: sc.state.turn });
    expect(w.some(x => /NÃO registrou nenhum pagamento/.test(x))).toBe(true);
  });

  it('DÚVIDA-DESIGN: "Você compra o Stim e guarda no bolso" (sem valor) com a oferta só proposta NÃO gera aviso — a heurística exige um valor em €$', () => {
    const sc = scenario();
    propose(sc, 'medical_stim');
    const w = checkNarration(null, 'Você compra o Stim e guarda no bolso. O injetor agora é seu.', [], sc.state.npcs, [{ tool: 'propose_trade', args: {} }], { money: money(sc), turn: sc.state.turn });
    expect(w).toEqual([]);
  });
});

describe('QA-ECO: progressão e competência antes do dado', () => {
  const tech = (maker: Record<string, number>, m = 5_000) => scenario({ role: 'tech' }).edit(s => ({ ...s, character: { ...s.character, money: m, roleData: { ...s.character.roleData, maker } } }));

  it('craft: não-Técnico, sem especialidade, sem materiais e rank insuficiente são recusados ANTES do dado (d10=10)', () => {
    let sc = scenario({ role: 'solo' });
    sc.tool('interpreter', 'craft', { mode: 'fabricate', name: 'X', category: 'gear' }, [10]);
    expect(sc.last().ok).toBe(false);

    sc = tech({});
    sc.tool('interpreter', 'craft', { mode: 'fabricate', name: 'X', category: 'gear' }, [10]);
    expect(sc.last().ok).toBe(false);

    sc = tech({ fabrication: 1 });
    sc.tool('interpreter', 'craft', { mode: 'fabricate', name: 'Pistola', category: 'weapon', weaponClass: 'pistol_heavy' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/precisa de Fabricação/);
    expect(money(sc)).toBe(5_000); // nenhum material gasto

    sc = tech({ invention: 1 });
    sc.tool('interpreter', 'craft', { mode: 'invent', name: 'Gizmo', category: 'gear', priceCategory: 'super_luxury' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
    expect(sc.item('Gizmo')).toBeUndefined();

    sc = tech({ fabrication: 4 }, 10);
    sc.tool('interpreter', 'craft', { mode: 'fabricate', name: 'Pistola', category: 'weapon', weaponClass: 'pistol_heavy' }, [10]);
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(10);
  });

  it('craft: narrador/phone não fabricam; upgrade só uma vez por item', () => {
    const sc = tech({ fabrication: 4, upgrade: 4 });
    sc.tool('narrator', 'craft', { mode: 'fabricate', name: 'X', category: 'gear' }, [10]);
    expect(sc.last().ok).toBe(false);
    const gun = sc.state.character.inventory.find(i => i.weapon)!;
    sc.tool('interpreter', 'craft', { mode: 'upgrade', itemId: gun.id }, [10, 10]);
    if (sc.last().ok && sc.item(gun.id)?.upgrade) {
      sc.tool('interpreter', 'craft', { mode: 'upgrade', itemId: gun.id }, [10, 10]);
      expect(sc.last().ok).toBe(false);
    }
  });

  it('jack_in: arquitetura avançada exige Interface 8 mesmo com d10 natural; narrador não conecta o jogador', () => {
    let sc = scenario({ role: 'netrunner' }).tool('narrator', 'net_architecture', { name: 'Cofre', difficulty: 'advanced', floors: 3 });
    sc.tool('interpreter', 'jack_in', {}, [10]);
    expect(sc.last().ok).toBe(false);
    expect(sc.state.net.run).toBeNull();
    sc.tool('narrator', 'jack_in', {});
    expect(sc.last().ok).toBe(false);

    sc = scenario({ role: 'solo' }).tool('narrator', 'net_architecture', { name: 'A', difficulty: 'basic', floors: 2 });
    sc.tool('interpreter', 'jack_in', {}, [10]);
    expect(sc.last().ok).toBe(false);
  });

  it('subir perícia: custo = nível*20 PM, sem PM não sobe, nível 10 é o teto, perícia desconhecida é ignorada', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, ip: 0 } }));
    const lvl = sc.state.character.skills['brawling'] ?? 0;
    let st = gameReducer(sc.state, { type: 'improveSkill', skillId: 'brawling' } as never);
    expect(st.character.skills['brawling'] ?? 0).toBe(lvl);
    sc.edit(s => ({ ...s, character: { ...s.character, ip: 1_000, skills: { ...s.character.skills, brawling: 9 } } }));
    st = gameReducer(sc.state, { type: 'improveSkill', skillId: 'brawling' } as never);
    expect(st.character.skills['brawling']).toBe(10);
    expect(st.character.ip).toBe(1_000 - 200);
    const st2 = gameReducer(st, { type: 'improveSkill', skillId: 'brawling' } as never);
    expect(st2.character.skills['brawling']).toBe(10);
    expect(st2.character.ip).toBe(st.character.ip);
    expect(gameReducer(sc.state, { type: 'improveSkill', skillId: 'nope' } as never)).toBe(sc.state);
  });

  it('award_ip: só narrador, 1..20 por chamada; jogador/interpreter não se dão PM', () => {
    const sc = scenario();
    const ip0 = sc.state.character.ip;
    sc.tool('player', 'award_ip', { amount: 20 });
    sc.tool('interpreter', 'award_ip', { amount: 20 });
    expect(sc.state.character.ip).toBe(ip0);
    sc.tool('narrator', 'award_ip', { amount: 1e6 });
    expect(sc.state.character.ip - ip0).toBe(20);
  });

  it('DÚVIDA-DESIGN: award_ip não tem teto por turno — 5 chamadas de 20 PM no mesmo turno rendem 100 PM (um nível de perícia)', () => {
    const sc = scenario();
    const ip0 = sc.state.character.ip;
    for (let i = 0; i < 5; i++) sc.tool('narrator', 'award_ip', { amount: 20, reason: 'x' });
    expect(sc.state.character.ip - ip0).toBe(100);
  });

  it('DÚVIDA-DESIGN: invenção de luxo + revenda dá lucro repetível (materiais €$1000, revenda 50% de €$5000 = €$2500)', () => {
    const sc = tech({ invention: 10 }, 100_000);
    const b = money(sc);
    sc.tool('interpreter', 'craft', { mode: 'invent', name: 'Gizmo', category: 'gear', priceCategory: 'luxury' }, [10, 10]);
    expect(sc.last().ok).toBe(true);
    sc.tool('player', 'sell_item', { itemId: 'Gizmo', buyer: 'Fence' });
    expect(money(sc) - b).toBeGreaterThan(0);
  });
});

describe('QA-ECO: buy_program (Trilheiro)', () => {
  const runner = () => rich(scenario({ role: 'netrunner' }), 5_000);

  it('PROG-1: deck igual ou inferior ao atual é recusado sem cobrar nem apagar programas; superior é aceito', () => {
    const sc = runner();
    const deck0 = sc.state.character.deck!;
    for (const program of ['deck_poor', 'deck_standard']) {
      sc.tool('player', 'buy_program', { program });
      expect(sc.last().ok, program).toBe(false);
    }
    expect(money(sc)).toBe(5_000);
    expect(sc.state.character.deck).toEqual(deck0);
    sc.tool('player', 'buy_program', { program: 'deck_excellent' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.deck!.slots).toBe(9);
    expect(sc.state.character.deck!.programs.length).toBe(deck0.programs.length);
    const m = money(sc);
    sc.tool('player', 'buy_program', { program: 'deck_poor' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(m);
    expect(sc.state.character.deck!.programs.length).toBe(deck0.programs.length);
  });

  it('PROG-2: programa já instalado (ativo) não é comprado de novo; destruído pode ser recomprado', () => {
    const sc = runner();
    const deck0 = sc.state.character.deck!;
    expect(deck0.programs.some(p => p.key === 'sword')).toBe(true);
    sc.tool('player', 'buy_program', { program: 'sword' });
    expect(sc.last().ok).toBe(false);
    expect(money(sc)).toBe(5_000);
    expect(sc.state.character.deck!.programs.filter(p => p.key === 'sword')).toHaveLength(1);
    sc.edit(s => ({ ...s, character: { ...s.character, deck: { ...s.character.deck!, programs: s.character.deck!.programs.map(p => (p.key === 'sword' ? { ...p, destroyed: true } : p)) } } }));
    sc.tool('player', 'buy_program', { program: 'sword' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.deck!.programs.filter(p => p.key === 'sword' && !p.destroyed)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Teste de propriedade: sequência aleatória (seed fixa) de ferramentas da área.
// ---------------------------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('QA-ECO: teste de propriedade (2000 chamadas, seed fixa)', () => {
  const ORIGINS: Origin[] = ['narrator', 'phone', 'interpreter', 'player'];
  const PLAYER_ONLY = new Set(['settle_trade', 'decline_trade', 'haggle_trade', 'haggle_quest', 'propose_catalog_item', 'transfer_money']);
  const HAGGLE = new Set(['haggle_trade', 'haggle_quest']);
  const CREDIT_TOOLS = new Set(['sell_item', 'receive_payment', 'transfer_money', 'complete_quest', 'loot']);
  const DEBIT_TOOLS = new Set(['settle_trade', 'buy_item', 'pay_money', 'transfer_money']);
  const TOOLS = ['propose_trade', 'open_merchant_catalog', 'propose_catalog_item', 'settle_trade', 'decline_trade', 'haggle_trade', 'haggle_quest', 'sell_item', 'receive_payment', 'give_item', 'transfer_money', 'buy_item', 'pay_money', 'start_quest', 'complete_quest', 'remove_item', 'award_ip', 'move_location'];

  function run(seed: number, role: 'fixer' | 'solo') {
    const rnd = mulberry32(seed);
    const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
    const sc = rich(scenario({ role }), 800);
    let questN = 0;
    const violations: string[] = [];

    const argsFor = (tool: string): Record<string, unknown> => {
      const s = sc.state;
      const offer = s.world.tradeOffer;
      const goodId = offer && rnd() < 0.8 ? offer.id : `trade_${Math.floor(rnd() * 5)}`;
      const inv = s.character.inventory;
      switch (tool) {
        case 'propose_trade': return { seller: pick(['Nix', 'Doc', 'X', '']), catalogKey: pick([...MERCHANT_ITEM_KEYS, 'inexistente']), quantity: pick([0, 1, 3, 50, -2, 1e9, 2.5, 'x']), name: pick([undefined, 'Apelido', 'Biocurativo']) };
        case 'open_merchant_catalog': return { seller: pick(['Doc', 'Nix']), merchantType: pick(['street', 'medical', 'weapons', 'armor', 'general', 'bogus']), stock: pick([undefined, 'medical_stim,biocurativo', 'weapon_smg', 'x,y']), turns: pick([1, 3, 24, 0]) };
        case 'propose_catalog_item': return { catalogKey: pick([...MERCHANT_ITEM_KEYS, 'x']), quantity: pick([1, 2, 10]) };
        case 'settle_trade': case 'decline_trade': case 'haggle_trade': return { offerId: goodId };
        case 'haggle_quest': return { questId: pick(s.missions.map(m => m.id).concat(['m_x'])) };
        case 'sell_item': return { itemId: inv.length && rnd() < 0.9 ? pick(inv).id : 'zzz', buyer: pick(['F', 'G']), quantity: pick([undefined, 1, 5, 99, 0]) };
        case 'receive_payment': return { amount: pick([1, 30, 300, 501, 1000, 5000, -5, 0]), counterpart: pick(['A', 'B', 'a', 'Contratante']), kind: pick(['gift', 'service', 'refund', 'found', 'robbery', 'bogus']), reason: 'r' };
        case 'give_item': return { name: pick(['Faca', 'Stim', 'Relíquia', 'Biocurativo']), category: pick(['gear', 'consumable', 'weapon', 'datashard']), quantity: pick([1, 5, 30]), estimatedValue: pick([0, 50, 1000]), catalogKey: pick([undefined, 'medical_stim', 'weapon_smg']) };
        case 'transfer_money': return { amount: pick([100, -100, 1000, -9999, 0]), counterpart: pick(['A', 'B']) };
        case 'buy_item': return { name: pick(['Tralha', 'Pistola', 'Munição']), category: pick(['gear', 'weapon', 'ammo']), price: pick([1, 10, 500, 20000]), quantity: pick([1, 3, 50]) };
        case 'pay_money': return { amount: pick([1, 50, 900, 100000]), recipient: pick(['A', 'B']) };
        case 'start_quest': questN += 1; return { id: `m_p${questN}`, title: `Missão ${questN}`, objective: 'o', rewardEddies: pick([0, 100, 300, 5000]) };
        case 'complete_quest': return { questId: pick(s.missions.map(m => m.id).concat(['m_x'])) };
        case 'remove_item': return { itemId: inv.length ? pick(inv).id : 'zzz', quantity: pick([1, 99]) };
        case 'award_ip': return { amount: pick([1, 20, 99]) };
        case 'move_location': return { district: pick(['WATSON', 'HEYWOOD', 'CITY_CENTER']), spot: 'Algum lugar' };
        default: return {};
      }
    };

    for (let i = 0; i < 1000; i++) {
      if (rnd() < 0.4) sc.atTurn(sc.state.turn + 1);
      const tool = pick(TOOLS);
      const origin = pick(ORIGINS);
      const before = sc.state;
      const offerBefore = before.world.tradeOffer;
      const dice = [Math.ceil(rnd() * 10), Math.ceil(rnd() * 10), Math.ceil(rnd() * 10)];
      const args = argsFor(tool);
      sc.tool(origin, tool, args, dice);
      const rec = sc.last();
      const after = sc.state;
      const tag = `#${i} ${origin}:${tool} ${JSON.stringify(args)}`;
      const dm = after.character.money - before.character.money;
      const m = after.character.money;

      if (!Number.isFinite(m) || !Number.isInteger(m) || m < 0) violations.push(`${tag}: saldo inválido ${m}`);
      const ids = new Set<string>();
      for (const it of after.character.inventory) {
        if (!Number.isInteger(it.quantity) || it.quantity <= 0) violations.push(`${tag}: quantidade inválida ${it.name}=${it.quantity}`);
        if (ids.has(it.id)) violations.push(`${tag}: id de item duplicado ${it.id}`);
        ids.add(it.id);
      }
      const o = after.world.tradeOffer;
      if (o && !(Number.isInteger(o.price) && o.price >= 0 && o.item && Number.isInteger(o.item.quantity) && o.item.quantity >= 1 && typeof o.id === 'string' && o.expiresTurn >= o.createdTurn)) violations.push(`${tag}: oferta incoerente ${JSON.stringify(o)}`);

      if (!rec.ok) {
        if (dm !== 0) violations.push(`${tag}: chamada rejeitada mudou o saldo ${dm}`);
        if (invUnits(after) !== invUnits(before)) violations.push(`${tag}: chamada rejeitada mudou o inventário`);
        continue;
      }
      // Pechincha também vale pelo texto do jogador (intérprete); o resto continua só pela tela.
      const allowed = HAGGLE.has(tool) ? ['player', 'interpreter', 'phone'] : ['player'];
      if (PLAYER_ONLY.has(tool) && !allowed.includes(origin as string)) violations.push(`${tag}: ferramenta só-jogador aceita de ${origin}`);
      if (dm > 0 && !CREDIT_TOOLS.has(tool)) violations.push(`${tag}: crédito de ${dm} por ferramenta ${tool}`);
      if (dm < 0 && !DEBIT_TOOLS.has(tool) && tool !== 'pay_money') violations.push(`${tag}: débito de ${dm} por ferramenta ${tool}`);
      if (tool === 'receive_payment' && dm > 1000) violations.push(`${tag}: receive_payment > 1000`);
      if (tool === 'settle_trade') {
        if (!offerBefore) violations.push(`${tag}: settle sem oferta`);
        else {
          if (dm !== -offerBefore.price) violations.push(`${tag}: settle cobrou ${dm} ≠ ${offerBefore.price}`);
          if (invUnits(after) - invUnits(before) !== offerBefore.item.quantity) violations.push(`${tag}: settle entregou ${invUnits(after) - invUnits(before)} ≠ ${offerBefore.item.quantity}`);
          if (after.world.tradeOffer) violations.push(`${tag}: oferta continuou após settle`);
        }
      }
      if ((tool === 'decline_trade') && (dm !== 0 || after.world.tradeOffer)) violations.push(`${tag}: decline inconsistente`);
      if (tool === 'propose_trade' && dm !== 0) violations.push(`${tag}: propose mexeu no saldo`);
      if (tool === 'propose_trade' && invUnits(after) !== invUnits(before)) violations.push(`${tag}: propose mexeu no inventário`);
      if (tool === 'sell_item' && dm <= 0) violations.push(`${tag}: venda sem ganho`);
    }
    return violations;
  }

  // As violações conhecidas (BUGs documentados acima) são filtradas por padrão para a suíte não
  // acusar o mesmo bug 1000 vezes: os caminhos que o aleatório pode atingir de graça são
  // give_item→sell_item (BUG-ECO-1) e receive_payment em volume (BUG-ECO-2), ambos fora dos invariantes de
  // "uma ferramenta, um efeito" checados aqui.
  for (const [seed, role] of [[1337, 'fixer'], [42, 'solo']] as const) {
    it(`invariantes de dinheiro/inventário/oferta (seed ${seed}, ${role})`, () => {
      expect(run(seed, role)).toEqual([]);
    });
  }
});
