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

/** Número de verdade (NaN/Infinity vindos de JSON quebrado não passam). */
const num = z.number().refine(Number.isFinite, 'número inválido');
/** Lista de objetos: nenhum item nulo (o motor percorre sem checar item a item). */
const list = z.array(z.looseObject({}));

/**
 * Validação estrutural de um save v3 (saves v1 são rejeitados).
 * Cobre tudo que o motor percorre sem defesa: listas, objetos aninhados e números.
 * Um save que passa aqui tem de aguentar um turno inteiro sem lançar.
 */
const SaveSchema = z.looseObject({
  version: z.literal(STATE_VERSION),
  id: z.string(),
  turn: num,
  character: z.looseObject({
    bio: z.looseObject({ name: z.string(), handle: z.string() }),
    hp: z.object({ current: num, max: num }),
    humanity: z.object({ current: num, max: num }),
    luck: z.object({ current: num, max: num }),
    money: num,
    stats: z.record(z.string(), num),
    inventory: list,
    skills: z.record(z.string(), num),
    cyberware: list,
    criticalInjuries: list,
  }),
  world: z.looseObject({ time: z.string(), location: z.looseObject({}) }),
  npcs: list,
  missions: list,
  chat: list,
  phone: z.array(z.looseObject({ npcId: z.string(), messages: list })),
  combat: z.looseObject({ active: z.boolean(), combatants: list, round: num }),
  session: z.looseObject({ version: num, branchId: z.string() }),
  scene: z.looseObject({ presentNpcIds: z.array(z.string()) }),
  flags: z.record(z.string(), z.any()),
  scheduled: z.array(z.looseObject({ action: z.looseObject({ kind: z.string() }) })),
  history: z.looseObject({ summaries: list, summarizedUpToTurn: num }),
  activeEffects: list,
  memories: list,
  events: list,
  discoveries: list,
  factions: list,
  // Campos novos: ausentes em saves antigos (a migração preenche), mas se vierem têm de ser válidos.
  fronts: z.array(z.looseObject({ id: z.string(), stages: z.array(z.looseObject({ effects: z.array(z.any()) })) })).optional(),
  news: list.optional(),
  party: z.looseObject({ members: z.array(z.looseObject({ npcId: z.string() })) }).optional(),
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
