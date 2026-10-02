// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCharacter, STAT_PRESETS } from '@shared/rules/creation';
import { createInitialState } from '@shared/engine/initialState';
import type { GameState } from '@shared/types/game';

vi.mock('../services/audio', () => ({ sound: new Proxy({}, { get: () => () => undefined }) }));

const { useGameStore, commit } = await import('./gameStore');
const { takeSnapshot, rewindTo, createBranch } = await import('./timeline');
const { saveToSlot, loadFromSlot, isPermadead } = await import('../services/saves');
const { setRepository, createMemoryRepository } = await import('../services/repository');

const character = () =>
  buildCharacter({
    name: 'Ren', handle: 'Sparks', age: 22, role: 'solo', occupation: 'x', district: 'WATSON',
    familyTie: '', debtReason: '', personalAnchor: '', appearance: '',
    stats: { ...STAT_PRESETS[0].stats }, starterWeaponId: 'pistol',
  });
const die = (s: GameState): GameState => ({ ...s, character: { ...s.character, dead: true, hp: { ...s.character.hp, current: 0 } } });

beforeEach(() => {
  localStorage.clear();
  setRepository(createMemoryRepository());
});

describe('Modo hardcore', () => {
  it('a campanha nasce marcada; sem a opção, não', () => {
    expect(createInitialState(character(), { hardcore: true }).hardcore).toBe(true);
    expect(createInitialState(character()).hardcore).toBeUndefined();
  });

  it('morreu no hardcore: a linha do tempo não volta (rebobinar e ramificar recusam)', async () => {
    useGameStore.getState().setGame(createInitialState(character(), { hardcore: true }));
    const snap = await takeSnapshot(useGameStore.getState().game!, 'turn_start', 'antes');
    commit(die(useGameStore.getState().game!));
    expect(isPermadead(useGameStore.getState().game!)).toBe(true);
    await expect(rewindTo(snap)).rejects.toThrow(/hardcore/i);
    await expect(createBranch(snap)).rejects.toThrow(/hardcore/i);
    expect(useGameStore.getState().game!.character.dead).toBe(true);
  });

  it('save antigo (vivo) de uma campanha hardcore que morreu não carrega mais', () => {
    useGameStore.getState().setGame(createInitialState(character(), { hardcore: true }));
    saveToSlot(1, useGameStore.getState().game!); // salvo enquanto vivo
    commit(die(useGameStore.getState().game!));
    expect(() => loadFromSlot(1)).toThrow(/hardcore/i);
  });

  it('fora do hardcore, morrer não trava nada', async () => {
    useGameStore.getState().setGame(createInitialState(character()));
    const snap = await takeSnapshot(useGameStore.getState().game!, 'turn_start', 'antes');
    saveToSlot(1, useGameStore.getState().game!);
    commit(die(useGameStore.getState().game!));
    expect(() => loadFromSlot(1)).not.toThrow();
    const back = await rewindTo(snap);
    expect(back.character.dead).toBe(false);
  });
});
