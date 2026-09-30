/**
 * Confiabilidade da camada LLM: classificação dos erros REAIS do Gemini (capturados com a chave
 * gratuita), disjuntor por chave+modelo, cadeias por papel, timeout por tentativa e memórias.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAST_MODEL_CHAIN,
  DEFAULT_MODEL_CHAIN,
  LlmError,
  classifyError,
  cooldownOf,
  msUntilPacificMidnight,
  resetLlmMemory,
  runChain,
  type Transport,
  type TransportCall,
} from './gamemaster/llmClient';
import { createGameMaster, isSevereWarning } from './gamemaster/gameMaster';
import type { GameContext } from '../shared/types/gm';
import { scenario } from '../evals/harness';

// Erros como o @google/genai os entrega (status + a resposta JSON da API na mensagem).
const apiError = (status: number, body: object) => Object.assign(new Error(JSON.stringify(body)), { status });
const quotaDay = () =>
  apiError(429, {
    error: {
      code: 429,
      message: 'You exceeded your current quota… Please retry in 6.600118922s.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '6s' },
      ],
    },
  });
const quotaMinute = () =>
  apiError(429, {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
      ],
    },
  });
const overloaded = () => apiError(503, { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } });
const invalidArg = () => apiError(400, { error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } });

const ok = (call: TransportCall) => Promise.resolve({ text: '{"ok":true}', model: call.model, usage: {} });

/** Transporte falso: `plan[model]` diz o que cada modelo faz (sempre o mesmo, ou uma fila). */
function fakeTransport(plan: Record<string, Array<'ok' | Error | 'hang'> | 'ok' | Error | 'hang'>) {
  const calls: TransportCall[] = [];
  const transport: Transport = call => {
    calls.push(call);
    const p = plan[call.model];
    const step = Array.isArray(p) ? (p.length > 1 ? p.shift()! : p[0]) : p ?? 'ok';
    if (step === 'ok') return ok(call);
    if (step === 'hang') return new Promise((_, reject) => call.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))));
    return Promise.reject(step);
  };
  return { transport, calls };
}

const req = (purpose: 'narrate' | 'interpret' = 'narrate', schema: object = { type: 'object', properties: { a: { type: 'string' } } }) => ({ system: 's', prompt: 'p', schema, mode: 'flash' as const, purpose });

beforeEach(() => resetLlmMemory());
afterEach(() => {
  delete process.env.GM_ATTEMPT_MS_FAST;
  delete process.env.GM_ATTEMPT_MS_NARRATE;
});

describe('classifyError (erros reais do Gemini)', () => {
  it('cota diária vence o "retry in 6s" enganoso', () => {
    expect(classifyError(quotaDay()).kind).toBe('quota_day');
  });
  it('cota por minuto respeita o RetryInfo', () => {
    expect(classifyError(quotaMinute())).toMatchObject({ kind: 'quota_minute', retryAfterMs: 12_000 });
  });
  it('503, abort, chave inválida e 400', () => {
    expect(classifyError(overloaded()).kind).toBe('overloaded');
    expect(classifyError(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })).kind).toBe('timeout');
    expect(classifyError(apiError(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })).kind).toBe('auth');
    expect(classifyError(invalidArg()).kind).toBe('bad_request');
  });
  it('a cota diária esfria até a meia-noite do Pacífico (entre 1 min e 24 h)', () => {
    const ms = msUntilPacificMidnight();
    expect(ms).toBeGreaterThanOrEqual(60_000);
    expect(ms).toBeLessThanOrEqual(24 * 3600_000 + 60_000);
  });
});

