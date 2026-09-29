/**
 * NIGHT//LIFE — modelo de estado ÚNICO do jogo.
 * Compartilhado entre cliente (store/React) e servidor (prompt do GM).
 * Toda mutação passa por shared/engine/reducer.ts.
 */

export const STATE_VERSION = 3 as const;

export type StatKey = 'INT' | 'REF' | 'DEX' | 'TECH' | 'COOL' | 'WILL' | 'LUCK' | 'MOVE' | 'BODY' | 'EMP';
export type Stats = Record<StatKey, number>;

export type HitLocation = 'body' | 'head';
export type DistanceBracket = 'melee' | '0-6m' | '7-12m' | '13-25m' | '26-50m' | '51-100m';
export type CoverLevel = 'none' | 'partial' | 'full';

export type WeaponClass =
  | 'unarmed'
  | 'melee_light'
  | 'melee_medium'
  | 'melee_heavy'
  | 'pistol_medium'
  | 'pistol_heavy'
  | 'pistol_vheavy'
  | 'smg'
  | 'shotgun'
  | 'assault_rifle'
  | 'sniper_rifle'
  | 'bow';

export type AmmoKind = 'M_PISTOL' | 'H_PISTOL' | 'VH_PISTOL' | 'SLUG' | 'RIFLE' | 'ARROW';

export interface WeaponStats {
  weaponClass: WeaponClass;
  damage: string; // ex.: "2d6"
  magSize: number | null; // null = corpo a corpo
  loaded: number;
  ammo: AmmoKind | null;
}

export interface ArmorStats {
  slot: HitLocation;
  sp: number;
  maxSp: number;
}

export type ItemCategory = 'weapon' | 'armor' | 'ammo' | 'consumable' | 'gear' | 'datashard';

export interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  quantity: number;
  description: string;
  equipped?: boolean;
  value?: number;
  weapon?: WeaponStats;
  armor?: ArmorStats;
  ammoKind?: AmmoKind; // para itens de munição
  heal?: number; // consumíveis de cura
}

export type CyberwareCategory =
  | 'Neuralware'
  | 'Cyberóptico'
  | 'Cyberáudio'
  | 'Membro Cibernético'
  | 'Implante Interno'
  | 'Implante Dérmico'
  | 'Borgware';

export interface CyberwareItem {
  id: string;
  name: string;
  category: CyberwareCategory;
  humanityLoss: number;
  description: string;
}

export interface CriticalInjury {
  id: string;
  key: string;
  name: string;
  effect: string;
  location: HitLocation;
  /** Penalidades mecânicas aplicadas em testes. 'all' = todos os testes. */
  penalties: Partial<Record<StatKey | 'all', number>>;
  quickFixDv: number;
  treatmentDv: number;
}

export interface CharacterBio {
  name: string;
  handle: string;
  age: number;
  role: RoleId;
  occupation: string;
  district: string;
  familyTie: string;
  debtReason: string;
  personalAnchor: string;
  appearance: string;
}

export type RoleId = 'solo' | 'netrunner' | 'tech' | 'medtech' | 'fixer' | 'nomad';

export interface Character {
  bio: CharacterBio;
  stats: Stats;
  /** Nível por id canônico de perícia (shared/rules/skills.ts). */
  skills: Record<string, number>;
  hp: { current: number; max: number };
  humanity: { current: number; max: number };
  luck: { current: number; max: number };
  money: number;
  reputation: number; // 0..10
  ip: number; // pontos de melhoria
  inventory: InventoryItem[];
  cyberware: CyberwareItem[];
  criticalInjuries: CriticalInjury[];
  deathSavePenalty: number;
  stabilized: boolean;
  dead: boolean;
}

export type MissionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABANDONED';

export interface Mission {
  id: string;
  title: string;
  description: string;
  objective: string;
  status: MissionStatus;
  reward?: string;
  /** Pagamento em eddies liberado pelo motor ao concluir (a única fonte de recompensa de missão). */
  rewardEddies: number;
  giverId?: string;
  notes: string[];
  /** Flag que conclui/falha a missão automaticamente quando fica verdadeira. */
  completeFlag?: string;
  failFlag?: string;
  startedTurn: number;
  resolvedTurn?: number;
}

export type NpcStatus = 'alive' | 'missing' | 'dead';

export interface NpcKnowledge {
  id: string;
  fact: string;
  /** Segredo: o NPC sabe, o jogador não. */
  secret: boolean;
}

export interface Npc {
  id: string;
  name: string;
  role: string;
  description: string;
  trust: number; // -100..100
  respect: number; // 0..100
  fear: number; // 0..100
  anger: number; // 0..100
  currentGoal?: string;
  location?: string;
  knowledge: NpcKnowledge[];
  status: NpcStatus;
  faction?: string;
  pendingMatters?: string;
  lastInteraction?: string;
  /** Aparece nos contatos do telefone. */
  isContact: boolean;
}

