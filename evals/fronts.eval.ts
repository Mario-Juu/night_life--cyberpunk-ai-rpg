/**
 * Frentes do mundo: tramas montadas por mistura de átomos (seed da campanha), que andam sozinhas
 * com o relógio e soltam manchetes, boatos, mensagens e ganchos de cena.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { STORY_CATALOG } from '../shared/rules/storyCatalog';
import { MIN_AGE } from '../shared/rules/creation';
import { migrateState } from '../shared/engine/migrate';
import { FRONTS_PER_RUN, REPLENISH_HOURS, changeFront, generateFronts, processFronts, repairFronts, replenishFronts, unreadNews, markNewsRead } from '../shared/engine/fronts';
import { noteInteraction } from '../shared/engine/npcProfile';
import { pendingOffscreen } from '../shared/engine/world';
import { applyNarration, beginTurn, finalizeTurn } from '../shared/engine/turn';
import { buildGameContext } from '../shared/engine/context';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import { advanceGameTime } from '../shared/rules/world';
import type { GameState } from '../shared/types/game';

const withFronts = (seed = 'teste', over = {}) => generateFronts(scenario(over).state, { seed });
const front = (s: GameState, i = 0) => s.fronts![i];
/** Pula o relógio até o próximo passo da frente (sem passar pelo turno). */
const jumpTo = (s: GameState, at: string): GameState => processFronts({ ...s, world: { ...s.world, time: at } });

describe('Catálogo', () => {
  const c = STORY_CATALOG;
  const keys = (list: Array<{ key: string }>) => new Set(list.map(x => x.key));

  it('toda chave referenciada existe e toda premissa tem alguém compatível', () => {
    const arcs = keys(c.arcs);
    const places = keys(c.places);
    for (const p of c.premises) {
      for (const a of p.arcs ?? []) expect(arcs.has(a), `${p.key} → arco ${a}`).toBe(true);
      for (const pl of p.places ?? []) expect(places.has(pl), `${p.key} → fachada ${pl}`).toBe(true);
      const who = c.who.filter(w => p.needs.every(n => w.tags.includes(n)) && (!p.needsAny?.length || p.needsAny.some(n => w.tags.includes(n))));
      expect(who.length, `${p.key} sem quem compatível`).toBeGreaterThan(0);
    }
  });

  it('chaves únicas, intervalos de horas válidos e nenhuma lacuna desconhecida', () => {
    for (const list of [c.premises, c.who, c.places, c.motives, c.victims, c.twists, c.arcs, c.seeds]) expect(keys(list).size).toBe(list.length);
    const texts = JSON.stringify(c);
    expect(texts.match(/\{(\w+)\}/g)?.filter(t => !['{who}', '{place}', '{victim}', '{seed}', '{district}', '{motive}'].includes(t)) ?? []).toEqual([]);
    for (const a of c.arcs) for (const st of a.stages) expect(st.hours[0]).toBeLessThanOrEqual(st.hours[1]);
  });
});

