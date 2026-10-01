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
  | 'martial_arts'
  | 'melee_light'
  | 'melee_medium'
  | 'melee_heavy'
  | 'melee_vheavy'
  | 'pistol_medium'
  | 'pistol_heavy'
  | 'pistol_vheavy'
  | 'smg'
  | 'heavy_smg'
  | 'shotgun'
  | 'assault_rifle'
  | 'sniper_rifle'
  | 'bow'
  | 'grenade'
  | 'grenade_launcher'
  | 'rocket_launcher';

/** Qualidade da arma (RED): ruim trava num 1 natural; excelente dá +1 para acertar. */
export type WeaponQuality = 'poor' | 'standard' | 'excellent';

/** Granadas (RED p.345–347). */
export type GrenadeKind = 'basic' | 'armor_piercing' | 'flashbang' | 'incendiary' | 'sleep' | 'smoke' | 'teargas' | 'poison' | 'emp';

export type AmmoKind = 'M_PISTOL' | 'H_PISTOL' | 'VH_PISTOL' | 'SLUG' | 'RIFLE' | 'ARROW' | 'GRENADE' | 'ROCKET';

export interface WeaponStats {
  weaponClass: WeaponClass;
  damage: string; // ex.: "2d6"
  magSize: number | null; // null = corpo a corpo
  loaded: number;
  ammo: AmmoKind | null;
  quality?: WeaponQuality;
  /** Arma ruim travou: gaste uma Ação destravando (recarregar destrava). */
  jammed?: boolean;
  /** Não letal (RED): 'stun' = bastão/pistola de choque (apaga em vez de matar); 'rubber' = munição de borracha (deixa com 1 PV, sem crítico nem ablação). */
  nonLethal?: 'stun' | 'rubber';
  /** Granada (arremessada): o tipo. */
  grenade?: GrenadeKind;
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
  /** Munição especial (borracha: não mata, sem crítico nem ablação). */
  ammoVariant?: 'rubber';
  heal?: number; // consumíveis de cura
  /** Droga médica (Medicânico): efeito aplicado pelo motor ao usar. */
  drug?: DrugKey;
  /** Peça de cromo solta (achada, recebida): um ripperdoc instala cobrando só a cirurgia. */
  cyberKey?: string;
  /** Droga de rua (Black Lace, Boost…): efeito + teste de vício. */
  streetDrug?: StreetDrugKey;
  /** Aprimoramento feito por um Técnico (Fabricante). */
  upgrade?: string;
  /** Item "embutido" por um implante (lâmina, arma popup, pele blindada): não se larga nem se desequipa. */
  implant?: string;
}

export type CyberwareCategory =
  | 'Neuralware'
  | 'Ciberóptico'
  | 'Ciberáudio'
  | 'Membro Cibernético'
  | 'Implante Interno'
  | 'Implante Dérmico'
  | 'Borgware'
  | 'Estético';

export interface CyberwareItem {
  id: string;
  name: string;
  category: CyberwareCategory;
  humanityLoss: number;
  description: string;
  /** Chave do catálogo (shared/rules/cyberware.ts). Ausente = implante narrativo/antigo. */
  key?: string;
  /** Fundação onde a opção está instalada (olho, braço, Neural Link…). */
  parentId?: string;
  /** Opção de chip: perícia ajustada pelo Skill Chip. */
  skillId?: string;
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
  /** Remendo de campo feito: penalidades suspensas até o tratamento (a penalidade do Teste de Morte continua). */
  quickFixed?: boolean;
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
  /** Condições (imobilizado, agarrado, inconsciente). Ausente = nenhuma. */
  conditions?: Condition[];
  /** Vícios em drogas de rua (abstinência quando sóbrio). */
  addictions?: StreetDrugKey[];
  /** Habilidade de Papel (Cyberpunk RED): rank 1..10, começa em 4. */
  roleRank: number;
  /** Alocações da habilidade de papel (Solo, Técnico, Medicânico). */
  roleData: RoleData;
  /** Ciberdeck (Trilheiro). */
  deck?: Cyberdeck;
  /** Quickhacks desbloqueados (chaves de shared/rules/quickhacks.ts). */
  quickhacks?: string[];
  /** Briga: id do combatente que o personagem está agarrando. */
  grappling?: string;
  /** Escudo humano: o agarrado recebe os tiros; morto, vira escudo-cadáver com PV = CORPO. */
  humanShield?: { id: string; corpseHp?: number };
}

