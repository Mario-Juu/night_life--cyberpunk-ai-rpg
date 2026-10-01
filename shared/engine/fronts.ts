/**
 * Frentes do mundo: tramas que andam sozinhas com o relógio do jogo.
 * Geração = mistura sorteada (seed da campanha) de átomos do catálogo; disparo = efeitos já existentes
 * (notícia, SMS do rosto da trama, NPC some/morre, flag, gancho de cena para o narrador).
 */
import type { Faction, Front, FrontEffect, FrontStage, GameState, NewsItem, NewsSource, Npc, ScheduledEvent } from '../types/game';
import type { WorldgenRequest, WorldgenResponse } from '../types/gm';
import type { ArcEffectTemplate, AtomGender, AtomHook, AtomTag, PremiseAtom, StoryCatalog, WhoAtom } from '../rules/storyAtoms';
import { STORY_CATALOG } from '../rules/storyCatalog';
import { advanceGameTime, getDistrict } from '../rules/world';
import { seededRng, type Rng } from './dice';
import { emit } from './events';
import { makeId, slugId } from './ids';
import { setFlag, setNpcStatus, deliverMessage, normalizeFlagKey } from './world';

export const FRONTS_PER_RUN = 3;
export const MAX_NEWS = 40;

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Sorteio ponderado (pesos ≤ 0 ficam de fora). */
function pick<T>(rng: Rng, items: T[], weight: (t: T) => number = () => 1): T | undefined {
  const weighted = items.map(t => ({ t, w: Math.max(0, weight(t)) })).filter(x => x.w > 0);
  const total = weighted.reduce((n, x) => n + x.w, 0);
  if (!total) return undefined;
  // rng(n) devolve 1..n: sorteia em milésimos para pesos fracionários.
  let roll = ((rng(1_000_000) - 1) / 1_000_000) * total;
  for (const x of weighted) {
    roll -= x.w;
    if (roll < 0) return x.t;
  }
  return weighted[weighted.length - 1].t;
}

const between = (rng: Rng, [min, max]: [number, number]) => min + rng(Math.max(1, max - min + 1)) - 1;
const overlap = (a: readonly string[], b: readonly string[]) => a.filter(x => b.includes(x)).length;
const hasAll = (have: readonly string[], need: readonly string[] = []) => need.every(n => have.includes(n));
const hasAny = (have: readonly string[], need: readonly string[] = []) => !need.length || need.some(n => have.includes(n));
/** Texto que envolve a família/parentes do jogador (fica longe de tramas adultas). */
const FAMILY_RE = /parente|famíli|filh[oa]|irm[ãa]|mãe|pai\b/i;
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** De → do/da, em → no/na, por → pelo/pela, a → ao/à. */
const CONTRACTION: Record<string, Record<string, string>> = {
  de: { o: 'do', a: 'da', os: 'dos', as: 'das', um: 'dum', uma: 'duma' },
  em: { o: 'no', a: 'na', os: 'nos', as: 'nas', um: 'num', uma: 'numa' },
  por: { o: 'pelo', a: 'pela', os: 'pelos', as: 'pelas' },
  a: { o: 'ao', a: 'à', os: 'aos', as: 'às' },
};

/**
 * Junta preposição e artigo depois de preencher as lacunas: os átomos trazem "em {place}" e o lugar
 * já vem com artigo ("o mercado noturno"), o que renderia "em o mercado noturno".
 */
export function contractions(text: string): string {
  return text.replace(/\b(de|em|por|a)\s+(o|a|os|as|um|uma)\b/gi, (whole, prep: string, art: string) => {
    const joined = CONTRACTION[prep.toLowerCase()]?.[art.toLowerCase()];
    if (!joined) return whole;
    return prep[0] === prep[0].toUpperCase() ? joined.charAt(0).toUpperCase() + joined.slice(1) : joined;
  });
}

/** Palavras da ficha que indicam cada gancho. */
const HOOK_WORDS: Record<AtomHook, string[]> = {
  divida: ['divid', 'deve', 'devendo', 'aluguel', 'agiota', 'cassino', 'emprest', 'atrasad', 'cobra', 'conta'],
  familia: ['irma', 'irmao', 'mae', 'pai', 'filh', 'avo', 'famili', 'primo', 'prima', 'tia', 'tio', 'esposa', 'marido', 'namorad'],
  trabalho: ['entreg', 'motoboy', 'courier', 'app', 'turno', 'fabrica', 'oficina', 'mecanic', 'bico', 'corre', 'garcom', 'segurança', 'seguranca'],
};

