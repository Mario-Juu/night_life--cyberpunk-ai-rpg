// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GmEnvelope, InterpretResponse, NarrateResponse, PhoneResponse } from '@shared/types/gm';
import type { LlmRunMeta, TurnRecord } from '@shared/types/turn';
import type { GameState } from '@shared/types/game';
import { buildCharacter, STAT_PRESETS } from '@shared/rules/creation';

vi.mock('../services/audio', () => ({ sound: new Proxy({}, { get: () => () => undefined }) }));

const calls: string[] = [];
const narrateInputs: unknown[] = [];
let interpretReply: InterpretResponse | null = null;
const interpretQueue: InterpretResponse[] = [];
const feedbacks: Array<string | undefined> = [];
let narrateReply: NarrateResponse | null = null;
/** Envelopes de narração enfileirados (para simular o Flash falhando). */
const narrateEnvQueue: Array<GmEnvelope<NarrateResponse>> = [];
let hold: (() => void) | null = null;

const meta = (purpose: LlmRunMeta['purpose']): LlmRunMeta => ({
  requestId: `req_${calls.length}`, sessionId: 's', turnId: 't', purpose, provider: 'fake', model: 'fake', promptVersion: 'test',
  latencyMs: 1, attempts: [], toolsCalled: [], retrievedMemories: [], errors: [], degraded: false, createdAt: new Date().toISOString(),
});
const env = <T,>(payload: T, purpose: LlmRunMeta['purpose']): GmEnvelope<T> => ({ payload, meta: meta(purpose) });
const narration = (over: Partial<NarrateResponse> = {}): NarrateResponse => ({ narration: 'Narração.', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: ['a'], enemyActions: [], ...over });

/** Falhas de rede/hospedagem enfileiradas para a narração (ex.: 502 da Netlify). */
const narrateThrowQueue: Error[] = [];

vi.mock('../services/api', () => ({
  isGatewayCut: (e: unknown) => [502, 503, 504].includes((e as { status?: number })?.status ?? 0),
  fetchStatus: async () => ({ status: 'ok', hasKey: true, defaultMode: 'flash', promptVersion: 'test' }),
  api: {
    interpret: vi.fn(async (_ctx: unknown, _text: string, _model: unknown, feedback?: string) => {
      calls.push('interpret');
      feedbacks.push(feedback);
      if (hold) await new Promise<void>(r => (hold = r));
      return env(interpretQueue.shift() ?? interpretReply!, 'interpret');
    }),
    narrate: vi.fn(async (_ctx, input) => {
      calls.push(`narrate:${input.kind}`);
      narrateInputs.push(input);
      const boom = narrateThrowQueue.shift();
      if (boom) throw boom;
      const queued = narrateEnvQueue.shift();
      if (queued) return queued;
      return env(narrateReply ?? narration(), input.kind === 'prologue' ? 'prologue' : 'narrate');
    }),
    phone: vi.fn(async () => {
      calls.push('phone');
      const reply: PhoneResponse = { replyText: 'Fechado.', suggestedReplies: [], toolCalls: [{ tool: 'modify_relationship', args: { npcId: 'npc_rafa', trust: 3 } }] };
      return env(reply, 'phone');
    }),
    summarize: vi.fn(async () => env({ summary: 'resumo' }, 'summarize')),
  },
}));

const { startCampaign, sendAction, rollPending, sendPhoneMessage, regenerateNarration, recoverInterruptedTurn, reload, consumeItem } = await import('./turnController');
const { useGameStore } = await import('./gameStore');
const { getRepository, setRepository, createMemoryRepository } = await import('../services/repository');

const character = () =>
  buildCharacter({
    name: 'Ren', handle: 'Sparks', age: 22, role: 'solo', occupation: 'x', district: 'WATSON',
    familyTie: '', debtReason: '', personalAnchor: '', appearance: '',
    stats: { ...STAT_PRESETS[0].stats }, starterWeaponId: 'pistol',
  });

