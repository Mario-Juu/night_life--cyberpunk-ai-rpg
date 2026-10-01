/**
 * Evals AO VIVO contra o modelo real (custam tokens). Rodam só com:
 *   npm run eval:live
 * Verificam que o LLM, dentro da arquitetura, respeita o motor.
 */
import 'dotenv/config';
import { beforeEach, describe, expect, it } from 'vitest';
import { scenario, withRipperdoc } from './harness';
import { createGameMaster, type GameMaster } from '../server/gamemaster/gameMaster';
import { dailyQuotaExhausted, geminiProvider, getApiKey } from '../server/gamemaster/llmClient';
import { checkNarration } from '../shared/engine/consistency';
import { applyWorldgen, buildWorldgenRequest, generateFronts } from '../shared/engine/fronts';
import { applyGeneratedProfile, buildProfileRequest, syncImportance } from '../shared/engine/npcProfile';
import { appendChat } from '../shared/engine/reducer';

// Testes usam a chave gratuita (TEST_API_KEY) e a mesma cadeia do jogo: flash 3.8 → 3.7 → … → flash-lite.
if (process.env.TEST_API_KEY?.trim()) {
  process.env.CUSTOM_GEMINI_API_KEY = process.env.TEST_API_KEY.trim();
  process.env.GM_BUDGET_MS ??= '280000'; // o teste espera; o jogo usa 110 s
  process.env.GM_RETRIES ??= '3'; // plano gratuito: 503/429 frequentes — esperar em vez de falhar
}

const live = import.meta.env.MODE === 'live' && getApiKey() !== null;
const TIMEOUT = 300_000;

/**
 * O Mestre degradado não é o que estes testes medem: em vez de asserts confusos, falha dizendo a causa
 * (cota, sobrecarga…). E, se a cota DIÁRIA da chave acabou em todos os modelos, os testes seguintes são pulados.
 */
function strict(inner: GameMaster): GameMaster {
  const check = <T extends { meta: { degraded: boolean; failureKind?: string; errors: string[] } }>(env: T): T => {
    if (env.meta.degraded) throw new Error(`Mestre degradado (${env.meta.failureKind ?? '?'}): ${env.meta.errors.join(' | ').slice(0, 300)}`);
    return env;
  };
  return {
    interpret: async (...a) => check(await inner.interpret(...a)),
    narrate: async (...a) => check(await inner.narrate(...a)),
    phone: async (...a) => check(await inner.phone(...a)),
    summarize: async (...a) => check(await inner.summarize(...a)),
    profile: async (...a) => check(await inner.profile(...a)),
    worldgen: async (...a) => check(await inner.worldgen(...a)),
  };
}
const gm = strict(createGameMaster(geminiProvider, () => {}));

