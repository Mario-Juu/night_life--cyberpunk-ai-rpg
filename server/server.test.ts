import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { GameContext } from '../shared/types/gm';
import type { LlmRunMeta } from '../shared/types/turn';
import { buildCharacter, STAT_PRESETS } from '../shared/rules/creation';
import { createInitialState } from '../shared/engine/initialState';
import { buildGameContext } from '../shared/engine/context';
import { REGISTRY, runToolCalls } from '../shared/engine/tools';
import { sequenceRng } from '../shared/engine/dice';
import { createGameMaster } from './gamemaster/gameMaster';
import { isRetryable, LlmError, type LlmProvider } from './gamemaster/llmClient';
import { parseLlmJson } from './gamemaster/parseJson';
import { normalizeInterpret, normalizeNarrate } from './gamemaster/normalize';
import { buildInterpretPrompt, buildNarratePrompt } from './gamemaster/promptBuilder';
import { INTERPRET_SCHEMA, NARRATE_SCHEMA } from './gamemaster/schemas';
import { createApp } from './app';
import { generateFronts } from '../shared/engine/fronts';
import { scenario } from '../evals/harness';

function context(): GameContext {
  const c = buildCharacter({
    name: 'Ren', handle: 'Sparks', age: 22, role: 'solo', occupation: 'Entregador', district: 'WATSON',
    familyTie: 'Elena', debtReason: 'aluguel', personalAnchor: '', appearance: '',
    stats: { ...STAT_PRESETS[0].stats }, starterWeaponId: 'pistol',
  });
  const s = runToolCalls(REGISTRY, createInitialState(c), [{ tool: 'start_combat', args: { combatants: [{ id: 'foe_a', name: 'Capanga', hp: 20, weaponClass: 'pistol_medium' }] } }], {
    rng: sequenceRng([5]),
    origin: 'narrator',
  }).state;
  return buildGameContext(s, 'atiro no capanga');
}

/** Provedor falso: devolve respostas enfileiradas e registra os prompts. */
function fakeProvider(responses: Array<object | Error>) {
  const prompts: string[] = [];
  const provider: LlmProvider = {
    name: 'fake',
    async generate(req) {
      prompts.push(req.prompt);
      const next = responses.shift();
      if (!next || next instanceof Error) throw new LlmError('boom', [{ model: 'fake-1', ok: false, latencyMs: 1, error: '503' }]);
      return { text: JSON.stringify(next), model: 'fake-1', modelVersion: 'fake-1-001', usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 }, attempts: [{ model: 'fake-1', ok: true, latencyMs: 5 }] };
    },
  };
  return { provider, prompts };
}

describe('parse e normalização', () => {
  it('parseLlmJson aceita cercas e quebras de linha cruas, e recusa lixo', () => {
    expect(parseLlmJson('```json\n{"narration": "a\nb",}\n```')).toEqual({ narration: 'a\nb' });
    expect(() => parseLlmJson('not json')).toThrow();
  });

  it('intérprete: descarta ferramentas inexistentes ou de outra origem', () => {
    const r = normalizeInterpret({
      intent: { type: 'attack', summary: 'atirar' },
      toolCalls: [
        { tool: 'attack', args: { targetId: 'foe_a' } },
        { tool: 'set_hp', args: { value: 0 } },
        { tool: 'transfer_money', args: { amount: 500 } },
      ],
    });
    expect(r.toolCalls).toEqual([{ tool: 'attack', args: { targetId: 'foe_a' } }]);
    expect(r.intent.type).toBe('attack');
  });

  it('narrador: aceita formato antigo {type,payload} e limita sugestões', () => {
    const r = normalizeNarrate({ narration: 'x', toolCalls: [{ type: 'modify_heat', payload: { delta: 1 } }], suggestedActions: ['a', 'b', 'c', 'd', 'e'] });
    expect(r.toolCalls).toEqual([{ tool: 'modify_heat', args: { delta: 1 } }]);
    expect(r.suggestedActions).toHaveLength(4);
  });
});