const CATEGORY: Record<WhoAtom['kind'], Faction['category']> = { gang: 'Gang', corp: 'Megacorp', police: 'Polícia', fixer: 'Outro', other: 'Outro' };

/** Facção de quem está por trás: reaproveita a existente (mesmo nome) ou cria. */
function ensureFaction(state: GameState, who: WhoAtom): { state: GameState; factionId?: string } {
  if (who.kind === 'fixer' || who.kind === 'other') return { state };
  const existing = state.factions.find(f => norm(f.name) === norm(who.name));
  if (existing) return { state, factionId: existing.id };
  const faction: Faction = { id: `fac_${who.key}`, name: who.name, category: CATEGORY[who.kind], standing: 0, description: `${who.name} age nas sombras desta campanha.` };
  return { state: { ...state, factions: [...state.factions, faction] }, factionId: faction.id };
}

/** NPC que existe no mundo mas o jogador ainda não conheceu (fora do Diário e dos contatos). */
function offstageNpc(state: GameState, partial: Pick<Npc, 'name' | 'role'> & Partial<Npc>): { state: GameState; npc: Npc } {
  const base = slugId('npc', partial.name);
  const npc: Npc = {
    id: state.npcs.some(n => n.id === base) ? `${base}_${state.npcs.length}` : base,
    description: '',
    trust: 0,
    respect: 30,
    fear: 0,
    anger: 0,
    knowledge: [],
    status: 'alive',
    isContact: false,
    offstage: true,
    ...partial,
  };
  return { state: { ...state, npcs: [...state.npcs, npc] }, npc };
}

/** Palavras da ficha que puxam premissas (dívida, ocupação, laço, papel). */
function bioText(state: GameState): string {
  const b = state.character.bio;
  return norm([b.debtReason, b.occupation, b.familyTie, b.role, b.personalAnchor].filter(Boolean).join(' '));
}

function takeName(rng: Rng, catalog: StoryCatalog, state: GameState, used: Set<string>, gender?: AtomGender): string {
  const taken = new Set(state.npcs.map(n => norm(n.name).split(/\s+/)[0]));
  const fits = catalog.names.filter(([, g]) => !gender || g === gender);
  const free = fits.filter(([n]) => !used.has(n) && !taken.has(norm(n).split(/\s+/)[0]));
  const name = pick(rng, free.length ? free : fits.length ? fits : catalog.names)?.[0] ?? 'Sem-Nome';
  used.add(name);
  return name;
}

/** Átomos já usados nesta campanha (não repetir premissa, arco, fachada, reviravolta nem rosto). */
interface Used {
  premise: Set<string>;
  who: Set<string>;
  place: Set<string>;
  arc: Set<string>;
  twist: Set<string>;
  seed: Set<string>;
  names: Set<string>;
}

function usedFrom(state: GameState): Used {
  const fronts = state.fronts ?? [];
  const atoms = (axis: string) => new Set(fronts.map(f => f.atoms[axis]).filter(Boolean));
  return {
    premise: atoms('premise'),
    // Quem está por trás só fica bloqueado enquanto a trama dele está ativa.
    who: new Set(fronts.filter(f => f.status === 'active').map(f => f.atoms.who)),
    place: atoms('place'),
    arc: atoms('arc'),
    twist: atoms('twist'),
    seed: atoms('seed'),
    names: new Set(),
  };
}

/** Continuação: herda quem está por trás (e o rosto, se vivo) de uma trama que acabou. */
interface Sequel {
  parent: Front;
}

