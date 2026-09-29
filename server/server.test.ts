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
    expect(prompt).toContain('SEGREDOS (o jogador NÃO sabe)');
  });

  it('narrador recebe o resultado do motor como verdade absoluta', () => {
    const prompt = buildNarratePrompt(context(), { kind: 'action', playerInput: 'atiro', engineResult: { intent: null, tools: [{ tool: 'attack', ok: false, summary: 'Pistola está descarregada: só um clique seco.' }], roll: null, offscreen: ['Rafa vendeu o chip'] } }, false);
    expect(prompt).toContain('RESULTADO DO MOTOR — VERDADE ABSOLUTA');
    expect(prompt).toContain('✗ attack: Pistola está descarregada');
    expect(prompt).toContain('ACONTECEU FORA DE CENA');
  });

  it('schemas são JSON Schema padrão com as ferramentas do registro', () => {
    const tools = (INTERPRET_SCHEMA.properties.toolCalls as { items: { properties: { tool: { enum: string[] } } } }).items.properties.tool.enum;
    expect(tools).toContain('attack');
    expect(tools).not.toContain('transfer_money');
    const narr = (NARRATE_SCHEMA.properties.toolCalls as { items: { properties: { tool: { enum: string[] } } } }).items.properties.tool.enum;
    expect(narr).toContain('transfer_money');
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