describe('prompts e schemas', () => {
  it('contexto do prompt tem ids reais, munição, SP e separa segredos', () => {
    const prompt = buildInterpretPrompt(context(), 'Atiro no capanga');
    expect(prompt).toContain('[item_starter_weapon]');
    expect(prompt).toContain('pente 12/12');
    expect(prompt).toContain('SP cabeça 0 / corpo 7');
    expect(prompt).toContain('[foe_a] Capanga');
    expect(prompt).toContain('SÓ VOCÊ SABE');
  });

  it('narrador recebe o resultado do motor como verdade absoluta', () => {
    const prompt = buildNarratePrompt(context(), { kind: 'action', playerInput: 'atiro', engineResult: { intent: null, tools: [{ tool: 'attack', ok: false, summary: 'Pistola está descarregada: só um clique seco.' }], roll: null, offscreen: ['Rafa vendeu o chip'] } });
    expect(prompt).toContain('RESULTADO DO MOTOR — VERDADE ABSOLUTA');
    expect(prompt).toContain('✗ attack: Pistola está descarregada');
    expect(prompt).toContain('ACONTECEU FORA DE CENA');
  });

  it('schemas são JSON Schema padrão com as ferramentas do registro', () => {
    const tools = (INTERPRET_SCHEMA.properties.toolCalls as { items: { properties: { tool: { enum: string[] } } } }).items.properties.tool.enum;
    expect(tools).toContain('attack');
    expect(tools).not.toContain('transfer_money');
    const narr = (NARRATE_SCHEMA.properties.toolCalls as { items: { properties: { tool: { enum: string[] } } } }).items.properties.tool.enum;
    expect(narr).not.toContain('transfer_money');
    expect(JSON.stringify(NARRATE_SCHEMA)).not.toMatch(/"type":"(OBJECT|STRING)"/);
  });

  it('só tenta outro modelo em erros transitórios', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
  });
});

describe('Game Master', () => {
  it('reescreve a narração quando ela contradiz o motor (arma sem munição)', async () => {
    const { provider, prompts } = fakeProvider([
      { narration: 'Você dispara e a bala atravessa o ombro do capanga.', suggestedActions: [], toolCalls: [] },
      { narration: 'Clique seco. A arma está vazia.', suggestedActions: ['recarregar'], toolCalls: [] },
    ]);
    const runs: LlmRunMeta[] = [];
    const gm = createGameMaster(provider, m => runs.push(m));
    const env = await gm.narrate(context(), { kind: 'action', playerInput: 'atiro', engineResult: { intent: null, tools: [{ tool: 'attack', ok: false, summary: 'Pistola está descarregada: só um clique seco.' }], roll: null, offscreen: [] } }, 'flash');
    expect(env.payload.narration).toMatch(/Clique seco/);
    expect(prompts[1]).toContain('CORREÇÃO OBRIGATÓRIA');
    expect(env.meta).toMatchObject({ purpose: 'narrate', model: 'fake-1', modelVersion: 'fake-1-001', inputTokens: 100, outputTokens: 20, degraded: false });
    expect(env.meta.errors[0]).toMatch(/consistência/);
    expect(runs).toHaveLength(1);
  });

  it('JSON inválido do modelo é tentado de novo (não cai direto no modo degradado)', async () => {
    const prompts: string[] = [];
    const replies = ['{"narration": "corta', JSON.stringify({ narration: 'O dado rola e a cena segue.', suggestedActions: [], toolCalls: [] })];
    const provider: LlmProvider = {
      name: 'fake',
      async generate(req) {
        prompts.push(req.prompt);
        expect(req.deadline).toBeGreaterThan(Date.now()); // todas as tentativas dividem o mesmo prazo
        return { text: replies.shift()!, model: 'fake-1', usage: {}, attempts: [{ model: 'fake-1', ok: true, latencyMs: 1 }] };
      },
    };
    const env = await createGameMaster(provider, () => {}).narrate(context(), { kind: 'action', playerInput: 'rolo', engineResult: null }, 'flash');
    expect(env.payload.degraded).toBeFalsy();
    expect(env.payload.narration).toMatch(/dado rola/);
    expect(env.meta.attempts.some(a => /JSON inválido/.test(a.error ?? ''))).toBe(true);
    expect(prompts).toHaveLength(2);
  });

  it('falha do provedor vira resposta degradada sem ferramentas, com metadados de erro', async () => {
    const gm = createGameMaster(fakeProvider([new Error('x')]).provider, () => {});
    const env = await gm.narrate(context(), { kind: 'action', playerInput: 'olho', engineResult: null }, 'flash');
    expect(env.payload.degraded).toBe(true);
    expect(env.payload.toolCalls).toEqual([]);
    expect(env.meta).toMatchObject({ degraded: true, attempts: [{ model: 'fake-1', ok: false }] });
  });
});

