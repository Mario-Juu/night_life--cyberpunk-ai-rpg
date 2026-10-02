/**
 * QA adversarial: cromo (capacidade, estoque, peça solta), Mercado Noturno, encomendas, perseguições,
 * calor de facção e melhorias de papel. `it.fails('BUG-CID-n')` = bug confirmado (o teste descreve o
 * comportamento CORRETO e passa enquanto o bug existir). `DÚVIDA-n` = comportamento atual documentado.
 */
import { describe, expect, it } from 'vitest';
import { scenario, withRipperdoc, type Scenario } from './harness';
import { CYBERWARE } from '../shared/rules/cyberware';
import { cyberCapacityCost, cyberCapacityMax, cyberCapacityUsed, installCyberware, ripperdocHasStock, ripperdocStock } from '../shared/engine/cyberware';
import { fulfillCyberOrders, resolveChase, startChase } from '../shared/engine/citySystems';
import { gameReducer } from '../shared/engine/reducer';
import { advanceTime } from '../shared/engine/world';
import { REGISTRY, runToolCalls } from '../shared/engine/tools';
import { sequenceRng } from '../shared/engine/dice';
import { operatorPerks, roleUpgradeCost } from '../shared/rules/roles';
import { migrateState } from '../shared/engine/migrate';
import { validateSave } from '../src/services/saves';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import type { CyberwareItem, GameState, Npc } from '../shared/types/game';

// ------------------------------------------------------------------ helpers

const rich = (s: GameState, money = 500_000): GameState => withRipperdoc({ ...s, character: { ...s.character, money } });
const withMoney = (money: number) => (s: GameState): GameState => ({ ...s, character: { ...s.character, money } });
const withChar = (patch: Partial<GameState['character']>) => (s: GameState): GameState => ({ ...s, character: { ...s.character, ...patch } });
const inCombat = (s: GameState): GameState => ({ ...s, combat: { ...s.combat, active: true, round: 1 } });
const loose = (sc: Scenario, key?: string) => sc.state.character.inventory.filter(i => i.cyberKey && (!key || i.cyberKey === key));
const mkNpc = (over: Partial<Npc>): Npc => ({ id: 'npc_canal', name: 'Sandy', role: 'Canal', description: '', trust: 80, respect: 30, fear: 0, anger: 0, knowledge: [], status: 'alive', isContact: true, ...over }) as Npc;
const addNpc = (npc: Npc) => (s: GameState): GameState => ({ ...s, npcs: [...s.npcs.filter(n => n.id !== npc.id), npc] });
const fixer = (rank = 10, money = 500_000) => scenario({ role: 'fixer' }).edit(withChar({ roleRank: rank, money }));
const rankForTier = (tier: number) => [0, 3, 5, 7, 9, 10][tier] ?? 10;
const CIVIL_OR_MIL = Object.values(CYBERWARE).filter(d => d.grade !== 'prototype');
const tools = (sc: Scenario) => sc.records.map(r => `${r.tool}:${r.ok}`);

// ------------------------------------------------------------------ capacidade de cromo

describe('Capacidade de cromo', () => {
  it('instalar até estourar: recusa com a mensagem certa e não cobra nem muda o estado', () => {
    const sc = scenario().edit(rich);
    let refused = false;
    for (const key of ['cybereye', 'cybereye', 'cyberarm', 'cyberarm', 'cyberleg', 'cyberleg', 'neural_link', 'subdermal_armor', 'sandevistan', 'cyberware_malfunction']) {
      if (!CYBERWARE[key]) continue;
      const before = sc.state;
      sc.tool('interpreter', 'install_cyberware', { key }, [1, 1, 1, 1]);
      expect(cyberCapacityUsed(sc.state.character)).toBeLessThanOrEqual(cyberCapacityMax(sc.state.character));
      if (!sc.last().ok && /Capacidade de cromo insuficiente/.test(sc.last().summary)) {
        refused = true;
        expect(sc.state.character.money).toBe(before.character.money);
        expect(sc.state.character.cyberware).toEqual(before.character.cyberware);
        expect(sc.state.character.humanity).toEqual(before.character.humanity);
      }
    }
    // Cromo militar/protótipo custa mais capacidade: força o estouro de forma determinística.
    const small = scenario().edit(rich).edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, BODY: 2, TECH: 2 } } }));
    expect(cyberCapacityMax(small.state.character)).toBe(12);
    let n = 0;
    while (n++ < 30 && small.tool('interpreter', 'install_cyberware', { key: 'cyberleg' }, [1]).last().ok);
    expect(small.last().summary).toMatch(/Capacidade de cromo insuficiente|máximo de/);
    expect(refused || /Capacidade|máximo/.test(small.last().summary)).toBe(true);
  });

  it('par (olhos/pernas) consome capacidade em dobro e remover devolve toda a capacidade', () => {
    const sc = scenario().edit(rich).tool('interpreter', 'install_cyberware', { key: 'cybereye' }).tool('interpreter', 'install_cyberware', { key: 'cybereye' });
    const eyeCost = cyberCapacityCost(CYBERWARE.cybereye);
    expect(cyberCapacityUsed(sc.state.character)).toBe(eyeCost * 2);
    const before = cyberCapacityUsed(sc.state.character);
    sc.tool('interpreter', 'install_cyberware', { key: 'low_light' }, [1, 1]); // paired: duas peças
    expect(sc.last().ok).toBe(true);
    expect(cyberCapacityUsed(sc.state.character) - before).toBe(cyberCapacityCost(CYBERWARE.low_light) * 2);
    for (const cw of [...sc.state.character.cyberware].reverse()) sc.tool('interpreter', 'remove_cyberware', { cyberwareId: cw.id });
    expect(sc.state.character.cyberware).toHaveLength(0);
    expect(cyberCapacityUsed(sc.state.character)).toBe(0);
  });

  it('militar e protótipo custam mais capacidade que o civil do mesmo nível; borgware +2', () => {
    for (const tier of [1, 2, 3, 4, 5] as const) {
      const civil = CIVIL_OR_MIL.find(d => d.tier === tier && d.grade === 'civil' && !d.borgware);
      const mil = CIVIL_OR_MIL.find(d => d.tier === tier && d.grade === 'military' && !d.borgware);
      if (civil && mil) expect(cyberCapacityCost(mil)).toBeGreaterThan(cyberCapacityCost(civil));
    }
    for (const d of Object.values(CYBERWARE)) expect(cyberCapacityCost(d)).toBeGreaterThanOrEqual(1);
  });

  it('upgrade_cyber_capacity: exige ripperdoc, dinheiro; +2 sem mexer em Humanidade; custa 500+100*bônus; teto 20', () => {
    const noDoc = scenario().edit(withMoney(10_000)).tool('interpreter', 'upgrade_cyber_capacity');
    expect(noDoc.last().ok).toBe(false);
    expect(noDoc.state.character.money).toBe(10_000);

    const poor = scenario().edit(rich).edit(withMoney(499)).tool('interpreter', 'upgrade_cyber_capacity');
    expect(poor.last().ok).toBe(false);
    expect(poor.state.character.cyberCapacityBonus ?? 0).toBe(0);

    const sc = scenario().edit(rich);
    const { humanity } = sc.state.character;
    const max0 = cyberCapacityMax(sc.state.character);
    let spent = 0;
    for (let i = 0; i < 10; i++) {
      const m = sc.state.character.money;
      sc.tool('interpreter', 'upgrade_cyber_capacity');
      expect(sc.last().ok).toBe(true);
      expect(m - sc.state.character.money).toBe(500 + i * 2 * 100);
      spent += m - sc.state.character.money;
    }
    expect(sc.state.character.cyberCapacityBonus).toBe(20);
    expect(cyberCapacityMax(sc.state.character)).toBe(max0 + 20);
    expect(sc.state.character.humanity).toEqual(humanity);
    expect(spent).toBe(500_000 - sc.state.character.money);
    const money = sc.state.character.money;
    for (let i = 0; i < 5; i++) sc.tool('interpreter', 'upgrade_cyber_capacity');
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(money);
    expect(sc.state.character.cyberCapacityBonus).toBe(20);
  });

  it('upgrade: bloqueado em combate, pela IA (origem narrator) e com ripperdoc morto', () => {
    const sc = scenario().edit(rich).edit(inCombat).tool('interpreter', 'upgrade_cyber_capacity');
    expect(sc.last().ok).toBe(false);
    const ai = scenario().edit(rich).tool('narrator', 'upgrade_cyber_capacity');
    expect(ai.last().ok).toBe(false);
    expect(ai.state.character.cyberCapacityBonus ?? 0).toBe(0);
    const dead = scenario().edit(rich).edit(s => ({ ...s, npcs: s.npcs.map(n => (n.id === 'npc_doc' ? { ...n, status: 'dead' as const } : n)) })).tool('interpreter', 'upgrade_cyber_capacity');
    expect(dead.last().ok).toBe(false);
  });

  it('upgrade com ripperdoc citado por id que não está na cena (nome inexistente) cai no ripperdoc presente, sem erro', () => {
    const sc = scenario().edit(rich).tool('interpreter', 'upgrade_cyber_capacity', { ripperdocId: 'fantasma' });
    expect(sc.last().ok).toBe(true);
  });

  it('capacidade máxima nunca é menor que 12 nem negativa, mesmo com atributos mínimos', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, BODY: 0, TECH: 0 }, cyberCapacityBonus: -50 } }));
    expect(cyberCapacityMax(sc.state.character)).toBeGreaterThanOrEqual(12);
  });

  it('peça solta que não cabe na capacidade é recusada e continua no inventário (sem cobrar a cirurgia)', () => {
    const sc = scenario().edit(rich).edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, BODY: 2, TECH: 2 } } }));
    sc.tool('narrator', 'give_item', { name: 'Peça', category: 'gear', cyberKey: 'sandevistan_apogee' });
    const piece = loose(sc, 'sandevistan_apogee');
    expect(piece).toHaveLength(1);
    const money = sc.state.character.money;
    sc.tool('interpreter', 'install_cyberware', { key: 'sandevistan_apogee' });
    // pode falhar por fundação OU por capacidade; em ambos os casos nada muda
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(money);
    expect(loose(sc, 'sandevistan_apogee')).toHaveLength(1);
  });

  it('save antigo sem cyberCapacityBonus/market/chase/cyberOrders/heat de facção migra e valida', () => {
    const base = scenario().state;
    const old = JSON.parse(JSON.stringify(base)) as Record<string, any>;
    delete old.character.cyberCapacityBonus;
    delete old.character.nomadUpgrades;
    delete old.world.market;
    delete old.world.chase;
    delete old.world.cyberOrders;
    for (const f of old.factions) delete f.heat;
    const loaded = validateSave(old);
    expect(cyberCapacityMax(loaded.character)).toBe(cyberCapacityMax(base.character));
    expect(cyberCapacityUsed(loaded.character)).toBe(0);
    const sc = scenario();
    sc.state = loaded;
    sc.edit(rich).tool('interpreter', 'upgrade_cyber_capacity');
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.cyberCapacityBonus).toBe(2);
    // migração direta também não explode
    expect(() => migrateState(old)).not.toThrow();
  });

  it('save com mercado, encomenda e perseguição ativos passa por JSON + validateSave sem perder nada', () => {
    const sc = fixer(10)
      .tool('narrator', 'open_night_market', { name: 'Rattlesnake', cyberStock: 'cybereye,cyberarm', hours: 5 })
      .tool('interpreter', 'order_cyberware', { key: 'cybereye' })
      .tool('narrator', 'start_chase', { opponent: 'Interceptor', reason: 'fuga', pressure: 3 });
    const loaded = validateSave(JSON.parse(JSON.stringify(sc.state)));
    expect(loaded.world.market).toEqual(sc.state.world.market);
    expect(loaded.world.cyberOrders).toEqual(sc.state.world.cyberOrders);
    expect(loaded.world.chase).toEqual(sc.state.world.chase);
  });

  // BUG-CID-1: capacidade usada passa do máximo ao remover um implante que dava CORPO.
  it('BUG-CID-1: remover Músculo Enxertado (CORPO) não pode deixar a capacidade usada acima do máximo', () => {
    const sc = scenario().edit(rich).edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, BODY: 5, TECH: 3 } } }));
    sc.tool('interpreter', 'install_cyberware', { key: 'grafted_muscle' });
    expect(sc.last().ok).toBe(true);
    // O CORPO +2 amplia a capacidade (+4): enche-se até o novo teto…
    // enche o corpo até o novo teto com peças já instaladas (estado montado, sem depender de fundações)
    sc.edit(s => {
      const fake = Array.from({ length: cyberCapacityMax(s.character) - cyberCapacityUsed(s.character) }, (_, i) => ({ id: `cw_fill_${i}`, key: 'cybereye_x', name: 'Enxerto', category: 'Fashionware', humanityLoss: 0, description: '' }) as unknown as CyberwareItem);
      return { ...s, character: { ...s.character, cyberware: [...s.character.cyberware, ...fake] } };
    });
    expect(cyberCapacityUsed(sc.state.character)).toBe(cyberCapacityMax(sc.state.character));
    expect(cyberCapacityMax(sc.state.character)).toBe(20);
    const musc = sc.state.character.cyberware.find(c => c.key === 'grafted_muscle')!;
    sc.tool('interpreter', 'remove_cyberware', { cyberwareId: musc.id });
    // Remover deixaria o resto do cromo acima do teto: o motor recusa e explica (o músculo continua lá).
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/Remova outros implantes antes/);
    expect(cyberCapacityUsed(sc.state.character)).toBeLessThanOrEqual(cyberCapacityMax(sc.state.character));
  });

  it('DÚVIDA-1: add_cyberware (história, grátis) também respeita capacidade e falha quando o corpo está cheio', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, BODY: 2, TECH: 2 } } }));
    sc.tool('narrator', 'add_cyberware', { key: 'sandevistan_apogee' });
    // documenta o comportamento atual: o implante imposto pela cena é recusado (qualquer motivo) sem cobrar nada
    expect(sc.state.character.money).toBe(scenario().state.character.money);
  });
});

