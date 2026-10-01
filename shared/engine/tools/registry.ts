/**
 * Registro de ferramentas do Mestre.
 * Cada ferramenta declara parâmetros UMA vez; daí saem validação (zod),
 * JSON Schema para o LLM e documentação do prompt.
 * Ferramentas que alteram o mundo SEMPRE passam por aqui — o LLM só pede.
 */
import { z } from 'zod';
import type { GameState, RollRequest } from '../../types/game';
import type { ToolCall, ToolCallRecord, ToolOrigin } from '../../types/turn';
import type { Rng } from '../dice';
import { emit } from '../events';
import { NPC_TEMPLATES } from '../../rules/npcTemplates';

export type ToolKind = 'query' | 'action' | 'mutation';

export type ParamSpec =
  | { type: 'string'; desc: string; required?: boolean; max?: number; enum?: readonly string[] }
  | { type: 'number'; desc: string; required?: boolean; min: number; max: number; int?: boolean }
  | { type: 'boolean'; desc: string; required?: boolean }
  | { type: 'combatants'; desc: string; required?: boolean };

export interface CombatantArg {
  id?: string;
  name: string;
  /** Ficha pronta (a ficha manda: só nome, distância e cobertura podem mudar). */
  template?: string;
  /** Quantos iguais (grupo numerado). */
  count?: number;
  hp?: number;
  sp?: number;
  headSp?: number;
  weaponName?: string;
  weaponClass?: string;
  damage?: string;
  attackBase?: number;
  evasionBase?: number;
  ref?: number;
  distance?: string;
  cover?: string;
  /** ally = luta do lado do jogador (gangue que ajuda, segurança contratada). */
  side?: 'ally' | 'enemy';
}

type ArgOf<S> = S extends { type: 'string' } ? string : S extends { type: 'number' } ? number : S extends { type: 'boolean' } ? boolean : CombatantArg[];
type RequiredKeys<P> = { [K in keyof P]: P[K] extends { required: true } ? K : never }[keyof P];
export type ArgsOf<P extends Record<string, ParamSpec>> = { [K in RequiredKeys<P>]: ArgOf<P[K]> } & { [K in Exclude<keyof P, RequiredKeys<P>>]?: ArgOf<P[K]> };

export interface ToolContext {
  rng: Rng;
  origin: ToolOrigin;
}

export interface ToolOutcome {
  state: GameState;
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
  /** Ações que precisam de rolagem devolvem o pedido; o executor o registra como pendingRoll. */
  pendingRoll?: RollRequest;
}

export interface ToolDef<P extends Record<string, ParamSpec> = Record<string, ParamSpec>> {
  name: string;
  kind: ToolKind;
  description: string;
  origins: readonly ToolOrigin[];
  params: P;
  run: (state: GameState, args: ArgsOf<P>, ctx: ToolContext) => ToolOutcome;
}

export function defineTool<const P extends Record<string, ParamSpec>>(def: ToolDef<P>): ToolDef<Record<string, ParamSpec>> {
  return def as unknown as ToolDef<Record<string, ParamSpec>>;
}

export const ok = (state: GameState, summary: string, data?: unknown): ToolOutcome => ({ state, ok: true, summary, data });
export const fail = (state: GameState, error: string): ToolOutcome => ({ state, ok: false, summary: error, error });

// ---------------------------------------------------------------------------
// Validação gerada a partir dos ParamSpec
// ---------------------------------------------------------------------------

/**
 * Formatos que modelos menores mandam para `combatants`: um objeto só, ou {ficha: quantidade}
 * (ex.: {"maelstrom_ganger": 3}) — tudo vira a lista padrão.
 */
