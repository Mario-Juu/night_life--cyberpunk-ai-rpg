/**
 * Repositório local da campanha (IndexedDB do navegador — sem servidor de banco).
 * Guarda o que não cabe no localStorage: registros de turno, snapshots e llm_runs.
 * O estado corrente continua no localStorage (gameStore).
 *
 * Stores: turns (turnId) · snapshots (id) · llm_runs (requestId), todos indexados por gameId.
 * Fallback em memória quando o IndexedDB não existe (testes, modo privado).
 */
import type { GameState } from '@shared/types/game';
import type { LlmRunMeta, TurnRecord } from '@shared/types/turn';

export type SnapshotKind = 'turn_start' | 'post_engine' | 'branch' | 'manual';

export interface SnapshotRecord {
  id: string;
  gameId: string;
  branchId: string;
  turn: number;
  kind: SnapshotKind;
  stateVersion: number;
  label: string;
  createdAt: string;
  state: GameState;
}

export type SnapshotMeta = Omit<SnapshotRecord, 'state'>;

export interface CampaignRepository {
  saveTurn(turn: TurnRecord): Promise<void>;
  listTurns(gameId: string, branchId?: string): Promise<TurnRecord[]>;
  saveSnapshot(snap: SnapshotRecord): Promise<void>;
  getSnapshot(id: string): Promise<SnapshotRecord | undefined>;
  listSnapshots(gameId: string): Promise<SnapshotMeta[]>;
  deleteSnapshots(ids: string[]): Promise<void>;
  deleteTurns(turnIds: string[]): Promise<void>;
  saveLlmRun(run: LlmRunMeta): Promise<void>;
  listLlmRuns(gameId: string): Promise<LlmRunMeta[]>;
  deleteGame(gameId: string): Promise<void>;
}

// ---------------------------------------------------------------- memória

export function createMemoryRepository(): CampaignRepository {
  const turns = new Map<string, TurnRecord>();
  const snaps = new Map<string, SnapshotRecord>();
  const runs = new Map<string, LlmRunMeta>();
  const strip = ({ state: _s, ...meta }: SnapshotRecord): SnapshotMeta => meta;
  return {
    async saveTurn(t) {
      turns.set(t.turnId, structuredClone(t));
    },
    async listTurns(gameId, branchId) {
      return [...turns.values()].filter(t => t.gameId === gameId && (!branchId || t.branchId === branchId)).sort((a, b) => a.turn - b.turn);
    },
    async saveSnapshot(s) {
      snaps.set(s.id, structuredClone(s));
    },
    async getSnapshot(id) {
      const s = snaps.get(id);
      return s && structuredClone(s);
    },
    async listSnapshots(gameId) {
      return [...snaps.values()].filter(s => s.gameId === gameId).map(strip).sort((a, b) => a.turn - b.turn || a.createdAt.localeCompare(b.createdAt));
    },
    async deleteSnapshots(ids) {
      ids.forEach(id => snaps.delete(id));
    },
    async deleteTurns(ids) {
      ids.forEach(id => turns.delete(id));
    },
    async saveLlmRun(r) {
      runs.set(r.requestId, r);
    },
    async listLlmRuns(gameId) {
      return [...runs.values()].filter(r => r.sessionId === gameId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async deleteGame(gameId) {
      for (const [k, t] of turns) if (t.gameId === gameId) turns.delete(k);
      for (const [k, s] of snaps) if (s.gameId === gameId) snaps.delete(k);
      for (const [k, r] of runs) if (r.sessionId === gameId) runs.delete(k);
    },
  };
}

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = 'nightlife';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('turns', { keyPath: 'turnId' }).createIndex('gameId', 'gameId');
      db.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('gameId', 'gameId');
      db.createObjectStore('llm_runs', { keyPath: 'requestId' }).createIndex('gameId', 'sessionId');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export function createIndexedDbRepository(): CampaignRepository {
  const dbp = openDb();
  const store = async (name: string, mode: IDBTransactionMode) => (await dbp).transaction(name, mode).objectStore(name);
  const byGame = async <T,>(name: string, gameId: string) => req((await store(name, 'readonly')).index('gameId').getAll(gameId)) as Promise<T[]>;

  return {
    async saveTurn(t) {
      await req((await store('turns', 'readwrite')).put(t));
    },
    async listTurns(gameId, branchId) {
      return (await byGame<TurnRecord>('turns', gameId)).filter(t => !branchId || t.branchId === branchId).sort((a, b) => a.turn - b.turn);
    },
    async saveSnapshot(s) {
      await req((await store('snapshots', 'readwrite')).put(s));
    },
    async getSnapshot(id) {
      return req((await store('snapshots', 'readonly')).get(id)) as Promise<SnapshotRecord | undefined>;
    },
    async listSnapshots(gameId) {
      // Metadados apenas: percorre com cursor para não devolver os estados inteiros.
      const s = await store('snapshots', 'readonly');
      return new Promise<SnapshotMeta[]>((resolve, reject) => {
        const out: SnapshotMeta[] = [];
        const cursor = s.index('gameId').openCursor(IDBKeyRange.only(gameId));
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return resolve(out.sort((a, b) => a.turn - b.turn || a.createdAt.localeCompare(b.createdAt)));
          const { state: _state, ...meta } = c.value as SnapshotRecord;
          out.push(meta);
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    },
    async deleteSnapshots(ids) {
      const s = await store('snapshots', 'readwrite');
      await Promise.all(ids.map(id => req(s.delete(id))));
    },
    async deleteTurns(ids) {
      const s = await store('turns', 'readwrite');
      await Promise.all(ids.map(id => req(s.delete(id))));
    },
    async saveLlmRun(r) {
      await req((await store('llm_runs', 'readwrite')).put(r));
    },
    async listLlmRuns(gameId) {
      return (await byGame<LlmRunMeta>('llm_runs', gameId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async deleteGame(gameId) {
      for (const name of ['turns', 'snapshots', 'llm_runs']) {
        const s = await store(name, 'readwrite');
        const keys = await req(s.index('gameId').getAllKeys(gameId));
        await Promise.all(keys.map(k => req(s.delete(k))));
      }
    },
  };
}

let repo: CampaignRepository | null = null;

export function getRepository(): CampaignRepository {
  if (!repo) repo = typeof indexedDB !== 'undefined' ? createIndexedDbRepository() : createMemoryRepository();
  return repo;
}

/** Permite injetar outro repositório (testes). */
export function setRepository(r: CampaignRepository) {
  repo = r;
}

/**
 * Retenção de snapshots: todos os turn_start dos últimos 40 turnos, depois 1 a cada 10;
 * post_engine só dos 3 últimos turnos (servem para regenerar narração).
 */
export function snapshotsToPrune(metas: SnapshotMeta[], branchId: string, currentTurn: number): string[] {
  return metas
    .filter(m => m.branchId === branchId)
    .filter(m => {
      const age = currentTurn - m.turn;
      if (m.kind === 'post_engine') return age > 3;
      if (m.kind === 'turn_start') return age > 40 && m.turn % 10 !== 0;
      return false;
    })
    .map(m => m.id);
}
