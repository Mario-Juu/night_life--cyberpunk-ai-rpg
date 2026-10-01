/**
 * NPCs com profundidade: personalidade, objetivos, vínculos e o que o JOGADOR sabe de cada coisa.
 * A consciência do jogador só muda por reveal_npc — base para o narrador não quebrar diálogos.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { playerViewOf } from '../shared/engine/npcProfile';
import { repairNpcs } from '../shared/engine/npcs';
import { checkNarration, leakedSecrets } from '../shared/engine/consistency';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import { isSevereWarning } from '../server/gamemaster/gameMaster';

const withKiro = () =>
  scenario()
    .tool('narrator', 'upsert_npc', { name: 'Kiro', role: 'Químico de rua', currentGoal: 'Vender o lote dourado', present: true })
    .tool('narrator', 'npc_profile', { npcId: 'Kiro', traits: 'ansioso, generoso, mentiroso compulsivo', voice: 'fala rápido, ri nervoso', motivation: 'provar que é melhor que o ex-chefe' })
    .tool('narrator', 'upsert_npc', { name: 'Kiro', knowledge: 'O estimulante dourado foi roubado do laboratório da Biotechnica', secret: true });

describe('Perfil do NPC', () => {
  it('npc_profile grava e mescla (traços em texto viram lista; campos ausentes ficam)', () => {
    const sc = withKiro().tool('narrator', 'npc_profile', { npcId: 'Kiro', afraidOf: 'a Biotechnica' });
    const kiro = sc.npc('Kiro')!;
    expect(kiro.profile?.traits).toEqual(['ansioso', 'generoso', 'mentiroso compulsivo']);
    expect(kiro.profile?.voice).toBe('fala rápido, ri nervoso');
    expect(kiro.profile?.fear).toBe('a Biotechnica');
  });

  it('animal não tem perfil de pessoa', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Mingau', kind: 'animal' }).tool('narrator', 'npc_profile', { npcId: 'Mingau', traits: 'preguiçoso' });
    expect(sc.last().ok).toBe(false);
  });

  it('o Rafa inicial já tem personalidade, e saves antigos ganham a mesma', () => {
    const sc = scenario();
    expect(sc.npc('npc_rafa')?.profile?.traits.length).toBeGreaterThan(0);
    const old = sc.edit(s => ({ ...s, npcs: s.npcs.map(n => (n.id === 'npc_rafa' ? { ...n, profile: undefined } : n)) })).state;
    expect(repairNpcs(old).npcs.find(n => n.id === 'npc_rafa')?.profile?.voice).toMatch(/choom/);
  });
});

describe('O que o jogador sabe', () => {
  it('segredo novo fica escondido do Diário; reveal_npc mostra com o "como"', () => {
    const sc = withKiro();
    const fact = sc.npc('Kiro')!.knowledge[0];
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).facts).toEqual([]);

    sc.tool('narrator', 'reveal_npc', { npcId: 'Kiro', itemId: fact.id, level: 'suspects' });
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).facts[0]).toMatchObject({ suspected: true });

    sc.tool('narrator', 'reveal_npc', { npcId: 'Kiro', itemId: fact.id, how: 'achou a etiqueta da Biotechnica no frasco' });
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).facts[0]).toMatchObject({ suspected: false, secret: true, how: 'achou a etiqueta da Biotechnica no frasco' });
  });

  it('quem já sabe não "desaprende" (revelar de novo ou rebaixar falha)', () => {
    const sc = withKiro();
    const id = sc.npc('Kiro')!.knowledge[0].id;
    sc.tool('narrator', 'reveal_npc', { npcId: 'Kiro', itemId: id });
    sc.tool('narrator', 'reveal_npc', { npcId: 'Kiro', itemId: id, level: 'suspects' });
    expect(sc.last().ok).toBe(false);
    expect(sc.npc('Kiro')!.knowledge[0].playerKnows).toBe('yes');
  });

  it('id inventado falha com orientação', () => {
    const sc = withKiro().tool('narrator', 'reveal_npc', { npcId: 'Kiro', itemId: 'fact_nao_existe' });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/id listado no contexto/);
  });

  it('objetivo imediato: escondido por padrão; goalKnown ou reveal mostram; trocar de objetivo esconde de novo', () => {
    const sc = withKiro();
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).currentGoal).toBeUndefined();
    sc.tool('narrator', 'reveal_npc', { npcId: 'Kiro', itemId: 'current_goal' });
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).currentGoal).toBe('Vender o lote dourado');
    sc.tool('narrator', 'upsert_npc', { name: 'Kiro', currentGoal: 'Sumir de Westbrook' });
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).currentGoal).toBeUndefined();
    sc.tool('narrator', 'upsert_npc', { name: 'Kiro', currentGoal: 'Pagar o Rafa', goalKnown: true });
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).currentGoal).toBe('Pagar o Rafa');
  });

  it('objetivos de longo prazo: cria escondido, atualiza status pelo id', () => {
    const sc = withKiro().tool('narrator', 'npc_goal', { npcId: 'Kiro', text: 'Abrir o próprio laboratório' });
    const goal = sc.npc('Kiro')!.goals![0];
    expect(goal).toMatchObject({ status: 'active', playerKnows: 'no' });
    sc.tool('narrator', 'npc_goal', { npcId: 'Kiro', goalId: goal.id, status: 'done' });
    expect(sc.npc('Kiro')!.goals![0].status).toBe('done');
    sc.tool('narrator', 'npc_goal', { npcId: 'Kiro', goalId: 'goal_x', status: 'done' });
    expect(sc.last().ok).toBe(false);
  });

  it('vínculo com NPC ou facção; alvo desconhecido falha', () => {
    const sc = withKiro().tool('narrator', 'npc_bond', { npcId: 'Kiro', targetId: 'npc_rafa', kind: 'deve_a', note: 'deve €$2000' });
    expect(sc.last().ok).toBe(true);
    sc.tool('narrator', 'npc_bond', { npcId: 'Kiro', targetId: 'NCPD', kind: 'rival' });
    expect(sc.npc('Kiro')!.bonds!.map(b => b.targetId)).toEqual(['npc_rafa', 'fac_ncpd']);
    sc.tool('narrator', 'npc_bond', { npcId: 'Kiro', targetId: 'Arasaka Fantasma', kind: 'rival' });
    expect(sc.last().ok).toBe(false);
    expect(playerViewOf(sc.state, sc.npc('Kiro')!).bonds).toEqual([]);
  });

  it('sobrevive a recarregar a campanha', () => {
    const sc = withKiro().tool('narrator', 'npc_goal', { npcId: 'Kiro', text: 'Abrir o próprio laboratório', playerKnows: true }).reload();
    expect(sc.npc('Kiro')!.profile?.traits).toContain('ansioso');
    expect(sc.npc('Kiro')!.goals![0].playerKnows).toBe('yes');
  });
});

describe('Contexto do narrador', () => {
  it('separa SABE / SÓ VOCÊ SABE e traz o perfil e os ids para revelar', () => {
    const sc = withKiro();
    const prompt = buildNarratePrompt(sc.context('Kiro'), { kind: 'action', playerInput: 'falo com o Kiro', engineResult: null });
    const fact = sc.npc('Kiro')!.knowledge[0];
    expect(prompt).toContain('PERFIL — traços: ansioso, generoso, mentiroso compulsivo');
    expect(prompt).toContain(`SÓ VOCÊ SABE (ninguém age como se o jogador soubesse): [${fact.id}] ${fact.fact}`);
    expect(prompt).toContain('quer agora [current_goal]: Vender o lote dourado (SÓ VOCÊ SABE)');
  });
});

describe('Vazamento de segredo (aviso que só registra)', () => {
  const narration = 'Kiro ri nervoso e confessa: o estimulante dourado foi roubado do laboratório da Biotechnica.';

  it('narração contando o segredo sem reveal_npc gera aviso NÃO grave', () => {
    const sc = withKiro();
    const w = checkNarration(null, narration, [], sc.state.npcs);
    expect(w.some(x => /vazamento de segredo de Kiro/.test(x))).toBe(true);
    expect(w.some(isSevereWarning)).toBe(false);
  });

  it('com reveal_npc no mesmo turno, nada a avisar; texto sem relação também não', () => {
    const sc = withKiro();
    const id = sc.npc('Kiro')!.knowledge[0].id;
    expect(leakedSecrets(narration, sc.state.npcs, [{ tool: 'reveal_npc', args: { npcId: 'Kiro', itemId: id } }])).toEqual([]);
    expect(leakedSecrets('Kiro te oferece um frasco dourado e sorri.', sc.state.npcs)).toEqual([]);
  });
});