function normalizeCombatants(v: unknown): unknown {
  // Lista com ficha pronta mas sem nome ({template, count}): o nome vem da ficha.
  if (Array.isArray(v)) return v.map(c => (c && typeof c === 'object' && !(c as { name?: unknown }).name && NPC_TEMPLATES[(c as { template?: string }).template ?? ''] ? { ...c, name: NPC_TEMPLATES[(c as { template: string }).template].name } : c));
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (typeof o.name === 'string') return [o];
  const byTemplate = Object.entries(o).filter(([k]) => NPC_TEMPLATES[k]);
  if (byTemplate.length) return byTemplate.map(([k, n]) => ({ name: NPC_TEMPLATES[k].name, template: k, count: Number(n) || 1 }));
  if (typeof o.template === 'string' && NPC_TEMPLATES[o.template]) return [{ ...o, name: NPC_TEMPLATES[o.template].name }];
  return [o];
}

/** Número de ficha: fora da faixa é LIMITADO (não derruba a chamada inteira, que perderia a luta). */
const stat = (min: number, max: number) =>
  z.coerce
    .number()
    .refine(Number.isFinite)
    .transform(n => Math.min(max, Math.max(min, Math.round(n))));

const combatantZod = z.object({
  id: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(60),
  template: z.string().trim().max(40).optional(),
  count: stat(1, 6).optional(),
  hp: stat(1, 80).optional(),
  sp: stat(0, 18).optional(),
  headSp: stat(0, 18).optional(),
  weaponName: z.string().trim().max(60).optional(),
  weaponClass: z.string().trim().max(30).optional(),
  damage: z.string().trim().max(10).optional(),
  attackBase: stat(4, 22).optional(),
  evasionBase: stat(2, 20).optional(),
  ref: stat(2, 10).optional(),
  distance: z.string().trim().max(10).optional(),
  cover: z.string().trim().max(10).optional(),
  side: z.enum(['ally', 'enemy']).optional(),
});

function paramZod(spec: ParamSpec): z.ZodType {
  let schema: z.ZodType;
  switch (spec.type) {
    case 'string':
      schema = spec.enum
        ? z.enum(spec.enum as [string, ...string[]])
        : z
            .string()
            .trim()
            .min(1)
            .transform(v => v.slice(0, spec.max ?? 400));
      break;
    case 'number':
      schema = z.coerce
        .number()
        .refine(Number.isFinite, 'número inválido')
        .transform(n => {
          const clamped = Math.min(spec.max, Math.max(spec.min, n));
          return spec.int === false ? clamped : Math.round(clamped);
        });
      break;
    case 'boolean':
      schema = z.union([z.boolean(), z.enum(['true', 'false']).transform(v => v === 'true')]);
      break;
    case 'combatants':
      // Modelos menores às vezes mandam um objeto só em vez da lista.
      schema = z.preprocess(normalizeCombatants, z.array(combatantZod).min(1).max(8));
      break;
  }
  return spec.required ? schema : schema.optional();
}

const zodCache = new WeakMap<ToolDef, z.ZodType>();
export function argsSchema(def: ToolDef): z.ZodType {
  let s = zodCache.get(def);
  if (!s) {
    s = z.object(Object.fromEntries(Object.entries(def.params).map(([k, spec]) => [k, paramZod(spec)])));
    zodCache.set(def, s);
  }
  return s;
}

/**
 * Nomes que o LLM confunde (o schema de args é a união de todas as ferramentas): se a ferramenta
 * espera `targetId` e veio `targetNpcId`, o alvo não pode se perder.
 */
const ALIASES: Record<string, string[]> = {
  targetId: ['targetNpcId', 'target', 'targetName', 'npcId', 'id'],
  npcId: ['targetNpcId', 'targetId', 'target'],
  target: ['targetId', 'targetNpcId', 'npcId'],
  itemId: ['weaponId', 'item'],
};