/** Monta UMA frente (sorteio dos átomos + NPCs fora de cena). null = o catálogo não tem combinação válida. */
function buildFront(state: GameState, rng: Rng, catalog: StoryCatalog, used: Used, sequel?: Sequel): { state: GameState; front: Front } | null {
  const district = getDistrict(state.character.bio.district);
  const bio = bioText(state);
  const parentWho = sequel ? catalog.who.find(w => w.key === sequel.parent.atoms.who) : undefined;
  if (sequel && !parentWho) return null;
  const whoFits = (w: WhoAtom, p: PremiseAtom) => hasAll(w.tags, p.needs) && hasAny(w.tags, p.needsAny);

  // Premissa: as que tocam a ficha pesam mais; nunca repetir na campanha (se acabaram, libera).
  // Continuação: só premissas que o mesmo grupo consegue tocar; detida pelo jogador puxa violência (revanche).
  const fresh = catalog.premises.filter(p => !used.premise.has(p.key) && (!parentWho || whoFits(parentWho, p)));
  const pool = fresh.length ? fresh : catalog.premises.filter(p => !parentWho || whoFits(parentWho, p));
  const revenge = sequel?.parent.status === 'averted';
  const premise = pick(rng, pool, p => 1 + 3 * (p.hooks ?? []).filter(h => HOOK_WORDS[h].some(w => bio.includes(w))).length + (revenge && p.tags.includes('violence') ? 3 : 0));
  if (!premise) return null;
  used.premise.add(premise.key);

  // Quem: precisa ter o que a premissa exige; gangue do bairro pesa mais; nunca o mesmo em duas frentes ativas.
  const who =
    parentWho ??
    pick(
      rng,
      catalog.who.filter(w => !used.who.has(w.key) && whoFits(w, premise)),
      w => 1 + (w.district === district.id ? 3 : w.district === null ? 1 : 0) + overlap(w.tags, premise.tags),
    );
  if (!who) return null;
  used.who.add(who.key);
  const tags: AtomTag[] = [...new Set([...premise.tags, ...who.tags])];
  // Tema adulto isolado: premissa 'vice' só com as vítimas que pede (todas adultas); as outras nunca as sorteiam.
  const isVice = premise.tags.includes('vice');

  // Fachada: do distrito e com cara da PREMISSA (uma casa de penhores não oferece tratamento grátis).
  const inDistrict = catalog.places.filter(p => !used.place.has(p.key) && (p.districts === 'any' || p.districts.includes(district.id)));
  const place =
    pick(rng, inDistrict.filter(p => premise.places?.includes(p.key))) ??
    pick(rng, inDistrict.filter(p => overlap(p.tags, premise.tags) > 0), p => overlap(p.tags, premise.tags) ** 2 + overlap(p.tags, who.tags) * 0.5) ??
    pick(rng, inDistrict) ??
    pick(rng, catalog.places.filter(p => p.districts === 'any' || p.districts.includes(district.id))) ??
    pick(rng, catalog.places);
  if (place) used.place.add(place.key);
  const motive = pick(rng, catalog.motives, m => 1 + 2 * overlap(m.tags, tags));
  const victim = isVice ? pick(rng, catalog.victims.filter(v => premise.victims?.includes(v.key))) : pick(rng, catalog.victims.filter(v => !v.vice && (!premise.victims?.length || premise.victims.includes(v.key)))) ?? pick(rng, catalog.victims.filter(v => !v.vice));
  // Trama adulta nunca puxa família do jogador para perto do tema.
  const twistOk = (t: { text: string; needs?: AtomTag[] }) => hasAny(tags, t.needs) && !(isVice && FAMILY_RE.test(t.text));
  const twist = pick(rng, catalog.twists.filter(t => !used.twist.has(t.key) && twistOk(t))) ?? pick(rng, catalog.twists.filter(twistOk));
  if (twist) used.twist.add(twist.key);

  // Arco: o que a premissa indica; senão, o que combina com as tags DELA (não as de quem está por trás).
  const free = catalog.arcs.filter(a => !used.arc.has(a.key));
  const arc =
    pick(rng, free.filter(a => premise.arcs?.includes(a.key))) ??
    pick(rng, catalog.arcs.filter(a => premise.arcs?.includes(a.key))) ??
    pick(rng, free, a => overlap(a.fits, premise.tags) ** 2) ??
    pick(rng, catalog.arcs);
  if (!arc) return null;
  used.arc.add(arc.key);

  let s = state;
  const fac = ensureFaction(s, who);
  s = fac.state;

  // Rosto: na continuação, o mesmo de antes se ainda estiver vivo; senão, um arquétipo que combine com a premissa.
  const oldFace = sequel ? s.npcs.find(n => n.id === sequel.parent.seedNpcId && n.status !== 'dead') : undefined;
  // Rosto de trama adulta: só arquétipos do tema (nada de família/filhos no mesmo contexto).
  const seeds = catalog.seeds.filter(a => !used.seed.has(a.key) && (!isVice || a.fits.includes('vice')));
  const seedScore = (a: (typeof seeds)[number]) => overlap(a.fits, premise.tags);
  const archetype = oldFace
    ? undefined
    : (pick(rng, seeds.filter(a => seedScore(a) >= 2), a => seedScore(a) ** 2 + overlap(a.fits, who.tags)) ??
      pick(rng, seeds.filter(a => seedScore(a) >= 1), a => 1 + overlap(a.fits, who.tags)) ??
      pick(rng, seeds) ??
      pick(rng, catalog.seeds.filter(a => !isVice || a.fits.includes('vice'))));
  if (archetype) used.seed.add(archetype.key);
  const seedName = oldFace?.name ?? takeName(rng, catalog, s, used.names, archetype?.gender);
  const victimName = takeName(rng, catalog, s, used.names);

  // Maiúscula depois de preencher: "{who} recruta…" com "um canal independente" vira "Um canal…".
  const fill = (t: string) =>
    capitalize(
      contractions(
        t
          .replaceAll('{who}', who.name)
          .replaceAll('{place}', place?.text ?? 'um ponto discreto')
          .replaceAll('{victim}', victim?.text ?? 'gente do bairro')
          .replaceAll('{seed}', seedName)
          .replaceAll('{district}', district.name)
          .replaceAll('{motive}', motive?.text ?? 'dinheiro'),
      ),
    );

  let seedId: string;
  if (oldFace) {
    seedId = oldFace.id;
    s = { ...s, npcs: s.npcs.map(n => (n.id === oldFace.id ? { ...n, currentGoal: fill(premise.text) } : n)) };
  } else {
    const seedRes = offstageNpc(s, {
      name: seedName,
      role: archetype?.role ?? `Rosto de ${who.name}`,
      description: archetype ? fill(archetype.text) : '',
      faction: who.name,
      location: district.id,
      importance: 'recurring',
      profile: archetype ? { traits: [...archetype.traits], voice: archetype.voice } : undefined,
      currentGoal: fill(premise.text),
    });
    s = seedRes.state;
    seedId = seedRes.npc.id;
  }
  const victimRes = offstageNpc(s, { name: victimName, role: victim?.role ?? 'Gente do bairro', description: victim ? fill(victim.text) : '', location: district.id });
  s = victimRes.state;

  const id = `front_${(s.fronts?.length ?? 0) + 1}_${premise.key}`;
  const toEffect = (e: ArcEffectTemplate): FrontEffect | null => {
    switch (e.kind) {
      case 'news':
        return { kind: 'news', source: e.source, headline: fill(e.headline), body: fill(e.body) };
      case 'rumor':
        return { kind: 'news', source: 'Rumor', headline: fill(e.headline), body: fill(e.body) };
      case 'seed_message':
        return { kind: 'message', npcId: seedId, text: fill(e.text) };
      case 'victim_missing':
        return { kind: 'npc_status', npcId: victimRes.npc.id, status: 'missing' };
      case 'victim_dead':
        return { kind: 'npc_status', npcId: victimRes.npc.id, status: 'dead' };
      case 'faction_shift':
        return fac.factionId ? { kind: 'faction', factionId: fac.factionId, delta: e.delta } : null;
      case 'flag': {
        const key = normalizeFlagKey(`${id}_${e.key}`);
        return key ? { kind: 'flag', key, value: true, visibility: 'hidden' } : null;
      }
      case 'scene_hook':
        return { kind: 'scene_hook', text: fill(e.text) };
    }
  };
  const stages: FrontStage[] = arc.stages.map(st => ({
    title: fill(st.title),
    hours: between(rng, st.hours),
    effects: st.effects.map(toEffect).filter((e): e is FrontEffect => !!e),
    blockHint: fill(st.block),
  }));
  const front: Front = {
    id,
    title: fill(premise.text).replace(/\.$/, ''),
    premise: fill(premise.text),
    who: who.name,
    factionId: fac.factionId,
    place: place?.text ?? '',
    motive: motive?.text ?? '',
    victim: victim?.text ?? '',
    twist: twist ? fill(twist.text) : '',
    arc: arc.key,
    seedNpcId: seedId,
    victimNpcId: victimRes.npc.id,
    stage: 0,
    stages,
    status: 'active',
    playerAware: 'no',
    createdAt: s.world.time,
    nextAt: advanceGameTime(s.world.time, (stages[0]?.hours ?? 12) * 60),
    atoms: { premise: premise.key, who: who.key, place: place?.key ?? '', motive: motive?.key ?? '', victim: victim?.key ?? '', twist: twist?.key ?? '', arc: arc.key, seed: archetype?.key ?? sequel?.parent.atoms.seed ?? '' },
    ...(sequel ? { parentId: sequel.parent.id } : {}),
  };
  return { state: { ...s, fronts: [...(s.fronts ?? []), front] }, front };
}