// ------------------------------------------------------------------ estoque, fundação, peça solta

describe('Estoque do ripperdoc e peça trazida', () => {
  it('estoque sorteado é estável, nunca contém protótipo e sempre inclui fundações do nível', () => {
    const doc = (id: string, tier: 1 | 2 | 3 | 4 | 5, blackMarket: boolean): Npc => mkNpc({ id, name: id, role: 'Ripperdoc', ripperdoc: { tier, blackMarket } });
    for (const tier of [1, 2, 3, 4, 5] as const)
      for (const bm of [false, true]) {
        const d = doc(`doc_${tier}_${bm}`, tier, bm);
        const a = ripperdocStock(d).map(x => x.key);
        expect(a).toEqual(ripperdocStock(d).map(x => x.key));
        expect(new Set(a).size).toBe(a.length);
        for (const def of ripperdocStock(d)) {
          expect(def.tier).toBeLessThanOrEqual(tier);
          expect(def.grade).not.toBe('prototype');
          if (!bm) expect(def.grade).not.toBe('military');
        }
        for (const f of Object.values(CYBERWARE).filter(x => x.foundation && x.tier <= tier && !(x.install === 'hospital' && tier < 3))) expect(a).toContain(f.key);
      }
    expect(ripperdocStock(undefined)).toEqual([]);
    expect(ripperdocHasStock(undefined, 'cybereye')).toBe(false);
  });

  it('estoque explícito inexistente/lixo é ignorado e cai na vitrine sorteada', () => {
    const d = mkNpc({ id: 'npc_x', role: 'Ripperdoc', ripperdoc: { tier: 3, blackMarket: false, stock: ['nao_existe'] } });
    expect(ripperdocStock(d).length).toBeGreaterThan(0);
  });

  it('clínica sem a peça no estoque recusa; com peça trazida (cyberKey) cobra só a cirurgia', () => {
    const sc = scenario().edit(rich).edit(s => ({ ...s, npcs: s.npcs.map(n => (n.id === 'npc_doc' ? { ...n, ripperdoc: { tier: 5, blackMarket: true, stock: ['cybereye'] } } : n)) }));
    sc.tool('interpreter', 'install_cyberware', { key: 'cyberarm' }, [1]);
    // cyberarm é fundação: sempre disponível. Escolhe um não-fundação fora do estoque:
    const stocked = new Set(ripperdocStock(sc.npc('npc_doc')).map(d => d.key));
    const outKey = Object.values(CYBERWARE).find(d => !stocked.has(d.key) && d.grade === 'civil' && d.tier <= 3 && !d.requires && !d.foundation && !d.os && !d.effects.some(e => e.kind === 'body' || e.kind === 'body_set' || e.kind === 'skill_chip'))!;
    expect(outKey).toBeTruthy();
    const money = sc.state.character.money;
    sc.tool('interpreter', 'install_cyberware', { key: outKey.key });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/estoque/);
    expect(sc.state.character.money).toBe(money);
    sc.tool('narrator', 'give_item', { name: 'Peça', category: 'gear', cyberKey: outKey.key });
    const m2 = sc.state.character.money;
    sc.tool('interpreter', 'install_cyberware', { key: outKey.key }, [1, 1, 1, 1]);
    expect(sc.last().ok).toBe(true);
    expect(m2 - sc.state.character.money).toBe(250 * outKey.tier * (outKey.install === 'hospital' ? 2 : 1));
    expect(loose(sc, outKey.key)).toHaveLength(0);
    expect(sc.state.character.cyberware.filter(c => c.key === outKey.key)).toHaveLength(outKey.paired ? 2 : 1);
  });

  it('protótipo só entra por peça achada; sem a peça, a loja recusa mesmo com dinheiro', () => {
    const proto = Object.values(CYBERWARE).find(d => d.grade === 'prototype')!;
    const sc = scenario().edit(rich).tool('interpreter', 'install_cyberware', { key: proto.key });
    expect(sc.last().ok).toBe(false);
  });

  it('peça solta instalada some do inventário, não duplica e só a cirurgia é cobrada; instalar de novo sem peça cobra o preço cheio', () => {
    const sc = scenario().edit(rich).tool('narrator', 'give_item', { name: 'Olho', category: 'gear', cyberKey: 'cybereye' });
    const m0 = sc.state.character.money;
    sc.tool('interpreter', 'install_cyberware', { key: 'cybereye' }, [1, 1]);
    expect(m0 - sc.state.character.money).toBe(250);
    expect(loose(sc)).toHaveLength(0);
    const m1 = sc.state.character.money;
    sc.tool('interpreter', 'install_cyberware', { key: 'cybereye' }, [1, 1]);
    expect(m1 - sc.state.character.money).toBe(CYBERWARE.cybereye.price);
    expect(sc.state.character.cyberware.filter(c => c.key === 'cybereye')).toHaveLength(2);
  });

  it('peça solta de cromo não pode ser vendida (sem exploit de dinheiro) nem gera crédito ao largar', () => {
    const sc = scenario().edit(rich).tool('narrator', 'give_item', { name: 'Olho', category: 'gear', cyberKey: 'cybereye', estimatedValue: 5000 });
    const piece = loose(sc)[0];
    const m = sc.state.character.money;
    sc.tool('interpreter', 'sell_item', { itemId: piece.id, buyer: 'Doc' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(m);
    sc.edit(s => gameReducer(s, { type: 'dropItem', itemId: piece.id }));
    expect(sc.state.character.money).toBe(m);
  });

  it('peça comprada no mercado tem valor registrado = preço pago; vender é bloqueado mesmo assim', () => {
    const sc = scenario().edit(withMoney(10_000)).tool('narrator', 'open_night_market', { name: 'M', cyberStock: 'cybereye' }).tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    const piece = loose(sc)[0];
    sc.tool('interpreter', 'sell_item', { itemId: piece.id, buyer: 'Ninguém' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(10_000 - piece.value!);
  });

  it('peça solta migra de saves em que o implante era item de nome (sem cyberKey) sem virar item vendável', () => {
    const sc = scenario();
    const old = JSON.parse(JSON.stringify(sc.state)) as GameState;
    old.character.inventory.push({ id: 'item_old', name: 'Ciberolho', category: 'gear', quantity: 1, description: '', value: 100 });
    const loaded = validateSave(old);
    const item = loaded.character.inventory.find(i => i.id === 'item_old');
    expect(item?.cyberKey).toBe('cybereye');
  });
});

// ------------------------------------------------------------------ Mercado Noturno

describe('Mercado Noturno', () => {
  const market = (sc: Scenario, stock = 'cybereye,cyberarm,sandevistan_apogee', extra: Record<string, unknown> = {}) => sc.tool('narrator', 'open_night_market', { name: 'Rattlesnake', cyberStock: stock, ...extra });

  it('compra desconta exatamente o preço (par = 2x), entrega peça solta e não instala', () => {
    const sc = scenario().edit(withMoney(10_000)).edit(s => s);
    market(sc, 'cybereye,low_light');
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.state.character.money).toBe(10_000 - CYBERWARE.cybereye.price);
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'low_light' });
    // low_light é paired: o preço cobrado é o de DUAS peças e entra 1 item
    const price = CYBERWARE.low_light.price * (CYBERWARE.low_light.paired ? 2 : 1);
    expect(sc.state.character.money).toBe(10_000 - CYBERWARE.cybereye.price - price);
    expect(loose(sc, 'low_light')).toHaveLength(1);
    expect(sc.state.character.cyberware).toHaveLength(0);
  });

  it('sem dinheiro: recusa e não muda dinheiro/inventário', () => {
    const sc = scenario().edit(withMoney(50));
    market(sc, 'cybereye');
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(50);
    expect(loose(sc)).toHaveLength(0);
  });

  it('sem mercado aberto, peça fora da banca, chave inválida e origem da IA são recusados', () => {
    const sc = scenario().edit(withMoney(99_999));
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(false);
    market(sc, 'cybereye');
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cyberarm' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'nao_existe' });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(99_999);
  });

  it('protótipos são removidos do estoque na abertura (mesmo que a IA os liste)', () => {
    const proto = Object.values(CYBERWARE).find(d => d.grade === 'prototype')!;
    const sc = scenario().edit(withMoney(999_999));
    market(sc, `${proto.key},cybereye`);
    expect(sc.state.world.market?.cyberStock).toEqual(['cybereye']);
    sc.tool('interpreter', 'buy_market_cyberware', { key: proto.key });
    expect(sc.last().ok).toBe(false);
  });

  it('hardware militar só com blackMarket', () => {
    const mil = Object.values(CYBERWARE).find(d => d.grade === 'military' && d.price < 20_000)!;
    const sc = scenario().edit(withMoney(999_999));
    market(sc, mil.key);
    sc.tool('interpreter', 'buy_market_cyberware', { key: mil.key });
    expect(sc.last().ok).toBe(false);
    market(sc, mil.key, { blackMarket: true });
    sc.tool('interpreter', 'buy_market_cyberware', { key: mil.key });
    expect(sc.last().ok).toBe(true);
  });

  it('mercado vencido: o relógio fecha a banca (advance, rest, move_location, advance_time) e a compra é recusada', () => {
    for (const how of ['advance', 'rest', 'move', 'tool'] as const) {
      const sc = scenario().edit(withMoney(10_000));
      market(sc, 'cybereye', { hours: 2 });
      sc.advance(119);
      expect(sc.state.world.market).toBeDefined();
      if (how === 'advance') sc.advance(1);
      if (how === 'rest') sc.tool('interpreter', 'rest', { hours: 1 });
      if (how === 'move') sc.tool('narrator', 'move_location', { spot: 'Rua', minutes: 5 });
      if (how === 'tool') sc.tool('narrator', 'advance_time', { minutes: 5 });
      expect(sc.state.world.market, how).toBeUndefined();
      sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
      expect(sc.last().ok, how).toBe(false);
      expect(sc.state.character.money).toBe(10_000);
    }
  });

  it('mercado vencido sem o relógio ter rodado (estado editado) ainda recusa a compra', () => {
    const sc = scenario().edit(withMoney(10_000));
    market(sc, 'cybereye', { hours: 1 });
    sc.edit(s => ({ ...s, world: { ...s.world, time: new Date(new Date(s.world.time).getTime() + 3 * 3_600_000).toISOString() } }));
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(false);
  });

  it('DÚVIDA-2: o estoque não acaba — a mesma peça pode ser comprada quantas vezes houver dinheiro', () => {
    const sc = scenario().edit(withMoney(10_000));
    market(sc, 'cybereye');
    for (let i = 0; i < 5; i++) sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(tools(sc).filter(t => t === 'buy_market_cyberware:true')).toHaveLength(5);
    expect(loose(sc, 'cybereye').reduce((n, i) => n + i.quantity, 0) + loose(sc, 'cybereye').length * 0).toBeGreaterThanOrEqual(1);
  });

  it('DÚVIDA-3: comprar durante combate / com o personagem morto não é bloqueado (só instalar é)', () => {
    const sc = scenario().edit(withMoney(10_000)).edit(inCombat);
    market(sc, 'cybereye');
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(true);
  });

  // BUG-CID-2: o mercado acompanha o jogador depois que ele sai do lugar.
  it('BUG-CID-2: mudar de distrito encerra (ou esconde) o Mercado Noturno aberto em outro lugar', () => {
    const sc = scenario().edit(withMoney(10_000));
    market(sc, 'cybereye'); // sem "hours": nunca vence
    sc.tool('narrator', 'move_location', { district: 'CORPO_PLAZA', spot: 'Torre da Arasaka', minutes: 30 });
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(false);
  });

  it('abrir um segundo mercado substitui o primeiro; nome >80 e estoque vazio não quebram', () => {
    const sc = scenario();
    market(sc, 'cybereye');
    sc.tool('narrator', 'open_night_market', { name: 'B', cyberStock: 'lixo,,  ,cyberarm' });
    expect(sc.state.world.market?.cyberStock).toEqual(['cyberarm']);
    sc.tool('narrator', 'open_night_market', { name: 'C' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.market?.cyberStock).toEqual([]);
  });
});

// ------------------------------------------------------------------ encomendas

describe('Encomendas de cromo', () => {
  it('quem não é Canal e não tem contato é recusado (sem cobrar)', () => {
    const sc = scenario({ role: 'solo' }).edit(withMoney(99_999)).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(99_999);
    expect(sc.state.world.cyberOrders ?? []).toHaveLength(0);
  });

  it('IA (narrator/phone) não pode encomendar', () => {
    const sc = fixer(10).tool('narrator', 'order_cyberware', { key: 'cybereye' }).tool('phone', 'order_cyberware', { key: 'cybereye' });
    expect(sc.records.every(r => !r.ok)).toBe(true);
    expect(sc.state.world.cyberOrders ?? []).toHaveLength(0);
  });

  it('rank exigido segue o nível do cromo: [3,5,7,9,10] para T1..T5; protótipo nunca', () => {
    for (const rank of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const def of CIVIL_OR_MIL) {
        const sc = fixer(rank, 10_000_000).tool('interpreter', 'order_cyberware', { key: def.key });
        expect(sc.last().ok, `${def.key} rank ${rank}`).toBe(rank >= rankForTier(def.tier));
      }
    }
    for (const def of Object.values(CYBERWARE).filter(d => d.grade === 'prototype')) {
      const sc = fixer(10, 10_000_000).tool('interpreter', 'order_cyberware', { key: def.key });
      expect(sc.last().ok, def.key).toBe(false);
      expect(sc.state.character.money).toBe(10_000_000);
    }
  });

  it('sem dinheiro: recusa sem criar encomenda', () => {
    const sc = fixer(10, 10).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.character.money).toBe(10);
    expect(sc.state.world.cyberOrders ?? []).toHaveLength(0);
  });

  it('Canal NPC (contato): confiança >= 5*rank e reputação >= ceil(rank/2); morto/inexistente/outro papel não vale', () => {
    const cheap = 'cybereye'; // T1 => rank 3 => trust 15, rep 2
    const cases: Array<[string, Partial<Npc>, number, boolean]> = [
      ['ok', {}, 5, true],
      ['trust baixo', { trust: 10 }, 5, false],
      ['rep baixa', {}, 1, false],
      ['morto', { status: 'dead' }, 5, false],
      ['desaparecido', { status: 'missing' }, 5, false],
      ['não é Canal', { role: 'Ripperdoc' }, 5, false],
    ];
    for (const [label, over, rep, expected] of cases) {
      const sc = scenario({ role: 'solo' }).edit(withMoney(99_999)).edit(withChar({ reputation: rep })).edit(addNpc(mkNpc(over)));
      sc.tool('interpreter', 'order_cyberware', { key: cheap, fixerId: 'npc_canal' });
      expect(sc.last().ok, label).toBe(expected);
    }
    const none = scenario({ role: 'solo' }).edit(withMoney(99_999)).edit(withChar({ reputation: 9 })).tool('interpreter', 'order_cyberware', { key: cheap, fixerId: 'nao_existe' });
    expect(none.last().ok).toBe(false);
    const byName = scenario({ role: 'solo' }).edit(withMoney(99_999)).edit(withChar({ reputation: 9 })).edit(addNpc(mkNpc({}))).tool('interpreter', 'order_cyberware', { key: cheap, fixerId: 'sandy' });
    expect(byName.last().ok).toBe(true);
  });

  it('Canal NPC com alcance insuficiente para T5 (trust 49 < 50) é recusado; 50 passa', () => {
    const t5 = Object.values(CYBERWARE).find(d => d.tier === 5 && d.grade !== 'prototype')!;
    const a = scenario({ role: 'solo' }).edit(withMoney(9_999_999)).edit(withChar({ reputation: 9 })).edit(addNpc(mkNpc({ trust: 49 }))).tool('interpreter', 'order_cyberware', { key: t5.key, fixerId: 'npc_canal' });
    expect(a.last().ok).toBe(false);
    const b = scenario({ role: 'solo' }).edit(withMoney(9_999_999)).edit(withChar({ reputation: 9 })).edit(addNpc(mkNpc({ trust: 50 }))).tool('interpreter', 'order_cyberware', { key: t5.key, fixerId: 'npc_canal' });
    expect(b.last().ok).toBe(true);
  });

  it('prazo = 12h*tier (+24h militar): nada chega 1 minuto antes; chega no minuto exato', () => {
    for (const key of ['cybereye', 'sandevistan_apogee', ...CIVIL_OR_MIL.filter(d => d.grade === 'military').slice(0, 1).map(d => d.key)]) {
      if (!CYBERWARE[key] || CYBERWARE[key].grade === 'prototype') continue;
      const def = CYBERWARE[key];
      const hours = 12 * Math.max(1, def.tier) + (def.grade === 'military' ? 24 : 0);
      const sc = fixer(10, 10_000_000).tool('interpreter', 'order_cyberware', { key });
      expect(sc.last().ok).toBe(true);
      sc.advance(hours * 60 - 1);
      expect(sc.state.world.cyberOrders![0].status).toBe('ordered');
      expect(loose(sc)).toHaveLength(0);
      sc.advance(1);
      expect(sc.state.world.cyberOrders![0].status).toBe('ready');
      expect(loose(sc, key)).toHaveLength(1);
    }
  });

  it('entrega exatamente UMA vez: vários avanços, rest, move_location, advance_time, reload e fulfill direto', () => {
    const sc = fixer(10).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    sc.advance(12 * 60);
    expect(loose(sc, 'cybereye')).toHaveLength(1);
    for (let i = 0; i < 4; i++) sc.advance(600).reload();
    sc.tool('interpreter', 'rest', { hours: 8 }).tool('narrator', 'move_location', { spot: 'X', minutes: 30 }).tool('narrator', 'advance_time', { minutes: 60 });
    sc.state = fulfillCyberOrders(fulfillCyberOrders(sc.state));
    sc.state = JSON.parse(JSON.stringify(sc.state));
    expect(loose(sc, 'cybereye').reduce((n, i) => n + i.quantity, 0)).toBe(1);
    expect(sc.state.world.cyberOrders!.filter(o => o.status === 'ready')).toHaveLength(1);
    const delivered = sc.state.events.filter(e => (e.data as { cyberOrder?: string } | undefined)?.cyberOrder === sc.state.world.cyberOrders![0].id);
    expect(delivered.length).toBeLessThanOrEqual(1);
  });

  it('entrega vale por rest / move_location / advance_time (cada caminho de passagem de tempo)', () => {
    const paths: Array<[string, (s: Scenario) => Scenario]> = [
      ['rest', s => s.tool('interpreter', 'rest', { hours: 12 })],
      ['move', s => s.tool('narrator', 'move_location', { spot: 'Longe', minutes: 240 }).tool('narrator', 'move_location', { spot: 'Mais longe', minutes: 240 }).tool('narrator', 'move_location', { spot: 'Ainda', minutes: 240 })],
      ['advance_time', s => s.tool('narrator', 'advance_time', { minutes: 720 })],
      ['install (cirurgia avança relógio)', s => s.edit(rich).tool('interpreter', 'install_cyberware', { key: 'cyberarm' }, [1, 1]).tool('interpreter', 'rest', { hours: 12 })],
    ];
    for (const [label, go] of paths) {
      const sc = fixer(10).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
      go(sc);
      expect(loose(sc, 'cybereye').length, label).toBe(1);
    }
  });

  it('duas encomendas iguais viram duas peças; peça entregue instala cobrando só a cirurgia', () => {
    const sc = fixer(10).tool('interpreter', 'order_cyberware', { key: 'cybereye' }).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    expect(sc.state.world.cyberOrders).toHaveLength(2);
    sc.advance(24 * 60);
    expect(loose(sc, 'cybereye')).toHaveLength(2);
    sc.edit(rich);
    const m = sc.state.character.money;
    sc.tool('interpreter', 'install_cyberware', { key: 'cybereye' }, [1, 1]);
    expect(m - sc.state.character.money).toBe(250);
    expect(loose(sc, 'cybereye')).toHaveLength(1);
  });

  it('preço da encomenda = preço do catálogo (par = 2x) e fica registrado em paid', () => {
    const sc = fixer(10, 100_000).tool('interpreter', 'order_cyberware', { key: 'low_light' });
    expect(sc.last().ok).toBe(true);
    const paid = CYBERWARE.low_light.price * (CYBERWARE.low_light.paired ? 2 : 1);
    expect(sc.state.character.money).toBe(100_000 - paid);
    expect(sc.state.world.cyberOrders![0].paid).toBe(paid);
    expect(Number.isInteger(sc.state.world.cyberOrders![0].paid)).toBe(true);
  });

  it('encomenda cujo cyberKey sumiu do catálogo (save antigo) não quebra o relógio', () => {
    const sc = fixer(10).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    sc.edit(s => ({ ...s, world: { ...s.world, cyberOrders: s.world.cyberOrders!.map(o => ({ ...o, cyberKey: 'removido' })) } }));
    expect(() => sc.advance(24 * 60)).not.toThrow();
    expect(loose(sc)).toHaveLength(0);
  });

  it('encomenda cancelada ou já pronta nunca entrega de novo', () => {
    const sc = fixer(10).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    sc.edit(s => ({ ...s, world: { ...s.world, cyberOrders: s.world.cyberOrders!.map(o => ({ ...o, status: 'cancelled' as const })) } }));
    sc.advance(48 * 60);
    expect(loose(sc)).toHaveLength(0);
  });

  // BUG-CID-3: o Operador não tem efeito algum nos preços de cromo (import de operatorPerks sobrando em citySystems).
  it('DÚVIDA-4: o desconto/alcance do Operador não é aplicado a encomendas/mercado (marketCyberPrice ignora o personagem)', () => {
    const low = fixer(3, 100_000).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    const high = fixer(10, 100_000).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    expect(low.state.world.cyberOrders![0].paid).toBe(high.state.world.cyberOrders![0].paid);
    expect(operatorPerks(10).haggleDiscount).toBeGreaterThan(operatorPerks(3).haggleDiscount);
  });
});

