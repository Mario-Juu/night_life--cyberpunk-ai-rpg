/**
 * Fichas prontas de NPC (Cyberpunk RED). Valores das versões "Hardened" oficiais da R. Talsorian
 * (PDFs gratuitos: Hardened Mooks / Lieutenants / Mini Bosses). Perícias em BASE (atributo + nível).
 * PV = 10 + 5 × ⌈(BODY + WILL) / 2⌉. Variantes de gangue reaproveitam os blocos oficiais.
 */
import type { StatKey, WeaponClass } from '../types/game';

export type NpcTier = 'mook' | 'lieutenant' | 'miniboss';

export interface TemplateWeapon {
  name: string;
  weaponClass: WeaponClass;
  damage: string;
  /** Base de ataque (atributo + perícia). */
  base: number;
}

export interface NpcTemplate {
  key: string;
  name: string;
  tier: NpcTier;
  description: string;
  stats: Partial<Record<StatKey, number>>;
  hp: number;
  sp: { head: number; body: number };
  /** Bases (atributo + perícia): evasion, brawling, perception… */
  skills: Record<string, number>;
  weapons: TemplateWeapon[];
  gear: string;
  source: string;
}

const MOOKS = 'RTG Hardened Mooks';
const LTS = 'RTG Hardened Lieutenants';
const MB = 'RTG Hardened Mini Bosses';

