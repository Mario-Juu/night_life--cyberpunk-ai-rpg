/**
 * Turno estruturado: cada ação do jogador é rastreável da entrada à narração.
 */
import type { GameEvent, RollOutcome, RollRecord } from './game';

export type IntentType = 'attack' | 'skill' | 'social' | 'move' | 'trade' | 'use_item' | 'observe' | 'dialogue' | 'rest' | 'netrun' | 'other';

/** Intenção interpretada pelo LLM a partir do texto livre do jogador. */
export interface ParsedIntent {
  type: IntentType;
  summary: string;
  targetId?: string;
  confidence: number;
}

export type ToolOrigin = 'interpreter' | 'narrator' | 'phone' | 'player' | 'engine';

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallRecord extends ToolCall {
  origin: ToolOrigin;
  ok: boolean;
  /** Resumo legível do resultado (vai para o narrador e para o inspetor). */
  summary: string;
  data?: unknown;
  error?: string;
}

/** Verificação no formato solicitado (compatível com o CheckResult do motor). */
export interface CheckRecord {
  check: string;
  dice: string;
  roll: number;
  modifier: number;
  total: number;
  difficulty: number;
  success: boolean;
}

export interface LlmAttempt {
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export type LlmPurpose = 'interpret' | 'narrate' | 'prologue' | 'phone' | 'summarize';

/** Por que uma chamada ao LLM falhou (a causa que o jogador precisa saber). */
export type FailureKind = 'quota_day' | 'quota_minute' | 'overloaded' | 'timeout' | 'auth' | 'bad_request' | 'model_unavailable' | 'invalid_json' | 'network' | 'other';

/** Metadados de observabilidade de cada chamada ao LLM. */
export interface LlmRunMeta {
  requestId: string;
  sessionId: string;
  turnId: string;
  purpose: LlmPurpose;
  provider: string;
  model: string;
  modelVersion?: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  latencyMs: number;
  attempts: LlmAttempt[];
  toolsCalled: string[];
  retrievedMemories: string[];
  errors: string[];
  degraded: boolean;
  /** Causa principal quando degradado. */
  failureKind?: FailureKind;
  /** Narração: os flash falharam e o flash-lite NÃO foi tentado (o jogador decide). */
  liteOffered?: boolean;
  /** Alguma falha foi transitória: esperar e tentar de novo pode resolver. */
  waitMayHelp?: boolean;
  createdAt: string;
}

/** Resultado mecânico consolidado enviado ao narrador. */
export interface EngineResult {
  intent: ParsedIntent | null;
  tools: Array<Pick<ToolCallRecord, 'tool' | 'ok' | 'summary' | 'error' | 'data'>>;
  roll: RollOutcome | null;
  /** Eventos fora de cena disparados desde o último turno. */
  offscreen: string[];
}

/** in_net: o jogador está usando Ações de Rede pelo painel (o turno fecha com o ICE + narração). */
export type TurnPhase = 'interpreting' | 'awaiting_roll' | 'in_net' | 'narrating' | 'complete' | 'failed';
export type TurnKind = 'action' | 'prologue';

export interface TurnRecord {
  turnId: string;
  gameId: string;
  branchId: string;
  turn: number;
  kind: TurnKind;
  phase: TurnPhase;
  startedAt: string;
  completedAt?: string;
  playerInput: string | null;
  parsedIntent: ParsedIntent | null;
  clarification?: string;
  toolCalls: ToolCallRecord[];
  diceRolls: RollRecord[];
  checks: CheckRecord[];
  events: GameEvent[];
  engineResult: EngineResult | null;
  stateVersionBefore: number;
  stateVersionAfter?: number;
  /** Snapshot tirado depois do motor e antes da narração (permite regenerar a narração). */
  postEngineSnapshotId?: string;
  narration: string | null;
  memoriesCreated: string[];
  memoriesRetrieved: string[];
  llmRuns: LlmRunMeta[];
}
