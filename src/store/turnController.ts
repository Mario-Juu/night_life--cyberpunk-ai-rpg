/**
 * Orquestra o turno: JOGADOR → INTÉRPRETE (LLM) → MOTOR (tools/dados) → SNAPSHOT →
 * NARRADOR (LLM) → MOTOR (consequências validadas) → MEMÓRIA/EVENTOS → INTERFACE.
 * - Uma única fila garante que só uma operação do Mestre roda por vez.
 * - O estado só muda por funções puras do motor + commit (sem closures obsoletas).
 */
import { failureHint, failureTitle, isTransientFailure } from '@shared/rules/failures';
import type { Character, GameState, RollOutcome } from '@shared/types/game';
import type { EngineResult, TurnRecord } from '@shared/types/turn';
import type { GameContext, GmEnvelope, NarrateResponse } from '@shared/types/gm';
import { buildGameContext } from '@shared/engine/context';
import { createInitialState } from '@shared/engine/initialState';
import { OPENING_SURPRISE, findOpening, pickOpening } from '@shared/engine/openings';
import { applyWorldgen, buildWorldgenRequest, markNewsRead, markPolishTried, needsPolish, unreadNews } from '@shared/engine/fronts';
import { createSandboxState } from '@shared/engine/sandbox';
import { attackBlocker, buildAttackRequest, getPlayerWeapon, type AttackOptions } from '@shared/engine/combat';
import { activeOs } from '@shared/engine/cyberBonus';
import { newSeed, rollDie, seededRng } from '@shared/engine/dice';
import { makeId } from '@shared/engine/ids';
import { turnIdOf } from '@shared/engine/events';
import { canUsePhone } from '@shared/engine/npcs';
import { leaveAccessPoint } from '@shared/engine/net';
import { buildQuickhackRequest, quickhackRolls } from '@shared/engine/quickhacks';
import type { QuickhackKey } from '@shared/rules/quickhacks';
import { applyGeneratedProfile, buildProfileRequest, markProfileTried, nextProfileCandidate } from '@shared/engine/npcProfile';
import { humanityBand, isCyberpsycho } from '@shared/rules/humanity';
import { appendChat } from '@shared/engine/reducer';
import { applyEnemyPhase, applyInterpretation, applyNarration, applyPhoneReply, applyRoll, beginTurn, buildEngineResult, finalizeTurn, type Step } from '@shared/engine/turn';
import { REGISTRY, executeTool, validateToolCalls } from '@shared/engine/tools';
import { api, isGatewayCut } from '../services/api';
import { sound } from '../services/audio';
import { getRepository } from '../services/repository';
import { commit, dispatch, getGame, requireGame, useGameStore } from './gameStore';
import { useUiStore, type LiteChoice } from './uiStore';
import { pruneSnapshots, takeSnapshot } from './timeline';
import { toast } from '../ui/toastStore';
import { diceShowFrom, playDice } from './diceStore';
import { vfx } from './vfxStore';

/** O jogo mudou embaixo do turno (carregar save, nova campanha, rewind)? */
class TurnAbandoned extends Error {}

let queue: Promise<unknown> = Promise.resolve();

/** Executa fn com exclusividade sobre o Mestre. */
function exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    try {
      // setBusy dentro do try: se a escrita do store falhar, a entrada não trava ligada.
      useUiStore.getState().setBusy(true, label);
      return await fn();
    } catch (err) {
      // A campanha mudou no meio (carregar save, rewind, nova campanha): o turno antigo só é descartado.
      if (err instanceof TurnAbandoned) return undefined as T;
      throw err;
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
  if (err instanceof TurnAbandoned) return;
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

function assertSameGame(record: TurnRecord): GameState {
  const game = requireGame();
  if (game.id !== record.gameId || game.session.branchId !== record.branchId) throw new TurnAbandoned('A campanha mudou durante o turno.');
  return game;
}

/** Passo a partir do estado ATUAL do store (mudanças da UI durante a espera não se perdem). */
function current(record: TurnRecord): Step {
  return { state: assertSameGame(record), record };
}

function feedback(before: GameState, after: GameState) {
  announceHumanity(before, after);
  if (!before.combat.active && after.combat.active) {
    sound.playCombatStart();
    vfx('combat');
  }
  if (after.discoveries.length > before.discoveries.length) sound.playDiscovery();
  const fresh = (after.news ?? []).filter(n => !(before.news ?? []).some(b => b.id === n.id));
  if (fresh.length) toast({ title: `NCNet · ${fresh[fresh.length - 1].source}`, body: fresh[fresh.length - 1].headline, tone: 'info', action: { label: 'Ler', run: () => openNews() } });
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
    void backgroundWork();
  }
}