export const NPC_TEMPLATES: Record<string, NpcTemplate> = {
  boosterganger: {
    key: 'boosterganger',
    name: 'Boosterganger',
    tier: 'mook',
    description: 'Ganger de rua movido a cromo barato e Black Lace.',
    stats: { INT: 4, REF: 6, DEX: 5, TECH: 2, COOL: 4, WILL: 4, MOVE: 6, BODY: 4, EMP: 3 },
    hp: 30,
    sp: { head: 4, body: 4 },
    skills: { handgun: 12, melee_weapon: 12, brawling: 9, evasion: 7, athletics: 9 },
    weapons: [
      { name: 'Pistola muito pesada (ruim)', weaponClass: 'pistol_vheavy', damage: '4d6', base: 12 },
      { name: 'Wolvers', weaponClass: 'melee_heavy', damage: '3d6', base: 12 },
    ],
    gear: 'Couro (SP 4), cabelo tecnológico, 1 dose de Black Lace',
    source: MOOKS,
  },
  bodyguard: {
    key: 'bodyguard',
    name: 'Guarda-costas',
    tier: 'mook',
    description: 'Músculo contratado. Escopeta e mãos pesadas.',
    stats: { INT: 4, REF: 6, DEX: 6, TECH: 2, COOL: 4, WILL: 4, MOVE: 5, BODY: 7, EMP: 3 },
    hp: 40,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 10, brawling: 13, evasion: 8, perception: 10 },
    weapons: [
      { name: 'Escopeta (ruim)', weaponClass: 'shotgun', damage: '5d6', base: 10 },
      { name: 'Socos', weaponClass: 'unarmed', damage: '3d6', base: 13 },
    ],
    gear: 'Armorjack leve (SP 11), rádio',
    source: MOOKS,
  },
  road_ganger: {
    key: 'road_ganger',
    name: 'Ganger de estrada',
    tier: 'mook',
    description: 'Motoqueiro dos Ermos. Rápido no volante e na lâmina.',
    stats: { INT: 6, REF: 6, DEX: 6, TECH: 4, COOL: 3, WILL: 3, MOVE: 5, BODY: 3, EMP: 3 },
    hp: 25,
    sp: { head: 7, body: 7 },
    skills: { handgun: 10, melee_weapon: 12, evasion: 11, brawling: 8, drive: 12 },
    weapons: [
      { name: 'Pistola muito pesada', weaponClass: 'pistol_vheavy', damage: '4d6', base: 10 },
      { name: 'Arma branca pesada', weaponClass: 'melee_heavy', damage: '3d6', base: 12 },
    ],
    gear: 'Kevlar (SP 7), Neural Link com plugues',
    source: MOOKS,
  },
  security_operative: {
    key: 'security_operative',
    name: 'Agente de segurança',
    tier: 'mook',
    description: 'Segurança corporativo de fuzil. Treinado, mal pago.',
    stats: { INT: 5, REF: 7, DEX: 4, TECH: 2, COOL: 2, WILL: 3, MOVE: 4, BODY: 5, EMP: 3 },
    hp: 30,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 12, handgun: 12, brawling: 8, evasion: 6 },
    weapons: [
      { name: 'Fuzil de assalto (ruim)', weaponClass: 'assault_rifle', damage: '5d6', base: 12 },
      { name: 'Pistola muito pesada (ruim)', weaponClass: 'pistol_vheavy', damage: '4d6', base: 12 },
    ],
    gear: 'Armorjack leve (SP 11), 40 cartuchos de fuzil',
    source: MOOKS,
  },
  netrunner: {
    key: 'netrunner',
    name: 'Trilheiro inimigo',
    tier: 'lieutenant',
    description: 'Trilheiro de segurança. Frágil no mundo real, letal na Rede.',
    stats: { INT: 7, REF: 5, DEX: 4, TECH: 7, COOL: 4, WILL: 7, MOVE: 5, BODY: 4, EMP: 4 },
    hp: 40,
    sp: { head: 11, body: 11 },
    skills: { handgun: 12, evasion: 10, stealth: 12, brawling: 6 },
    weapons: [{ name: 'Pistola muito pesada', weaponClass: 'pistol_vheavy', damage: '4d6', base: 12 }],
    gear: 'Interface 4, Neural Link, deck com Armor ×2, Banhammer, DeckKRASH, Hellbolt ×2, Shield',
    source: LTS,
  },
  reclaimer_chief: {
    key: 'reclaimer_chief',
    name: 'Chefe Reclamador',
    tier: 'lieutenant',
    description: 'Líder nômade de sucata. Kerenzikov nos reflexos.',
    stats: { INT: 3, REF: 8, DEX: 6, TECH: 5, COOL: 4, WILL: 5, MOVE: 6, BODY: 6, EMP: 4 },
    hp: 40,
    sp: { head: 11, body: 11 },
    skills: { melee_weapon: 14, shoulder_arms: 14, evasion: 12, drive: 12, brawling: 10 },
    weapons: [
      { name: 'Escopeta', weaponClass: 'shotgun', damage: '5d6', base: 14 },
      { name: 'Arma branca pesada', weaponClass: 'melee_heavy', damage: '3d6', base: 14 },
    ],
    gear: 'Kerenzikov, Neural Link, Armorjack leve (SP 11)',
    source: LTS,
  },
  security_officer: {
    key: 'security_officer',
    name: 'Oficial de segurança',
    tier: 'lieutenant',
    description: 'Chefe de equipe tática. Ciberpernas e granada de luz.',
    stats: { INT: 5, REF: 8, DEX: 6, TECH: 4, COOL: 6, WILL: 5, MOVE: 6, BODY: 7, EMP: 5 },
    hp: 40,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 12, handgun: 12, brawling: 12, evasion: 10 },
    weapons: [{ name: 'Fuzil de assalto c/ escopeta acoplada', weaponClass: 'assault_rifle', damage: '5d6', base: 12 }],
    gear: 'Armorjack leve (SP 11), 2 ciberpernas, granada de luz',
    source: LTS,
  },
  cyberpsycho: {
    key: 'cyberpsycho',
    name: 'Ciberpsicopata',
    tier: 'miniboss',
    description: 'Humanidade zero. Cromo até os dentes, sem freio.',
    stats: { INT: 5, REF: 8, DEX: 8, TECH: 5, COOL: 4, WILL: 7, MOVE: 8, BODY: 10, EMP: 0 },
    hp: 55,
    sp: { head: 11, body: 11 },
    skills: { brawling: 14, athletics: 16, evasion: 12 },
    weapons: [
      { name: 'Cybersnake', weaponClass: 'melee_heavy', damage: '4d6', base: 17 },
      { name: 'Submetralhadora pesada embutida', weaponClass: 'smg', damage: '3d6', base: 12 },
    ],
    gear: 'Wolvers, cybersnake, lança-granadas embutido (6d6), submetralhadora embutida',
    source: 'CRB p.416 (via Dataterm)',
  },
  outrider: {
    key: 'outrider',
    name: 'Batedor nômade',
    tier: 'miniboss',
    description: 'Nômade de elite em moto blindada.',
    stats: { INT: 6, REF: 8, DEX: 8, TECH: 5, COOL: 7, WILL: 8, MOVE: 6, BODY: 8, EMP: 6 },
    hp: 50,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 16, melee_weapon: 16, evasion: 16, drive: 20, brawling: 12 },
    weapons: [
      { name: 'Fuzil de assalto (tambor)', weaponClass: 'assault_rifle', damage: '5d6', base: 16 },
      { name: 'Arma branca pesada (excelente)', weaponClass: 'melee_heavy', damage: '3d6', base: 16 },
    ],
    gear: 'Moto blindada, Moto 6',
    source: MB,
  },
  sniper: {
    key: 'sniper',
    name: 'Atirador de elite',
    tier: 'miniboss',
    description: 'Paciente, invisível, um tiro.',
    stats: { INT: 7, REF: 8, DEX: 8, TECH: 4, COOL: 7, WILL: 8, MOVE: 6, BODY: 6, EMP: 4 },
    hp: 45,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 16, stealth: 16, evasion: 16, perception: 15, brawling: 10 },
    weapons: [{ name: 'Fuzil de precisão (excelente, perfurante)', weaponClass: 'sniper_rifle', damage: '5d6', base: 16 }],
    gear: 'Ciberolhos com mira telescópica e visão noturna',
    source: MB,
  },
  militech_veteran: {
    key: 'militech_veteran',
    name: 'Veterano da Militech',
    tier: 'miniboss',
    description: 'Soldado de guerra corporativa com músculos enxertados.',
    stats: { INT: 6, REF: 8, DEX: 8, TECH: 6, COOL: 5, WILL: 8, MOVE: 7, BODY: 10, EMP: 4 },
    hp: 55,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 16, handgun: 16, brawling: 16, evasion: 16 },
    weapons: [
      { name: 'Fuzil de assalto c/ escopeta acoplada', weaponClass: 'assault_rifle', damage: '5d6', base: 16 },
      { name: 'Pistola pesada', weaponClass: 'pistol_heavy', damage: '3d6', base: 16 },
    ],
    gear: 'Músculo e osso enxertados, 4 doses de Black Lace',
    source: MB,
  },
  arasaka_assassin: {
    key: 'arasaka_assassin',
    name: 'Assassino da Arasaka',
    tier: 'miniboss',
    description: 'Lâmina e Sandevistan. Você não vê o golpe.',
    stats: { INT: 6, REF: 8, DEX: 8, TECH: 6, COOL: 5, WILL: 8, MOVE: 8, BODY: 8, EMP: 5 },
    hp: 50,
    sp: { head: 11, body: 11 },
    skills: { melee_weapon: 16, brawling: 16, evasion: 16, stealth: 16 },
    weapons: [{ name: 'Katana (excelente)', weaponClass: 'melee_heavy', damage: '3d6', base: 16 }],
    gear: 'Sandevistan, Caratê 16',
    source: MB,
  },

  // Variantes de gangue (Night City 2045) sobre os blocos oficiais.
  maelstrom_ganger: {
    key: 'maelstrom_ganger',
    name: 'Ganger da Maelstrom',
    tier: 'mook',
    description: 'Maelstrom (Burleson Tower): cromo agressivo, óticas vermelhas. Bloco do Boosterganger.',
    stats: { INT: 4, REF: 6, DEX: 5, TECH: 2, COOL: 4, WILL: 4, MOVE: 6, BODY: 4, EMP: 3 },
    hp: 30,
    sp: { head: 4, body: 7 },
    skills: { handgun: 12, melee_weapon: 12, brawling: 9, evasion: 7, athletics: 9 },
    weapons: [
      { name: 'Pistola muito pesada (ruim)', weaponClass: 'pistol_vheavy', damage: '4d6', base: 12 },
      { name: 'Rippers', weaponClass: 'melee_medium', damage: '2d6', base: 12 },
    ],
    gear: 'Kevlar (SP 7), ciberóticos, Black Lace',
    source: `${MOOKS} (variante)`,
  },
  tyger_claw: {
    key: 'tyger_claw',
    name: 'Tyger Claw',
    tier: 'mook',
    description: 'Tyger Claws (Japantown/Watson): katanas e motos. Bloco do Boosterganger.',
    stats: { INT: 4, REF: 6, DEX: 5, TECH: 2, COOL: 4, WILL: 4, MOVE: 6, BODY: 4, EMP: 3 },
    hp: 30,
    sp: { head: 4, body: 7 },
    skills: { handgun: 12, melee_weapon: 12, brawling: 9, evasion: 7, athletics: 9 },
    weapons: [
      { name: 'Katana', weaponClass: 'melee_heavy', damage: '3d6', base: 12 },
      { name: 'Pistola média', weaponClass: 'pistol_medium', damage: '2d6', base: 12 },
    ],
    gear: 'Kevlar (SP 7), tatuagens de luz',
    source: `${MOOKS} (variante)`,
  },
  sixth_street: {
    key: 'sixth_street',
    name: 'Patrulheiro da 6th Street',
    tier: 'mook',
    description: '6th Street (Heywood): veteranos armados, patrulham em grupos de 4–6. Bloco do Agente de segurança.',
    stats: { INT: 5, REF: 7, DEX: 4, TECH: 2, COOL: 2, WILL: 3, MOVE: 4, BODY: 5, EMP: 3 },
    hp: 30,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 12, handgun: 12, brawling: 8, evasion: 6 },
    weapons: [{ name: 'Fuzil de assalto', weaponClass: 'assault_rifle', damage: '5d6', base: 12 }],
    gear: 'Armorjack leve (SP 11), bandeira no ombro',
    source: `${MOOKS} (variante)`,
  },
  ncpd_officer: {
    key: 'ncpd_officer',
    name: 'Policial da NCPD',
    tier: 'mook',
    description: 'Patrulha terceirizada. Bloco do Agente de segurança.',
    stats: { INT: 5, REF: 7, DEX: 4, TECH: 2, COOL: 2, WILL: 3, MOVE: 4, BODY: 5, EMP: 3 },
    hp: 30,
    sp: { head: 11, body: 11 },
    skills: { shoulder_arms: 12, handgun: 12, brawling: 8, evasion: 6 },
    weapons: [{ name: 'Pistola pesada', weaponClass: 'pistol_heavy', damage: '3d6', base: 12 }],
    gear: 'Armorjack leve (SP 11), rádio, algemas',
    source: `${MOOKS} (variante)`,
  },
  maxtac: {
    key: 'maxtac',
    name: 'Agente da MaxTac',
    tier: 'lieutenant',
    description: 'Divisão de Força Máxima: caça ciberpsicopatas. Bloco do Oficial de segurança "Siege".',
    stats: { INT: 5, REF: 8, DEX: 6, TECH: 4, COOL: 6, WILL: 5, MOVE: 6, BODY: 7, EMP: 5 },
    hp: 40,
    sp: { head: 13, body: 13 },
    skills: { shoulder_arms: 12, handgun: 12, brawling: 12, evasion: 10 },
    weapons: [{ name: 'Submetralhadora pesada', weaponClass: 'smg', damage: '3d6', base: 12 }],
    gear: 'Armorjack pesado (SP 13), escudo à prova de balas, gás lacrimogêneo',
    source: `${LTS} (variante)`,
  },
};

