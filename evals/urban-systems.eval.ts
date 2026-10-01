import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { CYBERWARE } from '../shared/rules/cyberware';
import { addTrace, generateArchitecture } from '../shared/engine/net';
import { cyberCapacityCost, cyberCapacityMax, cyberCapacityUsed } from '../shared/engine/cyberware';
import { useQuickhack } from '../shared/engine/quickhacks';
import { sequenceRng } from '../shared/engine/dice';

describe('Cidade viva: Mercado Noturno e encomendas', () => {
  it('só vende a peça que a banca realmente possui', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 10_000 } }));
    sc.tool('narrator', 'open_night_market', { name: 'Rattlesnake', cyberStock: 'cybereye' });
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'neural_link' });
    expect(sc.last().ok).toBe(false);
    sc.tool('interpreter', 'buy_market_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.inventory.some(i => i.cyberKey === 'cybereye')).toBe(true);
  });

  it('Canal encomenda e recebe automaticamente ao passar o tempo', () => {
    const sc = scenario({ role: 'fixer' }).edit(s => ({ ...s, character: { ...s.character, money: 10_000, roleRank: 10 } }));
    sc.tool('interpreter', 'order_cyberware', { key: 'cybereye' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.cyberOrders?.[0].status).toBe('ordered');
    sc.advance(24 * 60);
    expect(sc.state.world.cyberOrders?.[0].status).toBe('ready');
    expect(sc.state.character.inventory.some(i => i.cyberKey === 'cybereye')).toBe(true);
  });

  it('Mercado fecha ao acabar sua janela', () => {
    const sc = scenario();
    sc.tool('narrator', 'open_night_market', { name: 'Curto', cyberStock: 'cybereye', hours: 1 });
    sc.advance(61);
    expect(sc.state.world.market).toBeUndefined();
  });
});

describe('Daemons, rastro e combos', () => {
  it('arquitetura guarda o daemon e o rastro é limitado a 0..5', () => {
    const arch = generateArchitecture({ name: 'Torre', accessPoint: 'porta', difficulty: 'basic', floors: 3, daemon: { name: 'Cão de Guarda', directive: 'Rastrear intrusos' } }, 1, sequenceRng([1]));
    expect(arch.daemon).toMatchObject({ name: 'Cão de Guarda', owner: 'system', alert: 0 });
    const sc = scenario().edit(s => ({ ...s, net: { ...s.net, trace: { level: 4, source: 'teste', lastTurn: 1 } } }));
    expect(addTrace(sc.state, 4, 'Cão de Guarda').net.trace?.level).toBe(5);
    expect(addTrace(sc.state, -9, 'Cloak').net.trace).toBeUndefined();
  });

  it('Pane de Cromo seguida de Curto-Circuito aciona o combo', () => {
    const sc = scenario({ role: 'netrunner' }).edit(s => ({
      ...s,
      character: { ...s.character, roleRank: 10, quickhacks: ['cyberware_malfunction', 'short_circuit'], deck: { ...s.character.deck!, ram: { current: 20, max: 20 } } },
      combat: { ...s.combat, active: true, round: 1, combatants: [{ id: 'foe', name: 'Alvo', hp: { current: 50, max: 50 }, sp: { head: 0, body: 0 }, weapon: { name: 'Pistola', weaponClass: 'pistol_medium', damage: '2d6' }, attackBase: 6, evasionBase: 6, ref: 6, initiative: null, distance: '0-6m', cover: 'none', status: 'active', template: 'boosterganger' }] },
    }));
    const one = useQuickhack(sc.state, 'cyberware_malfunction', { combatantId: 'foe' }, sequenceRng([10, 1]));
    const two = useQuickhack(one.state, 'short_circuit', { combatantId: 'foe' }, sequenceRng([10, 1, 6, 6, 6, 6]));
    expect(two.ok).toBe(true);
    expect(two.summary).toMatch(/Combo: Pane de Cromo/);
    expect(two.data?.combo).toMatch(/Pane de Cromo/);
  });
});

describe('Capacidade, perseguição e facções', () => {
  it('capacidade de cromo é independente da Humanidade e cobra mais de hardware raro', () => {
    const sc = scenario();
    expect(cyberCapacityMax(sc.state.character)).toBeGreaterThan(0);
    expect(cyberCapacityUsed(sc.state.character)).toBe(0);
    expect(cyberCapacityCost(CYBERWARE.sandevistan_apogee)).toBeGreaterThan(cyberCapacityCost(CYBERWARE.cybereye));
  });

  it('perseguição pode ser vencida pelo Sandbox/motor e encerrar o estado', () => {
    const sc = scenario().edit(s => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, REF: 8 }, skills: { ...s.character.skills, drive: 8 } } }));
    sc.tool('narrator', 'start_chase', { opponent: 'Interceptor NCPD', reason: 'fuga', pressure: 2, vehicleIntegrity: 4, opponentIntegrity: 4 });
    sc.tool('interpreter', 'chase_action', { action: 'escape' }, [10, 1]);
    expect(sc.last().ok).toBe(true);
    expect(sc.state.world.chase).toBeUndefined();
  });

  it('calor de facção não altera o Heat policial global', () => {
    const sc = scenario();
    sc.tool('narrator', 'modify_faction', { name: 'Maelstrom', delta: 0, category: 'Gang' });
    const id = sc.state.factions.find(f => f.name === 'Maelstrom')!.id;
    sc.tool('narrator', 'modify_faction_heat', { factionId: id, delta: 2, reason: 'câmeras viram tudo' });
    expect(sc.state.factions.find(f => f.id === id)?.heat).toBe(2);
    expect(sc.state.world.heat).toBe(0);
  });
});
