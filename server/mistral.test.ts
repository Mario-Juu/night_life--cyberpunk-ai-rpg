/** Mistral como reserva da narração: provider (API simulada) e a ordem Flash → Mistral → Flash-Lite. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmError, type GenerateRequest, type LlmProvider } from './gamemaster/llmClient';
import { createMistralProvider, withNarrationBackup } from './gamemaster/mistralClient';

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({ system: 's', prompt: 'p', schema: { type: 'object' }, mode: 'flash', purpose: 'narrate', ...over });
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (content: string) => json(200, { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

beforeEach(() => {
  process.env.MISTRAL_API_KEY = 'mstrl_teste';
});
afterEach(() => {
  delete process.env.MISTRAL_API_KEY;
});

describe('createMistralProvider', () => {
  it('manda system + prompt + json_schema com Bearer e devolve o texto do Medium', async () => {
    let sent: { auth?: string; body?: { model: string; messages: Array<{ role: string }>; response_format: { type: string } } } = {};
    const provider = createMistralProvider((async (_url: string, init: RequestInit) => {
      sent = { auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(init.body as string) };
      return answer('{"narration":"ok"}');
    }) as unknown as typeof fetch);
    const r = await provider.generate(req());
    expect(r).toMatchObject({ text: '{"narration":"ok"}', model: 'mistral-medium-latest', usage: { inputTokens: 10, outputTokens: 5 } });
    expect(sent.auth).toBe('Bearer mstrl_teste');
    expect(sent.body?.messages.map(m => m.role)).toEqual(['system', 'user']);
    expect(sent.body?.response_format.type).toBe('json_schema');
  });

  it('Medium sem cota (429) → tenta o Small', async () => {
    const models: string[] = [];
    const provider = createMistralProvider((async (_u: string, init: RequestInit) => {
      const { model } = JSON.parse(init.body as string);
      models.push(model);
      return model === 'mistral-medium-latest' ? json(429, { message: 'Rate limit exceeded' }) : answer('{}');
    }) as unknown as typeof fetch);
    const r = await provider.generate(req());
    expect(r.model).toBe('mistral-small-latest');
    expect(models).toEqual(['mistral-medium-latest', 'mistral-small-latest']);
  });

  it('sem MISTRAL_API_KEY: falha na hora (auth), sem chamar a API', async () => {
    delete process.env.MISTRAL_API_KEY;
    let called = false;
    const provider = createMistralProvider((async () => {
      called = true;
      return answer('{}');
    }) as unknown as typeof fetch);
    await expect(provider.generate(req())).rejects.toMatchObject({ kind: 'auth' });
    expect(called).toBe(false);
  });
});

describe('withNarrationBackup', () => {
  /** Gemini falso: Flash falha; com liteOnly responde pelo Lite. */
  function gemini(log: string[]): LlmProvider {
    return {
      name: 'gemini',
      generate: async r => {
        log.push(r.liteOnly ? 'lite' : r.allowLite ? 'gemini+lite' : 'flash');
        if (r.liteOnly) return { text: '{}', model: 'gemini-3.1-flash-lite', usage: {}, attempts: [{ model: 'gemini-3.1-flash-lite', ok: true, latencyMs: 1 }] };
        throw new LlmError('503', [{ model: 'gemini-3.8-flash', ok: false, latencyMs: 1, error: 'overloaded 503' }], 'overloaded', true, true);
      },
    };
  }
  const mistral = (log: string[], ok: boolean): LlmProvider => ({
    name: 'mistral',
    generate: async () => {
      log.push('mistral');
      if (ok) return { text: '{}', model: 'mistral-medium-latest', usage: {}, attempts: [{ model: 'mistral-medium-latest', ok: true, latencyMs: 1 }] };
      throw new LlmError('429', [{ model: 'mistral-medium-latest', ok: false, latencyMs: 1, error: 'quota_minute 429' }], 'quota_minute');
    },
  });

  it('sem autorização: só o Flash (o erro sobe com "reserva oferecida" para o modal)', async () => {
    const log: string[] = [];
    const p = withNarrationBackup(gemini(log), mistral(log, true));
    await expect(p.generate(req())).rejects.toMatchObject({ liteSkipped: true });
    expect(log).toEqual(['flash']);
  });

  it('autorizado: Flash → Mistral (e as tentativas ficam todas no registro)', async () => {
    const log: string[] = [];
    const r = await withNarrationBackup(gemini(log), mistral(log, true)).generate(req({ allowLite: true }));
    expect(r.model).toBe('mistral-medium-latest');
    expect(log).toEqual(['flash', 'mistral']);
    expect(r.attempts.map(a => a.model)).toEqual(['gemini-3.8-flash', 'mistral-medium-latest']);
  });

  it('autorizado e Mistral também falhou: Flash → Mistral → Flash-Lite', async () => {
    const log: string[] = [];
    const r = await withNarrationBackup(gemini(log), mistral(log, false)).generate(req({ allowLite: true }));
    expect(r.model).toBe('gemini-3.1-flash-lite');
    expect(log).toEqual(['flash', 'mistral', 'lite']);
  });

  it('intérprete e telefone não passam pelo Mistral', async () => {
    const log: string[] = [];
    const quiet: LlmProvider = { name: 'g', generate: async () => ({ text: '{}', model: 'gemini-3.5-flash-lite', usage: {}, attempts: [] }) };
    const r = await withNarrationBackup(quiet, mistral(log, true)).generate(req({ purpose: 'interpret', allowLite: true }));
    expect(r.model).toBe('gemini-3.5-flash-lite');
    expect(log).toEqual([]);
  });
});
