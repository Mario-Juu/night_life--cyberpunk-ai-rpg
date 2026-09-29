import type { ToolCall, ToolOrigin } from '../../types/turn';
import { ACTION_TOOLS } from './actions';
import { MUTATION_TOOLS } from './mutations';
import { QUERY_TOOLS } from './queries';
import { argsSchema, createRegistry, type ParamSpec, type ToolDef } from './registry';

export * from './registry';
export { findNpc } from './helpers';

export const REGISTRY = createRegistry([...QUERY_TOOLS, ...ACTION_TOOLS, ...MUTATION_TOOLS]);

/**
 * Validação prévia (sem executar): devolve os erros de formato das chamadas.
 * Usada para pedir ao LLM que corrija a chamada antes que a ação do jogador se perca.
 */
export function validateToolCalls(calls: ToolCall[], origin: ToolOrigin): string[] {
  const errors: string[] = [];
  for (const call of calls) {
    const def = REGISTRY.get(call.tool);
    if (!def) {
      errors.push(`${call.tool}: ferramenta desconhecida`);
      continue;
    }
    if (!def.origins.includes(origin)) {
      errors.push(`${call.tool}: não permitida aqui`);
      continue;
    }
    const clean = Object.fromEntries(Object.entries(call.args ?? {}).filter(([, v]) => v !== null && v !== ''));
    const parsed = argsSchema(def).safeParse(clean);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const allowed = Object.keys(def.params).join(', ');
      errors.push(`${call.tool}: argumento "${issue?.path.join('.')}" inválido (${issue?.message}). Parâmetros aceitos: ${allowed}.`);
    }
  }
  return errors;
}

export function toolsFor(origin: ToolOrigin): ToolDef[] {
  return REGISTRY.all().filter(t => t.origins.includes(origin));
}

/** Documentação compacta para o prompt (nome, descrição e parâmetros). */
export function toolDocs(origin: ToolOrigin): string {
  return toolsFor(origin)
    .map(t => {
      const params = Object.entries(t.params)
        .map(([k, p]) => {
          const range = p.type === 'number' ? ` ${p.min}..${p.max}` : p.type === 'string' && p.enum ? ` ${p.enum.join('|')}` : '';
          return `${k}${p.required ? '*' : ''}: ${p.type}${range} — ${p.desc}`;
        })
        .join('; ');
      return `- ${t.name}(${params || ''}): ${t.description}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// JSON Schema (provedor-agnóstico) para o array de tool calls
// ---------------------------------------------------------------------------

const COMBATANT_JSON = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    hp: { type: 'number' },
    sp: { type: 'number' },
    headSp: { type: 'number' },
    weaponName: { type: 'string' },
    weaponClass: { type: 'string', enum: ['unarmed', 'melee_light', 'melee_medium', 'melee_heavy', 'pistol_medium', 'pistol_heavy', 'pistol_vheavy', 'smg', 'shotgun', 'assault_rifle', 'sniper_rifle', 'bow'] },
    damage: { type: 'string' },
    attackBase: { type: 'number' },
    evasionBase: { type: 'number' },
    ref: { type: 'number' },
    distance: { type: 'string', enum: ['melee', '0-6m', '7-12m', '13-25m', '26-50m', '51-100m'] },
    cover: { type: 'string', enum: ['none', 'partial', 'full'] },
  },
  required: ['name'],
};

function paramJson(p: ParamSpec): object {
  switch (p.type) {
    case 'string':
      return { type: 'string', description: p.desc };
    case 'number':
      return { type: 'number', description: p.desc };
    case 'boolean':
      return { type: 'boolean', description: p.desc };
    case 'combatants':
      return { type: 'array', items: COMBATANT_JSON, description: p.desc };
  }
}

/**
 * Schema do array de chamadas. `args` é um objeto plano com a união dos parâmetros
 * das ferramentas permitidas (a validação real, por ferramenta, é do motor).
 */
export function toolCallsJsonSchema(origin: ToolOrigin): object {
  const tools = toolsFor(origin);
  const props: Record<string, object> = {};
  for (const t of tools) for (const [k, p] of Object.entries(t.params)) props[k] ??= paramJson(p);
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: tools.map(t => t.name) },
        args: { type: 'object', properties: props },
      },
      required: ['tool', 'args'],
    },
  };
}
