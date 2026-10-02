/**
 * A Rede (Cyberpunk RED, cap. Netrunning): ICE Negro, programas, ciberdecks e tabelas de arquitetura.
 */
import type { Cyberdeck, IceKey, NetDifficulty, ProgramKey } from '../types/game';

/** Ações de Rede por turno, pelo rank de Interface. */
export function netActionsFor(rank: number): number {
  if (rank >= 10) return 5;
  if (rank >= 7) return 4;
  if (rank >= 4) return 3;
  return 2;
}

export const NET_DV: Record<NetDifficulty, number> = { basic: 6, standard: 8, uncommon: 10, advanced: 12 };
/** Acesso é um marco de progressão; o d10 vence a defesa, não pula a camada de segurança. */
export const NET_MIN_INTERFACE: Record<NetDifficulty, number> = { basic: 1, standard: 3, uncommon: 6, advanced: 8 };
export const NET_DIFFICULTY_LABEL: Record<NetDifficulty, string> = { basic: 'Básica', standard: 'Padrão', uncommon: 'Incomum', advanced: 'Avançada' };

export interface IceProfile {
  key: IceKey;
  name: string;
  kind: 'anti_personnel' | 'anti_program';
  per: number;
  spd: number;
  atk: number;
  def: number;
  rez: number;
  effect: string;
}

export const ICE: Record<IceKey, IceProfile> = {
  asp: { key: 'asp', name: 'Asp', kind: 'anti_personnel', per: 4, spd: 6, atk: 2, def: 2, rez: 15, effect: 'Destrói 1 programa aleatório do deck.' },
  giant: { key: 'giant', name: 'Giant', kind: 'anti_personnel', per: 2, spd: 2, atk: 8, def: 4, rez: 25, effect: '3d6 de dano cerebral e desconexão forçada (insegura).' },
  hellhound: { key: 'hellhound', name: 'Hellhound', kind: 'anti_personnel', per: 6, spd: 6, atk: 6, def: 2, rez: 20, effect: '2d6 de dano cerebral e o deck pega fogo (2 PV por turno até apagar).' },
  kraken: { key: 'kraken', name: 'Kraken', kind: 'anti_personnel', per: 6, spd: 2, atk: 8, def: 4, rez: 30, effect: '3d6 de dano cerebral; não pode descer nem sair com segurança até o fim do próximo turno.' },
  liche: { key: 'liche', name: 'Liche', kind: 'anti_personnel', per: 8, spd: 2, atk: 6, def: 2, rez: 25, effect: 'INT, REF e DEX −1d6 por 1 hora.' },
  raven: { key: 'raven', name: 'Raven', kind: 'anti_personnel', per: 6, spd: 4, atk: 4, def: 2, rez: 15, effect: 'Derreza 1 programa defensor e causa 1d6 de dano cerebral.' },
  scorpion: { key: 'scorpion', name: 'Scorpion', kind: 'anti_personnel', per: 2, spd: 6, atk: 2, def: 2, rez: 15, effect: 'MOVE −1d6 por 1 hora.' },
  skunk: { key: 'skunk', name: 'Skunk', kind: 'anti_personnel', per: 2, spd: 4, atk: 4, def: 2, rez: 10, effect: '−2 em Slide enquanto existir (acumula).' },
  wisp: { key: 'wisp', name: 'Wisp', kind: 'anti_personnel', per: 4, spd: 4, atk: 4, def: 2, rez: 15, effect: '1d6 de dano cerebral e −1 Ação de Rede no próximo turno.' },
  dragon: { key: 'dragon', name: 'Dragon', kind: 'anti_program', per: 6, spd: 4, atk: 6, def: 6, rez: 30, effect: '6d6 num programa (se derrezar, é destruído).' },
  killer: { key: 'killer', name: 'Killer', kind: 'anti_program', per: 4, spd: 8, atk: 6, def: 2, rez: 20, effect: '4d6 num programa (se derrezar, é destruído).' },
  sabertooth: { key: 'sabertooth', name: 'Sabertooth', kind: 'anti_program', per: 8, spd: 6, atk: 6, def: 2, rez: 25, effect: '6d6 num programa (se derrezar, é destruído).' },
};

export type ProgramClass = 'attacker' | 'booster' | 'defender';

