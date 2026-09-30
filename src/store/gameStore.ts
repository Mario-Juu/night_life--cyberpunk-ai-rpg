import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GameState } from '@shared/types/game';
import type { TurnRecord } from '@shared/types/turn';
import { gameReducer, type GameAction } from '@shared/engine/reducer';
import { validateSave } from '../services/saves';
import { backfillNpcsFromChat, repairNpcs } from '@shared/engine/npcs';

/** Cada mudança confirmada incrementa session.version (controle de concorrência/auditoria). */
function bump(prev: GameState, next: GameState): GameState {
  if (next === prev) return prev;
  return { ...next, session: { ...next.session, version: prev.session.version + 1 } };
}

interface GameStore {
  game: GameState | null;
  /** Turno em andamento (persistido: sobrevive a recarregar a página durante uma rolagem). */
  activeTurn: TurnRecord | null;
  dispatch: (action: GameAction) => void;
  /** Confirma um novo estado calculado pelo motor a partir do estado ATUAL. */
  commit: (next: GameState, expectedVersion?: number) => void;
  setGame: (state: GameState | null) => void;
  setActiveTurn: (turn: TurnRecord | null) => void;
}

export class StaleStateError extends Error {}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      game: null,
      activeTurn: null,
      dispatch: action =>
        set(s => {
          if (!s.game) return s;
          return { game: bump(s.game, gameReducer(s.game, action)) };
        }),
      commit: (next, expectedVersion) => {
        const current = get().game;
        if (!current) return;
        // Concorrência otimista: o estado não pode ter mudado entre o cálculo e o commit.
        if (expectedVersion !== undefined && current.session.version !== expectedVersion) {
          throw new StaleStateError(`Estado mudou durante a operação (v${expectedVersion} → v${current.session.version}).`);
        }
        set({ game: bump(current, next) });
      },
      setGame: state => set({ game: state, activeTurn: null }),
      setActiveTurn: activeTurn => set({ activeTurn }),
    }),
    {
      name: 'nightlife_state_v2',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // Sem `migrate`, o zustand DESCARTA estados de versão anterior. A migração real
      // (v2 → v3) acontece em `merge`, via validateSave/migrateState.
      migrate: persisted => persisted as GameStore,
      partialize: s => ({ game: s.game, activeTurn: s.activeTurn }),
      merge: (persisted, current) => {
        const p = persisted as { game?: unknown; activeTurn?: TurnRecord | null } | undefined;
        if (!p?.game) return current;
        try {
          // Recupera personagens que falaram em cena mas nunca foram cadastrados (saves antigos).
          const game = repairNpcs(backfillNpcsFromChat(validateSave(p.game)));
          return { ...current, game, activeTurn: p.activeTurn?.gameId === game.id ? p.activeTurn : null };
        } catch {
          return current;
        }
      },
    },
  ),
);

export function getGame(): GameState | null {
  return useGameStore.getState().game;
}

export function requireGame(): GameState {
  const g = getGame();
  if (!g) throw new Error('Nenhuma campanha ativa.');
  return g;
}

export function dispatch(action: GameAction): void {
  useGameStore.getState().dispatch(action);
}

export function commit(next: GameState, expectedVersion?: number): void {
  useGameStore.getState().commit(next, expectedVersion);
}
