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
  NetState,
  Front,
  Npc,
  NpcImportance,
  NpcProfile,
  SceneState,
  ThreatLevel,
  WorldFlag,
  WorldState,
} from './game';
import type { EngineResult, LlmRunMeta, ParsedIntent, ToolCall } from './turn';

/** Só a família flash (com flash-lite de reserva). O "pro" foi removido da plataforma. */
export type ModelMode = 'flash';

/** Frente do mundo como o Mestre a vê (o que está por trás + o que vem a seguir). */
export interface FrontView {
  id: string;
  title: string;
  premise: string;
  who: string;
  place: string;
  motive: string;
  victim: string;
  twist: string;
  status: Front['status'];
  playerAware: Front['playerAware'];
  stage: number;
  total: number;
  done: string[];
  next?: { title: string; at: string; blockHint: string };
  seedNpc?: string;
  /** Continuação de outra trama: o título dela e como terminou. */
  continues?: { title: string; outcome: string };
}

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
  /** Rede: arquitetura do ponto de acesso e conexão atual (opcional para clientes antigos). */
  net?: NetState;
  /** Modo Sandbox (debug). */
  sandbox?: boolean;
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
  /** Tramas do mundo (ativas e recém-encerradas). */
  fronts?: FrontView[];
  /** Últimas manchetes e rumores do feed NCNet (o jogador pode ter lido). */
  news?: Array<{ source: string; headline: string; at: string }>;
  /** Equipe do jogador (lutam ao lado dele; o motor decide os pedidos). */
  party?: Array<{ npcId: string; name: string; share: number; loyalty: number; stance: string; hp: string; present: boolean }>;
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
  /** O jogador autorizou o flash-lite se os flash falharem. */
  allowLite?: boolean;
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

// --------------------------------------------------------------- perfil de NPC
/** Pedido de perfil para um NPC que ganhou importância (roda fora do turno). */
export interface NpcProfileRequest {
  sessionId: string;
  turnId: string;
  npc: { id: string; name: string; role: string; description: string; currentGoal?: string; faction?: string; importance: NpcImportance; profile?: NpcProfile };
  /** profile = personalidade; depth = objetivo + segredo (NPC central); both = os dois. */
  needs: 'profile' | 'depth' | 'both';
  /** Cenas, mensagens, memórias e eventos em que o NPC apareceu. */
  evidence: string;
  player: { handle: string; role: string; district: string; occupation: string; debtReason: string; familyTie: string };
  /** Alvos possíveis de vínculo (NPCs e facções). */
  others: Array<{ id: string; name: string; role: string }>;
  model?: ModelMode;
}

export interface NpcProfileResponse {
  traits: string[];
  voice?: string;
  motivation?: string;
  fear?: string;
  lines?: string;
  goal?: string;
  secret?: string;
  secretWeight?: number;
  bond?: { targetId: string; kind: string; note?: string };
  knowsAboutPlayer?: string[];
  degraded?: boolean;
}

// --------------------------------------------------------------- costura do mundo
/** Textos de uma frente para o Mestre reescrever (mesma forma na ida e na volta; casados por id e posição). */
export interface FrontTexts {
  id: string;
  title: string;
  premise: string;
  twist: string;
  stages: Array<{ title: string; blockHint: string; effects: Array<{ kind: string; headline?: string; body?: string; text?: string }> }>;
}

export interface WorldgenRequest {
  sessionId: string;
  turnId: string;
  player: { handle: string; role: string; district: string; occupation: string; debtReason: string; familyTie: string; personalAnchor: string };
  fronts: Array<FrontTexts & { who: string; place: string; seed?: { name: string; role: string; voice?: string }; continues?: { title: string; outcome: string } }>;
  model?: ModelMode;
}

export interface WorldgenResponse {
  fronts: FrontTexts[];
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
  /** Reserva da narração quando o Flash cai (hoje, "Flash-Lite"). */
  backup?: string;
  promptVersion: string;
}
