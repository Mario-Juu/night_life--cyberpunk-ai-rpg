/**
 * Modo Sandbox (debug): personagem genérico no máximo, estado manipulável sem limitadores.
 * Tudo aqui são funções puras — o painel aplica com commit().
 */
import type { AmmoKind, ConditionKey, GameState, InventoryItem, RoleId, StatKey, WeaponClass } from '../types/game';
import { STAT_PRESETS, buildCharacter } from '../rules/creation';
import { STAT_KEYS, computeMaxHp, computeMaxHumanity } from '../rules/stats';
import { SKILLS } from '../rules/skills';
import { AMMO_LABEL, WEAPONS } from '../rules/weapons';
import { ARMOR_BY_SP } from '../rules/catalog';
import { MAX_ROLE_RANK, START_ROLE_RANK, familyVehicle } from '../rules/roles';
import { DECKS, PROGRAMS } from '../rules/net';
import type { DrugKey, ProgramKey } from '../types/game';
import { createInitialState, withStarterCyberware } from './initialState';
import { ROLE_LABEL } from '../rules/labels';
import { installCyberware } from './cyberware';
import type { Rng } from './dice';
import { CYBERWARE } from '../rules/cyberware';
import { defaultRoleData, VEHICLE_ITEM_ID } from './roles';
import { makeProgram, starterDeck } from './net';
import { drugItem } from './drugs';
import { setCondition } from './conditions';
import { appendChat } from './reducer';
import { emit } from './events';
import { makeId } from './ids';

export const SANDBOX_STAT = 10;

const WEAPON_NAMES: Partial<Record<WeaponClass, string>> = {
  melee_light: 'Faca de combate',
  melee_medium: 'Katana',
  melee_heavy: 'Marreta',
  pistol_medium: 'Pistola média',
  pistol_heavy: 'Revólver pesado',
  pistol_vheavy: 'Pistola muito pesada',
  smg: 'Submetralhadora',
  shotgun: 'Escopeta',
  assault_rifle: 'Fuzil de assalto',
  sniper_rifle: 'Rifle de precisão',
  bow: 'Arco',
};

/** Arsenal completo: uma arma de cada classe, munição farta, armaduras, drogas e kits. */
function arsenal(): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const [cls, name] of Object.entries(WEAPON_NAMES) as Array<[WeaponClass, string]>) {
    const p = WEAPONS[cls];
    const mag = p.melee ? null : p.defaultMag;
    items.push({ id: `sbx_${cls}`, name, category: 'weapon', quantity: 1, description: `Sandbox: ${p.label}.`, equipped: cls === 'pistol_heavy', value: 100, weapon: { weaponClass: cls, damage: p.defaultDamage, magSize: mag, loaded: mag ?? 0, ammo: p.ammo } });
  }
  for (const kind of Object.keys(AMMO_LABEL) as AmmoKind[]) items.push({ id: `sbx_ammo_${kind}`, name: AMMO_LABEL[kind], category: 'ammo', quantity: 200, description: 'Sandbox.', ammoKind: kind, value: 1 });
  const heavy = ARMOR_BY_SP[ARMOR_BY_SP.length - 1];
  items.push(
    { id: 'sbx_armor_body', name: `${heavy.name} (corpo)`, category: 'armor', quantity: 1, description: 'Sandbox.', equipped: true, value: heavy.price, armor: { slot: 'body', sp: heavy.sp, maxSp: heavy.sp } },
    { id: 'sbx_armor_head', name: `${heavy.name} (cabeça)`, category: 'armor', quantity: 1, description: 'Sandbox.', equipped: true, value: heavy.price, armor: { slot: 'head', sp: heavy.sp, maxSp: heavy.sp } },
    { id: 'sbx_medkit', name: 'Biocurativo', category: 'consumable', quantity: 20, description: 'Recupera 1d6 PV.', heal: 6, value: 50 },
  );
  for (const d of ['speedheal', 'antibiotic', 'stim', 'rapidetox', 'surge'] as DrugKey[]) items.push({ ...drugItem(d, 10), id: `sbx_drug_${d}` });
  return items;
}