/** Intervalo do polling quando a preferência é não descer para o Flash-Lite. */
export const INSIST_FLASH_RETRY_MS = 12_000;
/** Teto do polling "insistir": passado isso, o jogador decide (esperar mais, reserva ou desistir). */
export const INSIST_FLASH_MAX_MS = 10 * 60_000;

/**
 * Narração com o Flash. A preferência "insistir" nunca autoriza o Lite: o turno fica aguardando e
 * consulta a cadeia Flash novamente até ela responder, preservando a prosa do modelo principal.
 * Só insiste quando esperar pode resolver (sobrecarga, timeout, cota por minuto): cota diária, chave
 * inválida ou bloqueio de conteúdo não passam com o tempo — aí volta a perguntar.
 */
async function narrateWithChoice(
  record: TurnRecord,
  ctx: GameContext,
  input: { kind: 'action' | 'prologue'; playerInput?: string; engineResult: EngineResult | null },
): Promise<GmEnvelope<NarrateResponse>> {
  const ui = () => useUiStore.getState();
  let allowLite = ui().liteNarration === 'allow';
  let cuts = 0;
  let automaticRetries = 0;
  let insistSince = 0;
  let insistTries = 0;
  /** Uma volta do polling "insistir" (só Flash), com contagem visível. */
  const insistOnce = async () => {
    insistSince ||= Date.now();
    insistTries++;
    const waited = Math.round((Date.now() - insistSince) / 1000);
    ui().setBusy(true, `Flash indisponível — tentando de novo (tentativa ${insistTries + 1}${waited ? `, ${waited}s` : ''})…`);
    await sleep(INSIST_FLASH_RETRY_MS);
    assertSameGame(record);
    allowLite = false;
  };
  for (;;) {
    let env: GmEnvelope<NarrateResponse>;
    try {
      env = await api.narrate(ctx, { ...input, allowLite }, model());
    } catch (err) {
      // A hospedagem derrubou a Function (502/504): uma nova tentativa costuma passar.
      if (!isGatewayCut(err) || cuts++ >= 1) throw err;
      ui().setBusy(true, 'O servidor cortou a resposta; tentando de novo…');
      await sleep(3000);
      continue;
    }
    if (!env.meta.degraded) return env;
    // Falha sem opção de Lite (já foi tentado, ou outro motivo): a tentativa automática de antes.
    if (!env.meta.liteOffered) {
      if (automaticRetries++ === 0 && isTransientFailure(env.meta.failureKind) && env.meta.latencyMs < 60_000) {
        record.llmRuns = [...record.llmRuns, env.meta];
        ui().setBusy(true, 'O Mestre está reconectando…');
        await sleep(AUTO_RETRY_DELAY_MS);
        continue;
      }
      return env;
    }
    record.llmRuns = [...record.llmRuns, env.meta];
    // Insistir só vale enquanto esperar pode resolver, e até o teto; depois o jogador decide.
    const withinCap = !insistSince || Date.now() - insistSince < INSIST_FLASH_MAX_MS;
    if (ui().liteNarration === 'insist' && env.meta.waitMayHelp && withinCap) {
      await insistOnce();
      continue;
    }
    insistSince = 0;
    const choice = await new Promise<LiteChoice>(resolve => ui().setLiteChoice({ failureKind: env.meta.failureKind, waitMayHelp: !!env.meta.waitMayHelp, resolve }));
    ui().setLiteChoice(null);
    if (choice === 'cancel') return env;
    if (choice === 'always') ui().setLiteNarration('allow');
    if (choice === 'insist') ui().setLiteNarration('insist');
    if (choice === 'wait') {
      for (let s = LITE_WAIT_S; s > 0; s--) {
        ui().setBusy(true, `Aguardando o Flash… ${s}s`);
        await sleep(1000);
      }
      ui().setBusy(true, 'O Mestre narra…');
      allowLite = false;
    } else if (choice === 'lite' || choice === 'always') {
      ui().setBusy(true, `O Mestre narra (${ui().backupLabel})…`);
      allowLite = true;
    } else {
      // 'insist' escolhido no aviso: passa a valer como preferência e já tenta de novo.
      await insistOnce();
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Deixa o navegador pintar o resultado do ataque antes de iniciar a reação inimiga. */
async function paintPlayerAttack(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
/** Quanto esperar antes de tentar o Flash de novo quando o jogador escolhe "esperar". */
const LITE_WAIT_S = 20;

/** Narra o resultado mecânico, aplica consequências e fecha o turno. */
async function narrateAndFinish(stepIn: Step, outcome: RollOutcome | null): Promise<void> {
  // Combate: os inimigos agem na ordem de iniciativa antes da narração (seed registrada; o resultado fica
  // escondido até a narração chegar, como nos ataques do jogador).
  let step0 = stepIn;
  if (stepIn.state.combat.active && stepIn.record.kind !== 'prologue') {
    const seed = takeSeed();
    const phased = applyEnemyPhase(stepIn, seededRng(seed));
    if (phased !== stepIn) {
      if (!useUiStore.getState().concealedGame) useUiStore.getState().setConcealedGame(stepIn.state);
      const calls = phased.record.toolCalls.map(t => (t.tool === 'enemy_phase' ? { ...t, data: { ...(t.data as object), seed } } : t));
      step0 = commitStep({ state: phased.state, record: { ...phased.record, toolCalls: calls } });
    }
  }
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
    const env = await narrateWithChoice(step.record, ctx, input);
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

/**
 * Começa a campanha. `opening`: chave de shared/engine/openings.ts escolhida na criação; sem ela (ou
 * "surpresa"), sorteia uma abertura coerente com o papel e a história do personagem.
 */
export function startCampaign(character: Character, opening: string = OPENING_SURPRISE, opts: { hardcore?: boolean } = {}): Promise<void> {
  const seed = newSeed();
  const key = findOpening(opening)?.key ?? pickOpening(character, seededRng(seed)).key;
  useGameStore.getState().setGame(createInitialState(character, { opening: key, seed, hardcore: opts.hardcore }));
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
      opened.record.parsedIntent = { type: request.kind === 'attack' || request.kind === 'quickhack' ? 'attack' : 'skill', summary: request.reason, confidence: 1 };
      active = commitStep(opened).record;
    }

    // O motor decide com uma seed; a animação encena esse resultado; depois ele é aplicado
    // com a MESMA seed sobre o estado atual (os dados são idênticos, nada da UI se perde).
    const seed = takeSeed();
    const preview = applyRoll(current(active), luckSpent, seed).outcome!;
    useUiStore.getState().setBusy(true, 'Rolando os dados…');
    const animated = await playDice(diceShowFrom(preview));
    // Testes sociais seguem ocultos até a narração. Ataques, porém, mostram dano/queda antes da
    // reação inimiga: a ordem de iniciativa fica explícita para quem está jogando.
    if (request.kind !== 'initiative' && request.kind !== 'attack' && request.kind !== 'quickhack') useUiStore.getState().setConcealedGame(requireGame());
    const stepped = applyRoll(current(active), luckSpent, seed);
    const outcome = stepped.outcome!;
    commitStep(stepped);
    if (!animated) {
      sound.playDiceRoll();
      if (outcome.check.d10.crit) sound.playCrit();
      else if (outcome.check.d10.fumble) sound.playFumble();
    }

    if (request.kind === 'attack') await paintPlayerAttack();

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
/** Botão do painel: o jogador se afasta do ponto de acesso (sem conexão ativa; não precisa do Mestre). */
export function leaveNetAccess(): void {
  const game = getGame();
  if (!game?.net.architecture || game.net.run) return;
  commit(leaveAccessPoint(game, seededRng(newSeed())));
}

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
  const target = targetId ? game.combat.combatants.find(c => c.id === targetId && c.status === 'active' && c.side !== 'ally') : undefined;
  if (targetId && !target) return 'Alvo indisponível.';
  const weapon = getPlayerWeapon(game.character, weaponId);
  const err = attackBlocker(game.character, weapon, target, opts, activeOs(game));
  if (err) return err;
  const request = buildAttackRequest(game.character, weapon, target, opts, 'player');
  dispatch({ type: 'setPendingRoll', request });
  useUiStore.getState().setMobileTab('story');
  return null;
}

/** Painel de combate: quickhack vira teste de Interface na tela (Ping resolve na hora, sem teste). */
export function prepareQuickhack(key: QuickhackKey, targetId: string): string | null {
  const game = requireGame();
  if (game.pendingRoll?.origin === 'gm') return 'Resolva primeiro o teste pendente.';
  if (!quickhackRolls(key)) {
    void quickTool('quickhack', { hack: key }, 'Dou um ping na área.');
    return null;
  }
  const request = buildQuickhackRequest(game, key, { combatantId: targetId }, 'player');
  if (typeof request === 'string') return request;
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

/**
 * A página recarregou no meio de um turno (interpretando ou narrando): nada mais vai terminá-lo.
 * Fecha como falho e deixa um aviso no chat. Se o motor já tinha resolvido (snapshot pós-motor),
 * o aviso oferece "Tentar narrar de novo"; senão, o jogador reenvia a ação.
 * Rolagem pendente e turno na Rede continuam como estão: a interface já sabe retomá-los.
 */
export async function recoverInterruptedTurn(): Promise<void> {
  const active = useGameStore.getState().activeTurn;
  const game = getGame();
  if (!active || !game || (active.phase !== 'interpreting' && active.phase !== 'narrating')) return;
  if (active.gameId !== game.id || active.branchId !== game.session.branchId) {
    useGameStore.getState().setActiveTurn(null);
    return;
  }
  const resolved = !!active.postEngineSnapshotId;
  await closeTurn({ ...active, phase: 'failed' });
  commit(
    appendChat(requireGame(), {
      kind: 'system',
      text: resolved
        ? 'A página recarregou antes de o Mestre narrar este turno. A ação já foi resolvida — peça a narração de novo.'
        : 'A página recarregou antes de o Mestre entender a sua ação. Nada aconteceu: envie de novo.',
    }),
  );
}

export async function canRegenerate(): Promise<boolean> {
  const game = getGame();
  if (!game) return false;
  const turns = await getRepository().listTurns(game.id, game.session.branchId);
  return turns.some(t => t.turn === game.turn && t.postEngineSnapshotId && (t.phase === 'complete' || t.phase === 'failed'));
}

// ---------------------------------------------------------------- inventário direto

export function reload(weaponId: string) {
  const before = requireGame();
  // Em combate, recarregar/destravar é a Ação do turno: os inimigos respondem e o Mestre narra.
  if (before.combat.active) {
    const weapon = before.character.inventory.find(i => i.id === weaponId);
    const name = weapon?.name ?? 'a arma';
    return void quickTool('reload', { weaponId }, weapon?.weapon?.jammed ? `Gasto minha ação destravando ${name}.` : `Gasto minha ação recarregando ${name}.`);
  }
  dispatch({ type: 'reload', weaponId });
  if (requireGame().character.inventory !== before.character.inventory) sound.playClick();
  else sound.playAlert();
}

export function consumeItem(itemId: string) {
  const game = requireGame();
  const item = game.character.inventory.find(i => i.id === itemId);
  if (!item) return;
  // Droga de rua tem teste de vício: vira ação narrada. Em combate, usar qualquer item gasta a Ação do turno.
  if (item.streetDrug || game.combat.active) return void quickTool('use_item', { itemId }, `Uso ${item.name}.`);
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

/** "Conversa" especial do Agent que mostra o feed NCNet (manchetes e boatos das frentes). */
export const NEWS_THREAD = '__ncnet';

export function openNews() {
  const ui = useUiStore.getState();
  if (window.matchMedia?.('(min-width: 1024px)').matches) ui.openPhone(NEWS_THREAD);
  else {
    ui.setActiveThread(NEWS_THREAD);
    ui.setMobileTab('phone');
  }
}

/** Seleciona uma conversa dentro do telefone já aberto e a marca como lida. */
/** Abriu o NCNet: as manchetes contam como lidas. */
export function markNewsSeen() {
  const game = getGame();
  if (game && unreadNews(game)) commit(markNewsRead(game));
}

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
  dispatch({ type: 'phoneSend', npcId, text: clean });
  return exclusive('Aguardando resposta no Agent…', async () => {
    useUiStore.getState().setPhoneTyping(npcId);
    try {
      // Inclui a fala recém-enviada no histórico com o papel explícito de JOGADOR.
      const ctx = buildGameContext(requireGame(), clean);
      const env = await api.phone(ctx, npcId, clean, model());
      getRepository().saveLlmRun(env.meta).catch(() => undefined);
      const reply = env.payload;
      const ui = useUiStore.getState();
      const read = (ui.phoneOpen || ui.mobileTab === 'phone') && ui.activeThread === npcId;
      const before = requireGame();
      commit(applyPhoneReply(before, npcId, reply, read).state);
      void backgroundWork();
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

// ---------------------------------------------------------------- trabalho de fundo

let background: Promise<void> = Promise.resolve();

/**
 * Resumo, perfil de NPC e costura do mundo em FILA (um de cada vez), nunca em paralelo:
 * várias chamadas juntas estouram a cota por minuto do plano gratuito e esfriam os modelos da narração.
 */
function backgroundWork(): Promise<void> {
  background = background.then(async () => {
    await maybeSummarize();
    await maybeProfileNpc();
    await maybePolishWorld();
  });
  return background;
}

// ---------------------------------------------------------------- profundidade de NPCs

let profiling: string | null = null;

/**
 * NPC que ganhou importância e ainda é casca vazia: pede ao Mestre personalidade (e, se for central,
 * objetivo e segredo). Fora do turno, um por vez; se falhar, tenta de novo daqui a alguns turnos.
 */
async function maybeProfileNpc(): Promise<void> {
  const game = getGame();
  if (!game || profiling || game.sandbox) return;
  const npc = nextProfileCandidate(game);
  const req = npc && buildProfileRequest(game, npc.id);
  if (!npc || !req) return;
  profiling = npc.id;
  try {
    const env = await api.profile(req);
    getRepository().saveLlmRun(env.meta).catch(() => undefined);
    const latest = getGame();
    // Trocou de campanha no meio: o perfil não é desta.
    if (!latest || latest.id !== game.id) return;
    commit(env.payload.degraded ? markProfileTried(latest, npc.id) : applyGeneratedProfile(latest, npc.id, env.payload));
  } catch (err) {
    console.warn('[npc] perfil falhou:', err);
    const latest = getGame();
    if (latest?.id === game.id) commit(markProfileTried(latest, npc.id));
  } finally {
    profiling = null;
  }
}

// ---------------------------------------------------------------- costura do mundo

let polishing = false;

/**
 * As frentes saem do sorteio com texto cru: o Mestre reescreve (uma vez por campanha, fora do turno),
 * ligando-as ao personagem. Falhou: seguem com o texto da mistura e tenta de novo depois.
 */
export async function maybePolishWorld(): Promise<void> {
  const game = getGame();
  if (!game || polishing || game.sandbox || !needsPolish(game)) return;
  const req = buildWorldgenRequest(game);
  if (!req) return;
  polishing = true;
  try {
    const env = await api.worldgen(req);
    getRepository().saveLlmRun(env.meta).catch(() => undefined);
    const latest = getGame();
    if (!latest || latest.id !== game.id) return;
    commit(env.payload.degraded || !env.payload.fronts.length ? markPolishTried(latest) : applyWorldgen(latest, env.payload));
  } catch (err) {
    console.warn('[mundo] costura falhou:', err);
    const latest = getGame();
    if (latest?.id === game.id) commit(markPolishTried(latest));
  } finally {
    polishing = false;
  }
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
    const latest = getGame();
    // Trocou de campanha, de linha do tempo ou voltou no tempo enquanto o resumo vinha: ele não é mais deste jogo.
    if (!latest || latest.id !== game.id || latest.session.branchId !== game.session.branchId || latest.turn < game.turn) return;
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
