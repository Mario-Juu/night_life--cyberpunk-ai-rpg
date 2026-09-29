import { z } from 'zod';
import { STATE_VERSION, type GameState } from '@shared/types/game';
import { migrateState } from '@shared/engine/migrate';

export const SLOT_COUNT = 3;
const slotKey = (slot: number) => `nightlife_v2_slot_${slot}`; // chave mantida: slots v2 são migrados ao carregar

export interface SlotInfo {
  slot: number;
  savedAt: string;
  title: string;
  handle: string;
  turn: number;
  district: string;
}

interface SlotData extends SlotInfo {
  state: GameState;
}

/** Validação estrutural mínima de um save v2 (saves v1 são rejeitados). */
const SaveSchema = z.looseObject({
  version: z.literal(STATE_VERSION),
  id: z.string(),
  turn: z.number(),
  character: z.looseObject({
    bio: z.looseObject({ name: z.string(), handle: z.string() }),
    hp: z.object({ current: z.number(), max: z.number() }),
    inventory: z.array(z.any()),
    skills: z.record(z.string(), z.number()),
  }),
  world: z.looseObject({ time: z.string() }),
  npcs: z.array(z.any()),
  missions: z.array(z.any()),
  chat: z.array(z.any()),
  phone: z.array(z.any()),
  combat: z.looseObject({ active: z.boolean() }),
  session: z.looseObject({ version: z.number(), branchId: z.string() }),
  scene: z.looseObject({ presentNpcIds: z.array(z.string()) }),
  flags: z.record(z.string(), z.any()),
  scheduled: z.array(z.any()),
  history: z.looseObject({ summaries: z.array(z.any()), summarizedUpToTurn: z.number() }),
});

/** Valida e, se for de uma versão anterior compatível (v2), migra para a atual. */
export function validateSave(data: unknown): GameState {
  let migrated: unknown;
  try {
    migrated = migrateState(data);
  } catch (err) {
    throw new Error(`Save incompatível: ${(err as Error).message}`);
  }
  const res = SaveSchema.safeParse(migrated);
  if (!res.success) throw new Error('Arquivo de save inválido ou corrompido.');
  return res.data as unknown as GameState;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function listSlots(): Array<SlotInfo | null> {
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const raw = safeGet(slotKey(i + 1));
    if (!raw) return null;
    try {
      const { state: _state, ...info } = JSON.parse(raw) as SlotData;
      return info;
    } catch {
      return null;
    }
  });
}

export function saveToSlot(slot: number, state: GameState): void {
  const data: SlotData = {
    slot,
    savedAt: new Date().toISOString(),
    title: state.title,
    handle: state.character.bio.handle,
    turn: state.turn,
    district: state.world.location.district,
    state,
  };
  try {
    localStorage.setItem(slotKey(slot), JSON.stringify(data));
  } catch {
    throw new Error('Sem espaço no armazenamento do navegador. Exporte o save para um arquivo.');
  }
}

export function loadFromSlot(slot: number): GameState {
  const raw = safeGet(slotKey(slot));
  if (!raw) throw new Error('Slot vazio.');
  return validateSave((JSON.parse(raw) as SlotData).state);
}

export function deleteSlot(slot: number): void {
  try {
    localStorage.removeItem(slotKey(slot));
  } catch {
    // ignora
  }
}

export function exportSave(state: GameState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nightlife_${state.character.bio.handle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_t${state.turn}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importSave(file: File): Promise<GameState> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  return validateSave(data);
}
