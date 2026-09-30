/**
 * Pipeline do turno (funções puras):
 *   beginTurn → applyInterpretation → [applyRoll] → buildEngineResult → applyNarration → finalizeTurn
 * Cada etapa devolve o novo estado e o TurnRecord atualizado. Nada aqui chama rede.
 */
import type { GameState, RollOutcome } from '../types/game';
import type { CheckRecord, EngineResult, TurnKind, TurnRecord } from '../types/turn';
import type { InterpretResponse, NarrateResponse, PhoneResponse } from '../types/gm';
import { getSkill } from '../rules/skills';
import { recordingRng, seededRng, toRollRecord, cryptoRng, type Rng } from './dice';
import { emit, eventsOfTurn, turnIdOf } from './events';
import { appendChat, ensureDeathSave, gameReducer } from './reducer';
import { resolveRoll } from './rolls';
import { resolveEnemyAttack } from './combat';
import { REGISTRY, runToolCalls } from './tools';
import { acknowledgeOffscreen, pendingOffscreen } from './world';
import { memoriesFromEvents, pruneMemories, touchMemories } from './memory';
import { applyContactExchange, registerSpeakers, speakersOf } from './npcs';
import { CYBERPSYCHO_ACTIONS, isCyberpsycho } from '../rules/humanity';

export interface Step {
  state: GameState;
  record: TurnRecord;
}

export function beginTurn(state: GameState, input: string | null, kind: TurnKind = 'action'): Step {
  let s: GameState = { ...state, turn: state.turn + 1, suggestedActions: [] };
  if (input) s = appendChat(s, { kind: 'player', text: input });
  const record: TurnRecord = {
    turnId: turnIdOf(s),
    gameId: s.id,
    branchId: s.session.branchId,
    turn: s.turn,
    kind,
    phase: kind === 'prologue' ? 'narrating' : 'interpreting',
    startedAt: new Date().toISOString(),
    playerInput: input,
    parsedIntent: null,
    toolCalls: [],
    diceRolls: [],
    checks: [],
    events: [],
    engineResult: null,
    stateVersionBefore: state.session.version,
    narration: null,
    memoriesCreated: [],
    memoriesRetrieved: [],
    llmRuns: [],
  };
  return { state: s, record };
}

/** Executa as ferramentas pedidas pelo intérprete. Pedido ambíguo → só a pergunta, sem ação. */
export function applyInterpretation(step: Step, interp: InterpretResponse, rng: Rng = cryptoRng): Step {
  let s = step.state;
  const record: TurnRecord = { ...step.record, parsedIntent: interp.intent, clarification: interp.clarification };

  if (interp.clarification && interp.toolCalls.length === 0) {
    s = appendChat(s, { kind: 'narration', text: interp.clarification });
    return { state: s, record: { ...record, phase: 'complete', narration: interp.clarification } };
  }

  const run = runToolCalls(REGISTRY, s, interp.toolCalls, { rng, origin: 'interpreter' });
  s = run.state;
  // Rede de segurança: "salvei teu contato", "anoto o número do Kettle"… vira contato no Agent.
  const records = [...run.records];
  if (step.record.playerInput) {
    const exchange = applyContactExchange(s, step.record.playerInput);
    s = exchange.state;
    for (const npcId of exchange.saved) records.push({ tool: 'save_contact', args: { npcId }, origin: 'engine', ok: true, summary: `Contato de ${s.npcs.find(n => n.id === npcId)?.name} salvo no Agent.` });
  }
  // Ações de Rede por texto: o turno do jogador na Rede termina aqui (o ICE age antes da narração).
  if (s.net.run && records.some(r => r.ok && (r.tool === 'net_action' || r.tool === 'jack_in'))) {
    const end = runToolCalls(REGISTRY, s, [{ tool: 'net_end_turn', args: {} }], { rng, origin: 'engine' });
    s = end.state;
    records.push(...end.records);
  }
  if (interp.framing && run.pendingRoll) s = appendChat(s, { kind: 'narration', text: interp.framing });
  return {
    state: s,
    record: { ...record, toolCalls: [...record.toolCalls, ...records], phase: run.pendingRoll ? 'awaiting_roll' : 'narrating' },
  };
}

export function toCheckRecord(outcome: RollOutcome): CheckRecord {
  const c = outcome.check;
  return {
    check: outcome.request.kind === 'deathSave' ? 'DEATH_SAVE' : outcome.request.kind === 'initiative' ? 'INITIATIVE' : (getSkill(c.skillId)?.id ?? c.stat).toUpperCase(),
    dice: '1d10',
    roll: c.d10.total,
    modifier: c.total - c.d10.total,
    total: c.total,
    difficulty: c.dv,
    success: c.success,
  };
}

