import { z } from 'zod';

const hp = z.object({ current: z.number(), max: z.number() });

const CharacterSchema = z.looseObject({
  bio: z.looseObject({ name: z.string(), handle: z.string(), role: z.string() }),
  stats: z.record(z.string(), z.number()),
  skills: z.record(z.string(), z.number()),
  hp,
  humanity: hp,
  luck: hp,
  money: z.number(),
  inventory: z.array(z.looseObject({ id: z.string(), name: z.string(), quantity: z.number() })),
  cyberware: z.array(z.any()),
  criticalInjuries: z.array(z.any()),
});

export const ContextSchema = z.looseObject({
  sessionId: z.string(),
  branchId: z.string(),
  turnId: z.string(),
  turn: z.number(),
  character: CharacterSchema,
  world: z.looseObject({
    time: z.string(),
    location: z.looseObject({ district: z.string(), subDistrict: z.string(), spot: z.string() }),
  }),
  scene: z.looseObject({ presentNpcIds: z.array(z.string()), effectiveThreat: z.string() }),
  npcs: z.array(z.looseObject({ id: z.string(), name: z.string(), knowledge: z.array(z.any()) })).max(40),
  quests: z.array(z.looseObject({ id: z.string(), title: z.string() })).max(40),
  factions: z.array(z.any()).max(50),
  flags: z.array(z.looseObject({ key: z.string(), visibility: z.string() })).max(300),
  activeEffects: z.array(z.any()).max(30),
  combat: z.looseObject({ active: z.boolean(), combatants: z.array(z.looseObject({ id: z.string(), name: z.string() })).max(16) }),
  memories: z.array(z.looseObject({ id: z.string(), subject: z.string(), content: z.string() })).max(40),
  summaries: z.array(z.any()).max(20),
  recentHistory: z.array(z.object({ turn: z.number(), kind: z.string(), text: z.string().max(4000) })).max(30),
  phone: z.array(z.any()).max(50),
  playerKnowledge: z.array(z.string()).max(40),
  upcoming: z.array(z.any()).max(30),
  offscreen: z.array(z.string()).max(20),
});

// Clientes antigos ainda podem mandar 'pro': vira 'flash' (o pro não existe mais na plataforma).
const model = z.enum(['pro', 'flash']).optional().transform(() => 'flash' as const);

export const InterpretBody = z.object({ context: ContextSchema, text: z.string().trim().min(1).max(1500), model, feedback: z.string().max(3000).optional() });

export const NarrateBody = z.object({
  context: ContextSchema,
  kind: z.enum(['action', 'prologue']),
  playerInput: z.string().max(1500).optional(),
  engineResult: z.looseObject({ tools: z.array(z.any()), offscreen: z.array(z.string()) }).nullable(),
  model,
});

export const PhoneBody = z.object({
  context: ContextSchema,
  model,
  npcId: z.string().min(1).max(80),
  message: z.string().trim().min(1).max(800),
});

export const SummarizeBody = z.object({
  sessionId: z.string(),
  turnId: z.string(),
  fromTurn: z.number(),
  toTurn: z.number(),
  transcript: z.string().min(1).max(60_000),
  model,
});