/** Remove null/"" (o LLM costuma mandá-los para campos ausentes) e resolve apelidos de parâmetros. */
export function cleanArgs(raw: unknown, def?: ToolDef): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const args = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => v !== null && v !== ''));
  if (def) {
    for (const [key, alts] of Object.entries(ALIASES)) {
      if (!(key in def.params) || args[key] !== undefined) continue;
      const alt = alts.find(a => !(a in def.params) && typeof args[a] === 'string');
      if (alt) args[key] = args[alt];
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export interface ToolRegistry {
  get(name: string): ToolDef | undefined;
  all(): ToolDef[];
}

export function createRegistry(defs: ToolDef[]): ToolRegistry {
  const map = new Map(defs.map(d => [d.name, d]));
  return { get: n => map.get(n), all: () => defs };
}

export interface ExecuteResult {
  state: GameState;
  record: ToolCallRecord;
  pendingRoll?: RollRequest;
}

/** Executa UMA chamada: valida nome, origem e argumentos; nunca lança. */
export function executeTool(registry: ToolRegistry, state: GameState, call: ToolCall, ctx: ToolContext): ExecuteResult {
  const def = registry.get(call.tool);
  const reject = (error: string): ExecuteResult => ({
    state: emit(state, 'TOOL_REJECTED', `${call.tool}: ${error}`, { source: ctx.origin, target: call.tool, data: { args: call.args } }),
    record: { ...call, origin: ctx.origin, ok: false, summary: error, error },
  });
  if (!def) return reject('ferramenta desconhecida');
  if (!def.origins.includes(ctx.origin)) return reject(`não permitida para ${ctx.origin}`);

  const parsed = argsSchema(def).safeParse(cleanArgs(call.args, def));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return reject(`argumento inválido: ${issue?.path.join('.') || '?'} — ${issue?.message}`);
  }
  const args = parsed.data as Record<string, unknown>;
  try {
    const out = def.run(state, args as never, ctx);
    const base = out.ok ? out.state : emit(out.state, 'TOOL_REJECTED', `${call.tool}: ${out.error}`, { source: ctx.origin, target: call.tool });
    return {
      state: base,
      record: { tool: call.tool, args, origin: ctx.origin, ok: out.ok, summary: out.summary, data: out.data, error: out.error },
      pendingRoll: out.pendingRoll,
    };
  } catch (err) {
    return reject(`erro interno: ${(err as Error).message}`);
  }
}

export interface RunResult {
  state: GameState;
  records: ToolCallRecord[];
  pendingRoll: RollRequest | null;
}

/** Executa várias chamadas em ordem. Só uma rolagem por turno. */
export function runToolCalls(registry: ToolRegistry, state: GameState, calls: ToolCall[], ctx: ToolContext, maxCalls = 16): RunResult {
  let s = state;
  const records: ToolCallRecord[] = [];
  let pendingRoll: RollRequest | null = s.pendingRoll;
  let spentAction = false;
  for (const call of calls.slice(0, maxCalls)) {
    const def = registry.get(call.tool);
    if (def?.kind === 'action' && pendingRoll && needsRoll(call.tool)) {
      records.push({ ...call, origin: ctx.origin, ok: false, summary: 'Já existe uma rolagem pendente neste turno.', error: 'rolagem pendente' });
      continue;
    }
    // Em combate, a segunda Ação do mesmo turno é recusada (fica para o turno seguinte).
    if (s.combat.active && spentAction && isTurnAction(call.tool)) {
      records.push({ ...call, origin: ctx.origin, ok: false, summary: 'Você já agiu neste turno — é uma Ação por turno em combate.', error: 'ação já usada' });
      continue;
    }
    const res = executeTool(registry, s, call, ctx);
    s = res.state;
    if (res.record.ok && isTurnAction(call.tool)) spentAction = true;
    records.push(res.record);
    if (res.pendingRoll && !pendingRoll) {
      pendingRoll = res.pendingRoll;
      s = { ...s, pendingRoll };
    }
  }
  return { state: s, records, pendingRoll };
}

const ROLL_TOOLS = new Set(['attack', 'skill_check', 'persuade', 'intimidate', 'hack', 'quickhack']);
export function needsRoll(tool: string): boolean {
  return ROLL_TOOLS.has(tool);
}

/**
 * Ações que gastam a Ação do turno em combate: só UMA por turno. Sem isto, uma frase do jogador
 * ("hackeio, atiro e agarro") rendia três ações contra uma única resposta dos inimigos.
 */
const TURN_ACTIONS = new Set(['quickhack', 'grapple', 'execute', 'reload']);
export const isTurnAction = (tool: string) => ROLL_TOOLS.has(tool) || TURN_ACTIONS.has(tool);
