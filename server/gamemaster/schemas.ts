/**
 * Schemas de saída (JSON Schema padrão, independente de provedor).
 * O array de ferramentas é gerado do registro do motor — uma única fonte.
 */
import { toolCallsJsonSchema } from '../../shared/engine/tools';

const S = { type: 'string' };
const N = { type: 'number' };

const DIALOGUES = { type: 'array', items: { type: 'object', properties: { speaker: S, text: S }, required: ['speaker', 'text'] } };

export const INTERPRET_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['attack', 'skill', 'social', 'move', 'trade', 'use_item', 'observe', 'dialogue', 'rest', 'netrun', 'other'] },
        summary: S,
        targetId: S,
        confidence: N,
      },
      required: ['type', 'summary'],
    },
    framing: { type: 'string', description: '1–2 frases de tensão, só quando houver rolagem' },
    clarification: { type: 'string', description: 'pergunta ao jogador se a ação for ambígua demais' },
    toolCalls: toolCallsJsonSchema('interpreter'),
  },
  required: ['intent', 'toolCalls'],
};

export const NARRATE_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string', description: 'Narração com falas em [DIALOGUE: Nome]...[/DIALOGUE]' },
    dialogues: DIALOGUES,
    toolCalls: toolCallsJsonSchema('narrator'),
    discoveries: { type: 'array', items: { type: 'object', properties: { title: S, description: S, category: S }, required: ['title', 'description'] } },
    suggestedActions: { type: 'array', items: S },
    enemyActions: { type: 'array', items: { type: 'object', properties: { attackerId: S }, required: ['attackerId'] } },
  },
  required: ['narration', 'suggestedActions', 'toolCalls'],
};

export const PHONE_SCHEMA = {
  type: 'object',
  properties: {
    replyText: S,
    suggestedReplies: { type: 'array', items: S },
    toolCalls: toolCallsJsonSchema('phone'),
  },
  required: ['replyText', 'suggestedReplies', 'toolCalls'],
};

export const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    traits: { type: 'array', items: S },
    voice: S,
    motivation: S,
    fear: S,
    lines: S,
    goal: S,
    secret: S,
    secretWeight: N,
    bond: { type: 'object', properties: { targetId: S, kind: S, note: S }, required: ['targetId', 'kind'] },
    knowsAboutPlayer: { type: 'array', items: S },
  },
  required: ['traits'],
};

const FRONT_TEXTS = {
  type: 'object',
  properties: {
    id: S,
    title: S,
    premise: S,
    twist: S,
    stages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: S,
          blockHint: S,
          effects: { type: 'array', items: { type: 'object', properties: { kind: S, headline: S, body: S, text: S }, required: ['kind'] } },
        },
        required: ['title', 'blockHint', 'effects'],
      },
    },
  },
  required: ['id', 'title', 'premise', 'twist', 'stages'],
};

export const WORLDGEN_SCHEMA = {
  type: 'object',
  properties: { fronts: { type: 'array', items: FRONT_TEXTS } },
  required: ['fronts'],
};

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { summary: S },
  required: ['summary'],
};