export const NPC_TEMPLATE_KEYS = Object.keys(NPC_TEMPLATES);

/** Palavras que identificam uma ficha genérica pelo nome (sem acento, minúsculas). Ordem = prioridade. */
const NAME_HINTS: Array<[RegExp, string]> = [
  [/maxtac|forca maxima/, 'maxtac'],
  [/ciberpsico|cyberpsycho/, 'cyberpsycho'],
  [/maelstrom/, 'maelstrom_ganger'],
  [/tyger|tiger claw/, 'tyger_claw'],
  [/6th street|sixth street|sexta rua/, 'sixth_street'],
  [/ncpd|policial|policia|guarda municipal|tira\b/, 'ncpd_officer'],
  [/militech/, 'militech_veteran'],
  [/arasaka.*(assassin|ninja)|assassin/, 'arasaka_assassin'],
  [/sniper|atirador de elite/, 'sniper'],
  [/netrunner|trilheiro|hacker/, 'netrunner'],
  [/nomade|batedor|outrider/, 'outrider'],
  [/reclamador|reclaimer/, 'reclaimer_chief'],
  [/oficial de seguranca|chefe de seguranca|lider tatico/, 'security_officer'],
  [/guarda[- ]costas|bodyguard|leao de chacara|seguranca pessoal/, 'bodyguard'],
  [/seguranc|vigia|guarda|soldado|corporativ/, 'security_operative'],
  [/gangue de estrada|motoqueiro|road ganger/, 'road_ganger'],
  [/booster|ganger|gangueiro|capanga|bandido|marginal|pivete/, 'boosterganger'],
];

/** Ficha genérica que combina com o nome (null se for alguém sem cara de genérico). */
export function guessTemplate(name: string): string | null {
  const n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return NAME_HINTS.find(([re]) => re.test(n))?.[1] ?? null;
}

/** Lista compacta para o prompt do narrador. */
export function templateDocs(): string {
  return Object.values(NPC_TEMPLATES)
    .map(t => `${t.key} (${t.name}: PV ${t.hp}, SP ${t.sp.body}, ${t.weapons[0].name} ${t.weapons[0].damage})`)
    .join('; ');
}