export interface ProgramProfile {
  key: ProgramKey;
  name: string;
  class: ProgramClass;
  atk: number;
  rez: number;
  price: number;
  effect: string;
}

export const PROGRAMS: Record<ProgramKey, ProgramProfile> = {
  sword: { key: 'sword', name: 'Sword', class: 'attacker', atk: 1, rez: 0, price: 50, effect: '3d6 de REZ em ICE Negro (2d6 em outros programas).' },
  banhammer: { key: 'banhammer', name: 'Banhammer', class: 'attacker', atk: 1, rez: 0, price: 50, effect: '3d6 de REZ em programas comuns (2d6 em ICE Negro).' },
  deckkrash: { key: 'deckkrash', name: 'DeckKRASH', class: 'attacker', atk: 0, rez: 0, price: 100, effect: 'Força a desconexão insegura de um Trilheiro inimigo.' },
  hellbolt: { key: 'hellbolt', name: 'Hellbolt', class: 'attacker', atk: 2, rez: 0, price: 100, effect: '2d6 de dano cerebral e fogo (contra Trilheiros inimigos).' },
  nervescrub: { key: 'nervescrub', name: 'Nervescrub', class: 'attacker', atk: 0, rez: 0, price: 100, effect: 'INT, REF e DEX −1d6 por 1 hora (contra Trilheiros inimigos).' },
  poison_flatline: { key: 'poison_flatline', name: 'Poison Flatline', class: 'attacker', atk: 0, rez: 0, price: 100, effect: 'Destrói 1 programa comum (não ICE Negro).' },
  superglue: { key: 'superglue', name: 'Superglue', class: 'attacker', atk: 2, rez: 0, price: 100, effect: 'Prende um Trilheiro inimigo por 1d6 rodadas.' },
  vrizzbolt: { key: 'vrizzbolt', name: 'Vrizzbolt', class: 'attacker', atk: 1, rez: 0, price: 50, effect: '1d6 de dano cerebral e −1 Ação de Rede (contra Trilheiros inimigos).' },
  eraser: { key: 'eraser', name: 'Eraser', class: 'booster', atk: 0, rez: 7, price: 20, effect: '+2 em Cloak.' },
  see_ya: { key: 'see_ya', name: 'See Ya', class: 'booster', atk: 0, rez: 7, price: 20, effect: '+2 em Pathfinder.' },
  speedy_gonzalvez: { key: 'speedy_gonzalvez', name: 'Speedy Gonzalvez', class: 'booster', atk: 0, rez: 7, price: 100, effect: '+2 de Velocidade (testes contra ICE que chega).' },
  worm: { key: 'worm', name: 'Worm', class: 'booster', atk: 0, rez: 7, price: 50, effect: '+2 em Backdoor.' },
  armor: { key: 'armor', name: 'Armor', class: 'defender', atk: 0, rez: 7, price: 50, effect: '−4 em todo dano cerebral (uma vez por conexão).' },
  flak: { key: 'flak', name: 'Flak', class: 'defender', atk: 0, rez: 7, price: 20, effect: 'ATK 0 para atacantes que não são ICE Negro.' },
  shield: { key: 'shield', name: 'Shield', class: 'defender', atk: 0, rez: 7, price: 20, effect: 'Bloqueia o dano cerebral do primeiro atacante que não é ICE Negro.' },
};

/** Programas que funcionam contra ICE Negro (o resto só vale contra Trilheiros inimigos). */
export const ANTI_ICE_PROGRAMS: ProgramKey[] = ['sword', 'banhammer'];

export const DECKS: Record<Cyberdeck['quality'], { name: string; slots: number; price: number }> = {
  poor: { name: 'Ciberdeck de Baixa Qualidade', slots: 5, price: 100 },
  standard: { name: 'Ciberdeck Padrão', slots: 7, price: 500 },
  excellent: { name: 'Ciberdeck Excelente', slots: 9, price: 1000 },
};

// ---------------------------------------------------------------- tabelas de arquitetura

export type FloorSpec = { kind: 'password' | 'file' | 'control'; dv: number } | { kind: 'ice'; ice: IceKey[] };

/** Lobby (andares 1–2), 1d6. */
export const LOBBY_TABLE: Record<number, FloorSpec> = {
  1: { kind: 'file', dv: 6 },
  2: { kind: 'password', dv: 6 },
  3: { kind: 'password', dv: 8 },
  4: { kind: 'ice', ice: ['skunk'] },
  5: { kind: 'ice', ice: ['wisp'] },
  6: { kind: 'ice', ice: ['killer'] },
};