/**
 * Sorteia as frentes iniciais da campanha e cria os NPCs delas (fora de cena). Determinístico pela seed:
 * a mesma campanha sempre gera as mesmas frentes. Não mexe em campanha que já tem frentes.
 */
export function generateFronts(state: GameState, opts: { catalog?: StoryCatalog; count?: number; seed?: string } = {}): GameState {
  if (state.fronts?.length) return state;
  const catalog = opts.catalog ?? STORY_CATALOG;
  if (!catalog.premises.length) return { ...state, fronts: [] };
  const rng = seededRng(`fronts:${opts.seed ?? state.id}`);
  const used = usedFrom(state);
  let s: GameState = { ...state, fronts: [] };
  for (let i = 0; i < (opts.count ?? FRONTS_PER_RUN); i++) {
    const res = buildFront(s, rng, catalog, used);
    if (res) s = res.state;
  }
  const count = s.fronts?.length ?? 0;
  return count ? emit(s, 'SYSTEM', `Mundo: ${count} frente(s) em movimento`, { data: { fronts: s.fronts!.map(f => f.atoms) } }) : s;
}

/** Intervalo (horas de jogo) entre uma trama acabar e outra entrar no lugar. */
export const REPLENISH_HOURS: [number, number] = [12, 36];
/** Chance (em 100) de a nova trama continuar uma que acabou. */
export const SEQUEL_CHANCE = 50;