// ---------------------------------------------------------------------------
// Habilidades de Papel
// ---------------------------------------------------------------------------

export type CombatAwarenessKey = 'deflection' | 'fumbleRecovery' | 'initiative' | 'precision' | 'spotWeakness' | 'threatDetection';
export type MakerKey = 'field' | 'upgrade' | 'fabrication' | 'invention';
export type MedicineKey = 'surgery' | 'pharma' | 'cryo';
export type DrugKey = 'antibiotic' | 'rapidetox' | 'speedheal' | 'stim' | 'surge';
export type StreetDrugKey = 'black_lace' | 'blue_glass' | 'boost' | 'smash' | 'synthcoke';

export interface RoleData {
  combatAwareness?: Partial<Record<CombatAwarenessKey, number>>;
  maker?: Partial<Record<MakerKey, number>>;
  medicine?: Partial<Record<MedicineKey, number>>;
}

// ---------------------------------------------------------------------------
// Netrunning
// ---------------------------------------------------------------------------

export type NetDifficulty = 'basic' | 'standard' | 'uncommon' | 'advanced';
export type IceKey = 'asp' | 'giant' | 'hellhound' | 'kraken' | 'liche' | 'raven' | 'scorpion' | 'skunk' | 'wisp' | 'dragon' | 'killer' | 'sabertooth';
export type ProgramKey =
  | 'sword'
  | 'banhammer'
  | 'deckkrash'
  | 'hellbolt'
  | 'nervescrub'
  | 'poison_flatline'
  | 'superglue'
  | 'vrizzbolt'
  | 'eraser'
  | 'see_ya'
  | 'speedy_gonzalvez'
  | 'worm'
  | 'armor'
  | 'flak'
  | 'shield';

export interface DeckProgram {
  id: string;
  key: ProgramKey;
  rez: number;
  maxRez: number;
  /** Destruído por ICE (some do deck). Derrezado só volta na próxima conexão. */
  destroyed?: boolean;
  /** Booster/defensor ligado nesta conexão. */
  active?: boolean;
  /** Defensores: cada cópia funciona uma vez por conexão. */
  spent?: boolean;
}

export interface Cyberdeck {
  name: string;
  quality: 'poor' | 'standard' | 'excellent';
  slots: number;
  programs: DeckProgram[];
  /** RAM para quickhacks (recupera por rodada; fora de combate, enche). */
  ram?: { current: number; max: number };
}

export type NetNodeKind = 'password' | 'file' | 'control' | 'ice' | 'empty';

export interface NetFloor {
  index: number;
  kind: NetNodeKind;
  dv?: number;
  ice?: IceKey[];
  /** O que é (arquivo/nó de controle), definido pelo narrador ou genérico. */
  label?: string;
  /** Senha aberta, arquivo identificado, nó controlado ou ICE derrotado. */
  cleared: boolean;
  /** Revelado por Pathfinder ou visitado. */
  revealed: boolean;
  downloaded?: boolean;
}

export interface NetArchitecture {
  id: string;
  name: string;
  accessPoint: string;
  difficulty: NetDifficulty;
  dv: number;
  floors: NetFloor[];
  createdTurn: number;
  /** Vírus plantado no último andar (efeito duradouro). */
  virus?: string;
}

export interface IceInstance {
  id: string;
  key: IceKey;
  floor: number;
  rez: number;
  maxRez: number;
  /** Está perseguindo o runner (segue de andar em andar). */
  following: boolean;
  /** Já atingiu o runner (Skunk: a penalidade de Slide vale enquanto ele existir). */
  hitPlayer?: boolean;
}

