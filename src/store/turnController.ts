/**
 * Orquestra o turno: JOGADOR → INTÉRPRETE (LLM) → MOTOR (tools/dados) → SNAPSHOT →
 * NARRADOR (LLM) → MOTOR (consequências validadas) → MEMÓRIA/EVENTOS → INTERFACE.
 * - Uma única fila garante que só uma operação do Mestre roda por vez.
 * - O estado só muda por funções puras do motor + commit (sem closures obsoletas).
 */
import { failureHint, failureTitle, isTransientFailure } from '@shared/rules/failures';
import type { Character, GameState, RollOutcome } from '@shared/types/game';
import type { TurnRecord } from '@shared/types/turn';
import type { GmEnvelope } from '@shared/types/gm';
import { buildGameContext } from '@shared/engine/context';
import { createInitialState } from '@shared/engine/initialState';
import { createSandboxState } from '@shared/engine/sandbox';
import { attackBlocker, buildAttackRequest, getPlayerWeapon, type AttackOptions } from '@shared/engine/combat';
import { activeOs } from '@shared/engine/cyberBonus';
import { newSeed, rollDie, seededRng } from '@shared/engine/dice';
import { makeId } from '@shared/engine/ids';
import { turnIdOf } from '@shared/engine/events';
import { canUsePhone } from '@shared/engine/npcs';
import { humanityBand, isCyberpsycho } from '@shared/rules/humanity';
import { applyInterpretation, applyNarration, applyPhoneReply, applyRoll, beginTurn, buildEngineResult, finalizeTurn, type Step } from '@shared/engine/turn';
import { REGISTRY, executeTool, validateToolCalls } from '@shared/engine/tools';
import { api } from '../services/api';
import { sound } from '../services/audio';
import { getRepository } from '../services/repository';
import { commit, dispatch, getGame, requireGame, useGameStore } from './gameStore';
import { useUiStore } from './uiStore';
import { pruneSnapshots, takeSnapshot } from './timeline';
import { toast } from '../ui/toastStore';
import { diceShowFrom, playDice } from './diceStore';
import { vfx } from './vfxStore';

let queue: Promise<unknown> = Promise.resolve();

