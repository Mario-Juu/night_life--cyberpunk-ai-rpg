/**
 * Costura do mundo: o Mestre reescreve os textos crus das frentes sorteadas (fluência, concordância,
 * ganchos com a ficha). Só TEXTO muda: estrutura, efeitos, horários e NPCs ficam como o motor sorteou.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { POLISH_RETRY_TURNS, applyWorldgen, buildWorldgenRequest, generateFronts, markPolishTried, needsPolish } from '../shared/engine/fronts';
import { WorldgenBody } from '../server/validation';
import { createGameMaster } from '../server/gamemaster/gameMaster';
import type { LlmProvider } from '../server/gamemaster/llmClient';
import type { WorldgenResponse } from '../shared/types/gm';

const world = () => generateFronts(scenario({ debtReason: 'Devo ao cassino' }).state, { seed: 'costura' });

/** Resposta "do Mestre": mesma estrutura, textos marcados. */
function rewritten(state: ReturnType<typeof world>): WorldgenResponse {
  const req = buildWorldgenRequest(state)!;
  return {
    fronts: req.fronts.map(f => ({
      id: f.id,
      title: `Novo: ${f.title}`.slice(0, 40),
      premise: `Reescrita: ${f.premise}`,
      twist: f.twist ? `Reviravolta: ${f.twist}` : '',
      stages: f.stages.map(st => ({
        title: `Passo: ${st.title}`,
        blockHint: st.blockHint,
        effects: st.effects.map(e => ({ kind: e.kind, headline: e.headline ? `Manchete: ${e.headline}` : undefined, body: e.body, text: e.text ? `SMS: ${e.text}` : undefined })),
      })),
    })),
  };
}

describe('Pedido', () => {
  it('passa na validação do servidor e leva o personagem e a voz do rosto', () => {
    const req = buildWorldgenRequest(world())!;
    expect(WorldgenBody.safeParse(req).success).toBe(true);
    expect(req.player.debtReason).toBe('Devo ao cassino');
    expect(req.fronts[0].seed?.voice).toBeTruthy();
  });

  it('nada a costurar quando tudo já foi reescrito; falha espera alguns turnos', () => {
    let s = world();
    expect(needsPolish(s)).toBe(true);
    s = markPolishTried(s);
    expect(needsPolish(s)).toBe(false);
    expect(needsPolish({ ...s, turn: s.turn + POLISH_RETRY_TURNS })).toBe(true);
    s = applyWorldgen(s, rewritten(s));
    expect(needsPolish({ ...s, turn: s.turn + POLISH_RETRY_TURNS })).toBe(false);
    expect(buildWorldgenRequest(s)).toBeNull();
  });
});

describe('Aplicação', () => {
  it('troca só o texto: estrutura, efeitos, horários e NPCs ficam iguais', () => {
    const s = world();
    const after = applyWorldgen(s, rewritten(s));
    const f0 = s.fronts![0];
    const f1 = after.fronts![0];
    expect(f1.polished).toBe(true);
    expect(f1.premise).toBe(`Reescrita: ${f0.premise}`);
    expect(f1.stages.map(st => st.hours)).toEqual(f0.stages.map(st => st.hours));
    expect(f1.stages.map(st => st.effects.map(e => e.kind))).toEqual(f0.stages.map(st => st.effects.map(e => e.kind)));
    expect({ ...f1, title: '', premise: '', twist: '', stages: [], polished: undefined }).toEqual({ ...f0, title: '', premise: '', twist: '', stages: [], polished: undefined });
    const news = f1.stages.flatMap(st => st.effects).find(e => e.kind === 'news');
    if (news?.kind === 'news') expect(news.headline).toMatch(/^Manchete: /);
    // O rosto persegue a premissa reescrita.
    expect(after.npcs.find(n => n.id === f1.seedNpcId)?.currentGoal).toBe(f1.premise);
  });

  it('resposta torta (estágio a menos, efeito trocado, frente inventada, campo vazio) não quebra nada', () => {
    const s = world();
    const r = rewritten(s);
    r.fronts[0].stages = r.fronts[0].stages.slice(0, 1);
    r.fronts[0].title = '   ';
    r.fronts.push({ id: 'front_inventada', title: 'X', premise: 'Y', twist: '', stages: [] });
    const after = applyWorldgen(s, r);
    expect(after.fronts).toHaveLength(s.fronts!.length);
    expect(after.fronts![0].title).toBe(s.fronts![0].title);
    expect(after.fronts![0].stages[1]).toEqual(s.fronts![0].stages[1]);
    expect(after.fronts![0].stages[0].title).toMatch(/^Passo: /);
  });
});

describe('Ida e volta com o servidor (provedor falso)', () => {
  it('ok: aplica; falha: degradado sem frentes (o cliente só marca a tentativa)', async () => {
    const s = world();
    const answer = rewritten(s);
    const ok: LlmProvider = { name: 'fake', generate: async () => ({ text: JSON.stringify(answer), model: 'fake-1', usage: {}, attempts: [{ model: 'fake-1', ok: true, latencyMs: 1 }] }) };
    const env = await createGameMaster(ok, () => {}).worldgen(buildWorldgenRequest(s)!);
    expect(env.meta.purpose).toBe('worldgen');
    expect(applyWorldgen(s, env.payload).fronts!.every(f => f.polished)).toBe(true);

    const broken: LlmProvider = {
      name: 'fake',
      generate: async () => {
        throw new Error('503');
      },
    };
    const bad = await createGameMaster(broken, () => {}).worldgen(buildWorldgenRequest(s)!);
    expect(bad.payload).toEqual({ fronts: [], degraded: true });
  });
});