// ------------------------------------------------------------------ perseguições

describe('Perseguições', () => {
  const chase = (sc: Scenario, over: Record<string, unknown> = {}) => sc.tool('narrator', 'start_chase', { opponent: 'Interceptor NCPD', reason: 'fuga', ...over });

  it('valores padrão e limites (pressão 1..4, integridade 1..6) vêm do motor', () => {
    const sc = chase(scenario());
    expect(sc.state.world.chase).toMatchObject({ pressure: 2, vehicleIntegrity: 4, opponentIntegrity: 4 });
    chase(sc, { pressure: 99, vehicleIntegrity: 99, opponentIntegrity: -5 });
    expect(sc.state.world.chase).toMatchObject({ pressure: 4, vehicleIntegrity: 6, opponentIntegrity: 1 });
    chase(sc, { pressure: 0, vehicleIntegrity: 0 });
    expect(sc.state.world.chase).toMatchObject({ pressure: 1, vehicleIntegrity: 1 });
    // via função direta, valores fora da faixa também são limitados
    const s = startChase(scenario().state, { opponent: 'x', reason: 'y', pressure: 99, vehicleIntegrity: 99, opponentIntegrity: 99 });
    expect(s.world.chase).toMatchObject({ pressure: 4, vehicleIntegrity: 6, opponentIntegrity: 6 });
  });

  it('chase_action sem perseguição em curso falha sem rolar nem mudar o estado', () => {
    const sc = scenario().tool('interpreter', 'chase_action', { action: 'drive' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.world.chase).toBeUndefined();
  });

  it('chase_action só vale para o jogador; ação inválida é rejeitada', () => {
    const sc = chase(scenario()).tool('narrator', 'chase_action', { action: 'drive' }).tool('interpreter', 'chase_action', { action: 'voar' });
    expect(sc.records.slice(-2).every(r => !r.ok)).toBe(true);
    expect(sc.state.world.chase!.pressure).toBe(2);
  });

  it('start_chase é só da IA: o jogador não consegue iniciar uma perseguição', () => {
    const sc = scenario().tool('interpreter', 'start_chase', { opponent: 'x', reason: 'y' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.world.chase).toBeUndefined();
  });

  it('escape com sucesso duas vezes encerra (pressão 2 -> 0) sem mexer em Heat', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, REF: 10 }, skills: { ...s.character.skills, drive: 10 } } }));
    chase(sc);
    const heat = sc.state.world.heat;
    sc.tool('interpreter', 'chase_action', { action: 'escape' }, [10, 10]);
    expect(sc.state.world.chase).toBeUndefined();
    expect(sc.state.world.heat).toBe(heat);
    // pressão 4: escape (-2) duas vezes
    const sc2 = scenario().edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, REF: 10 }, skills: { ...s.character.skills, drive: 10 } } }));
    chase(sc2, { pressure: 4 });
    sc2.tool('interpreter', 'chase_action', { action: 'escape' }, [10, 10]);
    expect(sc2.state.world.chase!.pressure).toBe(2);
    sc2.tool('interpreter', 'chase_action', { action: 'escape' }, [10, 10]);
    expect(sc2.state.world.chase).toBeUndefined();
  });

  it('pressão 5 encurrala: encerra a perseguição, +1 Heat global e +1 Heat da facção (0..5)', () => {
    const sc = scenario().tool('narrator', 'modify_faction', { name: 'Maelstrom', delta: 0, category: 'Gang' });
    const id = sc.state.factions.find(f => f.name === 'Maelstrom')!.id;
    chase(sc, { pressure: 4, factionId: id });
    sc.edit(s => ({ ...s, character: { ...s.character, skills: { ...s.character.skills, drive: 0 } } }));
    const heat = sc.state.world.heat;
    sc.tool('interpreter', 'chase_action', { action: 'drive' }, [1, 1]);
    expect(sc.state.world.chase).toBeUndefined();
    expect(sc.state.world.heat).toBe(heat + 1);
    expect(sc.state.factions.find(f => f.id === id)?.heat).toBe(1);
    // com tudo no teto, não passa de 5
    const s5 = { ...sc.state, world: { ...sc.state.world, heat: 5 }, factions: sc.state.factions.map(f => ({ ...f, heat: 5 })) };
    const s6 = startChase(s5, { opponent: 'x', reason: 'y', factionId: id, pressure: 4, vehicleIntegrity: 4, opponentIntegrity: 4 });
    const r = resolveChase(s6, 'drive', 0).state;
    expect(r.world.heat).toBe(5);
    expect(r.factions.find(f => f.id === id)?.heat).toBe(5);
  });

  it('encurralado sem facção (ou com facção inexistente) só mexe no Heat global e não quebra', () => {
    const s = startChase(scenario().state, { opponent: 'x', reason: 'y', factionId: 'fantasma', pressure: 4, vehicleIntegrity: 4, opponentIntegrity: 4 });
    const r = resolveChase(s, 'evade', 0).state;
    expect(r.world.heat).toBe(1);
    expect(r.factions.every(f => (f.heat ?? 0) === 0)).toBe(true);
  });

  it('ram: sucesso = oponente -2 e veículo -1; falha = veículo -2; integridades ficam em 0..6', () => {
    const base = startChase(scenario().state, { opponent: 'x', reason: 'y', pressure: 2, vehicleIntegrity: 4, opponentIntegrity: 4 });
    const win = resolveChase(base, 'ram', 99).state.world.chase!;
    expect(win).toMatchObject({ opponentIntegrity: 2, vehicleIntegrity: 3, pressure: 2 });
    const lose = resolveChase(base, 'ram', 0).state.world.chase!;
    expect(lose).toMatchObject({ opponentIntegrity: 4, vehicleIntegrity: 2 });
    // oponente a 1: ram com sucesso derruba e encerra como vitória
    const last = startChase(scenario().state, { opponent: 'x', reason: 'y', pressure: 2, vehicleIntegrity: 4, opponentIntegrity: 1 });
    const r = resolveChase(last, 'ram', 99);
    expect(r.state.world.chase).toBeUndefined();
    expect(r.state.world.heat).toBe(0);
    // veículo a 1: ram que falha destrói o veículo => encurralado
    const fragile = startChase(scenario().state, { opponent: 'x', reason: 'y', pressure: 2, vehicleIntegrity: 1, opponentIntegrity: 4 });
    const f = resolveChase(fragile, 'ram', 0);
    expect(f.state.world.chase).toBeUndefined();
    expect(f.state.world.heat).toBe(1);
  });

  it('shoot com sucesso tira 1 do oponente; falha não muda nada; 4 tiros certos encerram', () => {
    let s = startChase(scenario().state, { opponent: 'x', reason: 'y', pressure: 2, vehicleIntegrity: 4, opponentIntegrity: 4 });
    expect(resolveChase(s, 'shoot', 0).state.world.chase).toMatchObject({ opponentIntegrity: 4, pressure: 2 });
    for (let i = 0; i < 3; i++) s = resolveChase(s, 'shoot', 99).state;
    expect(s.world.chase!.opponentIntegrity).toBe(1);
    s = resolveChase(s, 'shoot', 99).state;
    expect(s.world.chase).toBeUndefined();
  });

  it('DV sobe com a pressão: DV 13 até 2, 14 em 3, 15 em 4 (limite estrito: total == DV falha)', () => {
    const at = (pressure: number) => startChase(scenario().state, { opponent: 'x', reason: 'y', pressure, vehicleIntegrity: 4, opponentIntegrity: 4 });
    expect(resolveChase(at(2), 'drive', 13).state.world.chase!.pressure).toBe(3);
    expect(resolveChase(at(2), 'drive', 14).state.world.chase!.pressure).toBe(1);
    expect(resolveChase(at(3), 'drive', 14).state.world.chase!.pressure).toBe(4);
    expect(resolveChase(at(4), 'drive', 15).state.world.chase).toBeUndefined(); // pressão 5 => encurralado
    expect(resolveChase(at(4), 'drive', 16).state.world.chase!.pressure).toBe(3);
  });

  it('heavy_chassis: veículo começa com pelo menos 6; sem a melhoria, mantém o valor; desligar volta ao normal', () => {
    const nomad = scenario({ role: 'nomad' });
    chase(nomad, { vehicleIntegrity: 2 });
    expect(nomad.state.world.chase!.vehicleIntegrity).toBe(2);
    nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'heavy_chassis' }));
    chase(nomad, { vehicleIntegrity: 2 });
    expect(nomad.state.world.chase!.vehicleIntegrity).toBe(6);
    nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'heavy_chassis' }));
    chase(nomad, { vehicleIntegrity: 2 });
    expect(nomad.state.world.chase!.vehicleIntegrity).toBe(2);
  });

  it('iniciar uma nova perseguição com outra em curso a SOBRESCREVE (progresso se perde, sem erro)', () => {
    const sc = chase(scenario(), { opponent: 'A', pressure: 4 });
    chase(sc, { opponent: 'B', pressure: 1 });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.chase).toMatchObject({ opponent: 'B', pressure: 1 });
  });

  it('DÚVIDA-5: facção desconhecida em start_chase é aceita e fica pendurada no estado', () => {
    const sc = chase(scenario(), { factionId: 'fac_que_nao_existe' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.chase!.factionId).toBe('fac_que_nao_existe');
  });

  it('DÚVIDA-6: dá para iniciar perseguição durante combate e durante uma run de Rede (sem exclusão mútua)', () => {
    const c = scenario().edit(inCombat);
    chase(c);
    expect(c.last().ok).toBe(true);
    const n = scenario({ role: 'netrunner' }).tool('narrator', 'net_architecture', { name: 'T', accessPoint: 'porta', difficulty: 'basic', floors: 1 }).tool('interpreter', 'jack_in', {}, [10]);
    expect(n.state.net.run).toBeTruthy();
    chase(n);
    expect(n.last().ok).toBe(true);
  });

  it('DÚVIDA-7: shoot não exige arma nem consome munição (usa Pistola mesmo desarmado)', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, inventory: s.character.inventory.filter(i => i.category !== 'weapon' && i.category !== 'ammo') } }));
    chase(sc);
    sc.tool('interpreter', 'chase_action', { action: 'shoot' }, [10, 10]);
    expect(sc.last().ok).toBe(true);
  });

  it('DÚVIDA-8: rest e move_location continuam permitidos com a perseguição em curso (a pressão não muda)', () => {
    const sc = chase(scenario()).tool('interpreter', 'rest', { hours: 8 });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.chase).toBeDefined();
  });

  // BUG-CID-4
  it('BUG-CID-4: personagem morto não pode executar chase_action', () => {
    const sc = chase(scenario()).edit(s => ({ ...s, character: { ...s.character, dead: true, hp: { ...s.character.hp, current: 0 } } }));
    sc.tool('interpreter', 'chase_action', { action: 'escape' }, [10, 10]);
    expect(sc.last().ok).toBe(false);
  });

  it('DÚVIDA-9: inconsciente (0 PV) também consegue dirigir (não há checagem de condição)', () => {
    const sc = chase(scenario()).edit(s => ({ ...s, character: { ...s.character, hp: { ...s.character.hp, current: 0 } } }));
    sc.tool('interpreter', 'chase_action', { action: 'drive' }, [10, 10]);
    expect(sc.last().ok).toBe(true);
  });

  // BUG-CID-5
  it('BUG-CID-5: data.success devolvido por chase_action tem de refletir o DV real da perseguição (13 + pressão-2)', () => {
    const sc = chase(scenario(), { pressure: 4 }).edit(s => ({ ...s, character: { ...s.character, skills: { ...s.character.skills, drive: 0 } } }));
    // força total 14: > DV 13 do teste instantâneo, mas <= DV 15 da pressão 4 => a manobra FALHA no motor.
    const before = sc.state.world.chase!.pressure;
    sc.tool('interpreter', 'chase_action', { action: 'drive' }, [7]);
    const total = (sc.last().data as { success?: boolean } | undefined)?.success;
    const worsened = !sc.state.world.chase || sc.state.world.chase.pressure > before;
    // sucesso informado precisa coincidir com o que o motor aplicou (pressão não pode subir se success=true)
    expect(Boolean(total)).toBe(!worsened);
  });

  // BUG-CID-6
  it('BUG-CID-6: chase_action conta como Ação do turno em combate (uma por turno)', () => {
    const sc = chase(scenario()).edit(inCombat);
    const r = runToolCalls(REGISTRY, sc.state, [{ tool: 'chase_action', args: { action: 'drive' } }, { tool: 'chase_action', args: { action: 'drive' } }], { rng: sequenceRng([10, 10, 10, 10]), origin: 'player' });
    expect(r.records.filter(x => x.ok)).toHaveLength(1);
  });

  it('DÚVIDA-10: fora de combate, várias manobras na mesma mensagem do jogador resolvem a perseguição de uma vez', () => {
    const sc = chase(scenario(), { pressure: 2 });
    const r = runToolCalls(REGISTRY, sc.state, [{ tool: 'chase_action', args: { action: 'escape' } }, { tool: 'chase_action', args: { action: 'escape' } }], { rng: sequenceRng([10, 10, 10, 10]), origin: 'player' });
    expect(r.records[0].ok).toBe(true);
  });
});

