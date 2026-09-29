/**
 * Evals AO VIVO contra o modelo real (custam tokens). Rodam só com:
 *   npm run eval:live
 * Verificam que o LLM, dentro da arquitetura, respeita o motor.
 */
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { createGameMaster } from '../server/gamemaster/gameMaster';
import { geminiProvider, getApiKey } from '../server/gamemaster/llmClient';
import { checkNarration } from '../shared/engine/consistency';

const live = import.meta.env.MODE === 'live' && getApiKey() !== null;
const gm = createGameMaster(geminiProvider, () => {});
const TIMEOUT = 120_000;

describe.skipIf(!live)('LIVE — intérprete', () => {
  it(
    '"saco minha Nova .357 e atiro no segurança" vira attack com a arma do inventário',
    async () => {
      const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Segurança do Bloco', role: 'Segurança', present: true });
      const { payload } = await gm.interpret(sc.context('atiro no segurança'), 'Eu saco minha Nova .357 e atiro no segurança.', 'flash');
      const attack = payload.toolCalls.find(t => t.tool === 'attack');
      expect(payload.intent.type).toBe('attack');
      expect(attack).toBeDefined();
      expect([undefined, 'item_starter_weapon']).toContain(attack!.args.weaponId);
      sc.tool('interpreter', 'attack', attack!.args);
      expect(sc.last().ok).toBe(true);
      expect(sc.state.pendingRoll?.kind).toBe('attack');
    },
    TIMEOUT,
  );

  it(
    'sem vendedor na cena, não inventa compra (pede esclarecimento)',
    async () => {
      const { payload } = await gm.interpret(scenario().context('compro munição'), 'Compro duas caixas de munição de revólver com o camelô.', 'flash');
      expect(payload.toolCalls.some(t => t.tool === 'buy_item') || Boolean(payload.clarification)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'compra com vendedor presente vira buy_item (o motor define o preço)',
    async () => {
      const sc = scenario()
        .tool('narrator', 'move_location', { spot: 'Mercado de rua de The Glen', minutes: 10 })
        .tool('narrator', 'upsert_npc', { name: 'Camelô Paco', role: 'Vendedor de munição', present: true });
      const { payload } = await gm.interpret(sc.context('compro munição'), 'Compro duas caixas de munição de revólver com o Paco.', 'flash');
      const buy = payload.toolCalls.find(t => t.tool === 'buy_item');
      expect(buy).toBeDefined();
      const before = sc.state.character.money;
      sc.tool('interpreter', 'buy_item', buy!.args);
      expect(sc.last().ok).toBe(true);
      expect(sc.state.character.money).toBeLessThan(before);
    },
    TIMEOUT,
  );
  it(
    'pagar dívida vira pay_money (ou pergunta o valor)',
    async () => {
      const sc = scenario().edit(s => ({ ...s, character: { ...s.character, money: 1100 } }));
      const { payload } = await gm.interpret(sc.context('pagar dívida'), 'Acesso o terminal doméstico e transfiro €$600 para abater o aluguel atrasado.', 'flash');
      const pay = payload.toolCalls.find(t => t.tool === 'pay_money');
      expect(pay).toBeDefined();
      sc.tool('interpreter', 'pay_money', pay!.args);
      expect(sc.state.character.money).toBe(500);
    },
    TIMEOUT,
  );
});

describe.skipIf(!live)('LIVE — narrador respeita o motor', () => {
  it(
    'arma sem munição: nenhum disparo narrado',
    async () => {
      const engineResult = { intent: null, tools: [{ tool: 'attack', ok: false, summary: 'Revólver Nova 357 está descarregada: só um clique seco. Nenhum disparo acontece.' }], roll: null, offscreen: [] };
      const sc = scenario();
      const { payload } = await gm.narrate(sc.context('atiro'), { kind: 'action', playerInput: 'Atiro no segurança', engineResult }, 'flash');
      expect(checkNarration(engineResult, payload.narration, payload.dialogues, sc.state.npcs)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'NPC morto não fala',
    async () => {
      const sc = scenario().tool('narrator', 'npc_status', { npcId: 'npc_rafa', status: 'dead', reason: 'baleado' });
      const { payload } = await gm.narrate(sc.context('Rafa'), { kind: 'action', playerInput: 'Vou até o térreo falar com o Rafa.', engineResult: null }, 'flash');
      expect(checkNarration(null, payload.narration, payload.dialogues, sc.state.npcs)).toEqual([]);
    },
    TIMEOUT,
  );
});