export interface NetRun {
  architectureId: string;
  /** Índice do andar atual (0 = primeiro). */
  position: number;
  actionsLeft: number;
  /** Turno de Rede (conta as rodadas dentro da arquitetura). */
  netTurn: number;
  /** ICE rezzado encontrado nesta conexão (os derrotados ficam com rez 0). */
  ice: IceInstance[];
  slideUsed: boolean;
  /** Kraken/Superglue: não desce nem sai com segurança até este turno de Rede. */
  lockedUntil?: number;
  skunkPenalty: number;
  /** Wisp/Vrizzbolt: −1 Ação de Rede no próximo turno. */
  actionPenalty: number;
  cloaked: boolean;
  /** Ações deste turno de Rede (o narrador descreve o lote). */
  log: string[];
}

export interface NetState {
  /** Arquitetura acessível no ponto de acesso da cena. */
  architecture: NetArchitecture | null;
  run: NetRun | null;
}

export type ConditionKey = 'restrained' | 'grappled' | 'unconscious' | 'prone';

export interface Condition {
  key: ConditionKey;
  /** Turno em que começou (execução exige indefeso desde um turno ANTERIOR). */
  sinceTurn: number;
  source?: string;
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

/** O que o JOGADOR sabe de um fato, objetivo ou vínculo de NPC (evita diálogos que pressupõem o que ele não sabe). */
export type Awareness = 'no' | 'suspects' | 'yes';

export interface NpcKnowledge {
  id: string;
  fact: string;
  /** Segredo: o NPC esconde isso. Quanto o jogador já descobriu fica em `playerKnows`. */
  secret: boolean;
  /** Ausente = 'no' se for segredo, 'yes' se não for (saves antigos). */
  playerKnows?: Awareness;
  /** Peso do segredo: 1 detalhe, 2 sério, 3 muda tudo. */
  weight?: 1 | 2 | 3;
  revealedTurn?: number;
  /** Como o jogador descobriu (aparece no Diário). */
  revealedHow?: string;
}

/** Personalidade: o que faz o NPC soar como ele mesmo. */
export interface NpcProfile {
  traits: string[];
  /** Jeito de falar: registro, gíria, manias. */
  voice?: string;
  /** O que move a pessoa. */
  motivation?: string;
  fear?: string;
  /** O que ela não faz de jeito nenhum. */
  lines?: string;
}

export type NpcGoalStatus = 'active' | 'done' | 'dropped';

/** Objetivo de longo prazo (o `currentGoal` é o imediato). */
export interface NpcGoal {
  id: string;
  text: string;
  status: NpcGoalStatus;
  playerKnows: Awareness;
}

export type NpcBondKind = 'aliado' | 'rival' | 'deve_a' | 'cobra' | 'familia' | 'amante' | 'chefe' | 'subordinado' | 'ex';

/** Ligação com outro NPC ou facção. */
export interface NpcBond {
  id: string;
  /** Id de NPC ou de facção. */
  targetId: string;
  kind: NpcBondKind;
  note?: string;
  playerKnows: Awareness;
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
  /** 'animal' = bicho de estimação etc.: não fala, não usa o Agent. Ausente = pessoa. */
  kind?: 'person' | 'animal';
  conditions?: Condition[];
  /** É ripperdoc: nível da clínica (1–5) e se mexe com hardware militar do mercado negro. */
  ripperdoc?: { tier: 1 | 2 | 3 | 4 | 5; blackMarket?: boolean };
  profile?: NpcProfile;
  goals?: NpcGoal[];
  bonds?: NpcBond[];
  /** O jogador sabe o objetivo imediato (currentGoal)? Ausente = não. */
  currentGoalKnown?: boolean;
  /** Importância na história (só sobe). Ausente = figurante. */
  importance?: NpcImportance;
  /** Em quantos turnos diferentes o NPC interagiu com o jogador (falou, trocou mensagem). */
  interactions?: number;
  lastSeenTurn?: number;
  /** Último turno em que o perfil foi pedido ao Mestre (evita repetir quando falha). */
  profileTriedTurn?: number;
  /** O que o NPC sabe do JOGADOR (dívida, passado, segredos). Fora disto, só o que viu acontecer. */
  knowsAboutPlayer?: string[];
  /** Existe no mundo (frente), mas o jogador ainda não o conheceu: fora do Diário até interagir. */
  offstage?: boolean;
  /** Ficha de combate (membros da equipe): persiste entre lutas. */
  combat?: NpcCombatBlock;
}

/** figurante (só falou numa cena) → recorrente (voltou, é contato) → central (contratante, laço, muita história). */
export type NpcImportance = 'extra' | 'recurring' | 'core';

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
  weapon: { name: string; weaponClass: WeaponClass; damage: string; quality?: WeaponQuality };
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
  /** O jogador deixou a cena; este corpo não pode mais ser revistado. */
  lootUnavailable?: boolean;
  conditions?: Condition[];
  /** Ficha pronta usada (shared/rules/npcTemplates.ts). */
  template?: string;
  /** CORPO (dano de estrangular/arremessar) e base de Briga (DEX + Briga, para agarrões). */
  body?: number;
  brawlingBase?: number;
  /** Rodadas seguidas sendo estrangulado (3 = apaga). */
  chokeRounds?: number;
  /** Perde o próximo ataque (arma travada, suprimido, ofuscado, emboscado) — o motivo vai no texto. */
  skipNextAttack?: string;
  /** COOL e VONTADE da ficha (Encarada, supressão, testes contra granadas). */
  cool?: number;
  will?: number;
  /** Resultado da Encarada com o jogador (−2 nas ações contra o vencedor). */
  facedown?: 'player' | 'npc';
  /** PV da cobertura total atrás da qual está (atirar nela a destrói). */
  coverHp?: number;
  /** Efeitos de quickhack ativos (até a rodada indicada). */
  hacks?: CombatantHack[];
  /** De que lado luta (ausente = inimigo). */
  side?: 'ally' | 'enemy';
  /** Aliado da equipe: o NPC por trás (PV e ferimentos persistem depois da luta). */
  npcId?: string;
  /** Postura do aliado (decidida por ele; o jogador só pede). */
  stance?: AllyStance;
  /** Alvo que o aliado aceitou focar. */
  focusId?: string;
}