const timeOf = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

/**
 * O mundo não para: com menos frentes ativas que o normal, depois de um intervalo entra uma nova —
 * às vezes a continuação de uma que acabou (mesmo grupo e mesmo rosto; detida pelo jogador = revanche).
 * Uma por chamada; determinística pela campanha e pela quantidade de frentes.
 */
export function replenishFronts(state: GameState, opts: { catalog?: StoryCatalog; seed?: string } = {}): GameState {
  const fronts = state.fronts ?? [];
  const ended = fronts.filter(f => f.status !== 'active');
  if (!ended.length || fronts.length - ended.length >= FRONTS_PER_RUN) return state;
  const catalog = opts.catalog ?? STORY_CATALOG;
  const rng = seededRng(`fronts:${opts.seed ?? state.id}:${fronts.length}`);
  // Espera contada do último movimento (uma trama acabou ou outra entrou) — só enquanto ainda houver
  // alguma trama de pé. Com a cidade parada, a próxima entra na hora: o mundo nunca fica vazio.
  const last = Math.max(...fronts.map(f => Math.max(timeOf(f.endedAt ?? (f.status !== 'active' ? f.nextAt : undefined)), timeOf(f.createdAt))));
  const waiting = Number.isFinite(last) && timeOf(state.world.time) < last + between(rng, REPLENISH_HOURS) * 3_600_000;
  if (waiting && ended.length < fronts.length) return state;

  const continued = new Set(fronts.map(f => f.parentId).filter(Boolean));
  const parent = [...ended].filter(f => !continued.has(f.id)).sort((a, b) => timeOf(b.endedAt) - timeOf(a.endedAt))[0];
  const used = usedFrom(state);
  const res = (parent && rng(100) <= SEQUEL_CHANCE ? buildFront(state, rng, catalog, used, { parent }) : null) ?? buildFront(state, rng, catalog, used);
  if (!res) return state;
  const parentFront = res.front.parentId ? fronts.find(f => f.id === res.front.parentId) : undefined;
  return emit(res.state, 'SYSTEM', parentFront ? `Mundo: "${parentFront.title}" tem continuação` : 'Mundo: uma nova trama começa a se mexer', { target: res.front.id, data: { atoms: res.front.atoms, parentId: res.front.parentId } });
}

