/**
 * Linha do tempo: snapshots, rewind e ramificação.
 * - turn_start: estado ANTES do turno N (snapshot.turn = N) → rewind para "antes do turno N".
 * - post_engine: estado depois do motor e antes da narração do turno N → regenerar narração.
 * - branch/manual: pontas de linhas do tempo alternativas.
 */
import type { GameState } from '@shared/types/game';
import { makeId } from '@shared/engine/ids';
import { getRepository, snapshotsToPrune, type SnapshotKind, type SnapshotMeta, type SnapshotRecord } from '../services/repository';
import { requireGame, useGameStore } from './gameStore';

const lineName = (id: string) => (id === 'main' ? 'principal' : id);

export function snapshotId(state: GameState, kind: SnapshotKind, turn: number): string {
  const base = `${state.id}:${state.session.branchId}:t${turn}:${kind}`;
  return kind === 'manual' || kind === 'branch' ? `${base}:${Date.now().toString(36)}` : base;
}

export async function takeSnapshot(state: GameState, kind: SnapshotKind, label: string): Promise<string> {
  const turn = kind === 'turn_start' ? state.turn + 1 : state.turn;
  const snap: SnapshotRecord = {
    id: snapshotId(state, kind, turn),
    gameId: state.id,
    branchId: state.session.branchId,
    turn,
    kind,
    stateVersion: state.session.version,
    label: label.slice(0, 120),
    createdAt: new Date().toISOString(),
    state,
  };
  try {
    await getRepository().saveSnapshot(snap);
  } catch (err) {
    console.warn('[timeline] snapshot não salvo:', err);
  }
  return snap.id;
}

export async function listTimeline(gameId: string): Promise<SnapshotMeta[]> {
  return getRepository().listSnapshots(gameId);
}

export async function pruneSnapshots(state: GameState): Promise<void> {
  const repo = getRepository();
  const metas = await repo.listSnapshots(state.id);
  const ids = snapshotsToPrune(metas, state.session.branchId, state.turn);
  if (ids.length) await repo.deleteSnapshots(ids);
}

/**
 * Volta para antes do turno do snapshot. Na mesma linha do tempo, o futuro é descartado
 * (turnos e snapshots posteriores). Para preservar o futuro, use createBranch.
 */
export async function rewindTo(snapshotIdToLoad: string): Promise<GameState> {
  const repo = getRepository();
  const snap = await repo.getSnapshot(snapshotIdToLoad);
  if (!snap) throw new Error('Ponto de retorno não encontrado.');
  const metas = await repo.listSnapshots(snap.gameId);
  const future = metas.filter(m => m.branchId === snap.branchId && m.turn >= snap.turn && m.id !== snap.id).map(m => m.id);
  await repo.deleteSnapshots([...future, snap.id]);
  const turns = await repo.listTurns(snap.gameId, snap.branchId);
  await repo.deleteTurns(turns.filter(t => t.turn >= snap.turn).map(t => t.turnId));
  const state = { ...snap.state, session: { ...snap.state.session, version: requireGame().session.version + 1 } };
  useGameStore.getState().setGame(state);
  return state;
}

/**
 * Cria uma linha do tempo alternativa a partir de um snapshot, preservando a atual
 * (a ponta atual é salva para poder ser retomada depois).
 */
export async function createBranch(fromSnapshotId: string): Promise<GameState> {
  const repo = getRepository();
  const snap = await repo.getSnapshot(fromSnapshotId);
  if (!snap) throw new Error('Ponto de retorno não encontrado.');
  const current = requireGame();
  await takeSnapshot(current, 'branch', `Ponta da linha ${lineName(current.session.branchId)} (turno ${current.turn})`);
  const branchId = makeId('br');
  const state: GameState = {
    ...snap.state,
    session: { version: current.session.version + 1, branchId, parentBranchId: snap.branchId, branchedFromTurn: snap.turn },
  };
  useGameStore.getState().setGame(state);
  await takeSnapshot(state, 'branch', `Início de uma nova linha (a partir do turno ${snap.turn})`);
  return state;
}

/** Retoma a ponta mais recente de outra linha do tempo. */
export async function switchBranch(branchId: string): Promise<GameState> {
  const repo = getRepository();
  const current = requireGame();
  if (branchId === current.session.branchId) return current;
  await takeSnapshot(current, 'branch', `Ponta da linha ${lineName(current.session.branchId)} (turno ${current.turn})`);
  const metas = (await repo.listSnapshots(current.id)).filter(m => m.branchId === branchId);
  const tip = metas.sort((a, b) => b.turn - a.turn || b.createdAt.localeCompare(a.createdAt))[0];
  if (!tip) throw new Error('Linha do tempo sem pontos de retorno.');
  const snap = await repo.getSnapshot(tip.id);
  if (!snap) throw new Error('Ponto de retorno não encontrado.');
  const state = { ...snap.state, session: { ...snap.state.session, version: current.session.version + 1 } };
  useGameStore.getState().setGame(state);
  return state;
}

export function branchesOf(metas: SnapshotMeta[]): Array<{ branchId: string; lastTurn: number; snapshots: number }> {
  const map = new Map<string, { branchId: string; lastTurn: number; snapshots: number }>();
  for (const m of metas) {
    const b = map.get(m.branchId) ?? { branchId: m.branchId, lastTurn: 0, snapshots: 0 };
    b.lastTurn = Math.max(b.lastTurn, m.turn);
    b.snapshots++;
    map.set(m.branchId, b);
  }
  return [...map.values()];
}
