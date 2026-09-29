// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RollOutcome } from '@shared/types/game';
import { buildCharacter, STAT_PRESETS } from '@shared/rules/creation';
import { createInitialState } from '@shared/engine/initialState';
import { resolveCheck } from '@shared/engine/checks';
import { sequenceRng } from '@shared/engine/dice';
import { diceShowFrom, playDice, useDiceStore } from '../../store/diceStore';
import { useUiStore } from '../../store/uiStore';
import { DiceOverlay } from './DiceOverlay';
import { RollResult } from '../narrative/RollResult';
import { RollCard } from '../narrative/RollCard';

vi.mock('../../services/audio', () => ({ sound: new Proxy({}, { get: () => () => undefined }) }));

const character = buildCharacter({
  name: 'Ren', handle: 'Sparks', age: 22, role: 'solo', occupation: 'x', district: 'WATSON',
  familyTie: '', debtReason: '', personalAnchor: '', appearance: '',
  stats: { ...STAT_PRESETS[0].stats }, starterWeaponId: 'pistol',
});

function outcome(faces: number[], dv = 17): RollOutcome {
  const check = resolveCheck(character, { stat: 'COOL', skillId: 'persuasion', dv }, sequenceRng(faces));
  return { request: { id: 'r1', kind: 'check', origin: 'gm', reason: 'Convencer o guarda', stat: 'COOL', skillId: 'persuasion', dv, modifier: 0 }, check };
}

afterEach(() => {
  cleanup();
  useUiStore.setState({ revealDv: false, animateDice: true });
  useDiceStore.setState({ show: null, resolve: null });
});

describe('encenação dos dados', () => {
  it('crítico mostra os dois d10 e o total — sem DV nem sucesso/falha', () => {
    const show = diceShowFrom(outcome([10, 4]));
    expect(show.stages[0].dice.map(d => [d.value, d.tone])).toEqual([
      [10, 'crit'],
      [4, 'crit'],
    ]);
    expect(show.stages[0].result).toMatch(/10 natural/);
    expect(JSON.stringify(show)).not.toMatch(/DV|17|[Ss]ucesso|[Ff]alha|Acert|Err/);
  });

  it('ataque: só o dado de ataque; o dano não é encenado (revelaria o acerto)', () => {
    const base = outcome([8]);
    const show = diceShowFrom({
      ...base,
      request: { ...base.request, kind: 'attack' },
      attack: { weaponId: 'w', weaponName: 'Pistola', targetId: 't', targetName: 'Guarda', hit: true, ammoBefore: 12, ammoAfter: 11, damage: { notation: '2d6', rolls: [6, 3], total: 9, sixes: 1, critical: false } },
    });
    expect(show.stages.map(s => s.label)).toEqual(['Ataque']);
    expect(JSON.stringify(show)).not.toMatch(/Dano|Acert|Guarda/);
  });

  it('overlay pousa nos valores do motor e o clique pula', async () => {
    render(<DiceOverlay />);
    let done = false;
    let promise: Promise<boolean>;
    act(() => {
      promise = playDice(diceShowFrom(outcome([7])));
      void promise.then(() => (done = true));
    });
    expect(screen.getByRole('dialog', { name: /Rolagem/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('dialog', { name: /Rolagem/ }));
    expect(await promise!).toBe(true);
    expect(done).toBe(true);
    expect(screen.queryByRole('dialog', { name: /Rolagem/ })).toBeNull();
  });

  it('sem animação (configuração), resolve na hora', async () => {
    render(<DiceOverlay />);
    useUiStore.setState({ animateDice: false });
    expect(await playDice(diceShowFrom(outcome([7])))).toBe(false);
  });
});

describe('DV escondido do jogador', () => {
  it('resultado não mostra o DV por padrão, só no modo transparente', () => {
    const o = outcome([6], 21);
    const { container, rerender } = render(<RollResult outcome={o} defaultOpen />);
    expect(container.textContent).not.toMatch(/DV/);
    act(() => useUiStore.setState({ revealDv: true }));
    rerender(<RollResult outcome={o} defaultOpen />);
    expect(container.textContent).toMatch(/vs DV 21/);
  });

  it('antes da narração, o card não revela sucesso/falha nem dano', () => {
    const base = outcome([9], 13);
    const o = { ...base, attack: { weaponId: 'w', weaponName: 'Pistola', targetId: 't', targetName: 'Guarda', hit: true, ammoBefore: 12, ammoAfter: 11, application: { location: 'body' as const, raw: 9, spBefore: 4, spAfter: 3, throughArmor: 5, hpDamage: 5, critBonus: 0, hpBefore: 20, hpAfter: 15, ablated: true } } };
    const { container, rerender } = render(<RollResult outcome={o} concealed />);
    expect(container.textContent).toMatch(/O Mestre narra/);
    expect(container.textContent).not.toMatch(/Sucesso|Falha|PV|Guarda/);
    expect(screen.queryByRole('button', { name: /Detalhes/ })).toBeNull();
    rerender(<RollResult outcome={o} />);
    expect(container.textContent).toMatch(/Sucesso/);
    expect(container.textContent).toMatch(/−5 PV em Guarda/);
  });

  it('card de rolagem não revela a dificuldade', () => {
    const game = { ...createInitialState(character), pendingRoll: outcome([5], 21).request };
    const { container } = render(<RollCard game={game} />);
    expect(container.textContent).not.toMatch(/DV|dificuldade|heroico|21/i);
    expect(screen.getByRole('button', { name: /Rolar 1d10/ })).toBeTruthy();
  });
});
