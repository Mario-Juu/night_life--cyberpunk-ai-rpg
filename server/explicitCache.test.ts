/** Cache explícito das instruções fixas: só com chave paga, só nos flash, nunca quebra a chamada. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CACHE_TTL_SEC, MIN_CACHE_CHARS, createCacheManager, type CacheApi } from './gamemaster/explicitCache';
import { classifyError, geminiTransport, type GeminiLike } from './gamemaster/llmClient';

const BIG = 'x'.repeat(MIN_CACHE_CHARS + 10);
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
const FREE_TIER = apiError(429, '{"error":{"code":429,"message":"TotalCachedContentStorageTokensPerModelFreeTier limit exceeded for model gemini-3.8-flash: limit=0, requested=8603"}}');

function fakeApi(behavior: (n: number) => Promise<{ name: string; expiresAt: number }>) {
  let calls = 0;
  const api: CacheApi = { create: () => behavior(++calls) };
  return { api, calls: () => calls };
}

// Experimental: desligado por padrão; estes testes ligam.
beforeEach(() => void (process.env.GM_EXPLICIT_CACHE = 'on'));
afterEach(() => void delete process.env.GM_EXPLICIT_CACHE);

describe('createCacheManager', () => {
  it('desligado por padrão (sem GM_EXPLICIT_CACHE=on)', async () => {
    delete process.env.GM_EXPLICIT_CACHE;
    const { api, calls } = fakeApi(async () => ({ name: 'c', expiresAt: Date.now() + 3_600_000 }));
    expect(await createCacheManager(api).get('paga', 'gemini-3.8-flash', BIG)).toBeNull();
    expect(calls()).toBe(0);
  });


  it('chave paga: cria uma vez, reaproveita e renova perto de vencer', async () => {
    let t = 1_000_000;
    const { api, calls } = fakeApi(async n => ({ name: `cachedContents/c${n}`, expiresAt: t + CACHE_TTL_SEC * 1000 }));
    const m = createCacheManager(api, { now: () => t });
    expect(await m.get('paga', 'gemini-3.8-flash', BIG)).toBe('cachedContents/c1');
    expect(await m.get('paga', 'gemini-3.8-flash', BIG)).toBe('cachedContents/c1');
    expect(calls()).toBe(1);
    t += (CACHE_TTL_SEC - 60) * 1000; // a 1 min de vencer
    expect(await m.get('paga', 'gemini-3.8-flash', BIG)).toBe('cachedContents/c2');
  });

  it('chamadas simultâneas criam um cache só', async () => {
    const { api, calls } = fakeApi(async n => ({ name: `c${n}`, expiresAt: Date.now() + 3_600_000 }));
    const m = createCacheManager(api);
    const names = await Promise.all([1, 2, 3].map(() => m.get('paga', 'gemini-3.8-flash', BIG)));
    expect(new Set(names)).toEqual(new Set(['c1']));
    expect(calls()).toBe(1);
  });

  it('chave gratuita (limit=0): marca a chave e nunca mais tenta', async () => {
    const { api, calls } = fakeApi(async () => {
      throw FREE_TIER;
    });
    const m = createCacheManager(api);
    expect(await m.get('gratis', 'gemini-3.8-flash', BIG)).toBeNull();
    expect(await m.get('gratis', 'gemini-3.7-flash', BIG)).toBeNull();
    expect(calls()).toBe(1);
    expect(m.skip('gratis', 'gemini-3.6-flash', BIG)).toBe('free_tier');
  });

  it('sobrecarga ao criar: segue sem cache agora e tenta de novo depois', async () => {
    const { api, calls } = fakeApi(async n => {
      if (n === 1) throw apiError(503, 'UNAVAILABLE');
      return { name: 'c2', expiresAt: Date.now() + 3_600_000 };
    });
    const m = createCacheManager(api);
    expect(await m.get('paga', 'gemini-3.8-flash', BIG)).toBeNull();
    expect(await m.get('paga', 'gemini-3.8-flash', BIG)).toBe('c2');
    expect(calls()).toBe(2);
  });

  it('não usa em lite, em prompt pequeno nem com GM_EXPLICIT_CACHE=off', async () => {
    const { api, calls } = fakeApi(async () => ({ name: 'c', expiresAt: Date.now() + 3_600_000 }));
    const m = createCacheManager(api);
    expect(await m.get('paga', 'gemini-3.1-flash-lite', BIG)).toBeNull();
    expect(await m.get('paga', 'gemini-3.8-flash', 'curto')).toBeNull();
    process.env.GM_EXPLICIT_CACHE = 'off';
    expect(await m.get('paga', 'gemini-3.8-flash', BIG)).toBeNull();
    expect(calls()).toBe(0);
  });
});

describe('geminiTransport com cache', () => {
  type Sent = { model: string; config: Record<string, unknown> };
  function fakeGemini(opts: { createError?: Error }) {
    const sent: Sent[] = [];
    let created = 0;
    const ai: GeminiLike = {
      models: {
        generateContent: async p => {
          sent.push(p);
          return { text: '{}', usageMetadata: { promptTokenCount: 9000, cachedContentTokenCount: p.config.cachedContent ? 8000 : 0, thoughtsTokenCount: 700 } };
        },
      },
      caches: {
        create: async () => {
          created++;
          if (opts.createError) throw opts.createError;
          return { name: 'cachedContents/abc', expireTime: new Date(Date.now() + 3_600_000).toISOString() };
        },
      },
    };
    return { ai, sent, created: () => created };
  }
  const call = (model = 'gemini-3.8-flash') => ({ model, system: BIG, prompt: 'contexto', schema: { type: 'object' }, signal: new AbortController().signal });

  it('paga: manda o cache no lugar das instruções e reporta os tokens em cache e de pensamento', async () => {
    const { ai, sent } = fakeGemini({});
    const r = await geminiTransport(ai, 'paga-1')(call());
    expect(sent[0].config.cachedContent).toBe('cachedContents/abc');
    expect(sent[0].config.systemInstruction).toBeUndefined();
    expect(sent[0].config.responseJsonSchema).toEqual({ type: 'object' });
    expect(r.usage).toMatchObject({ cachedTokens: 8000, thoughtsTokens: 700 });
  });

  it('gratuita: segue exatamente como antes (instruções na requisição)', async () => {
    const { ai, sent } = fakeGemini({ createError: FREE_TIER });
    await geminiTransport(ai, 'gratis-1')(call());
    expect(sent[0].config.cachedContent).toBeUndefined();
    expect(sent[0].config.systemInstruction).toBe(BIG);
  });

  it('o Google recusa o schema junto do cache: repete só com o cache e lembra', async () => {
    const { ai, sent } = fakeGemini({});
    const strict: GeminiLike = {
      ...ai,
      models: {
        generateContent: async p => {
          if (p.config.cachedContent && p.config.responseJsonSchema) {
            sent.push(p);
            throw apiError(400, 'INVALID_ARGUMENT');
          }
          return ai.models.generateContent(p);
        },
      },
    };
    const t = geminiTransport(strict, 'paga-2');
    await t(call('gemini-3.7-flash'));
    expect(sent.map(s => [!!s.config.cachedContent, !!s.config.responseJsonSchema])).toEqual([
      [true, true],
      [true, false],
    ]);
    sent.length = 0;
    await t(call('gemini-3.7-flash'));
    expect(sent.map(s => [!!s.config.cachedContent, !!s.config.responseJsonSchema])).toEqual([[true, false]]);
  });

  it('cache recusado de vez (404): segue sem ele e não tenta mais nesse modelo', async () => {
    const { ai, sent, created } = fakeGemini({});
    const broken: GeminiLike = {
      ...ai,
      models: {
        generateContent: async p => {
          if (p.config.cachedContent) {
            sent.push(p);
            throw apiError(404, 'cached content not found');
          }
          return ai.models.generateContent(p);
        },
      },
    };
    const t = geminiTransport(broken, 'paga-3');
    const r = await t(call('gemini-3.6-flash'));
    expect(r.text).toBe('{}');
    expect(sent.at(-1)?.config.systemInstruction).toBe(BIG);
    const before = created();
    await t(call('gemini-3.6-flash'));
    expect(created()).toBe(before);
    expect(sent.at(-1)?.config.cachedContent).toBeUndefined();
  });

  it('lite nunca usa cache explícito (o implícito já pega nele)', async () => {
    const { ai, sent, created } = fakeGemini({});
    await geminiTransport(ai, 'paga-4')(call('gemini-3.1-flash-lite'));
    expect(created()).toBe(0);
    expect(sent[0].config.systemInstruction).toBe(BIG);
  });
});

describe('Bloqueio do filtro de conteúdo', () => {
  it('resposta vazia com blockReason vira erro "blocked" (não JSON inválido)', async () => {
    delete process.env.GM_EXPLICIT_CACHE;
    const ai: GeminiLike = {
      models: { generateContent: async () => ({ text: '', promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }) },
      caches: { create: async () => ({}) },
    };
    const err = await geminiTransport(ai, 'k-block')({ model: 'gemini-3.1-flash-lite', system: 's', prompt: 'p', schema: {}, signal: new AbortController().signal }).catch(e => e);
    expect(classifyError(err).kind).toBe('blocked');
  });
});