/** Rola o pendingRoll com seed registrada (reproduzível) e aplica o resultado. */
export function applyRoll(step: Step, luckSpent: number, seed: string): Step & { outcome: RollOutcome | null } {
  const request = step.state.pendingRoll;
  if (!request) return { ...step, outcome: null };
  const { rng, log } = recordingRng(seededRng(seed));
  const outcome = resolveRoll(step.state, request, luckSpent, rng);
  let s = gameReducer(step.state, { type: 'rollResolved', outcome });
  const roll = toRollRecord(log, { rollId: `${step.record.turnId}:r${step.record.diceRolls.length}`, seed, purpose: request.reason });
  s = emit(s, 'ROLL_MADE', `${roll.dice} → [${roll.results.join(', ')}] (${request.reason})`, { data: { rollId: roll.rollId, seed } });
  return {
    state: s,
    outcome,
    record: {
      ...step.record,
      diceRolls: [...step.record.diceRolls, roll],
      checks: [...step.record.checks, toCheckRecord(outcome)],
      phase: 'narrating',
    },
  };
}

/** Resultado mecânico consolidado (é só isto que o narrador precisa respeitar). */
export function buildEngineResult(step: Step, outcome: RollOutcome | null): EngineResult {
  return {
    intent: step.record.parsedIntent,
    // Tudo que o jogador (texto ou painel) e o motor resolveram neste turno; nada do narrador/telefone.
    tools: step.record.toolCalls.filter(t => t.origin === 'interpreter' || t.origin === 'player' || t.origin === 'engine').map(t => ({ tool: t.tool, ok: t.ok, summary: t.summary, error: t.error, data: REGISTRY.get(t.tool)?.kind === 'query' ? t.data : undefined })),
    roll: outcome,
    offscreen: pendingOffscreen(step.state),
  };
}

/**
 * Aplica a narração: texto, descobertas, ferramentas do narrador (validadas),
 * ataques inimigos (resolvidos pelo motor) e sugestões.
 */
export function applyNarration(step: Step, narr: NarrateResponse, rng: Rng = cryptoRng): Step {
  let s = appendChat(step.state, { kind: 'narration', text: narr.narration, degraded: narr.degraded });
  // Quem fala na cena passa a existir no mundo (o narrador pode enriquecer depois com upsert_npc).
  if (!narr.degraded) s = registerSpeakers(s, speakersOf(narr.narration, narr.dialogues)).state;
  for (const d of narr.discoveries) {
    if (s.discoveries.some(x => x.title === d.title)) continue;
    s = appendChat({ ...s, discoveries: [...s.discoveries, d].slice(-60) }, { kind: 'discovery', text: d.description, discovery: d });
  }
  const run = runToolCalls(REGISTRY, s, narr.toolCalls, { rng, origin: 'narrator' }, 20);
  s = run.state;
  for (const action of narr.enemyActions.slice(0, 6)) {
    const res = resolveEnemyAttack(s, action.attackerId, rng);
    if (res) s = gameReducer(s, { type: 'enemyAttack', result: res.result });
  }
  // Ciberpsicose: o jogador só escolhe impulsos — nunca fica sem opções.
  const suggestions = isCyberpsycho(s.character) && narr.suggestedActions.length < 2 ? CYBERPSYCHO_ACTIONS : narr.suggestedActions;
  s = acknowledgeOffscreen({ ...s, suggestedActions: suggestions.slice(0, 4) });
  s = ensureDeathSave(s);
  return { state: s, record: { ...step.record, narration: narr.narration, toolCalls: [...step.record.toolCalls, ...run.records] } };
}

/** Fecha o turno: memórias automáticas, poda, eventos do turno e versão final. */
export function finalizeTurn(step: Step, retrievedMemoryIds: string[]): Step {
  let s = touchMemories(step.state, retrievedMemoryIds);
  const events = eventsOfTurn(s, step.record.turnId);
  const mem = memoriesFromEvents(s, events);
  s = pruneMemories(mem.state);
  return {
    state: s,
    record: {
      ...step.record,
      phase: 'complete',
      completedAt: new Date().toISOString(),
      events: eventsOfTurn(s, step.record.turnId),
      memoriesCreated: [...step.record.memoriesCreated, ...mem.created, ...step.record.toolCalls.filter(t => t.tool === 'create_memory' && t.ok).map(t => (t.data as { id: string }).id)],
      memoriesRetrieved: retrievedMemoryIds,
    },
  };
}

/** Aplica a resposta do telefone: mensagem + ferramentas permitidas ao contato. */
export function applyPhoneReply(state: GameState, npcId: string, reply: PhoneResponse, read: boolean, rng: Rng = cryptoRng): { state: GameState; records: TurnRecord['toolCalls'] } {
  let s = gameReducer(state, { type: 'phoneReply', npcId, text: reply.replyText, suggestedReplies: reply.suggestedReplies, read });
  const run = runToolCalls(REGISTRY, s, reply.toolCalls, { rng, origin: 'phone' }, 8);
  s = run.state;
  return { state: s, records: run.records };
}