beforeEach(() => {
  calls.length = 0;
  narrateInputs.length = 0;
  interpretReply = null;
  interpretQueue.length = 0;
  feedbacks.length = 0;
  narrateReply = null;
  narrateEnvQueue.length = 0;
  narrateThrowQueue.length = 0;
  hold = null;
  setRepository(createMemoryRepository());
});

describe('pipeline do turno', () => {
  it('intérprete → motor → rolagem com seed → narrador → turno registrado', async () => {
    await startCampaign(character());
    expect(useGameStore.getState().game?.turn).toBe(1);

    interpretReply = { intent: { type: 'social', summary: 'convencer o segurança', confidence: 0.9 }, framing: 'Ele cruza os braços.', toolCalls: [{ tool: 'persuade', args: { dv: 13, reason: 'Lábia no segurança' } }] };
    await sendAction('Tento convencer o segurança');
    let game = useGameStore.getState().game!;
    expect(game.turn).toBe(2);
    expect(game.pendingRoll).toMatchObject({ skillId: 'persuasion', dv: 13, origin: 'gm' });
    expect(useGameStore.getState().activeTurn?.phase).toBe('awaiting_roll');
    expect(calls).toEqual(['narrate:prologue', 'interpret']);

    narrateReply = narration({ narration: 'Ele cede.', toolCalls: [{ tool: 'modify_heat', args: { delta: 1 } }] });
    // Enquanto o narrador trabalha, os painéis mostram o estado de antes do dado.
    const { useUiStore } = await import('./uiStore');
    const concealedDuringNarration: boolean[] = [];
    const unsub = useUiStore.subscribe(s => concealedDuringNarration.push(s.concealedGame !== null));
    const outcome = await rollPending(0);
    unsub();
    expect(concealedDuringNarration).toContain(true);
    expect(useUiStore.getState().concealedGame).toBeNull();
    game = useGameStore.getState().game!;
    expect(outcome?.check.dv).toBe(13);
    expect(game.pendingRoll).toBeNull();
    expect(game.world.heat).toBe(1);
    expect(calls).toEqual(['narrate:prologue', 'interpret', 'narrate:action']);
    expect((narrateInputs[1] as { engineResult: { roll: unknown } }).engineResult.roll).toBeTruthy();

    const turns = await getRepository().listTurns(game.id);
    const t2 = turns.find(t => t.turn === 2)!;
    expect(t2).toMatchObject({ phase: 'complete', playerInput: 'Tento convencer o segurança', parsedIntent: { type: 'social' } });
    expect(t2.toolCalls.map(t => `${t.origin}:${t.tool}:${t.ok}`)).toEqual(['interpreter:persuade:true', 'narrator:modify_heat:true']);
    expect(t2.diceRolls[0]).toMatchObject({ dice: expect.stringMatching(/^[12]d10$/), seed: expect.any(String) });
    expect(t2.checks[0]).toMatchObject({ check: 'PERSUASION', difficulty: 13 });
    expect(t2.llmRuns.map(r => r.purpose)).toEqual(['interpret', 'narrate']);
    expect(t2.events.some(e => e.type === 'HEAT_CHANGED')).toBe(true);
    expect(t2.stateVersionAfter).toBeGreaterThan(t2.stateVersionBefore);
  });

  it('ação sem risco vai direto ao narrador; pedido ambíguo só pergunta', async () => {
    await startCampaign(character());
    interpretReply = { intent: { type: 'observe', summary: 'olhar', confidence: 1 }, toolCalls: [] };
    await sendAction('Olho pela janela');
    expect(calls).toEqual(['narrate:prologue', 'interpret', 'narrate:action']);

    interpretReply = { intent: { type: 'other', summary: '?', confidence: 0.2 }, clarification: 'Atirar em quem, choom?', toolCalls: [] };
    await sendAction('Atiro');
    expect(calls.at(-1)).toBe('interpret');
    expect(useGameStore.getState().game!.chat.at(-1)?.text).toBe('Atirar em quem, choom?');
  });

  it('arma sem munição: nenhum disparo, munição continua 0 e o narrador recebe a recusa', async () => {
    await startCampaign(character());
    const g = useGameStore.getState().game!;
    useGameStore.getState().setGame({ ...g, character: { ...g.character, inventory: g.character.inventory.map(i => (i.weapon ? { ...i, weapon: { ...i.weapon, loaded: 0 } } : i)) } });
    interpretReply = { intent: { type: 'attack', summary: 'atirar', confidence: 1 }, toolCalls: [{ tool: 'attack', args: { targetName: 'Segurança' } }] };
    await sendAction('Atiro no segurança');
    const game = useGameStore.getState().game!;
    expect(game.pendingRoll).toBeNull();
    expect(game.character.inventory.find(i => i.weapon)?.weapon?.loaded).toBe(0);
    const input = narrateInputs.at(-1) as { engineResult: { tools: Array<{ ok: boolean; summary: string }> } };
    expect(input.engineResult.tools[0]).toMatchObject({ ok: false, summary: expect.stringMatching(/descarregada/) });
  });

  it('telefone e narrativa são serializados; relação via ferramenta persiste', async () => {
    await startCampaign(character());
    interpretReply = { intent: { type: 'observe', summary: 'olhar', confidence: 1 }, toolCalls: [] };
    hold = () => undefined;
    const action = sendAction('Olho em volta');
    const phone = sendPhoneMessage('npc_rafa', 'Topo o corre');
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual(['narrate:prologue', 'interpret']);
    hold!();
    await Promise.all([action, phone]);
    expect(calls).toEqual(['narrate:prologue', 'interpret', 'narrate:action', 'phone']);
    const game = useGameStore.getState().game!;
    expect(game.npcs.find(n => n.id === 'npc_rafa')?.trust).toBe(13);
  });

  it('chamada mal formada volta ao intérprete com o erro e o pagamento acontece', async () => {
    await startCampaign(character());
    const money = useGameStore.getState().game!.character.money;
    interpretQueue.push(
      { intent: { type: 'trade', summary: 'pagar', confidence: 1 }, toolCalls: [{ tool: 'pay_money', args: { recipient: 'Síndico', combatantId: 'm_rent' } }] },
      { intent: { type: 'trade', summary: 'pagar', confidence: 1 }, toolCalls: [{ tool: 'pay_money', args: { amount: 300, recipient: 'Síndico', questId: 'm_rent' } }] },
    );
    await sendAction('Transfiro €$300 para o síndico');
    expect(calls).toEqual(['narrate:prologue', 'interpret', 'interpret', 'narrate:action']);
    expect(feedbacks[1]).toMatch(/pay_money: argumento "amount"/);
    expect(useGameStore.getState().game!.character.money).toBe(money - 300);
    const input = narrateInputs.at(-1) as { engineResult: { tools: Array<{ tool: string; ok: boolean }> } };
    expect(input.engineResult.tools).toEqual([expect.objectContaining({ tool: 'pay_money', ok: true })]);
  });

  it('regenerar narração mantém a mesma mecânica', async () => {
    await startCampaign(character());
    interpretReply = { intent: { type: 'observe', summary: 'olhar', confidence: 1 }, toolCalls: [{ tool: 'move_location', args: { spot: 'Telhado', minutes: 10 } }] };
    narrateReply = narration({ narration: 'Primeira versão.' });
    await sendAction('Subo ao telhado');
    const before = useGameStore.getState().game!;
    narrateReply = narration({ narration: 'Segunda versão.' });
    await regenerateNarration();
    const after = useGameStore.getState().game!;
    expect(after.chat.filter(e => e.kind === 'narration').map(e => e.text)).toEqual(['Narração.', 'Segunda versão.']);
    expect(after.world.location.spot).toBe('Telhado');
    expect(after.world.time).toBe(before.world.time);
    expect(after.turn).toBe(before.turn);
  });
});

