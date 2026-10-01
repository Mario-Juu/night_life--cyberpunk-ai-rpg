/**
 * Game Master: orquestra as chamadas ao LLM por papel e produz metadados de observabilidade.
 * Não aplica NADA ao estado — só devolve intenções, narração e pedidos de ferramentas.
 */
import { randomUUID } from 'crypto';
import type { EngineResult, FailureKind, LlmPurpose, LlmRunMeta } from '../../shared/types/turn';
import type { GameContext, GmEnvelope, InterpretResponse, ModelMode, NarrateResponse, NpcProfileRequest, NpcProfileResponse, PhoneResponse, SummarizeResponse, WorldgenRequest, WorldgenResponse } from '../../shared/types/gm';
import { checkNarration } from '../../shared/engine/consistency';
import { fixSelfAddressedSpeakers } from '../../shared/engine/narration';
import { LlmError, gmBudgetMs, type GenerateResult, type LlmProvider } from './llmClient';
import { INTERPRETER_PROMPT, NARRATOR_PROMPT, PHONE_PROMPT, PROFILE_PROMPT, PROMPT_VERSION, SUMMARIZER_PROMPT, WORLDGEN_PROMPT } from './systemPrompt';
import { INTERPRET_SCHEMA, NARRATE_SCHEMA, PHONE_SCHEMA, PROFILE_SCHEMA, SUMMARY_SCHEMA, WORLDGEN_SCHEMA } from './schemas';
import { buildInterpretPrompt, buildNarratePrompt, buildPhonePrompt, buildProfilePrompt, buildWorldgenPrompt } from './promptBuilder';
import { normalizeInterpret, normalizeNarrate, normalizePhone } from './normalize';
import { parseLlmJson } from './parseJson';
import { fallbackInterpret, fallbackNarrate, fallbackPhone, fallbackSummary } from './fallbacks';

export interface GameMaster {
  interpret(ctx: GameContext, text: string, mode: ModelMode, feedback?: string): Promise<GmEnvelope<InterpretResponse>>;
  narrate(ctx: GameContext, input: { kind: 'action' | 'prologue'; playerInput?: string; engineResult: EngineResult | null; allowLite?: boolean }, mode: ModelMode): Promise<GmEnvelope<NarrateResponse>>;
  phone(ctx: GameContext, npcId: string, message: string, mode: ModelMode): Promise<GmEnvelope<PhoneResponse>>;
  summarize(req: { sessionId: string; turnId: string; fromTurn: number; toTurn: number; transcript: string }, mode: ModelMode): Promise<GmEnvelope<SummarizeResponse>>;
  profile(req: NpcProfileRequest): Promise<GmEnvelope<NpcProfileResponse>>;
  worldgen(req: WorldgenRequest): Promise<GmEnvelope<WorldgenResponse>>;
}

export type RunLogger = (meta: LlmRunMeta) => void;

const SLIM_NOTE = 'filtro de conteúdo do Google bloqueou o contexto completo; narrado com o contexto reduzido';

/**
 * Contexto mínimo para quando o filtro do Google bloqueia o completo: ficha, cena, quem está presente
 * (mais quem for pedido), missões ativas e as últimas falas. Sem tramas do mundo, memórias nem resumos.
 */
export function slimContext(ctx: GameContext, keepNpcIds: string[] = []): GameContext {
  const keep = new Set([...ctx.scene.presentNpcIds, ...keepNpcIds]);
  return {
    ...ctx,
    npcs: ctx.npcs.filter(n => keep.has(n.id)),
    quests: ctx.quests.filter(q => q.status === 'ACTIVE'),
    memories: [],
    summaries: [],
    recentHistory: ctx.recentHistory.slice(-4),
    phone: ctx.phone.filter(t => keep.has(t.npcId)),
    playerKnowledge: [],
    fronts: [],
    news: [],
  };
}

