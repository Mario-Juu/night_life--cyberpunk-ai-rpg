/**
 * Contrato da API entre cliente e servidor do Game Master.
 * Fluxo: interpretar intenção → motor resolve → narrar resultado.
 */
import type {
  ActiveEffect,
  Character,
  CombatState,
  Dialogue,
  Discovery,
  Faction,
  HistorySummary,
  Memory,
  Mission,
  Npc,
  SceneState,
  ThreatLevel,
  WorldFlag,
  WorldState,
} from './game';
import type { EngineResult, LlmRunMeta, ParsedIntent, ToolCall } from './turn';

export type ModelMode = 'pro' | 'flash';

/** Subconjunto relevante do estado, montado por shared/engine/context.ts. */
export interface GameContext {
  sessionId: string;
  branchId: string;
  turnId: string;
  turn: number;
  character: Character;
  world: WorldState;
  scene: SceneState & { effectiveThreat: ThreatLevel };
  npcs: Npc[];
  quests: Mission[];
  factions: Faction[];
  flags: WorldFlag[];
  activeEffects: ActiveEffect[];
  combat: CombatState;
  memories: Memory[];
  summaries: HistorySummary[];
  recentHistory: Array<{ turn: number; kind: string; text: string }>;
  phone: Array<{ npcId: string; npcName: string; last: Array<{ from: string; text: string }> }>;
  /** O que o JOGADOR sabe (descobertas). Segredos de NPCs ficam só nos NPCs. */
  playerKnowledge: string[];
  /** Eventos agendados (só o Mestre vê). */
  upcoming: Array<{ id: string; at: string; description: string }>;
  /** Acontecimentos fora de cena disparados e ainda não narrados. */
  offscreen: string[];
}

// --------------------------------------------------------------- interpretar
export interface InterpretRequest {
  context: GameContext;
  text: string;
  model?: ModelMode;
  /** Erros da tentativa anterior, para o intérprete se corrigir. */
  feedback?: string;
}

export interface InterpretResponse {
  intent: ParsedIntent;
  /** 1–2 frases de tensão exibidas antes de uma rolagem. */
  framing?: string;
  /** Pergunta ao jogador quando a ação é ambígua (nenhuma ferramenta é executada). */
  clarification?: string;
  toolCalls: ToolCall[];
}

// --------------------------------------------------------------- narrar
export interface NarrateRequest {
  context: GameContext;
  kind: 'action' | 'prologue';
  playerInput?: string;
  engineResult: EngineResult | null;
  model?: ModelMode;
}

export interface EnemyAction {
  attackerId: string;
}

export interface NarrateResponse {
  narration: string;
  dialogues: Dialogue[];
  toolCalls: ToolCall[];
  discoveries: Discovery[];
  suggestedActions: string[];
  enemyActions: EnemyAction[];
  /** Contradições com o motor detectadas no servidor (mesmo após nova tentativa). */
  consistencyWarnings?: string[];
  degraded?: boolean;
}

// --------------------------------------------------------------- telefone
export interface PhoneRequest {
  context: GameContext;
  npcId: string;
  message: string;
  model?: ModelMode;
}

export interface PhoneResponse {
  replyText: string;
  suggestedReplies: string[];
  toolCalls: ToolCall[];
  degraded?: boolean;
}

// --------------------------------------------------------------- resumo
export interface SummarizeRequest {
  sessionId: string;
  turnId: string;
  fromTurn: number;
  toTurn: number;
  transcript: string;
  model?: ModelMode;
}

export interface SummarizeResponse {
  summary: string;
  degraded?: boolean;
}

/** Envelope de todas as respostas do GM: payload + metadados de observabilidade. */
export interface GmEnvelope<T> {
  payload: T;
  meta: LlmRunMeta;
}

export interface GMStatus {
  status: 'ok';
  hasKey: boolean;
  defaultMode: ModelMode;
  promptVersion: string;
}