describe('Geração por mistura', () => {
  it('determinística pela seed; seeds diferentes dão runs diferentes', () => {
    const a = withFronts('x');
    expect(withFronts('x').fronts).toEqual(a.fronts);
    const runs = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(seed => withFronts(seed).fronts!.map(f => f.atoms.premise + f.atoms.who).join('|')));
    expect(runs.size).toBeGreaterThan(4);
  });

  it(`${FRONTS_PER_RUN} frentes sem repetir premissa, quem ou arco; tudo preenchido e coerente`, () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const s = withFronts(seed);
      const fronts = s.fronts!;
      expect(fronts).toHaveLength(FRONTS_PER_RUN);
      for (const axis of ['premise', 'who', 'arc'] as const) expect(new Set(fronts.map(f => f.atoms[axis])).size).toBe(fronts.length);
      for (const f of fronts) {
        expect(JSON.stringify(f)).not.toMatch(/\{(who|place|victim|seed|district|motive)\}/);
        const premise = STORY_CATALOG.premises.find(p => p.key === f.atoms.premise)!;
        const who = STORY_CATALOG.who.find(w => w.key === f.atoms.who)!;
        expect(premise.needs.every(n => who.tags.includes(n))).toBe(true);
        if (premise.arcs?.length) expect(premise.arcs).toContain(f.arc);
        expect(f.stages.length).toBeGreaterThanOrEqual(4);
        expect(new Date(f.nextAt).getTime()).toBeGreaterThan(new Date(s.world.time).getTime());
      }
    }
  });

  it('a ficha puxa premissas: dívida de cassino traz mais tramas de dívida do que uma ficha sem dívida', () => {
    const debtHooks = (over: object) =>
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].reduce((n, seed) => n + withFronts(seed, over).fronts!.filter(f => STORY_CATALOG.premises.find(p => p.key === f.atoms.premise)?.hooks?.includes('divida')).length, 0);
    expect(debtHooks({ debtReason: 'Devo ao cassino e ao agiota' })).toBeGreaterThan(debtHooks({ debtReason: 'Quero ver o mar', familyTie: 'ninguém', occupation: 'Pintor' }));
  });

  it('rosto e vítima existem fora de cena (fora do Diário) até o jogador interagir', () => {
    let s = withFronts();
    const seed = s.npcs.find(n => n.id === front(s).seedNpcId)!;
    expect(seed).toMatchObject({ offstage: true, isContact: false, importance: 'recurring' });
    expect(seed.profile?.traits.length).toBeGreaterThan(0);
    expect(s.npcs.find(n => n.id === front(s).victimNpcId)?.offstage).toBe(true);
    s = noteInteraction({ ...s, turn: s.turn + 1 }, [seed.id]);
    expect(s.npcs.find(n => n.id === seed.id)?.offstage).toBeUndefined();
  });

  it('não regera frentes de quem já tem; facção nova aparece quando quem está por trás não existia', () => {
    const s = withFronts();
    expect(generateFronts(s, { seed: 'outra' })).toBe(s);
    for (const f of s.fronts!) if (f.factionId) expect(s.factions.some(x => x.id === f.factionId)).toBe(true);
  });
});

describe('O relógio do mundo', () => {
  it('passo vencido dispara os efeitos; tempo pulado dispara vários; a última etapa conclui a trama', () => {
    let s = withFronts();
    const f = front(s);
    s = jumpTo(s, f.nextAt);
    expect(front(s).stage).toBe(1);
    const firstNews = f.stages[0].effects.filter(e => e.kind === 'news').length;
    expect((s.news ?? []).filter(n => n.frontId === f.id)).toHaveLength(firstNews);
    s = jumpTo(s, advanceGameTime(s.world.time, 24 * 60 * 30));
    expect(s.fronts!.every(x => x.status === 'resolved')).toBe(true);
    expect(s.flags[`${f.id}_concluida`]?.value).toBe(true);
  });

  it('rosto que o jogador não conhece não manda SMS do nada: vira gancho de cena para o narrador', () => {
    let s = withFronts();
    const i = s.fronts!.findIndex(f => f.stages.some(st => st.effects.some(e => e.kind === 'message')));
    expect(i).toBeGreaterThanOrEqual(0);
    const f = front(s, i);
    const stage = f.stages.findIndex(st => st.effects.some(e => e.kind === 'message'));
    for (let k = 0; k <= stage; k++) s = changeFrontOk(s, f.id, 'advance');
    expect(s.phone.some(t => t.npcId === f.seedNpcId)).toBe(false);
    expect(pendingOffscreen(s).some(t => t.includes(s.npcs.find(n => n.id === f.seedNpcId)!.name))).toBe(true);
  });

  it('rosto já conhecido (contato) manda a mensagem pelo Agent', () => {
    let s = withFronts();
    const i = s.fronts!.findIndex(f => f.stages.some(st => st.effects.some(e => e.kind === 'message')));
    const f = front(s, i);
    s = { ...s, npcs: s.npcs.map(n => (n.id === f.seedNpcId ? { ...n, offstage: undefined, isContact: true } : n)) };
    const stage = f.stages.findIndex(st => st.effects.some(e => e.kind === 'message'));
    for (let k = 0; k <= stage; k++) s = changeFrontOk(s, f.id, 'advance');
    expect(s.phone.find(t => t.npcId === f.seedNpcId)?.messages.length).toBeGreaterThan(0);
  });

  it('vítima morta não "some" depois', () => {
    let s = withFronts();
    const f = front(s);
    s = { ...s, npcs: s.npcs.map(n => (n.id === f.victimNpcId ? { ...n, status: 'dead' as const } : n)) };
    s = jumpTo(s, advanceGameTime(s.world.time, 24 * 60 * 30));
    expect(s.npcs.find(n => n.id === f.victimNpcId)?.status).toBe('dead');
  });

  it('o fim do turno faz o mundo andar (pipeline real)', () => {
    let s = withFronts();
    s = { ...s, world: { ...s.world, time: front(s).nextAt } };
    const step = finalizeTurn(applyNarration(beginTurn(s, 'espero'), { narration: 'O tempo passa.', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [] }), []);
    expect(front(step.state).stage).toBe(1);
  });

  it('manchetes novas contam como não lidas até abrir o NCNet', () => {
    let s = jumpTo(withFronts(), advanceGameTime(withFronts().world.time, 24 * 60 * 3));
    expect(unreadNews(s)).toBeGreaterThan(0);
    s = markNewsRead(s);
    expect(unreadNews(s)).toBe(0);
  });
});

