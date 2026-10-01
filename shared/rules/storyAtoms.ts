/**
 * Átomos de história para as frentes do mundo. Cada run sorteia um átomo por eixo (premissa, quem,
 * fachada, motivo, vítima, reviravolta, arco, rosto da trama) e mistura — nenhuma campanha repete a outra.
 * Os tópicos vêm de histórias prontas (aventuras do RED, gigs do 2077, Edgerunners, noir e crime),
 * reescritos: só a ideia, nunca o texto.
 *
 * Lacunas preenchidas pelo motor: {who} {place} {victim} {seed} {district} {motive}.
 */
import type { NewsSource } from '../types/game';

export type AtomTag =
  | 'money'
  | 'violence'
  | 'net'
  | 'chem'
  | 'corp'
  | 'street'
  | 'cyber'
  | 'smuggling'
  | 'media'
  | 'politics'
  | 'occult'
  | 'medical'
  | 'police'
  /** Tema adulto (bonecas, Mox, BD erótico, anúncios): só com personagens adultos, nunca explícito. */
  | 'vice';

/** Ganchos com a ficha: dívida, família (laço) ou trabalho (ocupação). */
export type AtomHook = 'divida' | 'familia' | 'trabalho';

export interface PremiseAtom {
  key: string;
  text: string;
  /** Tags que QUEM está por trás precisa ter (todas). */
  needs: AtomTag[];
  /** …e pelo menos uma destas (vazio = qualquer). */
  needsAny?: AtomTag[];
  tags: AtomTag[];
  /** Que parte da ficha esta premissa toca (pesa no sorteio quando a ficha tem aquilo). */
  hooks?: AtomHook[];
  /** Arcos que contam bem esta história (o sorteio escolhe entre eles; vazio = por tags). */
  arcs?: string[];
  /** Fachadas que a premissa pede (quando a história depende do lugar); vazio = por tags. */
  places?: string[];
  /** Vítimas que a premissa pede. Premissa 'vice' SÓ sorteia daqui (todas adultas). */
  victims?: string[];
}

export interface WhoAtom {
  key: string;
  name: string;
  kind: 'gang' | 'corp' | 'police' | 'fixer' | 'other';
  tags: AtomTag[];
  /** Distrito de origem (pesa no sorteio); null = cidade toda. */
  district: string | null;
}

export interface PlaceAtom {
  key: string;
  text: string;
  tags: AtomTag[];
  districts: string[] | 'any';
}

export interface MotiveAtom {
  key: string;
  text: string;
  tags: AtomTag[];
}

export interface VictimAtom {
  key: string;
  text: string;
  /** Papel do NPC-vítima que o motor cria (ex.: "Vizinho endividado"). */
  role: string;
  /** Do tema adulto: só entra quando a premissa pede pelo nome. */
  vice?: boolean;
}

export interface TwistAtom {
  key: string;
  text: string;
  /** Precisa de pelo menos uma destas tags em quem está por trás ou na premissa (vazio = qualquer). */
  needs?: AtomTag[];
}

export type ArcEffectTemplate =
  | { kind: 'news'; source: Exclude<NewsSource, 'Rumor'>; headline: string; body: string }
  | { kind: 'rumor'; headline: string; body: string }
  | { kind: 'seed_message'; text: string }
  | { kind: 'victim_missing' }
  | { kind: 'victim_dead' }
  | { kind: 'faction_shift'; delta: number }
  | { kind: 'flag'; key: string }
  | { kind: 'scene_hook'; text: string };

export interface ArcStageTemplate {
  title: string;
  /** Intervalo de horas de jogo desde o estágio anterior. */
  hours: [number, number];
  effects: ArcEffectTemplate[];
  /** Como o jogador pode segurar este estágio. */
  block: string;
}

export interface ArcTemplate {
  key: string;
  /** Combina com premissas que tenham alguma destas tags. */
  fits: AtomTag[];
  stages: ArcStageTemplate[];
}

export type AtomGender = 'f' | 'm';

export interface SeedArchetype {
  key: string;
  /** O texto e os traços do arquétipo têm gênero: o nome sorteado acompanha. */
  gender?: AtomGender;
  role: string;
  text: string;
  traits: string[];
  voice: string;
  fits: AtomTag[];
}

export interface StoryCatalog {
  premises: PremiseAtom[];
  who: WhoAtom[];
  places: PlaceAtom[];
  motives: MotiveAtom[];
  victims: VictimAtom[];
  twists: TwistAtom[];
  arcs: ArcTemplate[];
  seeds: SeedArchetype[];
  /** Nomes (com gênero) para os rostos e vítimas criados pelo motor (Night City é misturada). */
  names: Array<[string, AtomGender]>;
}