/** De qual trama esta é continuação, e como aquela terminou (para o narrador e a costura). */
export function continuationOf(state: Pick<GameState, 'fronts'>, front: Front): { title: string; outcome: string } | undefined {
  const p = front.parentId ? state.fronts?.find(x => x.id === front.parentId) : undefined;
  return p ? { title: p.title, outcome: p.status === 'resolved' ? 'aconteceu (o grupo saiu mais forte)' : 'foi detida pelo jogador (o grupo quer revanche)' } : undefined;
}

export function addNews(state: GameState, item: { source: NewsSource; headline: string; body: string; frontId?: string }): GameState {
  const news: NewsItem = { id: makeId('news'), turn: state.turn, at: state.world.time, read: false, ...item };
  return { ...state, news: [...(state.news ?? []), news].slice(-MAX_NEWS) };
}

/** Gancho de cena: entra pelo mesmo caminho dos eventos narrativos (o narrador incorpora uma vez). */
function sceneHook(state: GameState, text: string, frontTitle: string): GameState {
  const ev: ScheduledEvent = { id: makeId('sched'), at: state.world.time, description: `Frente: ${frontTitle}`, status: 'triggered', action: { kind: 'narrative', text }, createdTurn: state.turn };
  return { ...state, scheduled: [...state.scheduled, ev] };
}

function applyEffect(state: GameState, front: Front, e: FrontEffect): GameState {
  switch (e.kind) {
    case 'news':
      return addNews(state, { source: e.source, headline: e.headline, body: e.body, frontId: front.id });
    case 'message': {
      const npc = state.npcs.find(n => n.id === e.npcId);
      if (!npc || npc.status === 'dead') return state;
      // Estranho não manda SMS do nada: quem o jogador ainda não conheceu vira boato.
      // Quem o jogador ainda não conheceu aparece em cena (o narrador apresenta) em vez de mandar SMS do nada.
      if (npc.offstage && !npc.isContact) return sceneHook(state, `${npc.name} (${npc.role}) procura o jogador e quer dizer algo como: "${e.text}". Apresente-o em cena quando fizer sentido.`, front.title);
      return deliverMessage(state, e.npcId, e.text);
    }
    case 'npc_status': {
      // Morto não "some" depois; sumido pode aparecer morto.
      const npc = state.npcs.find(n => n.id === e.npcId);
      if (!npc || npc.status === 'dead') return state;
      return setNpcStatus(state, e.npcId, e.status, front.title);
    }
    case 'faction': {
      const key = normalizeFlagKey(`poder_${e.factionId}`);
      if (!key) return state;
      const prev = Number(state.flags[key]?.value ?? 0);
      return setFlag(state, key, prev + e.delta, 'hidden', front.title);
    }
    case 'flag':
      return setFlag(state, e.key, e.value, e.visibility, front.title);
    case 'scene_hook':
      return sceneHook(state, e.text, front.title);
  }
}

function replaceFront(state: GameState, front: Front): GameState {
  return { ...state, fronts: (state.fronts ?? []).map(f => (f.id === front.id ? front : f)) };
}

/** Dispara o próximo estágio de uma frente agora (relógio ou ação do narrador). */
export function fireStage(state: GameState, frontId: string, reason?: string): GameState {
  const front = state.fronts?.find(f => f.id === frontId);
  if (!front || front.status !== 'active') return state;
  const stage = front.stages[front.stage];
  if (!stage) return state;
  let s = state;
  for (const e of stage.effects) s = applyEffect(s, front, e);
  const next = front.stage + 1;
  const done = next >= front.stages.length;
  // O próximo conta de quando este VENCIA (tempo pulado dispara a cadeia toda); adiantado pelo narrador, conta de agora.
  const due = Math.min(new Date(front.nextAt).getTime(), new Date(s.world.time).getTime());
  const base = new Date(due).toISOString();
  const updated: Front = { ...front, stage: next, status: done ? 'resolved' : 'active', ...(done ? { endedAt: s.world.time } : {}), nextAt: done ? front.nextAt : advanceGameTime(base, front.stages[next].hours * 60) };
  s = replaceFront(s, updated);
  s = emit(s, 'EVENT_TRIGGERED', `Frente "${front.title}": ${stage.title}${reason ? ` (${reason})` : ''}`, { target: front.id, data: { stage: next, of: front.stages.length } });
  if (done) {
    const key = normalizeFlagKey(`${front.id}_concluida`);
    if (key) s = setFlag(s, key, true, 'hidden', 'a trama chegou ao fim');
  }
  return s;
}