/** aggressive: ataca o inimigo mais ferido · focus: um alvo · protect: quem ameaça o jogador · hold: segura posição na cobertura · retreat: sai da luta. */
export type AllyStance = 'aggressive' | 'focus' | 'protect' | 'hold' | 'retreat';

/** Ficha de combate que um aliado leva de uma luta para outra. */
export interface NpcCombatBlock {
  template?: string;
  hp: { current: number; max: number };
  sp: { head: number; body: number };
  weapon: Combatant['weapon'];
  attackBase: number;
  evasionBase: number;
  ref: number;
  body?: number;
  brawlingBase?: number;
  cool?: number;
  will?: number;
}

export interface PartyMember {
  npcId: string;
  /** Parte de cada pagamento de trabalho (%), descontada pelo motor ao concluir a missão. */
  share: number;
  /** 0–100: sobe com pagamento em dia e decisões alinhadas; cai com calote e traição. */
  loyalty: number;
  since: number;
  stance: AllyStance;
  /** Alvo combinado (postura focus): fica aqui para valer mesmo antes de o aliado entrar na luta. */
  focusId?: string;
}

export interface CombatantHack {
  key: string;
  label: string;
  /** Último round em que vale. */
  untilRound: number;
  /** Bônus para o JOGADOR acertar este alvo. */
  hitBonus?: number;
  /** Modificador nos ataques DESTE combatente. */
  attackMod?: number;
  /** Dano por rodada (ignora armadura). */
  dot?: string;
}

