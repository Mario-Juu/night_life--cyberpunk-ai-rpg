/** Mercado Noturno, encomendas e perseguições: sistemas pequenos, persistentes e independentes do narrador. */
import type { Character, ChaseState, GameState, NightMarket } from '../types/game';
import { CYBERWARE } from '../rules/cyberware';
import { advanceGameTime } from '../rules/world';
import { operatorPerks } from '../rules/roles';
import { emit } from './events';
import { makeId } from './ids';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const cyberCopies = (key: string) => (CYBERWARE[key]?.paired ? 2 : 1);
export const marketCyberPrice = (_c: Character, key: string) => {
  const base = CYBERWARE[key].price * cyberCopies(key);
  return base;
};

export function openNightMarket(s0: GameState, input: Omit<NightMarket, 'id'>): GameState {
  const stock = [...new Set(input.cyberStock.filter(key => key in CYBERWARE && CYBERWARE[key].grade !== 'prototype'))];
  const market: NightMarket = { ...input, id: makeId('market'), cyberStock: stock };
  return emit({ ...s0, world: { ...s0.world, market } }, 'SCENE_CHANGED', `Mercado Noturno aberto: ${market.name} (${stock.length} peças de cromo)`, { target: market.id, data: { nightMarket: true } });
}

export function buyMarketCyberware(s0: GameState, key: string): { state: GameState; error?: string; price?: number } {
  const market = s0.world.market;
  const def = CYBERWARE[key];
  if (!market) return { state: s0, error: 'Não há Mercado Noturno aberto nesta cena.' };
  if (market.endsAt && new Date(market.endsAt).getTime() <= new Date(s0.world.time).getTime()) return { state: s0, error: `${market.name} já desmontou as bancas.` };
  if (!def || !market.cyberStock.includes(key)) return { state: s0, error: `${def?.name ?? key} não está na banca deste Mercado Noturno.` };
  if (def.grade === 'military' && !market.blackMarket) return { state: s0, error: 'Esta banca não expõe hardware militar.' };
  const price = marketCyberPrice(s0.character, key);
  if (s0.character.money < price) return { state: s0, error: `${def.name} custa €$${price}; você tem €$${s0.character.money}.` };
  const item = { id: makeId('item'), name: `${def.name}${def.brand ? ` (${def.brand})` : ''} — peça solta`, category: 'gear' as const, quantity: 1, description: `${def.effect} Comprei no ${market.name}; precisa de cirurgia.`, value: price, cyberKey: key };
  let s: GameState = { ...s0, character: { ...s0.character, money: s0.character.money - price, inventory: [...s0.character.inventory, item] } };
  s = emit(s, 'MONEY_CHANGED', `−${price} €$ (${def.name}, ${market.name})`, { value: -price, source: market.id });
  s = emit(s, 'ITEM_ACQUIRED', `Peça de cromo comprada: ${def.name}`, { target: item.id, data: { cyberKey: key, market: market.id } });
  return { state: s, price };
}

const rankForTier = (tier: number) => [0, 3, 5, 7, 9, 10][tier] ?? 10;

export function orderCyberware(s0: GameState, key: string, fixerId?: string): { state: GameState; error?: string; hours?: number; price?: number } {
  const def = CYBERWARE[key];
  if (!def) return { state: s0, error: 'Implante desconhecido.' };
  if (def.grade === 'prototype') return { state: s0, error: 'Protótipos não entram em encomenda: precisam ser encontrados, roubados ou recebidos.' };
  const requiredRank = rankForTier(def.tier);
  const selfCanSource = s0.character.bio.role === 'fixer' && s0.character.roleRank >= requiredRank;
  const contact = fixerId ? s0.npcs.find(n => n.id === fixerId || n.name.toLowerCase() === fixerId.toLowerCase()) : undefined;
  // NPCs não têm rank de Operador: confiança alta + reputação representam o alcance que ele põe na mesa.
  const contactCanSource = !!contact && /canal|fixer/i.test(contact.role) && contact.status === 'alive' && contact.trust >= requiredRank * 5 && s0.character.reputation >= Math.max(1, Math.ceil(requiredRank / 2));
  if (!selfCanSource && !contactCanSource)
    return { state: s0, error: `Encomendar ${def.name} exige Operador rank ${requiredRank} ou um Canal confiável com alcance para essa categoria.` };
  const price = marketCyberPrice(s0.character, key);
  if (s0.character.money < price) return { state: s0, error: `${def.name} custa €$${price}; você tem €$${s0.character.money}.` };
  const hours = 12 * Math.max(1, def.tier) + (def.grade === 'military' ? 24 : 0);
  const order = { id: makeId('order'), cyberKey: key, label: def.name, paid: price, readyAt: advanceGameTime(s0.world.time, hours * 60), fixerId, status: 'ordered' as const };
  let s: GameState = { ...s0, character: { ...s0.character, money: s0.character.money - price }, world: { ...s0.world, cyberOrders: [...(s0.world.cyberOrders ?? []), order] } };
  s = emit(s, 'MONEY_CHANGED', `−${price} €$ (encomenda: ${def.name})`, { value: -price, source: fixerId ?? 'operator' });
  s = emit(s, 'EVENT_SCHEDULED', `Encomenda ${def.name}: pronta em ${hours}h`, { target: order.id, data: { cyberOrder: true, readyAt: order.readyAt } });
  return { state: s, hours, price };
}

