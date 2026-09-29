import type { GameEvent, GameEventType, GameState } from '../types/game';

export const MAX_EVENTS_IN_STATE = 300;

/** Id rastreável do turno atual: <campanha>:<linha>:t<n>. */
export function turnIdOf(state: Pick<GameState, 'id' | 'turn' | 'session'>, turn = state.turn): string {
  return `${state.id}:${state.session.branchId}:t${turn}`;
}

/** Registra um evento estruturado. Ids são determinísticos dentro do turno. */
export function emit(
  state: GameState,
  type: GameEventType,
  summary: string,
  fields: Partial<Pick<GameEvent, 'source' | 'target' | 'value' | 'data'>> = {},
): GameState {
  const turnId = turnIdOf(state);
  const seq = state.events.filter(e => e.turnId === turnId).length;
  const event: GameEvent = { id: `${turnId}:e${seq}`, turnId, turn: state.turn, time: state.world.time, type, summary, ...fields };
  return { ...state, events: [...state.events, event].slice(-MAX_EVENTS_IN_STATE) };
}

export function eventsOfTurn(state: GameState, turnId: string): GameEvent[] {
  return state.events.filter(e => e.turnId === turnId);
}
