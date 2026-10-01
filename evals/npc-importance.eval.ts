/**
 * Importância dos NPCs: quem volta à história sobe de figurante → recorrente → central e ganha
 * perfil (e, se central, objetivo e segredo) gerado fora do turno. Nunca rebaixa.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { applyNarration, beginTurn, applyPhoneReply } from '../shared/engine/turn';
import { backfillNpcsFromChat } from '../shared/engine/npcs';
import { appendChat } from '../shared/engine/reducer';
import {
  PROFILE_RETRY_TURNS,
  applyGeneratedProfile,
  buildProfileRequest,
  depthNeeds,
  markProfileTried,
  nextProfileCandidate,
  noteInteraction,
  syncImportance,
} from '../shared/engine/npcProfile';
import { ProfileBody } from '../server/validation';
import { createGameMaster } from '../server/gamemaster/gameMaster';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import type { LlmProvider } from '../server/gamemaster/llmClient';
import type { NarrateResponse } from '../shared/types/gm';
import type { GameState } from '../shared/types/game';

const narr = (narration: string): NarrateResponse => ({ narration, dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [] });
const kiroSays = (s: GameState, text: string) => applyNarration(beginTurn(s, 'oi'), narr(`[DIALOGUE: Kiro]\n${text}\n[/DIALOGUE]`)).state;
const kiro = (s: GameState) => s.npcs.find(n => n.name === 'Kiro')!;

describe('Interações e promoção', () => {
  it('quem fala conta uma interação por turno; no 2º turno vira recorrente (no fechamento do turno)', () => {
    let s = kiroSays(scenario().state, 'E aí, choom.');
    expect(kiro(s)).toMatchObject({ interactions: 1 });
    expect(kiro(s).importance).toBeUndefined();
    s = noteInteraction(s, [kiro(s).id]); // mesmo turno: não conta de novo
    expect(kiro(s).interactions).toBe(1);
    s = syncImportance(kiroSays(s, 'Voltei.'));
    expect(kiro(s)).toMatchObject({ interactions: 2, importance: 'recurring' });
    expect(s.events.some(e => e.type === 'NPC_UPDATED' && /Kiro ganhou importância/.test(e.summary))).toBe(true);
  });

  it('contratante de missão vira central; Rafa e o laço nascem centrais', () => {
    const sc = scenario()
      .tool('narrator', 'upsert_npc', { name: 'Kiro', role: 'Químico' })
      .tool('narrator', 'start_quest', { title: 'Testar o lote', objective: 'Achar cobaias', rewardEddies: 300, giverId: 'Kiro' });
    const s = syncImportance(sc.state);
    expect(kiro(s).importance).toBe('core');
    expect(s.npcs.find(n => n.id === 'npc_rafa')?.importance).toBe('core');
    expect(s.npcs.find(n => n.id === 'npc_family')?.importance).toBe('core');
  });

  it('contato do Agent ou conversa por SMS: recorrente; animal nunca sobe', () => {
    let s = scenario().tool('narrator', 'upsert_npc', { name: 'Kiro', isContact: true }).tool('narrator', 'upsert_npc', { name: 'Mingau', kind: 'animal' }).state;
    s = noteInteraction({ ...s, turn: 1 }, ['npc_mingau']);
    s = noteInteraction({ ...s, turn: 2 }, ['npc_mingau']);
    s = syncImportance(s);
    expect(kiro(s).importance).toBe('recurring');
    expect(s.npcs.find(n => n.name === 'Mingau')?.importance).toBeUndefined();
  });

  it('resposta por SMS conta interação e promove', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Kiro' });
    const s = applyPhoneReply(sc.state, kiro(sc.state).id, { replyText: 'Fala.', suggestedReplies: [], toolCalls: [] }, true).state;
    expect(kiro(s)).toMatchObject({ interactions: 1, importance: 'recurring' });
  });

  it('nunca rebaixa (missão concluída ou contato apagado não tiram a importância)', () => {
    let s = syncImportance(scenario().tool('narrator', 'upsert_npc', { name: 'Kiro', isContact: true }).state);
    s = { ...s, npcs: s.npcs.map(n => (n.name === 'Kiro' ? { ...n, isContact: false } : n)) };
    expect(kiro(syncImportance(s)).importance).toBe('recurring');
  });

  it('save antigo: interações contadas pelo histórico e promoção no carregamento', () => {
    let s = scenario().tool('narrator', 'upsert_npc', { name: 'Kiro' }).state;
    for (const turn of [3, 5, 9]) s = appendChat({ ...s, turn }, { kind: 'narration', text: '[DIALOGUE: Kiro]\nOi.\n[/DIALOGUE]' });
    const loaded = backfillNpcsFromChat(s);
    expect(kiro(loaded)).toMatchObject({ interactions: 3, importance: 'recurring' });
    expect(backfillNpcsFromChat(loaded)).toEqual(loaded); // idempotente
  });
});

describe('Quem ganha perfil', () => {
  it('recorrente sem perfil precisa de personalidade; central sem objetivo/segredo precisa de profundidade', () => {
    const s = syncImportance(scenario().tool('narrator', 'upsert_npc', { name: 'Kiro', isContact: true }).state);
    expect(depthNeeds(kiro(s))).toEqual({ profile: true, depth: false });
    // O Rafa inicial já tem perfil, objetivo e segredo.
    expect(depthNeeds(s.npcs.find(n => n.id === 'npc_rafa')!)).toEqual({ profile: false, depth: false });
  });

  it('central primeiro; quem falhou espera alguns turnos', () => {
    let s = scenario()
      .tool('narrator', 'upsert_npc', { name: 'Kiro', isContact: true })
      .tool('narrator', 'upsert_npc', { name: 'Yuki', role: 'Agiota' })
      .tool('narrator', 'start_quest', { title: 'Cobrança', objective: 'Pagar a Yuki', giverId: 'Yuki' }).state;
    s = syncImportance(s);
    // O laço da ficha (irmã) também é central e ainda não tem perfil: entra na fila.
    expect(['Yuki', 'Minha irmã']).toContain(nextProfileCandidate(s)?.name);
    s = markProfileTried(s, 'npc_family');
    expect(nextProfileCandidate(s)?.name).toBe('Yuki');
    s = markProfileTried(s, s.npcs.find(n => n.name === 'Yuki')!.id);
    expect(nextProfileCandidate(s)?.name).toBe('Kiro');
    s = markProfileTried(s, kiro(s).id);
    expect(nextProfileCandidate(s)).toBeUndefined();
    expect(nextProfileCandidate({ ...s, turn: s.turn + PROFILE_RETRY_TURNS })?.importance).toBe('core');
  });
});

describe('Perfil gerado pelo Mestre', () => {
  const coreKiro = () => {
    const sc = scenario()
      .tool('narrator', 'upsert_npc', { name: 'Kiro', role: 'Químico de rua', description: 'Magro, jaleco manchado' })
      .tool('narrator', 'start_quest', { title: 'Testar o lote', objective: 'Achar cobaias', giverId: 'Kiro' });
    return syncImportance(kiroSays(sc.state, 'Esse lote dourado vai mudar tudo, choom.'));
  };

  it('o pedido do cliente passa na validação do servidor e leva a evidência', () => {
    const req = buildProfileRequest(coreKiro(), 'npc_kiro')!;
    expect(ProfileBody.safeParse(req).success).toBe(true);
    expect(req.needs).toBe('both');
    expect(req.evidence).toContain('lote dourado');
    expect(req.others.some(o => o.id === 'npc_rafa')).toBe(true);
  });

  it('ida e volta com o servidor (provedor falso): aplica personalidade, objetivo, segredo, vínculo e o que sabe do jogador', async () => {
    const answer = {
      traits: ['ansioso', 'generoso com estranhos', 'mentiroso compulsivo'],
      voice: 'fala rápido e ri nervoso',
      motivation: 'provar que é melhor que o ex-chefe',
      fear: 'a Biotechnica',
      lines: 'nunca vende para criança',
      goal: 'Abrir o próprio laboratório em Japantown',
      secret: 'A fórmula do lote dourado foi roubada da Biotechnica',
      secretWeight: 3,
      bond: { targetId: 'npc_rafa', kind: 'deve_a', note: '€$2000 do último lote' },
      knowsAboutPlayer: ['O jogador topou testar o lote'],
    };
    const prompts: string[] = [];
    const provider: LlmProvider = {
      name: 'fake',
      async generate(req) {
        prompts.push(req.prompt);
        return { text: JSON.stringify(answer), model: 'fake-1', usage: {}, attempts: [{ model: 'fake-1', ok: true, latencyMs: 1 }] };
      },
    };
    const state = coreKiro();
    const env = await createGameMaster(provider, () => {}).profile(buildProfileRequest(state, 'npc_kiro')!);
    expect(env.meta.purpose).toBe('profile');
    expect(prompts[0]).toContain('perfil completo + DEPTH');
    const s = applyGeneratedProfile(state, 'npc_kiro', env.payload);
    const k = kiro(s);
    expect(k.profile?.traits).toEqual(answer.traits);
    expect(k.goals?.[0]).toMatchObject({ text: answer.goal, playerKnows: 'no' });
    expect(k.knowledge.find(f => f.secret)).toMatchObject({ fact: answer.secret, weight: 3, playerKnows: 'no' });
    expect(k.bonds?.[0]).toMatchObject({ targetId: 'npc_rafa', kind: 'deve_a', playerKnows: 'no' });
    expect(k.knowsAboutPlayer).toEqual(['O jogador topou testar o lote']);
    expect(depthNeeds(k)).toEqual({ profile: false, depth: false });
    expect(nextProfileCandidate(s)?.id).not.toBe('npc_kiro');
  });

  it('campos ruins são ignorados sem derrubar o resto; perfil já definido pelo narrador não é sobrescrito', () => {
    let s = coreKiro();
    s = applyGeneratedProfile(s, 'npc_kiro', { traits: ['calmo'], bond: { targetId: 'npc_inexistente', kind: 'rival' }, secretWeight: 9, secret: 'Tem um filho em Pacifica' });
    expect(kiro(s).profile?.traits).toEqual(['calmo']);
    expect(kiro(s).bonds ?? []).toEqual([]);
    expect(kiro(s).knowledge.find(f => f.secret)?.weight).toBe(2);
    s = applyGeneratedProfile(s, 'npc_kiro', { traits: ['nervoso'] });
    expect(kiro(s).profile?.traits).toEqual(['calmo']);
  });

  it('falha do Mestre: perfil vazio marcado como degradado (o cliente só marca a tentativa)', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      async generate() {
        throw new Error('503');
      },
    };
    const env = await createGameMaster(provider, () => {}).profile(buildProfileRequest(coreKiro(), 'npc_kiro')!);
    expect(env.payload).toMatchObject({ traits: [], degraded: true });
  });
});

describe('O que o NPC sabe do jogador', () => {
  it('upsert_npc learnsAboutPlayer acumula sem repetir e aparece no contexto', () => {
    const sc = scenario()
      .tool('narrator', 'upsert_npc', { name: 'Kiro', present: true, learnsAboutPlayer: 'O jogador deve ao cassino' })
      .tool('narrator', 'upsert_npc', { name: 'Kiro', learnsAboutPlayer: 'o jogador deve ao cassino' });
    expect(kiro(sc.state).knowsAboutPlayer).toEqual(['O jogador deve ao cassino']);
    const prompt = buildNarratePrompt(sc.context('Kiro'), { kind: 'action', playerInput: 'falo com o Kiro', engineResult: null });
    expect(prompt).toContain('sabe do jogador: O jogador deve ao cassino');
    expect(buildNarratePrompt(scenario().context('Rafa'), { kind: 'action', playerInput: 'Rafa', engineResult: null })).toContain('sabe do jogador: só o que viu acontecer');
  });
});

describe('Traços longos', () => {
  it('cortados no limite sem partir palavra', () => {
    const s = syncImportance(scenario().tool('narrator', 'upsert_npc', { name: 'Kiro', isContact: true }).state);
    const after = applyGeneratedProfile(s, 'npc_kiro', { traits: ['paranoico com germes apesar do jaleco imundo que nunca lava de verdade'] });
    expect(after.npcs.find(n => n.id === 'npc_kiro')?.profile?.traits).toEqual(['paranoico com germes apesar do jaleco imundo que nunca lava']);
  });
});
