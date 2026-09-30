/** Terminal de acesso: validação da chave Gemini do jogador. */
import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import { createApp } from './app';
import { createGameMaster } from './gamemaster/gameMaster';
import { checkApiKey, type LlmProvider } from './gamemaster/llmClient';

const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;

describe('checkApiKey', () => {
  it('200 = válida; 400/403 = recusada; erro de rede = não verificada', async () => {
    expect(await checkApiKey('AIzaChaveDeTeste_1234567890', reply(200))).toEqual({ valid: true });
    expect(await checkApiKey('AIzaChaveDeTeste_1234567890', reply(400))).toEqual({ valid: false, reason: 'invalid' });
    expect(await checkApiKey('AIzaChaveDeTeste_1234567890', reply(403))).toEqual({ valid: false, reason: 'invalid' });
    expect(await checkApiKey('AIzaChaveDeTeste_1234567890', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual({ valid: null, reason: 'network' });
    expect(await checkApiKey(undefined)).toEqual({ valid: false, reason: 'missing' });
  });

  it('a chave vai pelo cabeçalho x-goog-api-key (nunca na URL)', async () => {
    let seen: { url: string; key?: string } | null = null;
    await checkApiKey('AIzaChaveDeTeste_1234567890', (async (url: string, init: RequestInit) => {
      seen = { url, key: (init.headers as Record<string, string>)['x-goog-api-key'] };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    expect(seen!.url).not.toMatch(/key=/);
    expect(seen!.key).toBe('AIzaChaveDeTeste_1234567890');
  });
});

describe('GET /api/gm/key-check', () => {
  it('valida a chave enviada pelo navegador no cabeçalho', async () => {
    const provider: LlmProvider = { name: 'fake', generate: async () => ({ text: '{}', model: 'm', usage: {}, attempts: [] }) };
    const checked: Array<string | undefined> = [];
    const server = createApp({
      gm: createGameMaster(provider, () => {}),
      hasKey: () => false,
      defaultMode: () => 'flash',
      checkKey: async key => {
        checked.push(key);
        return key === 'AIzaChaveBoa_1234567890abcd' ? { valid: true } : { valid: false, reason: 'invalid' };
      },
    }).listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const good = await (await fetch(`http://127.0.0.1:${port}/api/gm/key-check`, { headers: { 'x-gemini-key': 'AIzaChaveBoa_1234567890abcd' } })).json();
      const bad = await (await fetch(`http://127.0.0.1:${port}/api/gm/key-check`, { headers: { 'x-gemini-key': 'AIzaChaveRuim_1234567890abcd' } })).json();
      const none = await (await fetch(`http://127.0.0.1:${port}/api/gm/key-check`)).json();
      expect(good).toEqual({ valid: true });
      expect(bad).toMatchObject({ valid: false });
      expect(none).toMatchObject({ valid: false });
      expect(checked).toEqual(['AIzaChaveBoa_1234567890abcd', 'AIzaChaveRuim_1234567890abcd', undefined]);
    } finally {
      server.close();
    }
  });
});