function changeFrontOk(s: GameState, id: string, change: Parameters<typeof changeFront>[2]): GameState {
  const res = changeFront(s, id, change);
  if ('error' in res) throw new Error(res.error);
  return res.state;
}

describe('front_update (o jogador interfere)', () => {
  it('delay adia 24h; stop detém de vez (flag pública) e nada mais dispara', () => {
    const sc = scenario();
    sc.state = generateFronts(sc.state, { seed: 'teste' });
    const f = front(sc.state);
    sc.tool('narrator', 'front_update', { frontId: f.id, change: 'delay', reason: 'o jogador avisou os vizinhos' });
    expect(front(sc.state).nextAt).toBe(advanceGameTime(f.nextAt, 24 * 60));
    sc.tool('narrator', 'front_update', { frontId: f.id, change: 'stop', reason: 'queimou o caixa' });
    expect(front(sc.state).status).toBe('averted');
    expect(sc.state.flags[`${f.id}_detida`]).toMatchObject({ value: true, visibility: 'public' });
    sc.state = jumpTo(sc.state, advanceGameTime(sc.state.world.time, 24 * 60 * 30));
    expect(front(sc.state).stage).toBe(0);
    sc.tool('narrator', 'front_update', { frontId: f.id, change: 'advance' });
    expect(sc.last().ok).toBe(false);
  });

  it('hint/reveal sobem o que o jogador sabe; id inventado falha', () => {
    const sc = scenario();
    sc.state = generateFronts(sc.state, { seed: 'teste' });
    const id = front(sc.state).id;
    sc.tool('narrator', 'front_update', { frontId: id, change: 'hint' });
    expect(front(sc.state).playerAware).toBe('suspects');
    sc.tool('narrator', 'front_update', { frontId: id, change: 'reveal' });
    expect(front(sc.state).playerAware).toBe('yes');
    sc.tool('narrator', 'front_update', { frontId: 'front_x', change: 'advance' });
    expect(sc.last().ok).toBe(false);
  });
});

describe('Contexto do narrador', () => {
  it('NA CIDADE traz a trama com a reviravolta marcada como SÓ VOCÊ SABE, o próximo passo e as manchetes', () => {
    let s = withFronts();
    s = jumpTo(s, front(s).nextAt);
    const prompt = buildNarratePrompt(buildGameContext(s, 'olho o bairro'), { kind: 'action', playerInput: 'olho o bairro', engineResult: null });
    const f = front(s);
    expect(prompt).toContain(`[${f.id}] ${f.title}`);
    if (f.twist) expect(prompt).toContain(`reviravolta (SÓ VOCÊ SABE): ${f.twist}`);
    expect(prompt).toContain(`próximo (`);
    expect(prompt).toContain('o jogador NÃO sabe da trama');
    const headline = s.news?.at(-1)?.headline;
    if (headline) expect(prompt).toContain(headline);
  });
});