const { useUiStore } = await import('./uiStore');

describe('Flash indisponível: o jogador escolhe antes do Flash-Lite', () => {
  const flashDown = (): GmEnvelope<NarrateResponse> => ({
    payload: narration({ narration: '⚠ O sinal com o Mestre caiu.', degraded: true }),
    meta: { ...meta('prologue'), degraded: true, failureKind: 'overloaded', liteOffered: true, waitMayHelp: true },
  });
  const waitForChoice = async () => {
    for (let i = 0; i < 200 && !useUiStore.getState().liteChoice; i++) await new Promise(r => setTimeout(r, 5));
    return useUiStore.getState().liteChoice!;
  };

  it('pergunta; "seguir com o Lite" pede a narração de novo com allowLite', async () => {
    useUiStore.setState({ liteNarration: 'ask', liteChoice: null });
    narrateEnvQueue.push(flashDown());
    const done = startCampaign(character());
    const choice = await waitForChoice();
    expect(choice.waitMayHelp).toBe(true);
    expect((narrateInputs[0] as { allowLite?: boolean }).allowLite).toBe(false);
    choice.resolve('lite');
    await done;
    expect((narrateInputs[1] as { allowLite?: boolean }).allowLite).toBe(true);
    expect(useGameStore.getState().game!.chat.some(e => e.kind === 'narration' && e.text === 'Narração.')).toBe(true);
    expect(useUiStore.getState().liteChoice).toBeNull();
  });

  it('"sempre usar o Lite" vira preferência: a próxima narração já vai com allowLite, sem perguntar', async () => {
    useUiStore.setState({ liteNarration: 'ask', liteChoice: null });
    narrateEnvQueue.push(flashDown());
    const done = startCampaign(character());
    (await waitForChoice()).resolve('always');
    await done;
    expect(useUiStore.getState().liteNarration).toBe('allow');
    narrateInputs.length = 0;
    await startCampaign(character());
    expect((narrateInputs[0] as { allowLite?: boolean }).allowLite).toBe(true);
    useUiStore.setState({ liteNarration: 'ask' });
  });

  it('fechar a pergunta mantém o aviso de modo degradado (nada é narrado pelo Lite)', async () => {
    useUiStore.setState({ liteNarration: 'ask', liteChoice: null });
    narrateEnvQueue.push(flashDown());
    const done = startCampaign(character());
    (await waitForChoice()).resolve('cancel');
    await done;
    expect(narrateInputs).toHaveLength(1);
    expect(useGameStore.getState().game!.chat.some(e => e.kind === 'narration' && /sinal com o Mestre caiu/.test(e.text))).toBe(true);
  });
});

