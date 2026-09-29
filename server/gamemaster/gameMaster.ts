/**
 * Game Master: orquestra as chamadas ao LLM por papel e produz metadados de observabilidade.
 * Não aplica NADA ao estado — só devolve intenções, narração e pedidos de ferramentas.
 */
import { randomUUID } from 'crypto';
import type { EngineResult, LlmPurpose, LlmRunMeta } from '../../shared/types/turn';
import type { GameContext, GmEnvelope, InterpretResponse, ModelMode, NarrateResponse, PhoneResponse, SummarizeResponse } from '../../shared/types/gm';
import { checkNarration } from '../../shared/engine/consistency';
import { LlmError, type GenerateResult, type LlmProvider } from './llmClient';
import { INTERPRETER_PROMPT, NARRATOR_PROMPT, PHONE_PROMPT, PROMPT_VERSION, SUMMARIZER_PROMPT } from './systemPrompt';
import { INTERPRET_SCHEMA, NARRATE_SCHEMA, PHONE_SCHEMA, SUMMARY_SCHEMA } from './schemas';
import { buildInterpretPrompt, buildNarratePrompt, buildPhonePrompt } from './promptBuilder';
import { normalizeInterpret, normalizeNarrate, normalizePhone } from './normalize';
import { parseLlmJson } from './parseJson';
import { fallbackInterpret, fallbackNarrate, fallbackPhone, fallbackSummary } from './fallbacks';

export interface GameMaster {
  interpret(ctx: GameContext, text: string, mode: ModelMode, feedback?: string): Promise<GmEnvelope<InterpretResponse>>;
  narrate(ctx: GameContext, input: { kind: 'action' | 'prologue'; playerInput?: string; engineResult: EngineResult | null }, mode: ModelMode): Promise<GmEnvelope<NarrateResponse>>;
  phone(ctx: GameContext, npcId: string, message: string, mode: ModelMode): Promise<GmEnvelope<PhoneResponse>>;
  summarize(req: { sessionId: string; turnId: string; fromTurn: number; toTurn: number; transcript: string }, mode: ModelMode): Promise<GmEnvelope<SummarizeResponse>>;
}

export type RunLogger = (meta: LlmRunMeta) => void;

/** Log estruturado (uma linha JSON por chamada). */
export const consoleRunLogger: RunLogger = meta => {
  const { attempts, ...rest } = meta;
  console.log(JSON.stringify({ tag: 'llm_run', ...rest, attempts: attempts.length }));
};

interface CallInfo {
  purpose: LlmPurpose;
  sessionId: string;
  turnId: string;
  retrievedMemories?: string[];
}