describe('O mundo não para (reposição e continuações)', () => {
  const stopFirst = (s: GameState) => changeFrontOk(s, front(s).id, 'stop');
  const later = (s: GameState, hours: number) => ({ ...s, world: { ...s.world, time: advanceGameTime(s.world.time, hours * 60) } });

  it('com 3 ativas nada entra; uma acaba → espera o intervalo → entra outra, sem repetir premissa', () => {
    let s = withFronts();
    expect(replenishFronts(later(s, 24 * 10)).fronts).toHaveLength(FRONTS_PER_RUN);
    s = stopFirst(s);
    expect(replenishFronts(later(s, REPLENISH_HOURS[0] - 1)).fronts).toHaveLength(FRONTS_PER_RUN);
    s = replenishFronts(later(s, REPLENISH_HOURS[1]));
    expect(s.fronts).toHaveLength(FRONTS_PER_RUN + 1);
    expect(s.fronts!.filter(f => f.status === 'active')).toHaveLength(FRONTS_PER_RUN);
    expect(new Set(s.fronts!.map(f => f.atoms.premise)).size).toBe(s.fronts!.length);
    expect(new Set(s.fronts!.map(f => f.id)).size).toBe(s.fronts!.length);
    const fresh = s.fronts!.at(-1)!;
    expect(fresh.createdAt).toBe(s.world.time);
    expect(new Date(fresh.nextAt).getTime()).toBeGreaterThan(new Date(s.world.time).getTime());
  });

  it('continuação: mesmo grupo por trás, mesmo rosto (vivo) e o narrador sabe do desfecho', () => {
    const seq = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map(seed => {
      const base = stopFirst(withFronts(seed));
      return { base, after: replenishFronts(later(base, REPLENISH_HOURS[1]), { seed }) };
    });
    const sequels = seq.filter(x => x.after.fronts!.at(-1)?.parentId);
    expect(sequels.length).toBeGreaterThan(0);
    expect(sequels.length).toBeLessThan(seq.length);
    for (const { base, after } of sequels) {
      const child = after.fronts!.at(-1)!;
      const parent = base.fronts!.find(f => f.id === child.parentId)!;
      expect(child.atoms.who).toBe(parent.atoms.who);
      expect(child.seedNpcId).toBe(parent.seedNpcId);
      const prompt = buildNarratePrompt(buildGameContext(after, ''), { kind: 'action', playerInput: 'olho', engineResult: null });
      expect(prompt).toContain(`CONTINUAÇÃO de "${parent.title}", que foi detida pelo jogador (o grupo quer revanche)`);
    }
  });

  it('rosto morto não volta: a continuação ganha um rosto novo', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']) {
      let base = stopFirst(withFronts(seed));
      base = { ...base, npcs: base.npcs.map(n => (n.id === front(base).seedNpcId ? { ...n, status: 'dead' as const } : n)) };
      const child = replenishFronts(later(base, REPLENISH_HOURS[1]), { seed }).fronts!.at(-1)!;
      if (child.parentId) expect(child.seedNpcId).not.toBe(front(base).seedNpcId);
    }
  });

  it('90 dias de jogo: nunca mais que 3 ativas, tramas novas continuam surgindo e o mundo não esvazia', () => {
    let s = withFronts('longo');
    let maxActive = 0;
    for (let h = 0; h < 24 * 90; h += 6) {
      s = replenishFronts(processFronts(later(s, 6)), { seed: 'longo' });
      maxActive = Math.max(maxActive, s.fronts!.filter(f => f.status === 'active').length);
    }
    expect(maxActive).toBeLessThanOrEqual(FRONTS_PER_RUN);
    expect(s.fronts!.length).toBeGreaterThan(FRONTS_PER_RUN * 3);
    expect(s.fronts!.filter(f => f.status === 'active').length).toBeGreaterThan(0);
    expect(s.fronts!.some(f => f.parentId)).toBe(true);
  });

  it('o fim do turno repõe (pipeline real)', () => {
    let s = later(stopFirst(withFronts()), REPLENISH_HOURS[1]);
    s = finalizeTurn(applyNarration(beginTurn(s, 'espero'), { narration: 'O tempo passa.', dialogues: [], toolCalls: [], discoveries: [], suggestedActions: [], enemyActions: [] }), []).state;
    expect(s.fronts!.filter(f => f.status === 'active')).toHaveLength(FRONTS_PER_RUN);
  });
});

