/**
 * Normalização estrutural da saída do LLM. Os ARGUMENTOS das ferramentas são validados
 * pelo motor (shared/engine/tools) no momento da execução — aqui só filtramos formato e origem.
 */
import type { Dialogue, Discovery } from '../../shared/types/game';
import type { InterpretResponse, NarrateResponse, PhoneResponse } from '../../shared/types/gm';
import type { IntentType, ToolCall, ToolOrigin } from '../../shared/types/turn';
import { REGISTRY } from '../../shared/engine/tools';
import { weaveDialogues } from '../../shared/engine/narration';

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const INTENTS: IntentType[] = ['attack', 'skill', 'social', 'move', 'trade', 'use_item', 'observe', 'dialogue', 'rest', 'netrun', 'other'];

/** Mantém só ferramentas existentes e permitidas para a origem; aceita {tool,args} ou {type,payload}. */
export function normalizeToolCalls(raw: unknown, origin: ToolOrigin, max: number): ToolCall[] {
  return arr(raw)
    .map(c => {
      const o = obj(c);
      return { tool: text(o.tool ?? o.type ?? o.name, 40), args: obj(o.args ?? o.payload ?? o.arguments) };
    })
    .filter(c => REGISTRY.get(c.tool)?.origins.includes(origin))
    .slice(0, max);
}

function normalizeDialogues(raw: unknown): Dialogue[] {
  return arr(raw)
    .map(d => ({ speaker: text(obj(d).speaker, 60), text: text(obj(d).text, 800) }))
    .filter(d => d.speaker && d.text)
    .slice(0, 8);
}

function normalizeStrings(raw: unknown, max: number, len: number): string[] {
  return arr(raw)
    .map(s => text(s, len))
    .filter(Boolean)
    .slice(0, max);
}

export function normalizeInterpret(raw: Record<string, unknown>): InterpretResponse {
  const i = obj(raw.intent);
  const type = INTENTS.includes(i.type as IntentType) ? (i.type as IntentType) : 'other';
  return {
    intent: { type, summary: text(i.summary, 200) || 'ação livre', targetId: text(i.targetId, 80) || undefined, confidence: Math.max(0, Math.min(1, Number(i.confidence) || 0.7)) },
    framing: text(raw.framing, 500) || undefined,
    clarification: text(raw.clarification, 300) || undefined,
    toolCalls: normalizeToolCalls(raw.toolCalls, 'interpreter', 6),
  };
}

export function normalizeNarrate(raw: Record<string, unknown>): NarrateResponse {
  const dialogues = normalizeDialogues(raw.dialogues);
  const discoveries: Discovery[] = arr(raw.discoveries)
    .map(d => ({ title: text(obj(d).title, 80), description: text(obj(d).description, 400), category: text(obj(d).category, 30) || undefined }))
    .filter(d => d.title && d.description)
    .slice(0, 3);
  return {
    narration: weaveDialogues(text(raw.narration, 8000) || 'A cidade respira fundo ao seu redor.', dialogues),
    dialogues,
    toolCalls: normalizeToolCalls(raw.toolCalls, 'narrator', 20),
    discoveries,
    suggestedActions: normalizeStrings(raw.suggestedActions, 4, 140),
    enemyActions: arr(raw.enemyActions)
      .map(a => ({ attackerId: text(obj(a).attackerId, 60) }))
      .filter(a => a.attackerId)
      .slice(0, 6),
  };
}

export function normalizePhone(raw: Record<string, unknown>): PhoneResponse {
  return {
    replyText: text(raw.replyText, 1200) || 'Na escuta, choom. Te dou um retorno.',
    suggestedReplies: normalizeStrings(raw.suggestedReplies, 3, 120),
    toolCalls: normalizeToolCalls(raw.toolCalls, 'phone', 8),
  };
}