/** Aplica o papel com tudo no máximo (rank 10, alocações cheias, deck excelente com programas). */
export function applySandboxRole(s: GameState, role: RoleId, rank = MAX_ROLE_RANK): GameState {
  const c = s.character;
  const distribute = <T extends string>(keys: readonly T[], total: number, max: number): Partial<Record<T, number>> => {
    const out: Partial<Record<T, number>> = {};
    for (let i = 0; i < total; i++) {
      const key = keys[i % keys.length];
      if ((out[key] ?? 0) < max) out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };
  const soloAwareness = (): Record<string, number> => {
    let remaining = rank;
    const out: Record<string, number> = {};
    if (remaining >= 3) {
      out.precision = 3;
      remaining -= 3;
    }
    for (const key of ['initiative', 'spotWeakness', 'threatDetection']) {
      if (remaining <= 0) break;
      out[key] = 1;
      remaining--;
    }
    if (remaining >= 2) {
      out.deflection = remaining - (remaining % 2);
      remaining %= 2;
    }
    if (remaining) out.initiative = (out.initiative ?? 0) + remaining;
    return out;
  };
  const roleData =
    role === 'solo'
      ? { combatAwareness: soloAwareness() }
      : role === 'tech'
        ? { maker: distribute(['field', 'upgrade', 'fabrication', 'invention'] as const, rank * 2, rank) } // 2 × rank pontos
        : role === 'medtech'
          ? { medicine: distribute(['surgery', 'pharma', 'cryo'] as const, rank, 5) }
          : defaultRoleData(role);
  const deck =
    role === 'netrunner'
      ? {
          name: DECKS.excellent.name,
          quality: 'excellent' as const,
          slots: DECKS.excellent.slots,
          programs: (['sword', 'banhammer', 'armor', 'worm', 'see_ya', 'eraser', 'speedy_gonzalvez', 'shield', 'flak'] as ProgramKey[]).map(makeProgram),
        }
      : undefined;
  const inventory = c.inventory.filter(i => i.id !== VEHICLE_ITEM_ID);
  // Trilheiro precisa de Neural Link + Plugues para conectar o deck.
  if (role === 'nomad') inventory.push({ id: VEHICLE_ITEM_ID, name: familyVehicle(rank), category: 'gear', quantity: 1, description: 'Veículo da família.', equipped: true, value: 0 });
  const character = { ...c, bio: { ...c.bio, role }, roleRank: rank, roleData, deck, inventory, nomadUpgrades: role === 'nomad' ? [] : undefined };
  return emit(withStarterCyberware({ ...s, character }), 'SYSTEM', `Sandbox: papel ${ROLE_LABEL[role]}, rank ${rank}`);
}

/** Estado inicial do Sandbox: personagem "Cobaia" com tudo no máximo. */
export function createSandboxState(role: RoleId = 'solo'): GameState {
  const base = buildCharacter({
    name: 'Cobaia',
    handle: 'Sandbox',
    age: 30,
    role,
    occupation: 'Testador de mecânicas',
    district: 'WATSON',
    familyTie: '',
    debtReason: '',
    personalAnchor: 'Quebrar o jogo antes que o jogo quebre os jogadores',
    appearance: '',
    stats: { ...STAT_PRESETS[0].stats },
    starterWeaponId: 'revolver',
  });
  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, SANDBOX_STAT])) as Record<StatKey, number>;
  const skills = Object.fromEntries(SKILLS.map(s => [s.id, 10]));
  const hp = computeMaxHp(stats.BODY, stats.WILL);
  const character = {
    ...base,
    stats,
    skills,
    hp: { current: hp, max: hp },
    humanity: { current: computeMaxHumanity(stats.EMP), max: computeMaxHumanity(stats.EMP) },
    luck: { current: stats.LUCK, max: stats.LUCK },
    money: 1_000_000,
    ip: 100_000,
    reputation: 10,
    inventory: arsenal(),
    roleRank: START_ROLE_RANK,
  };
  let s: GameState = { ...createInitialState(character), sandbox: true, title: 'Sandbox de mecânicas' };
  s = applySandboxRole(s, role);
  s = appendChat(s, {
    kind: 'narration',
    text: 'SANDBOX ATIVO. Personagem de testes com tudo no máximo. Use o painel Sandbox (menu ☰) para mexer em qualquer coisa, ou peça em texto: "gera 3 boostergangers", "cria uma rede avançada", "me amarra"…',
  });
  return s;
}

