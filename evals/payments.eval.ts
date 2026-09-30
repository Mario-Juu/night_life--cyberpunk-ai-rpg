/**
 * Pagamento duplicado: o narrador conclui a missão (que paga a recompensa) E, no mesmo turno,
 * transfere o "pagamento pelo corre". É o MESMO dinheiro — o motor paga uma vez só.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';

const withJob = () => {
  const sc = scenario().tool('narrator', 'start_quest', { id: 'm_entrega', title: 'Entrega Noturna em Heywood', objective: 'Levar a carga', rewardEddies: 600, giverId: 'npc_rafa' });
  return sc.atTurn(sc.state.turn + 1);
};

describe('Recompensa de missão × transferência na mesma cena', () => {
  it('conclui a missão e depois transfere o mesmo pagamento: a transferência é recusada', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa "Zero-Um"', reason: 'Pagamento pelo corre de entrega' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/duplicado/);
    expect(sc.state.character.money).toBe(before + 600);
  });

  it('transfere primeiro (do contratante) e depois conclui: a recompensa só completa o que faltar', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa', reason: 'pagamento do corre' });
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
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

  it('dinheiro de OUTRA pessoa, de outro valor, no mesmo turno continua valendo', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.tool('narrator', 'transfer_money', { amount: 50, counterpart: 'Gorjeta do cliente', reason: 'gorjeta' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(before + 650);
  });

  it('em turnos diferentes não há bloqueio (um bônus depois é outro pagamento)', () => {
    const sc = withJob();
    const before = sc.state.character.money;
    sc.tool('narrator', 'complete_quest', { questId: 'm_entrega' });
    sc.atTurn(sc.state.turn + 1).tool('narrator', 'transfer_money', { amount: 600, counterpart: 'Rafa', reason: 'bônus pelo sigilo' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.character.money).toBe(before + 1200);
  });
});