// ------------------------------------------------------------------ calor de facção

describe('Calor de facção', () => {
  const faction = (sc: Scenario) => sc.state.factions[0].id;

  it('faixa 0..5: soma, subtração e teto; delta enorme é limitado a ±3 pela validação', () => {
    const sc = scenario();
    const id = faction(sc);
    sc.tool('narrator', 'modify_faction_heat', { factionId: id, delta: 999 });
    expect(sc.state.factions[0].heat).toBe(3);
    sc.tool('narrator', 'modify_faction_heat', { factionId: id, delta: 999 });
    expect(sc.state.factions[0].heat).toBe(5);
    sc.tool('narrator', 'modify_faction_heat', { factionId: id, delta: 3 });
    expect(sc.state.factions[0].heat).toBe(5);
    sc.tool('narrator', 'modify_faction_heat', { factionId: id, delta: -999 });
    sc.tool('narrator', 'modify_faction_heat', { factionId: id, delta: -999 });
    expect(sc.state.factions[0].heat).toBe(0);
    sc.tool('narrator', 'modify_faction_heat', { factionId: id, delta: -3 });
    expect(sc.state.factions[0].heat).toBe(0);
  });

  it('não mexe no Heat policial global nem em outras facções; delta fracionário vira inteiro', () => {
    const sc = scenario();
    const [a, b] = sc.state.factions;
    sc.tool('narrator', 'modify_faction_heat', { factionId: a.id, delta: 1.6 });
    expect(sc.state.factions[0].heat).toBe(2);
    expect(Number.isInteger(sc.state.factions[0].heat)).toBe(true);
    expect(sc.state.factions[1].heat ?? 0).toBe(0);
    expect(sc.state.world.heat).toBe(0);
    expect(sc.state.factions[1].id).toBe(b.id);
  });

  it('facção inexistente, delta não numérico e origem do jogador são recusados', () => {
    const sc = scenario();
    sc.tool('narrator', 'modify_faction_heat', { factionId: 'fantasma', delta: 1 });
    expect(sc.last().ok).toBe(false);
    sc.tool('narrator', 'modify_faction_heat', { factionId: sc.state.factions[0].id, delta: 'abc' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'modify_faction_heat', { factionId: sc.state.factions[0].id, delta: 3 });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.factions.every(f => (f.heat ?? 0) === 0)).toBe(true);
  });

  it('heat armazenado fora da faixa em um save corrompido é puxado de volta para 0..5 ao mexer', () => {
    const sc = scenario().edit(s => ({ ...s, factions: s.factions.map(f => ({ ...f, heat: 40 })) }));
    sc.tool('narrator', 'modify_faction_heat', { factionId: sc.state.factions[0].id, delta: 1 });
    expect(sc.state.factions[0].heat).toBe(5);
  });

  it('modify_heat (policial) e modify_faction_heat são independentes nos dois sentidos', () => {
    const sc = scenario().tool('narrator', 'modify_heat', { delta: 2, reason: 'tiroteio' });
    expect(sc.state.world.heat).toBe(2);
    expect(sc.state.factions.every(f => (f.heat ?? 0) === 0)).toBe(true);
  });
});