/** Entrega encomendas vencidas sem depender de LLM/evento agendado externo. */
export function fulfillCyberOrders(s0: GameState): GameState {
  const now = new Date(s0.world.time).getTime();
  let s = s0;
  for (const order of s.world.cyberOrders ?? []) {
    if (order.status !== 'ordered' || new Date(order.readyAt).getTime() > now) continue;
    const def = CYBERWARE[order.cyberKey];
    if (!def) continue;
    const item = { id: makeId('item'), name: `${def.name}${def.brand ? ` (${def.brand})` : ''} — peça encomendada`, category: 'gear' as const, quantity: 1, description: `${def.effect} Encomenda pronta; exige cirurgia.`, value: order.paid, cyberKey: def.key };
    s = { ...s, character: { ...s.character, inventory: [...s.character.inventory, item] }, world: { ...s.world, cyberOrders: (s.world.cyberOrders ?? []).map(o => (o.id === order.id ? { ...o, status: 'ready' as const } : o)) } };
    s = emit(s, 'ITEM_ACQUIRED', `Encomenda entregue: ${def.name}`, { target: item.id, data: { cyberOrder: order.id, cyberKey: def.key } });
  }
  return s;
}

export function startChase(s0: GameState, chase: Omit<ChaseState, 'pressure'> & { pressure?: number }): GameState {
  const heavyChassis = s0.character.nomadUpgrades?.includes('heavy_chassis');
  const state: ChaseState = {
    ...chase,
    pressure: clamp(chase.pressure ?? 2, 1, 4),
    // O chassi pesado da Moto não resolve a perseguição, mas dá uma margem concreta de dano.
    vehicleIntegrity: clamp(heavyChassis ? Math.max(chase.vehicleIntegrity, 6) : chase.vehicleIntegrity, 1, 6),
    opponentIntegrity: clamp(chase.opponentIntegrity, 1, 6),
  };
  return emit({ ...s0, world: { ...s0.world, chase: state } }, 'SCENE_CHANGED', `Perseguição: ${state.opponent} (${state.reason})`, { data: { chase: true } });
}

/** DV da manobra: 13, mais 1 por ponto de pressão acima de 2. */
export const chaseDv = (chase: Pick<ChaseState, 'pressure'>) => 13 + Math.max(0, chase.pressure - 2);

export function resolveChase(s0: GameState, action: 'drive' | 'evade' | 'ram' | 'shoot' | 'escape', total: number): { state: GameState; summary: string } {
  const chase = s0.world.chase;
  if (!chase) return { state: s0, summary: 'Não há perseguição em curso.' };
  const dv = chaseDv(chase);
  const success = total > dv;
  let next = { ...chase };
  if (action === 'ram') {
    next.opponentIntegrity -= success ? 2 : 0;
    next.vehicleIntegrity -= success ? 1 : 2;
  } else if (action === 'shoot') next.opponentIntegrity -= success ? 1 : 0;
  else next.pressure += success ? (action === 'escape' ? -2 : -1) : 1;
  next.pressure = clamp(next.pressure, 0, 5);
  next.vehicleIntegrity = clamp(next.vehicleIntegrity, 0, 6);
  next.opponentIntegrity = clamp(next.opponentIntegrity, 0, 6);
  let s: GameState = { ...s0, world: { ...s0.world, chase: next } };
  if (next.pressure === 0 || next.opponentIntegrity === 0) {
    s = { ...s, world: { ...s.world, chase: undefined } };
    return { state: emit(s, 'SCENE_CHANGED', `Perseguição encerrada: ${next.opponentIntegrity === 0 ? 'oponente incapacitado' : 'você escapou'}`, { data: { chase: 'won' } }), summary: next.opponentIntegrity === 0 ? 'O veículo adversário saiu da perseguição.' : 'Você abriu distância e escapou.' };
  }
  if (next.pressure >= 5 || next.vehicleIntegrity <= 0) {
    const factions = chase.factionId ? s.factions.map(f => (f.id === chase.factionId ? { ...f, heat: clamp((f.heat ?? 0) + 1, 0, 5) } : f)) : s.factions;
    s = { ...s, factions, world: { ...s.world, chase: undefined, heat: clamp(s.world.heat + 1, 0, 5) } };
    return { state: emit(s, 'SCENE_CHANGED', `Perseguição encerrada: encurralado por ${chase.opponent}`, { data: { chase: 'lost' } }), summary: 'Você foi encurralado; o Heat global subiu.' };
  }
  return { state: emit(s, 'SCENE_CHANGED', `Perseguição: ${action} ${success ? 'funciona' : 'falha'} (${total} vs DV ${dv})`, { data: { chase: true, success } }), summary: `${action} ${success ? 'funcionou' : 'falhou'} (${total} vs DV ${dv}). Pressão ${next.pressure}/5; veículo ${next.vehicleIntegrity}/6; perseguidor ${next.opponentIntegrity}/6.` };
}