beforeEach(t => {
  const key = getApiKey();
  if (live && key && dailyQuotaExhausted(key)) t.skip('cota diária gratuita esgotada em todos os modelos — rode de novo depois da meia-noite do Pacífico');
});

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
    'Trilheiro: "me conecto e mapeio" vira jack_in + net_action pathfinder',
    async () => {
      const sc = scenario({ role: 'netrunner' }).tool('narrator', 'net_architecture', { name: 'Servidor do galpão', difficulty: 'basic', floors: 5, files: 'Lista de compradores' });
      const text = 'Plugo o deck no terminal, me conecto na rede e uso o Pathfinder pra mapear os andares.';
      const { payload } = await gm.interpret(sc.context(text), text, 'flash');
      const tools = payload.toolCalls.map(t => `${t.tool}${t.args.action ? `:${t.args.action}` : ''}`);
      expect(tools).toContain('jack_in');
      expect(tools).toContain('net_action:pathfinder');
    },
    TIMEOUT,
  );

  it(
    'briga: "agarro o ganger pelo pescoço" vira grapple grab no combatente existente',
    async () => {
      const sc = scenario().tool('narrator', 'start_combat', { combatants: [{ name: 'Ganger da Maelstrom', template: 'maelstrom_ganger', distance: 'melee' }] });
      const text = 'Agarro o ganger da Maelstrom pelo pescoço e prendo ele contra a parede.';
      const { payload } = await gm.interpret(sc.context(text), text, 'flash');
      const grab = payload.toolCalls.find(t => t.tool === 'grapple');
      expect(grab?.args.action).toBe('grab');
      sc.tool('interpreter', 'grapple', grab!.args, [1, 1, 9]);
      expect(sc.last().ok).toBe(true);
      expect(sc.state.combat.combatants).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'narrador: capangas genéricos entram por ficha pronta (template) e não duplicam no turno seguinte',
    async () => {
      const sc = scenario().tool('narrator', 'move_location', { spot: 'Beco atrás do Totentanz', minutes: 5 });
      const input = 'Viro a esquina e dou de cara com três gangers da Maelstrom armados. Saco a arma.';
      const first = await gm.narrate(sc.context(input), { kind: 'action', playerInput: input, engineResult: null }, 'flash');
      const start = first.payload.toolCalls.filter(t => t.tool === 'start_combat');
      expect(start.length).toBeGreaterThan(0);
      for (const call of start) sc.tool('narrator', 'start_combat', call.args);
      // A ficha pronta tem de ser aplicada (explícita ou reconhecida pelo nome), não números inventados.
      expect(sc.state.combat.combatants.length, `start_combat: ${JSON.stringify(start.map(s => s.args))} → ${sc.last().summary}`).toBeGreaterThan(0);
      expect(sc.state.combat.combatants.every(c => c.template === 'maelstrom_ganger')).toBe(true);
      const count = sc.state.combat.combatants.length;
      const next = 'Me abrigo atrás da caçamba e observo os três.';
      const second = await gm.narrate(sc.context(next), { kind: 'action', playerInput: next, engineResult: null }, 'flash');
      for (const call of second.payload.toolCalls.filter(t => t.tool === 'start_combat')) sc.tool('narrator', 'start_combat', call.args);
      expect(sc.state.combat.combatants.length).toBe(count);
    },
    TIMEOUT,
  );

  it(
    'cromo: "coloco um olho cibernético no ripperdoc" vira install_cyberware cybereye',
    async () => {
      // Desde o cromo de 2077, instalar exige um ripperdoc na cena (aqui, um de bairro).
      const sc = scenario().edit(s => withRipperdoc({ ...s, character: { ...s.character, money: 5000 } }, 2, false));
      const text = 'Vou no ripperdoc do térreo e pago pra instalar um olho cibernético.';
      const { payload } = await gm.interpret(sc.context(text), text, 'flash');
      const install = payload.toolCalls.find(t => t.tool === 'install_cyberware');
      expect(install).toBeDefined();
      sc.tool('interpreter', 'install_cyberware', install!.args);
      expect(sc.last().ok, sc.last().summary).toBe(true);
      expect(sc.state.character.cyberware.some(c => c.key === 'cybereye')).toBe(true);
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

  it(
    'execução: capturado desde o turno anterior, o tiro na cabeça passa pelo motor (execute) — narração e motor concordam',
    async () => {
      const sc = scenario()
        .atTurn(5)
        .tool('narrator', 'upsert_npc', { name: 'Capanga Maelstrom', role: 'Executor da gangue', present: true })
        .tool('narrator', 'set_condition', { target: 'player', condition: 'restrained', source: 'amarrado numa cadeira pela Maelstrom' })
        .edit(s => ({ ...s, world: { ...s.world, situation: 'Capturado pela Maelstrom. O Capanga encosta o cano na sua testa e vai atirar.' } }))
        .atTurn(6);
      const input = 'Fecho os olhos e não reajo. Deixo ele puxar o gatilho.';
      const { payload } = await gm.narrate(sc.context(input), { kind: 'action', playerInput: input, engineResult: null }, 'flash');
      expect(checkNarration(null, payload.narration, payload.dialogues, sc.state.npcs, payload.toolCalls)).toEqual([]);
      const exec = payload.toolCalls.find(t => t.tool === 'execute' && t.args.targetId === 'player');
      if (exec) {
        sc.tool('narrator', 'execute', exec.args);
        expect(sc.last().ok).toBe(true);
        expect(sc.state.character.dead).toBe(true);
      }
    },
    TIMEOUT,
  );
});

describe.skipIf(!live)('LIVE — mundo vivo e NPCs', () => {
  it(
    'costura do mundo: reescreve as frentes mantendo a estrutura (só texto muda)',
    async () => {
      const state = generateFronts(scenario({ debtReason: 'Devo €$9000 ao cassino dos Claws', occupation: 'Entregador noturno', district: 'WESTBROOK' }).state, { seed: 'live' });
      const env = await gm.worldgen(buildWorldgenRequest(state)!);
      const after = applyWorldgen(state, env.payload);
      for (const f of after.fronts!) {
        expect(f.polished).toBe(true);
        console.log(`\n[${f.id}] ${f.title}\n  ${f.premise}\n  reviravolta: ${f.twist}`);
        for (const st of f.stages) console.log(`   · ${st.title} :: ${st.effects.map(e => (e.kind === 'news' ? `[${e.source}] ${e.headline}` : e.kind === 'message' ? `SMS "${e.text}"` : e.kind)).join(' | ')}`);
      }
      const before = state.fronts!.map(f => f.stages.map(st => st.effects.map(e => e.kind)));
      expect(after.fronts!.map(f => f.stages.map(st => st.effects.map(e => e.kind)))).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    'perfil de NPC central: personalidade coerente com a evidência, objetivo e segredo',
    async () => {
      let s = scenario().tool('narrator', 'upsert_npc', { name: 'Kiro', role: 'Químico de rua', description: 'Magro, jaleco manchado, ri de nervoso' }).tool('narrator', 'start_quest', { title: 'Testar o lote dourado', objective: 'Achar quem teste o estimulante', rewardEddies: 4500, giverId: 'Kiro' }).state;
      s = appendChat({ ...s, turn: 3 }, { kind: 'narration', text: '[DIALOGUE: Kiro]\nDroga de estimulante forte, choom. Os meus testadores injetaram e dizem que os reflexos sobem pelas paredes sem fritar o miolo. Se conseguir mais lote desse lixo dourado, me procura de novo.\n[/DIALOGUE]' });
      s = syncImportance(s);
      const env = await gm.profile(buildProfileRequest(s, 'npc_kiro')!);
      const after = applyGeneratedProfile(s, 'npc_kiro', env.payload);
      const kiro = after.npcs.find(n => n.id === 'npc_kiro')!;
      console.log('\nKiro:', JSON.stringify({ profile: kiro.profile, goals: kiro.goals, secret: kiro.knowledge.find(k => k.secret), bonds: kiro.bonds, knowsAboutPlayer: kiro.knowsAboutPlayer }, null, 1));
      expect(kiro.profile?.traits.length).toBeGreaterThanOrEqual(2);
      expect(kiro.goals?.length).toBeGreaterThan(0);
      expect(kiro.knowledge.some(k => k.secret)).toBe(true);
    },
    TIMEOUT,
  );
});