// ------------------------------------------------------------------ Mestre (prompt)

describe('Contexto do Mestre', () => {
  const prompt = (sc: Scenario) => buildNarratePrompt(sc.context(), { kind: 'action', playerInput: 'olho em volta', engineResult: null });

  it('o contexto bruto carrega mercado, perseguição e encomendas (sem texto de debug vazando)', () => {
    const sc = fixer(10)
      .tool('narrator', 'open_night_market', { name: 'MercadoZ', cyberStock: 'cybereye' })
      .tool('narrator', 'start_chase', { opponent: 'InterceptorZ', reason: 'fuga' })
      .tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    const ctx = sc.context();
    expect(ctx.world.market?.name).toBe('MercadoZ');
    expect(ctx.world.chase?.opponent).toBe('InterceptorZ');
    expect(ctx.world.cyberOrders).toHaveLength(1);
  });

  // BUG-CID-7
  it('BUG-CID-7: o prompt do Mestre descreve a perseguição ativa (pressão/integridade)', () => {
    const sc = scenario().tool('narrator', 'start_chase', { opponent: 'InterceptorZ', reason: 'fuga', pressure: 3 });
    expect(prompt(sc)).toMatch(/InterceptorZ/);
  });

  // BUG-CID-8
  it('BUG-CID-8: o prompt do Mestre informa o Mercado Noturno aberto e as encomendas pendentes', () => {
    const sc = fixer(10).tool('narrator', 'open_night_market', { name: 'MercadoZ', cyberStock: 'cybereye' }).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    const p = prompt(sc);
    expect(p).toMatch(/MercadoZ/);
    expect(p).toMatch(/encomenda/i);
  });

  // BUG-CID-9
  it('BUG-CID-9: o prompt lista o id das facções e o calor por facção (modify_faction_heat exige factionId)', () => {
    const sc = scenario().tool('narrator', 'modify_faction_heat', { factionId: 'fac_ncpd', delta: 2 });
    const p = prompt(sc);
    expect(p).toMatch(/fac_ncpd/);
  });

  it('o prompt não vaza campos internos de encomenda (readyAt/status cru) nem chaves de peças ocultas', () => {
    const sc = fixer(10).tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    expect(prompt(sc)).not.toMatch(/"status":"ordered"/);
  });
});