export interface Faction {
  id: string;
  name: string;
  category: 'Megacorp' | 'Gang' | 'Rede de Canais' | 'Polícia' | 'Clã Nômade' | 'Outro';
  standing: number; // -100..100
  description: string;
}

export type CombatantStatus = 'active' | 'down' | 'fled' | 'dead' | 'surrendered';

export interface Combatant {
  id: string;
  name: string;
  hp: { current: number; max: number };
  sp: { head: number; body: number };
  weapon: { name: string; weaponClass: WeaponClass; damage: string };
  /** STAT + perícia de ataque (sem o d10). */
  attackBase: number;
  /** DEX + Evasão (sem o d10). */
  evasionBase: number;
  ref: number;
  initiative: number | null;
  distance: DistanceBracket;
  cover: CoverLevel;
  status: CombatantStatus;
  looted?: boolean;
}

export interface CombatState {
  active: boolean;
  round: number;
  playerInitiative: number | null;
  combatants: Combatant[];
  log: string[];
}

export interface PhoneMessage {
  id: string;
  from: 'npc' | 'player';
  text: string;
  time: string;
}

export interface PhoneThread {
  npcId: string;
  messages: PhoneMessage[];
  unread: number;
  suggestedReplies: string[];
}

export interface Dialogue {
  speaker: string;
  text: string;
}

export interface Discovery {
  title: string;
  description: string;
  category?: string;
}

export type ChatKind = 'narration' | 'player' | 'roll' | 'system' | 'discovery' | 'combat';

export interface ChatEntry {
  id: string;
  kind: ChatKind;
  text: string;
  time: string;
  turn: number;
  roll?: RollOutcome;
  discovery?: Discovery;
  degraded?: boolean;
}

export type MemoryType = 'CHARACTER_MEMORY' | 'CAMPAIGN_MEMORY' | 'NPC_MEMORY' | 'WORLD_MEMORY' | 'PLAYER_MEMORY' | 'SCENE_MEMORY';

export interface Memory {
  id: string;
  type: MemoryType;
  /** Id da entidade (npc_rafa, WATSON, m_rent…) ou rótulo livre. */
  subject: string;
  content: string;
  importance: number; // 1..10
  confidence: number; // 0..1
  createdTurn: number;
  lastRelevantTurn: number;
  tags: string[];
}

export const GAME_EVENT_TYPES = [
  'PLAYER_MOVED',
  'ITEM_ACQUIRED',
  'ITEM_REMOVED',
  'ITEM_USED',
  'AMMO_RELOADED',
  'MONEY_CHANGED',
  'DAMAGE_DEALT',
  'DAMAGE_TAKEN',
  'HEALED',
  'INJURY_ADDED',
  'INJURY_REMOVED',
  'HUMANITY_CHANGED',
  'CYBERWARE_INSTALLED',
  'NPC_MET',
  'NPC_UPDATED',
  'NPC_DIED',
  'QUEST_STARTED',
  'QUEST_UPDATED',
  'QUEST_COMPLETED',
  'QUEST_FAILED',
  'RELATIONSHIP_CHANGED',
  'FACTION_CHANGED',
  'REPUTATION_CHANGED',
  'HEAT_CHANGED',
  'WORLD_FLAG_CHANGED',
  'SCENE_CHANGED',
  'TIME_ADVANCED',
  'EFFECT_ADDED',
  'EFFECT_EXPIRED',
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
  'MEMORY_CREATED',
  'NPC_MEMORY_CREATED',
  'ROLL_MADE',
  'CHECK_RESOLVED',
  'ATTACK_RESOLVED',
  'COMBAT_STARTED',
  'COMBAT_ENDED',
  'EVENT_SCHEDULED',
  'EVENT_TRIGGERED',
  'EVENT_CANCELLED',
  'SKILL_IMPROVED',
  'IP_AWARDED',
  'TOOL_REJECTED',
  'SYSTEM',
] as const;

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

/** Evento estruturado: a fonte histórica da campanha. */
export interface GameEvent {
  id: string;
  turnId: string;
  turn: number;
  time: string;
  type: GameEventType;
  source?: string;
  target?: string;
  value?: number | string | boolean;
  data?: Record<string, unknown>;
  summary: string;
}

export type FlagValue = boolean | number | string;

export interface WorldFlag {
  key: string;
  value: FlagValue;
  /** 'hidden' = só o Mestre sabe (o jogador ainda não descobriu). */
  visibility: 'public' | 'hidden';
  setTurn: number;
  reason?: string;
}

export interface ActiveEffect {
  id: string;
  name: string;
  source: string;
  description: string;
  penalties: Partial<Record<StatKey | 'all', number>>;
  /** Hora do jogo (ISO) em que expira; null = até ser removido. */
  expiresAt: string | null;
}

export type ScheduledEventStatus = 'scheduled' | 'triggered' | 'resolved' | 'cancelled';

export type ScheduledEventAction =
  | { kind: 'message'; npcId: string; text: string }
  | { kind: 'set_flag'; key: string; value: FlagValue; visibility: 'public' | 'hidden' }
  | { kind: 'npc_status'; npcId: string; status: NpcStatus }
  | { kind: 'narrative'; text: string };