describe('rotas HTTP', () => {
  let server: Server;
  let base = '';
  const queue: Array<object | Error> = [];

  beforeAll(async () => {
    const provider: LlmProvider = {
      name: 'fake',
      async generate() {
        const next = queue.shift();
        if (!next || next instanceof Error) throw new LlmError('boom', []);
        return { text: JSON.stringify(next), model: 'fake', usage: {}, attempts: [] };
      },
    };
    server = createApp({ gm: createGameMaster(provider, () => {}), hasKey: () => true, defaultMode: () => 'flash' }).listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('/interpret devolve intenção + meta', async () => {
    queue.push({ intent: { type: 'attack', summary: 'atirar no capanga' }, toolCalls: [{ tool: 'attack', args: { targetId: 'foe_a' } }] });
    const res = await post('/api/gm/interpret', { context: context(), text: 'Atiro no capanga' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payload.toolCalls[0].tool).toBe('attack');
    expect(body.meta).toMatchObject({ purpose: 'interpret', promptVersion: expect.any(String), toolsCalled: ['attack'] });
  });

  it('/narrate valida o corpo', async () => {
    const res = await post('/api/gm/narrate', { context: { id: 1 }, kind: 'action', engineResult: null });
    expect(res.status).toBe(400);
  });

  it('/status informa a versão do prompt', async () => {
    const res = await fetch(`${base}/api/gm/status`);
    expect(await res.json()).toMatchObject({ status: 'ok', promptVersion: expect.stringMatching(/^nl-/) });
  });
});

describe('resiliência do provedor', () => {
  it('schema simplificado: args com dezenas de campos vira objeto livre (modelos com limite de complexidade)', async () => {
    const { simplifySchema } = await import('./gamemaster/llmClient');
    const simple = simplifySchema(NARRATE_SCHEMA) as { properties: { toolCalls: { items: { properties: { args: object } } } } };
    expect(simple.properties.toolCalls.items.properties.args).toEqual({ type: 'object', additionalProperties: true, description: expect.any(String) });
    expect(simplifySchema({ type: 'object', properties: { a: { type: 'string' } } })).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
  });
});

describe('gíria de Night City', () => {
  it('narrador e telefone recebem o glossário (e o intérprete não, para não gastar tokens)', async () => {
    const { NARRATOR_PROMPT, PHONE_PROMPT, INTERPRETER_PROMPT } = await import('./gamemaster/systemPrompt');
    for (const p of [NARRATOR_PROMPT, PHONE_PROMPT]) {
      expect(p).toMatch(/GÍRIA DE NIGHT CITY/);
      expect(p).toMatch(/Gonk = idiota/);
      expect(p).toMatch(/Giri = dívida de honra/);
    }
    expect(INTERPRETER_PROMPT).not.toMatch(/GÍRIA DE NIGHT CITY/);
  });
});

describe('chave do próprio jogador', () => {
  it('a chave enviada vale só dentro do pedido e tem prioridade sobre a do .env', async () => {
    const { runWithKey, sanitizeKey } = await import('./gamemaster/requestKey');
    const { getApiKey } = await import('./gamemaster/llmClient');
    const key = 'AIzaTesteDoJogador_1234567890';
    expect(runWithKey(sanitizeKey(key), () => getApiKey())).toBe(key);
    expect(sanitizeKey('lixo com espaço')).toBeUndefined();
    expect(getApiKey()).not.toBe(key);
  });

  it('/status informa que há chave quando o jogador manda a dele', async () => {
    const app = createApp({ gm: createGameMaster(fakeProvider([]).provider, () => {}), hasKey: () => false, defaultMode: () => 'flash' }).listen(0);
    const port = (app.address() as { port: number }).port;
    const without = await (await fetch(`http://127.0.0.1:${port}/api/gm/status`)).json();
    const withKey = await (await fetch(`http://127.0.0.1:${port}/api/gm/status`, { headers: { 'x-gemini-key': 'AIzaTesteDoJogador_1234567890' } })).json();
    app.close();
    expect(without.hasKey).toBe(false);
    expect(withKey.hasKey).toBe(true);
  });

  it('Sandbox só com a flag de debug: /status informa e, sem ela, o contexto perde o modo Sandbox', async () => {
    const prompts: string[] = [];
    const provider: LlmProvider = {
      name: 'fake',
      async generate(req) {
        prompts.push(req.prompt);
        return { text: JSON.stringify({ intent: { type: 'other', summary: 'x', confidence: 1 }, toolCalls: [] }), model: 'fake-1', usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, attempts: [{ model: 'fake-1', ok: true, latencyMs: 1 }] };
      },
    };
    for (const on of [false, true]) {
      prompts.length = 0;
      const app = createApp({ gm: createGameMaster(provider, () => {}), hasKey: () => true, defaultMode: () => 'flash', debug: () => on }).listen(0);
      const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
      const status = await (await fetch(`${base}/api/gm/status`)).json();
      await fetch(`${base}/api/gm/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { ...context(), sandbox: true }, text: 'gera 3 gangers' }) });
      app.close();
      expect(status.debug).toBe(on);
      expect(prompts.some(p => /MODO SANDBOX/.test(p))).toBe(on);
    }
  });

  it('chave malformada no cabeçalho é recusada (não cai em silêncio na chave do servidor) — API-5', async () => {
    const app = createApp({ gm: createGameMaster(fakeProvider([]).provider, () => {}), hasKey: () => true, defaultMode: () => 'flash' }).listen(0);
    const port = (app.address() as { port: number }).port;
    const bad = await fetch(`http://127.0.0.1:${port}/api/gm/status`, { headers: { 'x-gemini-key': 'curta demais' } });
    app.close();
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Chave Gemini inválida/);
  });

  it('método errado → 405 com Allow; OPTIONS → 204; turnos negativos no /summarize → 400 — API-8', async () => {
    const app = createApp({ gm: createGameMaster(fakeProvider([]).provider, () => {}), hasKey: () => true, defaultMode: () => 'flash' }).listen(0);
    const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
    const wrong = await fetch(`${base}/api/gm/narrate`);
    const options = await fetch(`${base}/api/gm/narrate`, { method: 'OPTIONS' });
    const missing = await fetch(`${base}/api/gm/nada`);
    const summarize = await fetch(`${base}/api/gm/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', turnId: 't', fromTurn: -3, toTurn: 1.5, transcript: 'x' }),
    });
    app.close();
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toMatch(/POST/);
    expect(options.status).toBe(204);
    expect(missing.status).toBe(404);
    expect(summarize.status).toBe(400);
  });

  it('contexto sem roleData é recusado na validação (antes quebrava no prompt) — API-6', async () => {
    const ctx = context() as unknown as { character: Record<string, unknown> };
    delete ctx.character.roleData;
    const app = createApp({ gm: createGameMaster(fakeProvider([]).provider, () => {}), hasKey: () => true, defaultMode: () => 'flash' }).listen(0);
    const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
    const res = await fetch(`${base}/api/gm/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, text: 'atiro' }) });
    app.close();
    expect(res.status).toBe(400);
  });
});

describe('Filtro de conteúdo: nova tentativa com contexto reduzido', () => {
  it('prompt completo bloqueado → repete com o contexto mínimo e narra (sem modo degradado)', async () => {
    const prompts: string[] = [];
    const provider: LlmProvider = {
      name: 'fake',
      async generate(req) {
        prompts.push(req.prompt);
        // Bloqueia enquanto houver a seção das tramas do mundo (o contexto completo).
        if (req.prompt.includes('# NA CIDADE') && /\[front_/.test(req.prompt)) throw new LlmError('blocked PROHIBITED_CONTENT', [{ model: 'fake-1', ok: false, latencyMs: 1, error: 'blocked PROHIBITED_CONTENT' }], 'blocked');
        return { text: JSON.stringify({ narration: 'A garoa cai.', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [] }), model: 'fake-1', usage: {}, attempts: [{ model: 'fake-1', ok: true, latencyMs: 1 }] };
      },
    };
    const sc = scenario();
    sc.state = generateFronts(sc.state, { seed: 'x' });
    const env = await createGameMaster(provider, () => {}).narrate(sc.context('olho'), { kind: 'action', playerInput: 'olho', engineResult: null }, 'flash');
    expect(env.meta.degraded).toBe(false);
    expect(env.payload.narration).toBe('A garoa cai.');
    expect(prompts).toHaveLength(2);
    expect(env.meta.errors.some(e => /contexto reduzido/.test(e))).toBe(true);
    expect(env.meta.attempts.map(a => a.ok)).toEqual([false, true]);
  });

  it('bloqueado mesmo enxuto → modo degradado dizendo que foi o filtro', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      async generate() {
        throw new LlmError('blocked PROHIBITED_CONTENT', [{ model: 'fake-1', ok: false, latencyMs: 1, error: 'blocked' }], 'blocked');
      },
    };
    const env = await createGameMaster(provider, () => {}).narrate(scenario().context('olho'), { kind: 'action', playerInput: 'olho', engineResult: null }, 'flash');
    expect(env.meta).toMatchObject({ degraded: true, failureKind: 'blocked' });
  });
});