/** Relógio: dispara os estágios vencidos (vários, se o tempo pulou). */
export function processFronts(state: GameState): GameState {
  if (!state.fronts?.length) return state;
  const now = new Date(state.world.time).getTime();
  let s = state;
  for (const f of state.fronts) {
    let guard = f.stages.length;
    let cur = s.fronts!.find(x => x.id === f.id)!;
    while (cur.status === 'active' && new Date(cur.nextAt).getTime() <= now && guard-- > 0) {
      s = fireStage(s, cur.id);
      cur = s.fronts!.find(x => x.id === f.id)!;
    }
  }
  return s;
}

export type FrontChange = 'advance' | 'delay' | 'stop' | 'reveal' | 'hint';

/** Mudança pedida pelo narrador (o jogador interferiu, descobriu, ou a trama acelerou). */
export function changeFront(state: GameState, frontId: string, change: FrontChange, reason?: string): { state: GameState; summary: string } | { error: string } {
  const front = state.fronts?.find(f => f.id === frontId);
  if (!front) return { error: `Frente "${frontId}" não existe. Use um id da seção NA CIDADE.` };
  if (change === 'reveal' || change === 'hint') {
    const level = change === 'reveal' ? 'yes' : 'suspects';
    if (front.playerAware === 'yes' || front.playerAware === level) return { error: 'O jogador já sabe disso.' };
    const s = emit(replaceFront(state, { ...front, playerAware: level }), 'NPC_UPDATED', `${level === 'yes' ? 'Descobriu' : 'Desconfia de'} uma trama: ${front.title}${reason ? ` (${reason})` : ''}`, { target: front.id });
    return { state: s, summary: `${front.title}: jogador ${level === 'yes' ? 'sabe' : 'desconfia'}` };
  }
  if (front.status !== 'active') return { error: `A frente "${front.title}" já ${front.status === 'resolved' ? 'chegou ao fim' : 'foi detida'}.` };
  if (change === 'advance') return { state: fireStage(state, frontId, reason), summary: `${front.title}: ${front.stages[front.stage]?.title ?? 'avançou'}` };
  if (change === 'delay') {
    const s = emit(replaceFront(state, { ...front, nextAt: advanceGameTime(front.nextAt, 24 * 60) }), 'EVENT_SCHEDULED', `Frente "${front.title}" atrasou um dia${reason ? ` (${reason})` : ''}`, { target: front.id });
    return { state: s, summary: `${front.title}: próximo passo adiado em 24h` };
  }
  let s = emit(replaceFront(state, { ...front, status: 'averted', endedAt: state.world.time }), 'EVENT_CANCELLED', `Frente detida: ${front.title}${reason ? ` (${reason})` : ''}`, { target: front.id });
  const key = normalizeFlagKey(`${front.id}_detida`);
  if (key) s = setFlag(s, key, true, 'public', reason ?? 'o jogador interferiu');
  return { state: s, summary: `${front.title}: detida` };
}

export const unreadNews = (state: Pick<GameState, 'news'>) => (state.news ?? []).filter(n => !n.read).length;

/**
 * Conserta frentes de saves antigos (idempotente): o átomo de vítima "acompanhantes" saiu do catálogo
 * (com protagonista menor de idade, o filtro do Google bloqueia o prompt inteiro).
 */
export function repairFronts(state: GameState): GameState {
  const bad = (state.fronts ?? []).filter(f => f.atoms.victim === 'joytoys_independentes');
  if (!bad.length) return state;
  const ids = new Set(bad.map(f => f.victimNpcId));
  return {
    ...state,
    fronts: state.fronts!.map(f => (f.atoms.victim === 'joytoys_independentes' ? { ...f, victim: 'vendedores ambulantes e donos de barraca', atoms: { ...f.atoms, victim: 'ambulantes' } } : f)),
    npcs: state.npcs.map(n => (ids.has(n.id) ? { ...n, role: 'Ambulante', description: 'Vendedores ambulantes e donos de barraca' } : n)),
  };
}