// ---------------------------------------------------------------- manipuladores do painel

export const sbx = {
  stat: (s: GameState, k: StatKey, v: number): GameState => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, [k]: clamp(v, 1, 20) } } }),
  hp: (s: GameState, current: number, max = s.character.hp.max): GameState => {
    const c = s.character;
    const cur = clamp(current, 0, max);
    return { ...s, character: { ...c, hp: { current: cur, max }, dead: cur > 0 ? false : c.dead, stabilized: cur > 0 ? false : c.stabilized, deathSavePenalty: cur > 0 ? 0 : c.deathSavePenalty } };
  },
  humanity: (s: GameState, current: number): GameState => ({ ...s, character: { ...s.character, humanity: { ...s.character.humanity, current: clamp(current, 0, s.character.humanity.max) } } }),
  money: (s: GameState, v: number): GameState => ({ ...s, character: { ...s.character, money: Math.max(0, Math.round(v)) } }),
  ip: (s: GameState, v: number): GameState => ({ ...s, character: { ...s.character, ip: Math.max(0, Math.round(v)) } }),
  luck: (s: GameState, v: number): GameState => ({ ...s, character: { ...s.character, luck: { ...s.character.luck, current: clamp(v, 0, s.character.luck.max) } } }),
  rank: (s: GameState, v: number): GameState => applySandboxRole(s, s.character.bio.role, clamp(v, 1, MAX_ROLE_RANK)),
  allSkills: (s: GameState, v: number): GameState => ({ ...s, character: { ...s.character, skills: Object.fromEntries(SKILLS.map(k => [k.id, clamp(v, 0, 10)])) } }),
  condition: (s: GameState, key: ConditionKey, active: boolean, turnsAgo = 1): GameState => ({
    ...s,
    character: { ...s.character, conditions: setCondition(s.character.conditions, key, active, s.turn - turnsAgo, 'sandbox') },
  }),
  revive: (s: GameState): GameState => {
    const c = s.character;
    return emit({ ...s, pendingRoll: null, character: { ...c, dead: false, hp: { ...c.hp, current: c.hp.max }, deathSavePenalty: 0, stabilized: false, criticalInjuries: [], conditions: [] } }, 'SYSTEM', 'Sandbox: personagem restaurado');
  },
  clearInjuries: (s: GameState): GameState => ({ ...s, character: { ...s.character, criticalInjuries: [] } }),
  clearEffects: (s: GameState): GameState => ({ ...s, activeEffects: [] }),
  endCombat: (s: GameState): GameState => ({ ...s, combat: { active: false, round: 0, playerInitiative: null, combatants: [], log: [] } }),
  clearNet: (s: GameState): GameState => ({ ...s, net: { architecture: null, run: null } }),
  refillNetActions: (s: GameState): GameState => (s.net.run ? { ...s, net: { ...s.net, run: { ...s.net.run, actionsLeft: 5 } } } : s),
  giveProgram: (s: GameState, key: ProgramKey): GameState => {
    const deck = s.character.deck ?? starterDeck();
    return { ...s, character: { ...s.character, deck: { ...deck, programs: [...deck.programs, makeProgram(key)] } } };
  },
  lethalThreat: (s: GameState, description: string | null, turnsAgo = 1): GameState => ({
    ...s,
    scene: { ...s.scene, lethalThreat: description ? { description, sinceTurn: s.turn - turnsAgo } : undefined },
  }),
  note: (s: GameState, text: string): GameState => appendChat(s, { kind: 'system', text: `🛠 ${text}` }),
  item: (s: GameState, item: Omit<InventoryItem, 'id'>): GameState => ({ ...s, character: { ...s.character, inventory: [...s.character.inventory, { ...item, id: makeId('item') }] } }),
  /** Instala um implante de graça, na hora (rola a Humanidade de verdade). */
  cyber: (s: GameState, key: string, rng: Rng): GameState | string => {
    if (!CYBERWARE[key]) return 'Implante desconhecido.';
    const res = installCyberware(s, key, rng, { free: true, noTime: true, skillId: key === 'skill_chip' ? 'handgun' : undefined });
    return res.ok ? res.state : res.error;
  },
};

export const SANDBOX_PROGRAMS = Object.keys(PROGRAMS) as ProgramKey[];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)));
}