describe('Hospedagem cortou a resposta (502)', () => {
  it('um 502 na narração: tenta de novo sozinho e o turno termina narrado', async () => {
    narrateThrowQueue.push(Object.assign(new Error('A hospedagem cortou a resposta do Mestre'), { status: 502 }));
    await startCampaign(character());
    expect(calls.filter(c => c.startsWith('narrate'))).toHaveLength(2);
    expect(useGameStore.getState().game!.chat.some(e => e.kind === 'narration' && e.text === 'Narração.')).toBe(true);
  }, 15_000);

  it('dois 502 seguidos: desiste com a mensagem clara (sem loop)', async () => {
    for (let i = 0; i < 2; i++) narrateThrowQueue.push(Object.assign(new Error('A hospedagem cortou a resposta do Mestre'), { status: 502 }));
    await startCampaign(character());
    expect(calls.filter(c => c.startsWith('narrate'))).toHaveLength(2);
    expect(useGameStore.getState().game!.chat.some(e => /cortou a resposta/.test(e.text))).toBe(true);
  }, 15_000);
});

describe('Página recarregada no meio do turno (UI-3)', () => {
  it('narrando: fecha o turno, avisa e a narração pode ser pedida de novo', async () => {
    await startCampaign(character());
    interpretReply = { intent: { type: 'other', summary: 'olhar', confidence: 0.9 }, toolCalls: [] };
    await sendAction('Olho em volta');
    const game = useGameStore.getState().game!;
    const done = (await getRepository().listTurns(game.id, game.session.branchId)).find(t => t.turn === game.turn && t.postEngineSnapshotId)!;
    // O que sobra no localStorage quando a página recarrega no meio da narração.
    useGameStore.getState().setActiveTurn({ ...done, phase: 'narrating', narration: null });
    await recoverInterruptedTurn();
    expect(useGameStore.getState().activeTurn).toBeNull();
    expect(useGameStore.getState().game!.chat.at(-1)?.text).toMatch(/peça a narração de novo/);
    calls.length = 0;
    await regenerateNarration();
    expect(calls).toEqual(['narrate:action']);
  });

  it('interpretando: fecha como falho e pede para reenviar; rolagem pendente fica como está', async () => {
    await startCampaign(character());
    const game = useGameStore.getState().game!;
    const base = { turnId: 't', gameId: game.id, branchId: game.session.branchId, turn: game.turn, kind: 'action', startedAt: '', playerInput: 'x', parsedIntent: null, toolCalls: [], diceRolls: [] } as unknown as TurnRecord;
    useGameStore.getState().setActiveTurn({ ...base, phase: 'awaiting_roll' });
    await recoverInterruptedTurn();
    expect(useGameStore.getState().activeTurn?.phase).toBe('awaiting_roll');
    useGameStore.getState().setActiveTurn({ ...base, phase: 'interpreting' });
    await recoverInterruptedTurn();
    expect(useGameStore.getState().activeTurn).toBeNull();
    expect(useGameStore.getState().game!.chat.at(-1)?.text).toMatch(/envie de novo/);
  });
});