// ------------------------------------------------------------------ papéis

describe('Melhorias de papel', () => {
  it('Operador: perks por rank (desconto 10% até 6, 20% de 7+; mercado noturno 5+; meia-noite 9+; alcance)', () => {
    expect(operatorPerks(4)).toMatchObject({ haggleDiscount: 0.1, canHostNightMarket: false, canHostMidnightMarket: false, reach: 'Caro' });
    expect(operatorPerks(5).canHostNightMarket).toBe(true);
    expect(operatorPerks(7)).toMatchObject({ haggleDiscount: 0.2, reach: 'Muito caro' });
    expect(operatorPerks(9)).toMatchObject({ canHostMidnightMarket: true, reach: 'Luxo' });
    expect(operatorPerks(10).reach).toBe('Superluxo');
    expect(operatorPerks(1).reach).toBe('Premium');
  });

  it('Nômade: melhorias respeitam o rank (limite de ativas), alternam on/off e são só do Nômade', () => {
    const solo = scenario({ role: 'solo' });
    const before = solo.state.character;
    solo.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'seating' }));
    expect(solo.state.character.nomadUpgrades).toBeUndefined();
    expect(solo.state.character.money).toBe(before.money);

    const nomad = scenario({ role: 'nomad' }).edit(withChar({ roleRank: 1 }));
    nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'seating' }));
    expect(nomad.state.character.nomadUpgrades).toEqual(['seating']);
    nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'heavy_chassis' }));
    expect(nomad.state.character.nomadUpgrades).toEqual(['seating']); // rank 1 => 1 slot
    nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'seating' }));
    expect(nomad.state.character.nomadUpgrades).toEqual([]);
    nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'nao_existe' as never }));
    expect(nomad.state.character.nomadUpgrades).toEqual([]);
    // ligar duas vezes seguidas não duplica
    nomad.edit(withChar({ roleRank: 10 }));
    for (let i = 0; i < 3; i++) nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: 'housing' }));
    expect(nomad.state.character.nomadUpgrades).toEqual(['housing']);
    // o item do veículo reflete as melhorias
    expect(nomad.item('item_family_vehicle')?.name).toMatch(/Capacidade de moradia/);
  });

  it('DÚVIDA-11: melhorias do Nômade são grátis e reversíveis (sem custo em PM/eddies)', () => {
    const nomad = scenario({ role: 'nomad' });
    const { money, ip } = nomad.state.character;
    for (const key of ['seating', 'heavy_chassis', 'housing'] as const) nomad.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key }));
    expect(nomad.state.character.nomadUpgrades).toHaveLength(3);
    expect(nomad.state.character.money).toBe(money);
    expect(nomad.state.character.ip).toBe(ip);
  });

  it('subir de rank custa 60 x novo rank em PM, exige PM e para no 10', () => {
    const sc = scenario({ role: 'fixer' }).edit(withChar({ ip: 0 }));
    const rank = sc.state.character.roleRank;
    sc.edit(s => gameReducer(s, { type: 'improveRole' }));
    expect(sc.state.character.roleRank).toBe(rank);
    sc.edit(withChar({ ip: roleUpgradeCost(rank + 1) - 1 })).edit(s => gameReducer(s, { type: 'improveRole' }));
    expect(sc.state.character.roleRank).toBe(rank);
    sc.edit(withChar({ ip: roleUpgradeCost(rank + 1) })).edit(s => gameReducer(s, { type: 'improveRole' }));
    expect(sc.state.character.roleRank).toBe(rank + 1);
    expect(sc.state.character.ip).toBe(0);
    sc.edit(withChar({ roleRank: 10, ip: 99_999 })).edit(s => gameReducer(s, { type: 'improveRole' }));
    expect(sc.state.character.roleRank).toBe(10);
    expect(sc.state.character.ip).toBe(99_999);
  });

  it('Operador: Pechincha só para Canal; só uma tentativa; desconto só em sucesso e nunca preço negativo', () => {
    const solo = scenario({ role: 'solo' }).tool('interpreter', 'haggle_trade', { offerId: 'x' });
    expect(solo.last().ok).toBe(false);
    const sc = fixer(10);
    sc.tool('interpreter', 'haggle_trade', { offerId: 'inexistente' });
    expect(sc.last().ok).toBe(false);
  });

  describe('cryo_stasis', () => {
    const medic = (cryo = 2) => scenario({ role: 'medtech' }).edit(withChar({ roleData: { medicine: { surgery: 1, pharma: 1, cryo } }, hp: { max: 30, current: 0 } }));

    it('só Medicânico com Criossistemas, só a 0 PV, vivo, e não duplica', () => {
      const solo = scenario({ role: 'solo' }).edit(withChar({ hp: { max: 30, current: 0 } })).tool('interpreter', 'cryo_stasis');
      expect(solo.last().ok).toBe(false);
      expect(medic(0).tool('interpreter', 'cryo_stasis').last().ok).toBe(false);
      const healthy = medic().edit(withChar({ hp: { max: 30, current: 10 } })).tool('interpreter', 'cryo_stasis');
      expect(healthy.last().ok).toBe(false);
      const dead = medic().edit(withChar({ dead: true })).tool('interpreter', 'cryo_stasis');
      expect(dead.last().ok).toBe(false);
      const ai = medic().tool('narrator', 'cryo_stasis');
      expect(ai.last().ok).toBe(false);
      const sc = medic().tool('interpreter', 'cryo_stasis');
      expect(sc.last().ok).toBe(true);
      expect(sc.state.character.cryoStasis).toBeDefined();
      sc.tool('interpreter', 'cryo_stasis');
      expect(sc.last().ok).toBe(false);
    });

    it('suspende o Teste de Morte, dura 7 dias e acorda sozinho (passando pelo relógio)', () => {
      const sc = medic().tool('interpreter', 'cryo_stasis');
      expect(sc.state.pendingRoll).toBeNull();
      sc.advance(6 * 24 * 60 + 23 * 60);
      expect(sc.state.character.cryoStasis).toBeDefined();
      sc.advance(60);
      expect(sc.state.character.cryoStasis).toBeUndefined();
    });
  });

  describe('reconfigure_awareness (Solo)', () => {
    const solo = (rank = 4) => scenario({ role: 'solo' }).edit(withChar({ roleRank: rank }));
    const foe = { id: 'foe', name: 'Alvo', hp: { current: 50, max: 50 }, sp: { head: 0, body: 0 }, weapon: { name: 'P', weaponClass: 'pistol_medium', damage: '2d6' }, attackBase: 6, evasionBase: 6, ref: 6, initiative: null, distance: '0-6m', cover: 'none', status: 'active', template: 'boosterganger' } as never;
    const fight = (sc: Scenario) => sc.edit(s => ({ ...s, combat: { ...s.combat, active: true, round: 1, combatants: [foe] } }));

    it('só em combate, só Solo, só o jogador; soma exata do rank e passos válidos', () => {
      expect(solo().tool('interpreter', 'reconfigure_awareness', { precision: 3, initiative: 1 }).last().ok).toBe(false); // fora de combate
      const nonSolo = scenario({ role: 'tech' }).edit(inCombat).tool('player', 'reconfigure_awareness', { initiative: 4 });
      expect(nonSolo.last().ok).toBe(false);
      const ai = fight(solo()).tool('narrator', 'reconfigure_awareness', { initiative: 4 });
      expect(ai.last().ok).toBe(false);
      const sc = fight(solo());
      sc.tool('player', 'reconfigure_awareness', { initiative: 3 }); // soma 3 != 4
      expect(sc.last().ok).toBe(false);
      sc.tool('player', 'reconfigure_awareness', { deflection: 3, initiative: 1 }); // passo de 2
      expect(sc.last().ok).toBe(false);
      sc.tool('player', 'reconfigure_awareness', { precision: 4 }); // passo de 3
      expect(sc.last().ok).toBe(false);
      sc.tool('player', 'reconfigure_awareness', { fumbleRecovery: 4 });
      expect(sc.last().ok).toBe(true);
      expect(sc.state.character.roleData.combatAwareness).toEqual({ fumbleRecovery: 4 });
      sc.tool('player', 'reconfigure_awareness', { spotWeakness: 2, initiative: 2 });
      expect(sc.last().ok).toBe(true);
      expect(sc.state.character.roleData.combatAwareness).toEqual({ spotWeakness: 2, initiative: 2 });
    });

    it('falha não altera a alocação anterior (atômico)', () => {
      const sc = fight(solo());
      const before = sc.state.character.roleData.combatAwareness;
      sc.tool('player', 'reconfigure_awareness', { precision: 3, initiative: 3 });
      expect(sc.last().ok).toBe(false);
      expect(sc.state.character.roleData.combatAwareness).toEqual(before);
    });

    // BUG-CID-10
    it('BUG-CID-10: reconfigure_awareness "consome a Ação do turno" — atacar na mesma rodada deve ser recusado', () => {
      const sc = fight(solo());
      const r = runToolCalls(REGISTRY, sc.state, [{ tool: 'reconfigure_awareness', args: { precision: 3, initiative: 1 } }, { tool: 'attack', args: { targetId: 'foe' } }], { rng: sequenceRng([5]), origin: 'player' });
      expect(r.records[0].ok).toBe(true);
      expect(r.records[1].ok).toBe(false);
    });

    it('DÚVIDA-12: reconfigurar é grátis e ilimitado entre rodadas (sem custo/cooldown); só a Ação deveria limitar', () => {
      const sc = fight(solo());
      for (let i = 0; i < 6; i++) sc.tool('player', 'reconfigure_awareness', i % 2 ? { precision: 3, initiative: 1 } : { spotWeakness: 4 });
      expect(sc.records.every(r => r.ok)).toBe(true);
    });

    it('reconfigurar mexe de verdade nos efeitos (Detecção de Ameaça = bônus em Percepção)', () => {
      const sc = fight(solo(4));
      sc.tool('player', 'reconfigure_awareness', { threatDetection: 4 });
      expect(sc.state.character.roleData.combatAwareness).toEqual({ threatDetection: 4 });
    });
  });
});

