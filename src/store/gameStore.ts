import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GameState } from '@shared/types/game';
import type { TurnRecord } from '@shared/types/turn';
import { gameReducer, type GameAction } from '@shared/engine/reducer';
import { isPermadead, markFallen, validateSave } from '../services/saves';
import { toast } from '../ui/toastStore';
import { backfillNpcsFromChat, repairNpcs } from '@shared/engine/npcs';
import { generateFronts, repairFronts } from '@shared/engine/fronts';

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
          const game = bump(s.game, gameReducer(s.game, action));
          if (isPermadead(game)) markFallen(game.id);
          return { game };
        }),
      commit: (next, expectedVersion) => {
        const current = get().game;
        if (!current) return;
        // Concorrência otimista: o estado não pode ter mudado entre o cálculo e o commit.
        if (expectedVersion !== undefined && current.session.version !== expectedVersion) {
          throw new StaleStateError(`Estado mudou durante a operação (v${expectedVersion} → v${current.session.version}).`);
        }
        const game = bump(current, next);
        // Morreu no hardcore: a campanha entra na lista das que não voltam (saves antigos incluídos).
        if (isPermadead(game)) markFallen(game.id);
        set({ game });
      },
      // Campanha nova, slot ou importação: saves de antes das frentes ganham as deles (seed da campanha).
      setGame: state => set({ game: state && sanitizeGame(state), activeTurn: null }),
      setActiveTurn: activeTurn => set({ activeTurn }),
    }),
    {
      name: 'nightlife_state_v2',
      version: 3,
      // Cota do navegador cheia não pode derrubar o turno no meio: avisa uma vez e segue em memória.
      storage: createJSONStorage(() => ({
        getItem: k => localStorage.getItem(k),
        removeItem: k => localStorage.removeItem(k),
        setItem: (k, v) => {
          try {
            localStorage.setItem(k, v);
            storageWarned = false;
          } catch {
            if (!storageWarned) {
              storageWarned = true;
              toast({ title: 'Não deu para salvar', body: 'O armazenamento do navegador encheu. Exporte a campanha (Menu → Salvar/Carregar) antes de fechar a aba.', tone: 'danger' });
            }
          }
        },
      })),
      // Sem `migrate`, o zustand DESCARTA estados de versão anterior. A migração real
      // (v2 → v3) acontece em `merge`, via validateSave/migrateState.
      migrate: persisted => persisted as GameStore,
      partialize: s => ({ game: s.game, activeTurn: s.activeTurn }),
      merge: (persisted, current) => {
        const p = persisted as { game?: unknown; activeTurn?: TurnRecord | null } | undefined;
        if (!p?.game) return current;
        try {
          // Recupera personagens que falaram em cena mas nunca foram cadastrados (saves antigos).
          const game = sanitizeGame(p.game);
          return { ...current, game, activeTurn: p.activeTurn?.gameId === game.id ? p.activeTurn : null };
        } catch (err) {
          // Guarda o original para não perder a campanha quando o save estiver corrompido/mais novo.
          try {
            const raw = localStorage.getItem('nightlife_state_v2');
            if (raw) localStorage.setItem('nightlife_state_backup', raw);
          } catch {
            /* sem espaço para a cópia: segue */
          }
          brokenSave = (err as Error)?.message ?? 'motivo desconhecido';
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

/**
 * Saneamento ÚNICO de toda campanha que entra no jogo (carregar, importar, slot, rewind, ramificação):
 * migra o schema, repara NPCs/frentes de saves antigos e garante as frentes do mundo.
 */
export function sanitizeGame(raw: unknown): GameState {
  return repairFronts(generateFronts(repairNpcs(backfillNpcsFromChat(validateSave(raw)))));
}

/** Save persistido que não pôde ser lido nesta sessão (a UI avisa o jogador). */
export let brokenSave: string | null = null;
export const clearBrokenSave = () => (brokenSave = null);

let storageWarned = false;

export function commit(next: GameState, expectedVersion?: number): void {
  useGameStore.getState().commit(next, expectedVersion);
}