describe('Botões da aba Equipamento gastam a vez em combate', () => {
  const inCombat = async () => {
    await startCampaign(character());
    const g = useGameStore.getState().game!;
    const gun = g.character.inventory.find(i => i.weapon?.magSize)!;
    const ammo = { id: 'item_ammo', name: 'Munição', category: 'ammo' as const, quantity: 30, description: '', equipped: false, value: 0, ammoKind: gun.weapon!.ammo ?? undefined };
    const medkit = { id: 'item_kit', name: 'Kit', category: 'consumable' as const, quantity: 2, description: '', equipped: false, value: 0, heal: 6 };
    const foe = { id: 'foe_a', name: 'Capanga', hp: { current: 20, max: 20 }, sp: { head: 0, body: 0 }, weapon: { name: 'Pistola', weaponClass: 'pistol_medium', damage: '2d6', quality: 'standard' }, attackBase: 10, evasionBase: 10, ref: 5, initiative: null, distance: '0-6m', cover: 'none', status: 'active' } as unknown as GameState['combat']['combatants'][number];
    useGameStore.getState().setGame({
      ...g,
      character: {
        ...g.character,
        hp: { ...g.character.hp, current: 5 },
        inventory: [...g.character.inventory.map(i => (i.id === gun.id ? { ...i, weapon: { ...i.weapon!, loaded: 0 } } : i)), ammo, medkit],
      },
      combat: { active: true, round: 1, playerInitiative: null, combatants: [foe], log: [] },
    });
    calls.length = 0;
    return gun.id;
  };

  it('recarregar e usar item abrem um turno (inimigos agem, Mestre narra)', async () => {
    const gunId = await inCombat();
    const turn = useGameStore.getState().game!.turn;
    reload(gunId);
    await vi.waitFor(() => expect(calls).toEqual(['narrate:action']));
    await vi.waitFor(() => expect(useGameStore.getState().activeTurn).toBeNull());
    expect(useGameStore.getState().game!.turn).toBe(turn + 1);
    consumeItem('item_kit');
    await vi.waitFor(() => expect(useGameStore.getState().game!.turn).toBe(turn + 2));
    await vi.waitFor(() => expect(useGameStore.getState().activeTurn).toBeNull());
    expect(useGameStore.getState().game!.character.inventory.find(i => i.id === 'item_kit')?.quantity).toBe(1);
  });

  it('fora de combate continuam instantâneos (sem turno)', async () => {
    const gunId = await inCombat();
    const g = useGameStore.getState().game!;
    useGameStore.getState().setGame({ ...g, combat: { ...g.combat, active: false, combatants: [] } });
    const turn = useGameStore.getState().game!.turn;
    reload(gunId);
    consumeItem('item_kit');
    expect(useGameStore.getState().game!.turn).toBe(turn);
    expect(calls).toEqual([]);
  });
});