export interface ScheduledEvent {
  id: string;
  /** Hora do jogo (ISO) em que dispara. */
  at: string;
  description: string;
  status: ScheduledEventStatus;
  action: ScheduledEventAction;
  /** Só dispara se a flag tiver este valor no momento. */
  condition?: { flag: string; equals: FlagValue };
  createdTurn: number;
  resolvedTurn?: number;
}

export type ThreatLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface SceneState {
  id: string;
  description: string;
  presentNpcIds: string[];
  threat: ThreatLevel;
  startedTurn: number;
}

export interface SessionInfo {
  /** Versão do estado: incrementa a cada mudança confirmada (controle de concorrência). */
  version: number;
  branchId: string;
  parentBranchId: string | null;
  branchedFromTurn: number | null;
}

export interface HistorySummary {
  id: string;
  fromTurn: number;
  toTurn: number;
  text: string;
  source: 'llm' | 'engine';
}

// ---------------------------------------------------------------------------
// Rolagens
// ---------------------------------------------------------------------------

export type RollKind = 'check' | 'attack' | 'deathSave' | 'initiative';
export type RollOrigin = 'gm' | 'player';

export interface RollRequest {
  id: string;
  kind: RollKind;
  origin: RollOrigin;
  reason: string;
  stat: StatKey;
  skillId: string | null;
  dv: number;
  modifier: number;
  targetId?: string;
  weaponId?: string;
  aimedHead?: boolean;
  /** NPC alvo de um teste social (a relação com ele modifica o teste). */
  targetNpcId?: string;
  /** Modificadores rotulados calculados pelo motor (relação, cena, flags). */
  modifiers?: Modifier[];
}

/** Registro de uma rolagem física (reproduzível pela seed). */
export interface RollRecord {
  rollId: string;
  dice: string;
  results: number[];
  total: number;
  seed: string;
  timestamp: string;
  purpose: string;
}

export interface D10Roll {
  rolls: number[]; // dado natural + explosão/implosão
  natural: number;
  total: number;
  crit: boolean;
  fumble: boolean;
}

export interface Modifier {
  label: string;
  value: number;
}

export interface CheckResult {
  stat: StatKey;
  statValue: number;
  skillId: string | null;
  skillValue: number;
  d10: D10Roll;
  modifiers: Modifier[];
  luckSpent: number;
  total: number;
  dv: number;
  success: boolean;
  margin: number;
}

export interface DamageRoll {
  notation: string;
  rolls: number[];
  total: number;
  sixes: number;
  critical: boolean;
}

export interface DamageApplication {
  location: HitLocation;
  raw: number;
  spBefore: number;
  spAfter: number;
  throughArmor: number;
  hpDamage: number;
  critBonus: number;
  hpBefore: number;
  hpAfter: number;
  ablated: boolean;
  criticalInjury?: CriticalInjury;
}

export interface AttackResult {
  weaponId: string;
  weaponName: string;
  targetId: string;
  targetName: string;
  hit: boolean;
  failure?: 'no_ammo' | 'out_of_range' | 'in_cover' | 'no_target';
  ammoBefore: number | null;
  ammoAfter: number | null;
  damage?: DamageRoll;
  application?: DamageApplication;
  targetStatusAfter?: CombatantStatus;
}

export interface EnemyAttackResult {
  attackerId: string;
  attackerName: string;
  attackTotal: number;
  defenseTotal: number;
  defenseKind: 'dv' | 'evasion';
  hit: boolean;
  damage?: DamageRoll;
  application?: DamageApplication;
}

export interface RollOutcome {
  request: RollRequest;
  check: CheckResult;
  attack?: AttackResult;
  deathSave?: { roll: number; target: number; success: boolean };
  initiative?: { player: number; enemies: Array<{ id: string; value: number }> };
}

// ---------------------------------------------------------------------------
// Estado raiz
// ---------------------------------------------------------------------------

export interface WorldState {
  /** Data/hora no jogo em ISO (UTC). */
  time: string;
  location: { district: string; subDistrict: string; spot: string };
  weather: string;
  heat: number; // 0..5
  situation: string;
  objective: string;
}

export interface GameState {
  version: typeof STATE_VERSION;
  id: string;
  title: string;
  createdAt: string;
  turn: number;
  session: SessionInfo;
  character: Character;
  world: WorldState;
  scene: SceneState;
  flags: Record<string, WorldFlag>;
  activeEffects: ActiveEffect[];
  scheduled: ScheduledEvent[];
  history: { summaries: HistorySummary[]; summarizedUpToTurn: number };
  npcs: Npc[];
  missions: Mission[];
  factions: Faction[];
  combat: CombatState;
  phone: PhoneThread[];
  chat: ChatEntry[];
  discoveries: Discovery[];
  memories: Memory[];
  events: GameEvent[];
  pendingRoll: RollRequest | null;
  suggestedActions: string[];
}