const nodes = (dv: number): Record<number, FloorSpec> => ({
  9: { kind: 'password', dv },
  10: { kind: 'file', dv },
  11: { kind: 'control', dv },
  12: { kind: 'password', dv },
});

/** Demais andares, 3d6, por dificuldade. */
export const FLOOR_TABLE: Record<NetDifficulty, Record<number, FloorSpec>> = {
  basic: {
    3: { kind: 'ice', ice: ['hellhound'] },
    4: { kind: 'ice', ice: ['sabertooth'] },
    5: { kind: 'ice', ice: ['raven', 'raven'] },
    6: { kind: 'ice', ice: ['hellhound'] },
    7: { kind: 'ice', ice: ['wisp'] },
    8: { kind: 'ice', ice: ['raven'] },
    ...nodes(6),
    13: { kind: 'ice', ice: ['skunk'] },
    14: { kind: 'ice', ice: ['asp'] },
    15: { kind: 'ice', ice: ['scorpion'] },
    16: { kind: 'ice', ice: ['killer', 'skunk'] },
    17: { kind: 'ice', ice: ['wisp', 'wisp', 'wisp'] },
    18: { kind: 'ice', ice: ['liche'] },
  },
  standard: {
    3: { kind: 'ice', ice: ['hellhound', 'hellhound'] },
    4: { kind: 'ice', ice: ['hellhound', 'killer'] },
    5: { kind: 'ice', ice: ['skunk', 'skunk'] },
    6: { kind: 'ice', ice: ['sabertooth'] },
    7: { kind: 'ice', ice: ['scorpion'] },
    8: { kind: 'ice', ice: ['hellhound'] },
    ...nodes(8),
    13: { kind: 'ice', ice: ['asp'] },
    14: { kind: 'ice', ice: ['killer'] },
    15: { kind: 'ice', ice: ['liche'] },
    16: { kind: 'ice', ice: ['asp'] },
    17: { kind: 'ice', ice: ['raven', 'raven', 'raven'] },
    18: { kind: 'ice', ice: ['liche', 'raven'] },
  },
  uncommon: {
    3: { kind: 'ice', ice: ['kraken'] },
    4: { kind: 'ice', ice: ['hellhound', 'scorpion'] },
    5: { kind: 'ice', ice: ['hellhound', 'killer'] },
    6: { kind: 'ice', ice: ['raven', 'raven'] },
    7: { kind: 'ice', ice: ['sabertooth'] },
    8: { kind: 'ice', ice: ['sabertooth'] },
    ...nodes(10),
    13: { kind: 'ice', ice: ['killer'] },
    14: { kind: 'ice', ice: ['liche'] },
    15: { kind: 'ice', ice: ['dragon'] },
    16: { kind: 'ice', ice: ['asp', 'raven'] },
    17: { kind: 'ice', ice: ['dragon', 'wisp'] },
    18: { kind: 'ice', ice: ['giant'] },
  },
  advanced: {
    3: { kind: 'ice', ice: ['hellhound', 'hellhound', 'hellhound'] },
    4: { kind: 'ice', ice: ['asp', 'asp'] },
    5: { kind: 'ice', ice: ['hellhound', 'liche'] },
    6: { kind: 'ice', ice: ['wisp', 'wisp', 'wisp'] },
    7: { kind: 'ice', ice: ['hellhound', 'sabertooth'] },
    8: { kind: 'ice', ice: ['kraken'] },
    ...nodes(12),
    13: { kind: 'ice', ice: ['giant'] },
    14: { kind: 'ice', ice: ['dragon'] },
    15: { kind: 'ice', ice: ['killer', 'scorpion'] },
    16: { kind: 'ice', ice: ['kraken'] },
    17: { kind: 'ice', ice: ['raven', 'wisp', 'hellhound'] },
    18: { kind: 'ice', ice: ['dragon', 'dragon'] },
  },
};

export const NET_ABILITY_LABEL = {
  pathfinder: 'Pathfinder',
  backdoor: 'Backdoor',
  eye_dee: 'Eye-Dee',
  control: 'Controle',
  cloak: 'Cloak',
  virus: 'Vírus',
  slide: 'Slide',
  zap: 'Zap',
} as const;