export interface CombatState {
  active: boolean;
  round: number;
  playerInitiative: number | null;
  combatants: Combatant[];
  log: string[];
  /** Rodada em que o Solo já usou Desvio de Dano / Ponto Fraco. */
  roleUsage?: { deflectionRound?: number; spotWeaknessRound?: number };
  /** Sistema operacional ativo (Sandevistan/Berserk): chave do cromo e rodadas. */
  os?: { key: string; startRound: number; rounds: number };
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

export type ChatKind = 'narration' | 'player' | 'roll' | 'system' | 'discovery' | 'combat' | 'net';

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
  'PLAYER_DIED',
  'CONDITION_CHANGED',
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
  'CYBERPSYCHOSIS',
  'ROLE_IMPROVED',
  'NET_ACTION',
  'NET_JACK_IN',
  'NET_JACK_OUT',
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

// ---------------------------------------------------------------------------
// Frentes do mundo (tramas que andam sozinhas) e notícias
// ---------------------------------------------------------------------------

export type NewsSource = '54 News' | 'NCNet' | 'Rumor';

export interface NewsItem {
  id: string;
  turn: number;
  /** Hora do jogo (ISO). */
  at: string;
  source: NewsSource;
  headline: string;
  body: string;
  frontId?: string;
  read?: boolean;
}

/** Efeito de um estágio de frente, já com os textos preenchidos. */
export type FrontEffect =
  | { kind: 'news'; source: NewsSource; headline: string; body: string }
  | { kind: 'message'; npcId: string; text: string }
  | { kind: 'npc_status'; npcId: string; status: NpcStatus }
  | { kind: 'faction'; factionId: string; delta: number }
  | { kind: 'flag'; key: string; value: FlagValue; visibility: 'public' | 'hidden' }
  | { kind: 'scene_hook'; text: string };

export interface FrontStage {
  title: string;
  /** Horas de jogo depois do estágio anterior (ou do início). */
  hours: number;
  effects: FrontEffect[];
  /** O que o jogador pode fazer para segurar este estágio (guia do Mestre). */
  blockHint: string;
}

export type FrontStatus = 'active' | 'resolved' | 'averted';

/** Trama montada por mistura de átomos (shared/rules/storyAtoms.ts): quem, onde, por quê, quem sofre e a reviravolta. */
export interface Front {
  id: string;
  title: string;
  /** Premissa preenchida ("Os Valentinos recrutam mercenários num cassino de Japantown"). */
  premise: string;
  who: string;
  factionId?: string;
  place: string;
  motive: string;
  victim: string;
  /** Reviravolta escondida: só o Mestre sabe até ser revelada. */
  twist: string;
  arc: string;
  seedNpcId?: string;
  victimNpcId?: string;
  /** Estágios já disparados (0 = nenhum). */
  stage: number;
  stages: FrontStage[];
  status: FrontStatus;
  /** Quanto o jogador sabe da trama por trás das notícias. */
  playerAware: Awareness;
  /** Hora do jogo (ISO) do próximo estágio. */
  nextAt: string;
  /** Átomos usados (evita repetir entre frentes e depura a mistura). */
  atoms: Record<string, string>;
  /** Hora do jogo em que a trama entrou no mundo e em que acabou (resolvida ou detida). */
  createdAt?: string;
  endedAt?: string;
  /** Continuação de outra frente (mesmo grupo por trás, mesmo rosto se vivo). */
  parentId?: string;
  /** Textos já reescritos pelo Mestre (fluência, concordância e ganchos com a ficha). */
  polished?: boolean;
  /** Turno da última tentativa de reescrita (evita repetir quando falha). */
  polishTriedTurn?: number;
}

export type ThreatLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface SceneState {
  id: string;
  description: string;
  presentNpcIds: string[];
  threat: ThreatLevel;
  startedTurn: number;
  /** Ameaça letal ANUNCIADA (bomba, Soulkiller, desabamento): sem rolagem que salve se o jogador não escapar. */
  lethalThreat?: { description: string; sinceTurn: number };
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

export type RollKind = 'check' | 'attack' | 'deathSave' | 'initiative' | 'quickhack';
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
  /** Ataque: tiro normal, rajada (10 tiros, 2d6 × margem) ou fogo de supressão. */
  mode?: 'single' | 'autofire' | 'suppressive';
  /** Cadência 2: dois ataques na mesma Ação. */
  rof2?: boolean;
  /** Primeiro golpe de uma emboscada: o alvo não esquiva e os inimigos perdem a próxima ação. */
  ambush?: boolean;
  /** Modificadores rotulados calculados pelo motor (relação, cena, flags). */
  modifiers?: Modifier[];
  /** Rolagem de quickhack: qual (o alvo vem em targetId/targetNpcId). */
  quickhack?: string;
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
  failure?: 'no_ammo' | 'out_of_range' | 'in_cover' | 'no_target' | 'jammed';
  ammoBefore: number | null;
  ammoAfter: number | null;
  damage?: DamageRoll;
  application?: DamageApplication;
  targetStatusAfter?: CombatantStatus;
  /** Dano extra do Ponto Fraco (Solo). */
  spotWeakness?: number;
  /** Usou a Ação de Movimento para colar no alvo antes do golpe. */
  closedIn?: boolean;
  /** Arma ruim travou neste ataque (1 natural). */
  jammedNow?: boolean;
  /** Rajada: multiplicador aplicado (margem, até o máximo da arma). */
  autofireMult?: number;
  /** Munição gasta (rajada/supressão = 10). */
  ammoUsed?: number;
  /** Granada arremessada: o item é consumido. */
  thrown?: boolean;
  grenade?: GrenadeKind;
  /** Explosivo: todos os atingidos na área (inclui o alvo principal). */
  areaHits?: AreaHit[];
  /** Fogo de supressão: quem segurou os nervos e quem mergulhou na cobertura. */
  suppression?: Array<{ id: string; name: string; held: boolean }>;
  /** Não letal: o alvo foi nocauteado (vivo) em vez de cair morrendo. */
  knockedOut?: boolean;
  nonLethal?: 'stun' | 'rubber';
  /** Emboscada: o alvo não pôde esquivar e os inimigos perdem a próxima ação. */
  ambush?: boolean;
  /** Tiro na cobertura: PV que ela perdeu (0 = destruída). */
  coverDamage?: { before: number; after: number };
}

export interface AreaHit {
  targetId: string;
  name: string;
  dodged: boolean;
  application?: DamageApplication;
  statusAfter?: CombatantStatus;
  /** Efeito especial da granada (ofuscado, dormiu, envenenado…). */
  effect?: string;
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
  /** Dano evitado pelo Desvio de Dano (Solo). */
  deflected?: number;
  /** Dano absorvido por cromo (Berserk, Editor de Dor Mk.2). */
  reduced?: number;
  /** O inimigo não atacou (arma travada, suprimido, ofuscado, emboscado). */
  skipped?: string;
  /** Arma ruim do inimigo travou neste ataque. */
  jammed?: boolean;
  /** O tiro acertou o escudo humano em vez do jogador. */
  shield?: { id: string; name: string; hpDamage: number; corpse: boolean; destroyed: boolean };
}

export interface RollOutcome {
  request: RollRequest;
  check: CheckResult;
  attack?: AttackResult;
  deathSave?: { roll: number; target: number; success: boolean };
  initiative?: { player: number; enemies: Array<{ id: string; value: number }> };
  /** Cadência 2: o segundo ataque da mesma Ação. */
  followUp?: RollOutcome;
  /**
   * Quickhack: o desfecho e os dados do EFEITO (dano etc.), gravados para o reducer repetir o
   * mesmo resultado sobre o estado (o teste de Interface já está em check.d10).
   */
  quickhack?: { key: string; ok: boolean; summary: string; effectRolls: number[] };
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
  net: NetState;
  phone: PhoneThread[];
  chat: ChatEntry[];
  discoveries: Discovery[];
  memories: Memory[];
  events: GameEvent[];
  pendingRoll: RollRequest | null;
  suggestedActions: string[];
  /** Modo Sandbox (debug): estado manipulável pelo painel, sem limitadores de roleplay. */
  sandbox?: boolean;
  /** Tramas do mundo desta run (ausente em saves antigos até o carregamento gerar). */
  fronts?: Front[];
  /** Feed NCNet do Agent: manchetes e rumores. */
  news?: NewsItem[];
  /** Equipe: NPCs que lutam ao lado do jogador. */
  party?: { members: PartyMember[] };
}