/** Executa fn com exclusividade sobre o Mestre. */
function exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    useUiStore.getState().setBusy(true, label);
    try {
      return await fn();
    } finally {
      useUiStore.getState().setBusy(false);
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

const model = () => useUiStore.getState().model;

/** Espera antes de tentar a narração de novo sozinho quando o Google está sobrecarregado. */
export const AUTO_RETRY_DELAY_MS = 8_000;

function reportError(err: unknown, context: string) {
  const message = (err as Error)?.message ?? String(err);
  dispatch({ type: 'systemMessage', text: `⚠ ${context}: ${message}` });
  toast({ title: context, body: message, tone: 'danger' });
}

/** Registra os metadados da chamada no turno e no repositório. */
function recordRun<T>(record: TurnRecord, env: GmEnvelope<T>): T {
  record.llmRuns = [...record.llmRuns, env.meta];
  getRepository().saveLlmRun(env.meta).catch(() => undefined);
  useUiStore.getState().setDegraded(env.meta.degraded);
  if (env.meta.degraded) toast({ title: failureTitle(env.meta.failureKind), body: failureHint(env.meta.failureKind), tone: 'warning' });
  return env.payload;
}

/** Confirma o passo no store e guarda o turno ativo. */
function commitStep(step: Step): Step {
  commit(step.state);
  useGameStore.getState().setActiveTurn(step.record);
  return { state: requireGame(), record: step.record };
}

/** Passo a partir do estado ATUAL do store (mudanças da UI durante a espera não se perdem). */
function current(record: TurnRecord): Step {
  return { state: requireGame(), record };
}

function feedback(before: GameState, after: GameState) {
  announceHumanity(before, after);
  if (!before.combat.active && after.combat.active) {
    sound.playCombatStart();
    vfx('combat');
  }
  if (after.discoveries.length > before.discoveries.length) sound.playDiscovery();
  const unread = (s: GameState) => s.phone.reduce((n, t) => n + t.unread, 0);
  if (unread(after) > unread(before)) {
    sound.playNotification();
    toast({ title: 'Nova mensagem no Agent', tone: 'info', action: { label: 'Abrir', run: () => openPhoneThread(after.phone.find(t => t.unread > 0)?.npcId ?? null) } });
  }
  if (after.character.hp.current < before.character.hp.current) {
    sound.playDamageTaken();
    vfx('damage');
  } else if (after.character.hp.current > before.character.hp.current) {
    sound.playHeal();
    vfx('heal');
  }
  if (after.character.hp.current <= 0 && !after.character.dead) sound.playHeartbeatDanger();
  if (after.pendingRoll && after.pendingRoll.id !== before.pendingRoll?.id) sound.playTurnAlert();
}

/** Entrada na ciberpsicose: a tela "cai". Faixas baixas de Humanidade: um glitch de aviso. */
export function announceHumanity(before: GameState, after: GameState) {
  if (!isCyberpsycho(before.character) && isCyberpsycho(after.character)) {
    vfx('crash');
    sound.playFumble();
    sound.playHeartbeatDanger();
  } else if (humanityBand(after.character).band !== humanityBand(before.character).band && after.character.humanity.current < before.character.humanity.current) {
    vfx('glitch');
  }
}

async function closeTurn(record: TurnRecord) {
  useGameStore.getState().setActiveTurn(null);
  await getRepository()
    .saveTurn(record)
    .catch(err => console.warn('[turn] não salvo:', err));
  const game = getGame();
  if (game) {
    pruneSnapshots(game).catch(() => undefined);
    void maybeSummarize();
  }
}

/** Narra o resultado mecânico, aplica consequências e fecha o turno. */
async function narrateAndFinish(step0: Step, outcome: RollOutcome | null): Promise<void> {
  const engineResult = buildEngineResult(step0, outcome);
  const postEngineSnapshotId = await takeSnapshot(step0.state, 'post_engine', `Motor resolvido (turno ${step0.state.turn})`);
  let step: Step = { ...step0, record: { ...step0.record, engineResult, postEngineSnapshotId, phase: 'narrating' } };
  useGameStore.getState().setActiveTurn(step.record);

  const query = [step.record.playerInput, step.record.parsedIntent?.summary].filter(Boolean).join(' ');
  const ctx = buildGameContext(step.state, query);
  const retrieved = ctx.memories.map(m => m.id);
  const before = step.state;
  try {
    const input = { kind: step.record.kind, playerInput: step.record.playerInput ?? undefined, engineResult };
    let env = await api.narrate(ctx, input, model());
    // Sobrecarga do Google costuma passar em segundos: uma nova tentativa automática antes de desistir
    // (só se a primeira falhou rápido — não dobra uma espera longa).
    if (env.meta.degraded && isTransientFailure(env.meta.failureKind) && env.meta.latencyMs < 60_000) {
      step.record.llmRuns = [...step.record.llmRuns, env.meta];
      useUiStore.getState().setBusy(true, 'O Mestre está reconectando…');
      await new Promise(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
      env = await api.narrate(ctx, input, model());
    }
    const narr = recordRun(step.record, env);
    step = applyNarration(current(step.record), narr);
    step = finalizeTurn(step, retrieved);
    commit(step.state);
    useUiStore.getState().setConcealedGame(null);
    sound.playReveal();
    await closeTurn({ ...step.record, stateVersionAfter: requireGame().session.version });
    feedback(before, requireGame());
    if (outcome?.attack?.application?.ablated) sound.playArmorAblation();
  } catch (err) {
    await closeTurn({ ...step.record, phase: 'failed' });
    reportError(err, 'O Mestre não narrou o resultado');
  } finally {
    // Revela o desfecho junto com a narração (ou com o aviso de falha).
    useUiStore.getState().setConcealedGame(null);
  }
}

// ---------------------------------------------------------------- campanha

export function startCampaign(character: Character): Promise<void> {
  useGameStore.getState().setGame(createInitialState(character));
  useUiStore.setState({ mobileTab: 'story', phoneOpen: false, activeThread: null, lastDegraded: false });
  return requestOpening();
}

/** Gera (ou tenta de novo) a cena de abertura da campanha atual. */
export function requestOpening(): Promise<void> {
  return exclusive('O Mestre prepara a abertura…', async () => {
    const game = requireGame();
    if (game.chat.some(e => e.kind === 'narration')) return;
    await takeSnapshot(game, 'turn_start', 'Prólogo');
    await narrateAndFinish(commitStep(beginTurn(game, null, 'prologue')), null);
  });
}

/** Seed da próxima rolagem. No Sandbox, o "d10 forçado" entra na seed (continua reproduzível). */
function takeSeed(): string {
  const forced = useUiStore.getState().forcedD10;
  if (forced && getGame()?.sandbox) {
    useUiStore.getState().setForcedD10(null);
    return `force:${forced}:${newSeed()}`;
  }
  return newSeed();
}

/** Modo Sandbox: personagem de testes com tudo no máximo, sem prólogo da IA. */
export function startSandbox(role: Character['bio']['role'] = 'solo') {
  useGameStore.getState().setGame(createSandboxState(role));
  useUiStore.setState({ mobileTab: 'story', phoneOpen: false, activeThread: null, lastDegraded: false, modal: 'sandbox' });
}

export function newCampaign() {
  useGameStore.getState().setGame(null);
  useUiStore.setState({ modal: null, phoneOpen: false, activeThread: null, lastDegraded: false });
}

// ---------------------------------------------------------------- ação livre

/** JOGADOR → INTÉRPRETE → MOTOR → (rolagem) → NARRADOR. */
export function sendAction(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return Promise.resolve();
  return exclusive('Interpretando sua ação…', async () => {
    const game = requireGame();
    if (game.character.dead) return;
    if (game.pendingRoll?.origin === 'gm') {
      toast({ title: 'Rolagem pendente', body: 'Resolva o teste pendente antes de agir.', tone: 'warning' });
      return;
    }
    if (game.pendingRoll) dispatch({ type: 'cancelPendingRoll' });
    if (useGameStore.getState().activeTurn?.phase === 'in_net') {
      toast({ title: 'Turno na Rede em andamento', body: 'Encerre o turno no painel da Rede antes de agir por texto.', tone: 'warning' });
      return;
    }

    await takeSnapshot(requireGame(), 'turn_start', clean);
    let step = commitStep(beginTurn(requireGame(), clean));
    const ctx = buildGameContext(step.state, clean);
    step.record.memoriesRetrieved = ctx.memories.map(m => m.id);

    let interp;
    try {
      interp = recordRun(step.record, await api.interpret(ctx, clean, model()));
      // Autocorreção: chamadas mal formadas voltam ao intérprete uma vez, com o erro do motor.
      const errors = validateToolCalls(interp.toolCalls, 'interpreter');
      if (errors.length) {
        useUiStore.getState().setBusy(true, 'Ajustando a interpretação…');
        const retry = recordRun(step.record, await api.interpret(ctx, clean, model(), errors.join('\n')));
        if (validateToolCalls(retry.toolCalls, 'interpreter').length < errors.length) interp = retry;
      }
    } catch (err) {
      await closeTurn({ ...step.record, phase: 'failed' });
      reportError(err, 'Não foi possível interpretar a ação');
      return;
    }

    const before = requireGame();
    step = commitStep(applyInterpretation(current(step.record), interp));
    // Testes resolvidos na hora (Fabricante, Medicina…) só mostram o desfecho junto com a narração.
    if (requireGame().chat.some(e => e.kind === 'roll' && e.turn === step.state.turn)) useUiStore.getState().setConcealedGame(before);
    feedback(before, requireGame());

    if (step.record.phase === 'complete') {
      const done = finalizeTurn(current(step.record), step.record.memoriesRetrieved);
      commit(done.state);
      await closeTurn(done.record);
      return;
    }
    if (step.record.phase === 'awaiting_roll') return; // o RollCard assume daqui
    useUiStore.getState().setBusy(true, 'O Mestre narra…');
    await narrateAndFinish(step, null);
  });
}

// ---------------------------------------------------------------- rolagem

/** Rola o teste pendente com o motor (seed registrada) e segue para a narração. */
export function rollPending(luckSpent: number): Promise<RollOutcome | null> {
  return exclusive('Resolvendo…', async () => {
    const game = requireGame();
    const request = game.pendingRoll;
    if (!request) return null;

    // Rolagens sem turno em andamento (painel de combate, Teste de Morte, iniciativa) abrem um turno próprio.
    let active = useGameStore.getState().activeTurn;
    if (!active || active.turn !== game.turn || active.phase !== 'awaiting_roll') {
      await takeSnapshot(game, 'turn_start', request.reason);
      const opened = beginTurn(game, request.origin === 'player' ? request.reason : null);
      opened.record.parsedIntent = { type: request.kind === 'attack' ? 'attack' : 'skill', summary: request.reason, confidence: 1 };
      active = commitStep(opened).record;
    }

    // O motor decide com uma seed; a animação encena esse resultado; depois ele é aplicado
    // com a MESMA seed sobre o estado atual (os dados são idênticos, nada da UI se perde).
    const seed = takeSeed();
    const preview = applyRoll(current(active), luckSpent, seed).outcome!;
    useUiStore.getState().setBusy(true, 'Rolando os dados…');
    const animated = await playDice(diceShowFrom(preview));
    // O desfecho só é revelado com a narração: os painéis mostram o estado de antes da rolagem.
    if (request.kind !== 'initiative') useUiStore.getState().setConcealedGame(requireGame());
    const stepped = applyRoll(current(active), luckSpent, seed);
    const outcome = stepped.outcome!;
    commitStep(stepped);
    if (!animated) {
      sound.playDiceRoll();
      if (outcome.check.d10.crit) sound.playCrit();
      else if (outcome.check.d10.fumble) sound.playFumble();
    }

    if (request.kind === 'initiative') {
      const done = finalizeTurn(current(stepped.record), []);
      commit(done.state);
      await closeTurn(done.record);
      return outcome;
    }
    useUiStore.getState().setBusy(true, 'O Mestre narra…');
    await narrateAndFinish(current(stepped.record), outcome);
    return outcome;
  });
}

// ---------------------------------------------------------------- ações rápidas do motor

/**
 * Ação de painel resolvida direto pelo motor (sem intérprete): valida no estado atual,
 * abre o turno, executa com seed e manda o Mestre narrar. Ex.: briga (agarrar, estrangular…).
 */
export function quickTool(tool: string, args: Record<string, unknown>, label: string): Promise<void> {
  return exclusive('Resolvendo…', async () => {
    const game = requireGame();
    if (game.character.dead) return;
    if (game.pendingRoll?.origin === 'gm') {
      toast({ title: 'Rolagem pendente', body: 'Resolva o teste pendente antes.', tone: 'warning' });
      return;
    }
    // Pré-validação sem efeito (funções puras): nada de turno aberto para uma ação impossível.
    const dry = executeTool(REGISTRY, game, { tool, args }, { rng: seededRng('dry'), origin: 'player' });
    if (!dry.record.ok) {
      toast({ title: 'Ação indisponível', body: dry.record.summary, tone: 'warning' });
      return;
    }
    await takeSnapshot(game, 'turn_start', label);
    const opened = beginTurn(requireGame(), label);
    opened.record.parsedIntent = { type: 'attack', summary: label, confidence: 1 };
    const step0 = commitStep(opened);
    const before = requireGame();
    const res = runNetTool(step0, tool, args);
    if (requireGame().chat.some(e => e.kind === 'roll' && e.turn === requireGame().turn)) useUiStore.getState().setConcealedGame(before);
    useUiStore.getState().setBusy(true, 'O Mestre narra…');
    await narrateAndFinish(current({ ...res.step.record, phase: 'narrating' }), null);
  });
}

// ---------------------------------------------------------------- Rede (painel)

/** Turno de Rede aberto pelo painel (reaproveita o atual; senão abre um). */
async function netTurn(): Promise<Step> {
  const game = requireGame();
  const active = useGameStore.getState().activeTurn;
  if (active && active.turn === game.turn && active.phase === 'in_net') return current(active);
  await takeSnapshot(game, 'turn_start', 'Ações na Rede');
  const opened = beginTurn(game, null);
  opened.record.phase = 'in_net';
  opened.record.parsedIntent = { type: 'netrun', summary: 'Ações na Rede', confidence: 1 };
  return commitStep(opened);
}

/** Executa uma ferramenta de Rede com seed registrada e anota no turno. */
function runNetTool(step: Step, tool: string, args: Record<string, unknown>): { step: Step; ok: boolean; summary: string } {
  const seed = takeSeed();
  const res = executeTool(REGISTRY, step.state, { tool, args }, { rng: seededRng(seed), origin: 'player' });
  const record = { ...step.record, toolCalls: [...step.record.toolCalls, { ...res.record, data: { ...(res.record.data as object), seed } }] };
  return { step: commitStep({ state: res.state, record }), ok: res.record.ok, summary: res.record.summary };
}

/** Fecha o turno de Rede: o ICE age e o Mestre narra o lote de ações. */
async function closeNetTurn(step0: Step) {
  let step = step0;
  if (step.state.net.run) step = runNetTool(step, 'net_end_turn', {}).step;
  useUiStore.getState().setBusy(true, 'O Mestre narra…');
  await narrateAndFinish(current({ ...step.record, phase: 'narrating' }), null);
}

/**
 * Ação de Rede pelo painel (jack_in, net_action). Resolve na hora; quando as Ações de Rede
 * acabam (ou a conexão cai), o turno fecha sozinho.
 */
export function netPanelAction(tool: 'jack_in' | 'net_action', args: Record<string, unknown> = {}): Promise<void> {
  return exclusive('Na Rede…', async () => {
    const game = requireGame();
    if (game.character.dead) return;
    if (game.pendingRoll?.origin === 'gm') {
      toast({ title: 'Rolagem pendente', body: 'Resolva o teste pendente antes.', tone: 'warning' });
      return;
    }
    const before = requireGame();
    const res = runNetTool(await netTurn(), tool, args);
    if (!res.ok) {
      toast({ title: 'Ação de Rede recusada', body: res.summary, tone: 'warning' });
      return;
    }
    sound.playDiceRoll();
    feedback(before, requireGame());
    const run = requireGame().net.run;
    if (!run || run.actionsLeft <= 0 || requireGame().character.dead) await closeNetTurn(res.step);
  });
}

/** Encerra o turno na Rede pelo painel (o ICE age e o Mestre narra). */
export function endNetTurnPanel(): Promise<void> {
  return exclusive('O ICE reage…', async () => {
    const active = useGameStore.getState().activeTurn;
    if (!active || active.phase !== 'in_net') return;
    await closeNetTurn(current(active));
  });
}

/** Ataque escolhido no painel de combate: pedido local (cancelável) com DV da balística. */
export function prepareAttack(targetId: string | null, weaponId: string | undefined, opts: AttackOptions): string | null {
  const game = requireGame();
  if (game.pendingRoll?.origin === 'gm') return 'Resolva primeiro o teste pendente.';
  const target = targetId ? game.combat.combatants.find(c => c.id === targetId && c.status === 'active') : undefined;
  if (targetId && !target) return 'Alvo indisponível.';
  const weapon = getPlayerWeapon(game.character, weaponId);
  const err = attackBlocker(game.character, weapon, target, opts, activeOs(game));
  if (err) return err;
  const request = buildAttackRequest(game.character, weapon, target, opts, 'player');
  dispatch({ type: 'setPendingRoll', request });
  useUiStore.getState().setMobileTab('story');
  return null;
}

export function cancelLocalRoll() {
  dispatch({ type: 'cancelPendingRoll' });
}

export function rollInitiative(): Promise<RollOutcome | null> {
  if (requireGame().pendingRoll) return Promise.resolve(null);
  dispatch({
    type: 'setPendingRoll',
    request: { id: makeId('roll'), kind: 'initiative', origin: 'player', reason: 'Iniciativa (REF + 1d10)', stat: 'REF', skillId: null, dv: 0, modifier: 0 },
  });
  return rollPending(0);
}

/**
 * Regenera a narração do último turno mantendo a MESMA resolução mecânica
 * (restaura o snapshot pós-motor e chama o narrador de novo).
 */
export function regenerateNarration(): Promise<void> {
  return exclusive('Regenerando narração…', async () => {
    const game = requireGame();
    const repo = getRepository();
    const last = (await repo.listTurns(game.id, game.session.branchId)).filter(t => t.turn === game.turn && t.postEngineSnapshotId).at(-1);
    const snap = last?.postEngineSnapshotId ? await repo.getSnapshot(last.postEngineSnapshotId) : undefined;
    if (!last || !snap) {
      toast({ title: 'Nada para regenerar', body: 'Só a narração do último turno pode ser regenerada.', tone: 'warning' });
      return;
    }
    commit(snap.state);
    const record: TurnRecord = { ...last, phase: 'narrating', narration: null, toolCalls: last.toolCalls.filter(t => t.origin !== 'narrator') };
    await narrateAndFinish(current(record), last.engineResult?.roll ?? null);
  });
}

export async function canRegenerate(): Promise<boolean> {
  const game = getGame();
  if (!game) return false;
  const turns = await getRepository().listTurns(game.id, game.session.branchId);
  return turns.some(t => t.turn === game.turn && t.postEngineSnapshotId && t.phase === 'complete');
}

// ---------------------------------------------------------------- inventário direto

export function reload(weaponId: string) {
  const before = requireGame();
  dispatch({ type: 'reload', weaponId });
  if (requireGame().character.inventory !== before.character.inventory) sound.playClick();
  else sound.playAlert();
}

export function consumeItem(itemId: string) {
  const item = requireGame().character.inventory.find(i => i.id === itemId);
  if (!item) return;
  // Droga de rua tem teste de vício: vira ação narrada.
  if (item.streetDrug) return void quickTool('use_item', { itemId }, `Uso ${item.name}.`);
  if (item.drug) dispatch({ type: 'useDrug', itemId });
  else dispatch({ type: 'useConsumable', itemId, healed: item.heal ? rollDie(item.heal) : 0 });
  sound.playSuccess();
}

// ---------------------------------------------------------------- telefone

/** Abre o telefone (drawer no desktop, aba no mobile) já na conversa indicada. */
export function openPhoneThread(npcId: string | null) {
  const ui = useUiStore.getState();
  if (window.matchMedia?.('(min-width: 1024px)').matches) ui.openPhone(npcId);
  else {
    ui.setActiveThread(npcId);
    ui.setMobileTab('phone');
  }
  if (npcId) dispatch({ type: 'phoneRead', npcId });
}

/** Seleciona uma conversa dentro do telefone já aberto e a marca como lida. */
export function selectThread(npcId: string | null) {
  useUiStore.getState().setActiveThread(npcId);
  if (npcId) dispatch({ type: 'phoneRead', npcId });
}

export function sendPhoneMessage(npcId: string, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return Promise.resolve();
  const game = requireGame();
  const target = game.npcs.find(n => n.id === npcId);
  if (target && !canUsePhone(target)) return Promise.resolve();
  const ctx = buildGameContext(game, clean);
  dispatch({ type: 'phoneSend', npcId, text: clean });
  return exclusive('Aguardando resposta no Agent…', async () => {
    useUiStore.getState().setPhoneTyping(npcId);
    try {
      const env = await api.phone(ctx, npcId, clean, model());
      getRepository().saveLlmRun(env.meta).catch(() => undefined);
      const reply = env.payload;
      const ui = useUiStore.getState();
      const read = (ui.phoneOpen || ui.mobileTab === 'phone') && ui.activeThread === npcId;
      const before = requireGame();
      commit(applyPhoneReply(before, npcId, reply, read).state);
      sound.playNotification();
      if (reply.degraded) toast({ title: 'Sinal fraco', body: 'O contato não respondeu de verdade. Tente de novo.', tone: 'warning' });
      else if (!read) toast({ title: `Resposta de ${before.npcs.find(n => n.id === npcId)?.name ?? 'contato'}`, body: reply.replyText.slice(0, 120), tone: 'info' });
    } catch (err) {
      reportError(err, 'Mensagem não entregue');
    } finally {
      useUiStore.getState().setPhoneTyping(null);
    }
  });
}

// ---------------------------------------------------------------- memória longa

export const SUMMARY_TRIGGER = 24;
export const RAW_TURNS_KEPT = 12;

/** Compacta turnos antigos em resumos (sem perder o que importa); o recente fica cru. */
async function maybeSummarize(): Promise<void> {
  const game = getGame();
  if (!game || game.turn - game.history.summarizedUpToTurn <= SUMMARY_TRIGGER) return;
  const fromTurn = game.history.summarizedUpToTurn + 1;
  const toTurn = game.turn - RAW_TURNS_KEPT;
  const lines = [
    ...game.chat
      .filter(e => e.turn >= fromTurn && e.turn <= toTurn && (e.kind === 'player' || e.kind === 'narration'))
      .map(e => `${e.kind === 'player' ? 'JOGADOR' : 'MESTRE'} (t${e.turn}): ${e.text.slice(0, 700)}`),
    ...game.events.filter(e => e.turn >= fromTurn && e.turn <= toTurn && e.type !== 'TIME_ADVANCED' && e.type !== 'ROLL_MADE').map(e => `EVENTO (t${e.turn}): ${e.summary}`),
  ];
  if (!lines.length) return;
  try {
    const env = await api.summarize({ sessionId: game.id, turnId: turnIdOf(game), fromTurn, toTurn, transcript: lines.join('\n').slice(0, 55_000) });
    getRepository().saveLlmRun(env.meta).catch(() => undefined);
    const latest = requireGame();
    if (latest.history.summarizedUpToTurn >= toTurn) return;
    commit({
      ...latest,
      history: {
        summaries: [...latest.history.summaries, { id: makeId('sum'), fromTurn, toTurn, text: env.payload.summary, source: (env.payload.degraded ? 'engine' : 'llm') as 'engine' | 'llm' }].slice(-30),
        summarizedUpToTurn: toTurn,
      },
    });
  } catch (err) {
    console.warn('[memória] resumo falhou:', err);
  }
}