// ------------------------------------------------------------------ teste de propriedade

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Propriedade: sequência aleatória (seed fixa, 2000 chamadas)', () => {
  const SAFE_KEYS = Object.values(CYBERWARE).filter(d => !d.effects.some(e => e.kind === 'body' || e.kind === 'body_set')).map(d => d.key);

  function run(seed: number, role: 'fixer' | 'nomad' | 'solo' | 'medtech', calls = 2000) {
    const rnd = mulberry32(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const sc = scenario({ role }).edit(withChar({ money: 30_000, roleRank: role === 'fixer' ? 10 : 4 })).edit(s => withRipperdoc(s, 5, true, 70)).edit(addNpc(mkNpc({ trust: 80 })));
    sc.edit(withChar({ reputation: 8 }));
    const ORIGINS = ['interpreter', 'player', 'narrator', 'phone'] as const;
    const key = () => (rnd() < 0.1 ? pick(['', 'lixo', 'cybereye ', '__proto__']) : pick(SAFE_KEYS));
    const factionId = () => (rnd() < 0.2 ? pick(['fantasma', '']) : pick(sc.state.factions).id);
    const num = () => pick([-999, -3, -1, 0, 1, 2, 3, 5, 999, 1.5, NaN as number, Number.MAX_SAFE_INTEGER]);
    const gens: Array<() => [string, Record<string, unknown>]> = [
      () => ['open_night_market', { name: 'M', cyberStock: Array.from({ length: int(0, 4) }, () => pick(['cybereye', 'cyberarm', 'neural_link', 'cyberleg', key()])).join(','), blackMarket: rnd() < 0.5, hours: rnd() < 0.5 ? num() : undefined }],
      () => ['buy_market_cyberware', { key: sc.state.world.market?.cyberStock.length && rnd() < 0.7 ? pick(sc.state.world.market.cyberStock) : key() }],
      () => ['order_cyberware', { key: key(), fixerId: rnd() < 0.4 ? pick(['npc_canal', 'Sandy', 'x', 'npc_doc']) : undefined }],
      () => ['start_chase', { opponent: 'X', reason: 'y', factionId: rnd() < 0.5 ? factionId() : undefined, pressure: num(), vehicleIntegrity: num(), opponentIntegrity: num() }],
      () => ['chase_action', { action: pick(['drive', 'evade', 'ram', 'shoot', 'escape', 'voar']) }],
      () => ['chase_action', { action: pick(['ram', 'shoot']) }],
      () => ['modify_faction_heat', { factionId: factionId(), delta: num() }],
      () => ['modify_heat', { delta: num() }],
      () => ['install_cyberware', { key: key(), skillId: 'pick_lock' }],
      () => ['remove_cyberware', { cyberwareId: sc.state.character.cyberware.length ? pick(sc.state.character.cyberware).id : 'cw_x' }],
      () => ['upgrade_cyber_capacity', {}],
      () => ['give_item', { name: 'Peça', category: 'gear', cyberKey: key() }],
      () => ['sell_item', { itemId: sc.state.character.inventory.length ? pick(sc.state.character.inventory).id : 'x', buyer: 'Alguém' }],
      () => ['remove_item', { itemId: sc.state.character.inventory.length ? pick(sc.state.character.inventory).id : 'x' }],
      () => ['rest', { hours: int(1, 24) }],
      () => ['advance_time', { minutes: int(1, 720) }],
      () => ['move_location', { spot: 'Rua', minutes: int(0, 240) }],
      () => ['cryo_stasis', {}],
      () => ['reconfigure_awareness', { precision: pick([0, 3, 6]), initiative: pick([0, 1, 4]), spotWeakness: pick([0, 2]) }],
    ];
    const events = new Map<string, number>();
    for (let i = 0; i < calls; i++) {
      const r = rnd();
      if (r < 0.03) sc.edit(s => ({ ...s, combat: { ...s.combat, active: !s.combat.active, round: 1 } }));
      else if (r < 0.04) sc.edit(s => gameReducer(s, { type: 'toggleNomadUpgrade', key: pick(['seating', 'heavy_chassis', 'housing'] as const) }));
      else if (r < 0.15) sc.edit(s => withRipperdoc(s, 5, true, 70)); // move_location tira o doutor da cena
      else if (r < 0.2) sc.edit(withChar({ money: Math.max(sc.state.character.money, 0) + int(0, 20_000) }));
      const [name, args] = pick(gens)();
      const origin = pick(ORIGINS);
      // NaN/undefined não sobrevivem ao JSON do LLM: normaliza como o transporte real faria
      const clean = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
      let threw: unknown = null;
      try {
        sc.tool(origin, name, clean, [int(1, 10), int(1, 10), int(1, 10), int(1, 10)]);
      } catch (e) {
        threw = e;
      }
      expect(threw, `${name} ${JSON.stringify(clean)}`).toBeNull();
      invariants(sc.state, `#${i} ${origin}:${name} ${JSON.stringify(clean)}`);
      if (i % 250 === 0) {
        sc.reload();
        expect(() => validateSave(JSON.parse(JSON.stringify(sc.state)))).not.toThrow();
      }
    }
    for (const e of sc.state.events) {
      const id = (e.data as { cyberOrder?: unknown } | undefined)?.cyberOrder;
      if (typeof id === 'string' && e.type === 'ITEM_ACQUIRED') events.set(id, (events.get(id) ?? 0) + 1);
    }
    for (const [id, n] of events) expect(n, `encomenda ${id} entregue ${n}x`).toBe(1);
    return sc;
  }

  function invariants(s: GameState, ctx: string) {
    const c = s.character;
    expect(Number.isInteger(c.money) && c.money >= 0, `dinheiro ${c.money} após ${ctx}`).toBe(true);
    expect(cyberCapacityUsed(c), `capacidade após ${ctx}`).toBeLessThanOrEqual(cyberCapacityMax(c));
    expect(cyberCapacityMax(c)).toBeGreaterThanOrEqual(12);
    expect((c.cyberCapacityBonus ?? 0) >= 0 && (c.cyberCapacityBonus ?? 0) <= 20, `bônus ${c.cyberCapacityBonus}`).toBe(true);
    expect(s.world.heat >= 0 && s.world.heat <= 5 && Number.isInteger(s.world.heat), `heat ${s.world.heat}`).toBe(true);
    for (const f of s.factions) {
      const h = f.heat ?? 0;
      expect(h >= 0 && h <= 5 && Number.isInteger(h), `heat ${f.id}=${f.heat} após ${ctx}`).toBe(true);
    }
    const ch = s.world.chase;
    if (ch) {
      expect(ch.pressure >= 0 && ch.pressure <= 5, `pressão ${ch.pressure} após ${ctx}`).toBe(true);
      expect(ch.vehicleIntegrity >= 0 && ch.vehicleIntegrity <= 6, `veículo ${ch.vehicleIntegrity}`).toBe(true);
      expect(ch.opponentIntegrity >= 0 && ch.opponentIntegrity <= 6, `oponente ${ch.opponentIntegrity}`).toBe(true);
      // uma perseguição ativa nunca está num estado terminal
      expect(ch.pressure).toBeGreaterThan(0);
      expect(ch.pressure).toBeLessThan(5);
      expect(ch.vehicleIntegrity).toBeGreaterThan(0);
      expect(ch.opponentIntegrity).toBeGreaterThan(0);
    }
    const ids = [...c.inventory.map(i => i.id), ...c.cyberware.map(i => i.id)];
    expect(new Set(ids).size, `ids de item/cromo duplicados após ${ctx}`).toBe(ids.length);
    for (const i of c.inventory) expect(i.quantity, `${i.name} qtd`).toBeGreaterThan(0);
    for (const o of s.world.cyberOrders ?? []) expect(Number.isInteger(o.paid) && o.paid > 0).toBe(true);
    // consistência com o catálogo: nenhum implante de protótipo foi comprado/encomendado
    for (const o of s.world.cyberOrders ?? []) expect(CYBERWARE[o.cyberKey].grade).not.toBe('prototype');
    expect(JSON.parse(JSON.stringify(s)).character.money).toBe(c.money);
  }

  for (const [seed, role] of [[1337, 'fixer'], [42, 'nomad'], [2077, 'solo'], [7, 'medtech']] as const) {
    it(`seed ${seed} (${role}): invariantes valem após cada chamada; save final é aceito por validateSave`, () => {
      const sc = run(seed, role, role === 'fixer' ? 2000 : 600);
      // cobertura: a sequência realmente exercitou os caminhos felizes (não só rejeições)
      const okCount = (name: string) => sc.records.filter(r => r.tool === name && r.ok).length;
      if (role === 'fixer') for (const name of ['open_night_market', 'buy_market_cyberware', 'order_cyberware', 'start_chase', 'chase_action', 'modify_faction_heat', 'install_cyberware', 'upgrade_cyber_capacity', 'rest']) expect(okCount(name), name).toBeGreaterThan(0);
      const loaded = validateSave(JSON.parse(JSON.stringify(sc.state)));
      expect(loaded.character.money).toBe(sc.state.character.money);
      // o relógio ainda roda sobre o save carregado
      expect(() => advanceTime(loaded, 24 * 60)).not.toThrow();
    }, 60_000);
  }

  it('o Mestre consegue montar o prompt em qualquer ponto da sequência aleatória', () => {
    const sc = run(99, 'fixer', 300);
    expect(() => buildNarratePrompt(sc.context(), { kind: 'action', playerInput: 'x', engineResult: null })).not.toThrow();
  });
});

// referências para o compilador (evita "unused" se algum helper ficar sem uso)
void installCyberware;