describe('runChain', () => {
  it('modelo com cota diária esgotada é pulado nas próximas chamadas (sem gastar request)', async () => {
    const { transport, calls } = fakeTransport({ 'gemini-3.8-flash': quotaDay() });
    const r1 = await runChain('k', req(), transport);
    expect(r1.model).toBe('gemini-3.7-flash');
    expect(cooldownOf('k', 'gemini-3.8-flash')?.kind).toBe('quota_day');
    calls.length = 0;
    const r2 = await runChain('k', req(), transport);
    expect(r2.model).toBe('gemini-3.7-flash');
    expect(calls.map(c => c.model)).toEqual(['gemini-3.7-flash']);
    // Outra chave (outro jogador) tem a própria cota.
    expect(cooldownOf('outra', 'gemini-3.8-flash')).toBeNull();
  });

  it('todos os modelos sem cota diária: falha na hora, sem chamar a API, com a causa certa', async () => {
    const all = Object.fromEntries(DEFAULT_MODEL_CHAIN.map(m => [m, quotaDay()]));
    const { transport, calls } = fakeTransport(all);
    await expect(runChain('k', req(), transport)).rejects.toMatchObject({ kind: 'quota_day' });
    calls.length = 0;
    const err = (await runChain("k", req(), transport).catch(e => e)) as LlmError;
    expect(err.kind).toBe('quota_day');
    expect(calls).toHaveLength(0);
  });

  it('intérprete começa pelo flash-lite com thinking LOW; narração pelo flash sem thinking', async () => {
    const { transport, calls } = fakeTransport({});
    await runChain('k', req('interpret'), transport);
    expect(calls[0]).toMatchObject({ model: FAST_MODEL_CHAIN[0], thinkingLevel: 'LOW' });
    await runChain('k', req('narrate'), transport);
    expect(calls[1].model).toBe(DEFAULT_MODEL_CHAIN[0]);
    expect(calls[1].thinkingLevel).toBeUndefined();
    expect(calls.every(c => c.temperature === undefined)).toBe(true);
  });

  it('503 lento: o timeout da tentativa corta e passa ao próximo modelo', async () => {
    process.env.GM_ATTEMPT_MS_NARRATE = '60';
    const { transport } = fakeTransport({ 'gemini-3.8-flash': 'hang' });
    const r = await runChain('k', { ...req(), deadline: Date.now() + 20_000 }, transport);
    expect(r.model).toBe('gemini-3.7-flash');
    expect(r.attempts[0].error).toMatch(/^timeout/);
    expect(cooldownOf('k', 'gemini-3.8-flash')?.kind).toBe('timeout');
  });

  it('400 do schema no lite: repete simplificado e LEMBRA na próxima request', async () => {
    const big = { type: 'object', properties: { args: { type: 'object', properties: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, { type: 'string' }])) } } };
    const lite = FAST_MODEL_CHAIN[0];
    const { transport, calls } = fakeTransport({ [lite]: invalidArg() });
    // O fake recusa sempre no lite; o schema simplificado é aceito se o modelo já foi marcado:
    const smart: Transport = call => (call.model === lite && call.schema === big ? transport(call) : ok(call));
    await runChain('k', req('interpret', big), smart);
    expect(calls).toHaveLength(1);
    calls.length = 0;
    const r = await runChain('k', req('interpret', big), c => (c.schema === big ? Promise.reject(invalidArg()) : ok(c)));
    expect(r.model).toBe(lite);
    expect(r.attempts).toHaveLength(1); // foi direto no simplificado
  });

  it('chave recusada para tudo na hora (não queima a cadeia)', async () => {
    const { transport, calls } = fakeTransport({ 'gemini-3.8-flash': apiError(400, { error: { message: 'API key not valid.' } }) });
    await expect(runChain('k', req(), transport)).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });

  it('JSON inválido: o Mestre tenta de novo em OUTRO modelo', async () => {
    const seen: string[] = [];
    const gm = createGameMaster(
      {
        name: 'fake',
        generate: async r => {
          const model = (r.avoid ?? []).includes('m1') ? 'm2' : 'm1';
          seen.push(model);
          return { text: model === 'm1' ? 'não é json' : JSON.stringify({ narration: 'ok', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [] }), model, usage: {}, attempts: [] };
        },
      },
      () => {},
    );
    const ctx = scenario().context('x') as GameContext;
    const env = await gm.narrate(ctx, { kind: 'action', playerInput: 'olho', engineResult: null }, 'flash');
    expect(env.meta.degraded).toBe(false);
    expect(seen).toEqual(['m1', 'm2']);
  });

  it('degradado por cota diária explica a causa ao jogador', async () => {
    const gm = createGameMaster(
      {
        name: 'fake',
        generate: async () => {
          throw new LlmError('cota', [], 'quota_day');
        },
      },
      () => {},
    );
    const env = await gm.narrate(scenario().context('x') as GameContext, { kind: 'action', playerInput: 'olho', engineResult: null }, 'flash');
    expect(env.meta).toMatchObject({ degraded: true, failureKind: 'quota_day' });
    expect(env.payload.narration).toMatch(/Configurações/);
  });

  it('reescrita de consistência só para contradições graves', () => {
    expect(isSevereWarning('A narração revelou o DV/dificuldade numérica — isso é segredo do Mestre.')).toBe(false);
    expect(isSevereWarning('O ataque ERROU Ganger; a narração diz que acertou.')).toBe(true);
  });
});