export function markNewsRead(state: GameState): GameState {
  if (!state.news?.some(n => !n.read)) return state;
  return { ...state, news: state.news.map(n => (n.read ? n : { ...n, read: true })) };
}

// ---------------------------------------------------------------- costura (reescrita pelo Mestre)

export const POLISH_RETRY_TURNS = 10;

/** A campanha tem frentes ainda com o texto cru da mistura (e não tentou há pouco)? */
export function needsPolish(state: GameState): boolean {
  return (state.fronts ?? []).some(f => !f.polished && f.status === 'active' && (f.polishTriedTurn === undefined || state.turn - f.polishTriedTurn >= POLISH_RETRY_TURNS));
}

const effectTexts = (e: FrontEffect) =>
  e.kind === 'news' ? { kind: e.kind, headline: e.headline, body: e.body } : e.kind === 'message' || e.kind === 'scene_hook' ? { kind: e.kind, text: e.text } : { kind: e.kind };

/** O que vai para o Mestre: os textos de cada frente e o personagem, para costurar ganchos. */
export function buildWorldgenRequest(state: GameState): WorldgenRequest | null {
  const fronts = (state.fronts ?? []).filter(f => !f.polished && f.status === 'active');
  if (!fronts.length) return null;
  const b = state.character.bio;
  return {
    sessionId: state.id,
    turnId: `${state.id}:${state.session.branchId}:t${state.turn}`,
    player: { handle: b.handle, role: b.role, district: b.district, occupation: b.occupation, debtReason: b.debtReason, familyTie: b.familyTie, personalAnchor: b.personalAnchor },
    fronts: fronts.map(f => {
      const seed = state.npcs.find(n => n.id === f.seedNpcId);
      return {
        id: f.id,
        title: f.title,
        premise: f.premise,
        twist: f.twist,
        who: f.who,
        place: f.place,
        seed: seed ? { name: seed.name, role: seed.role, voice: seed.profile?.voice } : undefined,
        continues: continuationOf(state, f),
        stages: f.stages.map(st => ({ title: st.title, blockHint: st.blockHint, effects: st.effects.map(effectTexts) })),
      };
    }),
  };
}

const text = (v: unknown, fallback: string, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

/**
 * Aplica a reescrita: só troca TEXTO, casando frente por id e estágio/efeito por posição.
 * Mecânica (quem, quando, efeitos, NPCs) nunca muda; campo ausente ou ruim mantém o original.
 */
export function applyWorldgen(state: GameState, res: WorldgenResponse): GameState {
  const byId = new Map((Array.isArray(res.fronts) ? res.fronts : []).filter(f => f && typeof f.id === 'string').map(f => [f.id, f]));
  const fronts = (state.fronts ?? []).map(f => {
    const r = byId.get(f.id);
    if (!r || f.polished) return f;
    const stages = f.stages.map((st, i) => {
      const rs = Array.isArray(r.stages) ? r.stages[i] : undefined;
      if (!rs) return st;
      const effects = st.effects.map((e, j): FrontEffect => {
        const re = Array.isArray(rs.effects) ? rs.effects[j] : undefined;
        if (!re) return e;
        if (e.kind === 'news') return { ...e, headline: text(re.headline, e.headline, 140), body: text(re.body, e.body, 400) };
        if (e.kind === 'message' || e.kind === 'scene_hook') return { ...e, text: text(re.text, e.text, 400) };
        return e;
      });
      return { ...st, title: text(rs.title, st.title, 160), blockHint: text(rs.blockHint, st.blockHint, 200), effects };
    });
    return { ...f, title: text(r.title, f.title, 200), premise: text(r.premise, f.premise, 500), twist: f.twist ? text(r.twist, f.twist, 300) : f.twist, stages, polished: true };
  });
  // O rosto da trama persegue a premissa reescrita.
  const npcs = state.npcs.map(n => {
    const f = fronts.find(x => x.seedNpcId === n.id && x.polished);
    return f && n.currentGoal === state.fronts?.find(x => x.id === f.id)?.premise ? { ...n, currentGoal: f.premise } : n;
  });
  return { ...state, fronts, npcs };
}

export function markPolishTried(state: GameState): GameState {
  return { ...state, fronts: (state.fronts ?? []).map(f => (f.polished ? f : { ...f, polishTriedTurn: state.turn })) };
}