export function createGameMaster(provider: LlmProvider, log: RunLogger = consoleRunLogger): GameMaster {
  function meta(info: CallInfo, started: number, result: GenerateResult | null, extra: Partial<LlmRunMeta>): LlmRunMeta {
    const m: LlmRunMeta = {
      requestId: randomUUID(),
      sessionId: info.sessionId,
      turnId: info.turnId,
      purpose: info.purpose,
      provider: provider.name,
      model: result?.model ?? '-',
      modelVersion: result?.modelVersion,
      promptVersion: PROMPT_VERSION,
      inputTokens: result?.usage.inputTokens,
      outputTokens: result?.usage.outputTokens,
      cachedTokens: result?.usage.cachedTokens,
      latencyMs: Date.now() - started,
      attempts: result?.attempts ?? [],
      toolsCalled: [],
      retrievedMemories: info.retrievedMemories ?? [],
      errors: [],
      degraded: false,
      createdAt: new Date().toISOString(),
      ...extra,
    };
    log(m);
    return m;
  }

  /** Chama o provedor e faz o parse; em falha devolve o erro com as tentativas. */
  async function call(system: string, prompt: string, schema: object, mode: ModelMode) {
    const result = await provider.generate({ system, prompt, schema, mode });
    return { result, raw: parseLlmJson(result.text) };
  }

  function failure(err: unknown) {
    return {
      attempts: err instanceof LlmError ? err.attempts : [],
      errors: [(err as Error)?.message ?? String(err)],
    };
  }

  return {
    async interpret(ctx, text, _mode, feedback) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'interpret', sessionId: ctx.sessionId, turnId: ctx.turnId, retrievedMemories: ctx.memories.map(m => m.id) };
      try {
        // Intérprete sempre usa o modo rápido: é classificação, não prosa.
        const { result, raw } = await call(INTERPRETER_PROMPT, buildInterpretPrompt(ctx, text, feedback), INTERPRET_SCHEMA, 'flash');
        const payload = normalizeInterpret(raw);
        return { payload, meta: meta(info, started, result, { toolsCalled: payload.toolCalls.map(t => t.tool) }) };
      } catch (err) {
        return { payload: fallbackInterpret(text), meta: meta(info, started, null, { ...failure(err), degraded: true }) };
      }
    },

    async narrate(ctx, input, mode) {
      const started = Date.now();
      const info: CallInfo = { purpose: input.kind === 'prologue' ? 'prologue' : 'narrate', sessionId: ctx.sessionId, turnId: ctx.turnId, retrievedMemories: ctx.memories.map(m => m.id) };
      let last: GenerateResult | null = null;
      try {
        let correction: string | undefined;
        let payload: NarrateResponse | null = null;
        const warningsSeen: string[] = [];
        // Até 2 tentativas: se a narração contradisser o motor, pede reescrita com a correção.
        for (let attempt = 0; attempt < 2; attempt++) {
          const { result, raw } = await call(NARRATOR_PROMPT, buildNarratePrompt(ctx, input, mode === 'pro', correction), NARRATE_SCHEMA, mode);
          last = result;
          payload = normalizeNarrate(raw);
          const warnings = checkNarration(input.engineResult, payload.narration, payload.dialogues, ctx.npcs, payload.toolCalls);
          if (!warnings.length) break;
          warningsSeen.push(...warnings);
          correction = warnings.join(' ');
          payload.consistencyWarnings = warnings;
        }
        if (input.kind === 'prologue') payload = { ...payload!, enemyActions: [] };
        return {
          payload: payload!,
          meta: meta(info, started, last, { toolsCalled: payload!.toolCalls.map(t => t.tool), errors: warningsSeen.map(w => `consistência: ${w}`) }),
        };
      } catch (err) {
        return { payload: fallbackNarrate(ctx, input.kind, input.engineResult, input.playerInput), meta: meta(info, started, last, { ...failure(err), degraded: true }) };
      }
    },

    async phone(ctx, npcId, message, mode) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'phone', sessionId: ctx.sessionId, turnId: ctx.turnId };
      try {
        const { result, raw } = await call(PHONE_PROMPT, buildPhonePrompt(ctx, npcId, message), PHONE_SCHEMA, mode);
        const payload = normalizePhone(raw);
        return { payload, meta: meta(info, started, result, { toolsCalled: payload.toolCalls.map(t => t.tool) }) };
      } catch (err) {
        return { payload: fallbackPhone(ctx), meta: meta(info, started, null, { ...failure(err), degraded: true }) };
      }
    },

    async summarize(req) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'summarize', sessionId: req.sessionId, turnId: req.turnId };
      try {
        const { result, raw } = await call(SUMMARIZER_PROMPT, `TURNOS ${req.fromTurn}–${req.toTurn}:\n${req.transcript}`, SUMMARY_SCHEMA, 'flash');
        const summary = typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 2000) : fallbackSummary(req.transcript);
        return { payload: { summary }, meta: meta(info, started, result, {}) };
      } catch (err) {
        return { payload: { summary: fallbackSummary(req.transcript), degraded: true }, meta: meta(info, started, null, { ...failure(err), degraded: true }) };
      }
    },
  };
}
