// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildCharacter, STAT_PRESETS } from '@shared/rules/creation';
import { createInitialState } from '@shared/engine/initialState';

describe('persistência do store', () => {
  it('save v2 no localStorage é migrado para v3 ao abrir o jogo (não descartado)', async () => {
    const c = buildCharacter({
      name: 'Ren', handle: 'Sparks', age: 22, role: 'solo', occupation: 'x', district: 'WATSON',
      familyTie: '', debtReason: '', personalAnchor: '', appearance: '',
      stats: { ...STAT_PRESETS[0].stats }, starterWeaponId: 'pistol',
    });
    const s = createInitialState(c);
    // Forma de um save v2 (sem os campos novos).
    const { session: _a, scene: _b, flags: _c, activeEffects: _d, scheduled: _e, history: _f, ...rest } = s;
    const v2 = { ...rest, version: 2, turn: 7, npcs: s.npcs.map(({ respect: _r, fear: _g, anger: _h, knowledge: _k, ...n }) => n) };
    localStorage.setItem('nightlife_state_v2', JSON.stringify({ state: { game: v2 }, version: 2 }));

    vi.resetModules();
    const { useGameStore } = await import('./gameStore');
    await useGameStore.persist.rehydrate();
    const game = useGameStore.getState().game;
    expect(game?.version).toBe(3);
    expect(game?.turn).toBe(7);
    expect(game?.character.bio.handle).toBe('Sparks');
    expect(game?.session.branchId).toBe('main');
  });
});