/** Revelar o DV é deslize de estilo; o resto contradiz o motor e merece reescrita. */
export function isSevereWarning(warning: string): boolean {
  return !/revelou o DV|Possível vazamento de segredo/i.test(warning);
}

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
      inputTokens: result?.usage?.inputTokens,
      outputTokens: result?.usage?.outputTokens,
      cachedTokens: result?.usage?.cachedTokens,
      thoughtsTokens: result?.usage?.thoughtsTokens,
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

  /**
   * Chama o provedor e faz o parse, tudo dentro do prazo da operação.
   * JSON inválido conta como falha transitória: tenta de novo em OUTRO modelo enquanto houver tempo.
   */
  /**
   * Chamada com rede de segurança para o FILTRO DE CONTEÚDO do Google: se o prompt completo for bloqueado e
   * houver uma versão enxuta (só ficha, cena, presentes e últimas falas), tenta uma vez com ela.
   */
  async function call(system: string, prompt: string, schema: object, mode: ModelMode, deadline: number, purpose: LlmPurpose, allowLite?: boolean, slim?: () => string) {
    try {
      return { ...(await callOnce(system, prompt, schema, mode, deadline, purpose, allowLite)), slimmed: false };
    } catch (err) {
      if (!slim || !(err instanceof LlmError) || err.kind !== 'blocked' || deadline - Date.now() < 15_000) throw err;
      try {
        const r = await callOnce(system, slim(), schema, mode, deadline, purpose, allowLite);
        return { ...r, result: { ...r.result, attempts: [...err.attempts, ...r.result.attempts] }, slimmed: true };
      } catch (err2) {
        if (err2 instanceof LlmError) throw new LlmError(err2.message, [...err.attempts, ...err2.attempts], err2.kind, err2.liteSkipped, err2.waitMayHelp);
        throw err2;
      }
    }
  }

  async function callOnce(system: string, prompt: string, schema: object, mode: ModelMode, deadline: number, purpose: LlmPurpose, allowLite?: boolean) {
    const attempts: LlmError['attempts'] = [];
    const avoid: string[] = [];
    let lastErr: unknown;
    for (let i = 0; i < 2; i++) {
      let result;
      try {
        result = await provider.generate({ system, prompt, schema, mode, deadline, purpose, avoid, allowLite });
      } catch (err) {
        if (err instanceof LlmError) throw new LlmError(err.message, [...attempts, ...err.attempts], err.kind, err.liteSkipped, err.waitMayHelp);
        throw err;
      }
      try {
        return { result: { ...result, attempts: [...attempts, ...result.attempts] }, raw: parseLlmJson(result.text) };
      } catch (err) {
        lastErr = err;
        avoid.push(result.model);
        attempts.push(...result.attempts, { model: result.model, ok: false, latencyMs: 0, error: `JSON inválido: ${(err as Error).message}`.slice(0, 200) });
        if (deadline - Date.now() < 15_000) break;
      }
    }
    throw new LlmError((lastErr as Error)?.message ?? 'Resposta inválida do modelo.', attempts, 'invalid_json');
  }

  const deadlineFrom = (started: number) => started + gmBudgetMs();

  function failure(err: unknown): Pick<LlmRunMeta, 'attempts' | 'errors' | 'failureKind' | 'liteOffered' | 'waitMayHelp'> {
    const e = err instanceof LlmError ? err : null;
    return {
      attempts: e?.attempts ?? [],
      errors: [(err as Error)?.message ?? String(err)],
      failureKind: e?.kind ?? 'other',
      liteOffered: e?.liteSkipped || undefined,
      waitMayHelp: e?.waitMayHelp || undefined,
    };
  }

  return {
    async interpret(ctx, text, _mode, feedback) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'interpret', sessionId: ctx.sessionId, turnId: ctx.turnId, retrievedMemories: ctx.memories.map(m => m.id) };
      try {
        // Intérprete sempre usa o modo rápido: é classificação, não prosa.
        const { result, raw, slimmed } = await call(INTERPRETER_PROMPT, buildInterpretPrompt(ctx, text, feedback), INTERPRET_SCHEMA, 'flash', deadlineFrom(started), 'interpret', undefined, () => buildInterpretPrompt(slimContext(ctx), text, feedback));
        const payload = normalizeInterpret(raw);
        return { payload, meta: meta(info, started, result, { toolsCalled: payload.toolCalls.map(t => t.tool), errors: slimmed ? [SLIM_NOTE] : [] }) };
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
        let slimmedAny = false;
        // Até 2 tentativas: se a narração contradisser o motor, pede reescrita com a correção.
        const deadline = deadlineFrom(started);
        for (let attempt = 0; attempt < 2; attempt++) {
          // A reescrita por consistência só acontece se ainda houver tempo (senão fica a 1ª versão, com o aviso).
          if (attempt > 0 && deadline - Date.now() < 30_000) break;
          let result, raw, slimmed;
          try {
            ({ result, raw, slimmed } = await call(NARRATOR_PROMPT, buildNarratePrompt(ctx, input, correction), NARRATE_SCHEMA, mode, deadline, info.purpose, input.allowLite, () => buildNarratePrompt(slimContext(ctx), input, correction)));
          } catch (err) {
            // A REESCRITA falhou: fica a narração anterior (com o aviso), em vez de perder o turno.
            if (attempt === 0 || !payload) throw err;
            warningsSeen.push(`reescrita não aconteceu: ${(err as Error)?.message ?? err}`.slice(0, 200));
            break;
          }
          last = result;
          if (slimmed) slimmedAny = true;
          payload = normalizeNarrate(raw);
          // Fala do jogador rotulada com o nome de quem ouve ("[DIALOGUE: Rafa] E aí, Rafa…").
          const speakers = fixSelfAddressedSpeakers(payload.narration, payload.dialogues, ctx.character.bio.handle || ctx.character.bio.name);
          payload = { ...payload, narration: speakers.narration, dialogues: speakers.dialogues };
          const warnings = checkNarration(input.engineResult, payload.narration, payload.dialogues, ctx.npcs, payload.toolCalls, { playerDead: ctx.character.dead, money: ctx.character.money, turn: ctx.turn, quests: ctx.quests });
          if (!warnings.length) break;
          warningsSeen.push(...warnings);
          correction = warnings.join(' ');
          payload.consistencyWarnings = warnings;
          // Reescrever custa outra chamada (e cota): só vale para contradições graves com o motor.
          if (!warnings.some(isSevereWarning)) break;
        }
        if (input.kind === 'prologue') payload = { ...payload!, enemyActions: [] };
        return {
          payload: payload!,
          meta: meta(info, started, last, { toolsCalled: payload!.toolCalls.map(t => t.tool), errors: [...(slimmedAny ? [SLIM_NOTE] : []), ...warningsSeen.map(w => `consistência: ${w}`)] }),
        };
      } catch (err) {
        const f = failure(err);
        const payload = fallbackNarrate(ctx, input.kind, input.engineResult, input.playerInput, f.failureKind);
        return { payload, meta: meta(info, started, last, { ...f, degraded: true }) };
      }
    },

    async phone(ctx, npcId, message, mode) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'phone', sessionId: ctx.sessionId, turnId: ctx.turnId };
      try {
        const { result, raw, slimmed } = await call(PHONE_PROMPT, buildPhonePrompt(ctx, npcId, message), PHONE_SCHEMA, mode, deadlineFrom(started), 'phone', undefined, () => buildPhonePrompt(slimContext(ctx, [npcId]), npcId, message));
        const payload = normalizePhone(raw);
        return { payload, meta: meta(info, started, result, { toolsCalled: payload.toolCalls.map(t => t.tool), errors: slimmed ? [SLIM_NOTE] : [] }) };
      } catch (err) {
        return { payload: fallbackPhone(ctx), meta: meta(info, started, null, { ...failure(err), degraded: true }) };
      }
    },

    async profile(req) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'profile', sessionId: req.sessionId, turnId: req.turnId };
      try {
        const { result, raw } = await call(PROFILE_PROMPT, buildProfilePrompt(req), PROFILE_SCHEMA, 'flash', deadlineFrom(started), 'profile');
        // O motor valida campo a campo ao aplicar (applyGeneratedProfile).
        return { payload: { ...(raw as unknown as NpcProfileResponse), traits: Array.isArray(raw.traits) ? (raw.traits as string[]) : [] }, meta: meta(info, started, result, {}) };
      } catch (err) {
        // Sem perfil inventado: o cliente tenta de novo mais tarde.
        return { payload: { traits: [], degraded: true }, meta: meta(info, started, null, { ...failure(err), degraded: true }) };
      }
    },

    async worldgen(req) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'worldgen', sessionId: req.sessionId, turnId: req.turnId };
      try {
        const { result, raw } = await call(WORLDGEN_PROMPT, buildWorldgenPrompt(req), WORLDGEN_SCHEMA, 'flash', deadlineFrom(started), 'worldgen');
        // O motor casa por id/posição e só troca texto (applyWorldgen).
        return { payload: { fronts: Array.isArray(raw.fronts) ? (raw.fronts as WorldgenResponse['fronts']) : [] }, meta: meta(info, started, result, {}) };
      } catch (err) {
        // Sem costura: as frentes seguem com o texto da mistura e o cliente tenta de novo depois.
        return { payload: { fronts: [], degraded: true }, meta: meta(info, started, null, { ...failure(err), degraded: true }) };
      }
    },

    async summarize(req) {
      const started = Date.now();
      const info: CallInfo = { purpose: 'summarize', sessionId: req.sessionId, turnId: req.turnId };
      try {
        const { result, raw } = await call(SUMMARIZER_PROMPT, `TURNOS ${req.fromTurn}–${req.toTurn}:\n${req.transcript}`, SUMMARY_SCHEMA, 'flash', deadlineFrom(started), 'summarize');
        const summary = typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 2000) : fallbackSummary(req.transcript);
        return { payload: { summary }, meta: meta(info, started, result, {}) };
      } catch (err) {
        return { payload: { summary: fallbackSummary(req.transcript), degraded: true }, meta: meta(info, started, null, { ...failure(err), degraded: true }) };
      }
    },
  };
}