describe('Filtro de conteúdo do Google (run real do T15)', () => {
  it('rosto e vítima fora de cena não vão para o contexto do narrador (só se citados)', () => {
    const s = withFronts();
    const offstage = s.npcs.filter(n => n.offstage);
    expect(offstage.length).toBeGreaterThan(0);
    const names = buildGameContext(s, 'olho a rua').npcs.map(n => n.id);
    for (const n of offstage) expect(names).not.toContain(n.id);
    const first = offstage[0].name.split(' ')[0];
    expect(buildGameContext(s, `pergunto sobre ${first}`).npcs.map(n => n.id)).toContain(offstage[0].id);
  });

  it('catálogo sem trabalho sexual (o protagonista pode ser menor) e saves antigos são reparados', () => {
    expect(JSON.stringify(STORY_CATALOG)).not.toMatch(/acompanhante|joytoy|garotas/i);
    let s = withFronts();
    const f = front(s);
    s = { ...s, fronts: s.fronts!.map((x, i) => (i === 0 ? { ...x, victim: 'acompanhantes independentes', atoms: { ...x.atoms, victim: 'joytoys_independentes' } } : x)), npcs: s.npcs.map(n => (n.id === f.victimNpcId ? { ...n, role: 'Acompanhante independente' } : n)) };
    const fixed = repairFronts(s);
    expect(front(fixed).atoms.victim).toBe('ambulantes');
    expect(fixed.npcs.find(n => n.id === f.victimNpcId)?.role).toBe('Ambulante');
    expect(repairFronts(fixed)).toBe(fixed);
  });
});

describe('Idade mínima 18 (filtro do Gemini)', () => {
  it('criação nunca gera menor de idade', () => {
    expect(scenario({ age: 16 }).state.character.bio.age).toBe(MIN_AGE);
    expect(scenario({ age: 17 }).state.character.bio.age).toBe(MIN_AGE);
    expect(scenario({ age: 30 }).state.character.bio.age).toBe(30);
  });

  it('save antigo com 17 anos sobe para 18 ao carregar', () => {
    const s = scenario().state;
    const old = { ...s, character: { ...s.character, bio: { ...s.character.bio, age: 17 } } };
    expect(migrateState(JSON.parse(JSON.stringify(old))).character.bio.age).toBe(18);
  });
});

describe('Temas adultos (bonecas, Mox, BD erótico) isolados', () => {
  const viceKeys = new Set(STORY_CATALOG.premises.filter(p => p.tags.includes('vice')).map(p => p.key));
  const allVice = () => {
    const out: Array<{ s: GameState; f: GameState['fronts'] extends (infer T)[] | undefined ? T : never }> = [];
    for (let i = 0; i < 120; i++) {
      const s = generateFronts(scenario().state, { seed: `vice-${i}` });
      for (const f of s.fronts!) if (viceKeys.has(f.atoms.premise)) out.push({ s, f });
    }
    return out;
  };

  it('o catálogo não tem menores de idade em lugar nenhum', () => {
    expect(JSON.stringify(STORY_CATALOG)).not.toMatch(/adolescent|criança|menor de idade|garot[oa]s? de (1[0-7]|[0-9])\b/i);
    expect(viceKeys.size).toBeGreaterThanOrEqual(4);
  });

  it('trama adulta só com vítima e rosto do tema, sem família por perto; tramas comuns nunca puxam vítimas do tema', () => {
    const vice = allVice();
    expect(vice.length).toBeGreaterThan(5);
    for (const { s, f } of vice) {
      const premise = STORY_CATALOG.premises.find(p => p.key === f.atoms.premise)!;
      expect(premise.victims).toContain(f.atoms.victim);
      expect(STORY_CATALOG.seeds.find(a => a.key === f.atoms.seed)?.fits).toContain('vice');
      expect(f.twist).not.toMatch(/parente|famíli|filh[oa]|irm[ãa]|mãe/i);
      expect(f.arc).not.toBe('escalada_de_cobranca');
      expect(s.npcs.find(n => n.id === f.victimNpcId)?.role).toBeTruthy();
    }
    const viceVictims = new Set(STORY_CATALOG.victims.filter(v => v.vice).map(v => v.key));
    for (let i = 0; i < 60; i++)
      for (const f of generateFronts(scenario().state, { seed: `comum-${i}` }).fronts!) if (!viceKeys.has(f.atoms.premise)) expect(viceVictims.has(f.atoms.victim)).toBe(false);
  });
});
