import type { AmmoKind, Combatant, GameState, InventoryItem, ItemCategory, Modifier, Npc } from '../../types/game';
import { AMMO_LABEL, WEAPONS, guessWeaponClass, isDistanceBracket, isWeaponClass } from '../../rules/weapons';
import { isValidNotation } from '../dice';
import { makeCombatantId } from '../combat';
import { makeId } from '../ids';
import type { CombatantArg } from './registry';
import { findNpcLoose } from '../npcs';

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Por id, nome exato ou nome equivalente único ("Jax" = "Jax 'Kettle'"). Nunca substring solta. */
export function findNpc(state: GameState, idOrName: string | undefined): Npc | undefined {
  if (!idOrName) return undefined;
  return state.npcs.find(n => n.id === idOrName) ?? state.npcs.find(n => sameName(n.name, idOrName)) ?? findNpcLoose(state, idOrName);
}

export function findItem(state: GameState, idOrName: string | undefined): InventoryItem | undefined {
  if (!idOrName) return undefined;
  const inv = state.character.inventory;
  return inv.find(i => i.id === idOrName) ?? inv.find(i => sameName(i.name, idOrName));
}

export function guessAmmoKind(name: string): AmmoKind {
  const n = name.toLowerCase();
  if (/escopeta|balote|calibre 12|cartucho/.test(n)) return 'SLUG';
  if (/fuzil|rifle/.test(n)) return 'RIFLE';
  if (/flecha|virote/.test(n)) return 'ARROW';
  if (/muito pesad/.test(n)) return 'VH_PISTOL';
  if (/pesad|\.357|magnum/.test(n)) return 'H_PISTOL';
  return 'M_PISTOL';
}

export interface ItemArgs {
  name: string;
  category: string;
  quantity?: number;
  description?: string;
  value?: number;
  weaponClass?: string;
  damage?: string;
  magSize?: number;
  ammoKind?: string;
  armorSP?: number;
  armorSlot?: string;
  heal?: number;
}

/** Constrói um item coerente com as regras (arma/armadura/munição completas). */
export function buildItem(a: ItemArgs): InventoryItem {
  const category = a.category as ItemCategory;
  const item: InventoryItem = { id: makeId('item'), name: a.name, category, quantity: a.quantity ?? 1, description: a.description ?? '', value: a.value };
  if (category === 'weapon') {
    const cls = isWeaponClass(a.weaponClass) ? a.weaponClass : guessWeaponClass(a.name, a.damage);
    const profile = WEAPONS[cls];
    const mag = profile.melee ? null : a.magSize ?? profile.defaultMag;
    item.weapon = { weaponClass: cls, damage: isValidNotation(a.damage) ? a.damage : profile.defaultDamage, magSize: mag, loaded: mag ?? 0, ammo: profile.ammo };
    item.quantity = 1;
  }
  if (category === 'armor') {
    const sp = a.armorSP ?? 7;
    item.armor = { slot: a.armorSlot === 'head' ? 'head' : 'body', sp, maxSp: sp };
    item.quantity = 1;
  }
  if (category === 'ammo') {
    item.ammoKind = (Object.keys(AMMO_LABEL) as AmmoKind[]).find(k => k === a.ammoKind) ?? guessAmmoKind(a.name);
  }
  if (category === 'consumable' && a.heal) item.heal = a.heal;
  return item;
}

/** Adiciona ao inventário, empilhando munição/consumíveis de mesmo tipo. */
export function addToInventory(state: GameState, item: InventoryItem): GameState {
  const c = state.character;
  const stackable = item.category === 'ammo' || item.category === 'consumable';
  const existing = stackable
    ? c.inventory.find(i => i.category === item.category && (item.ammoKind ? i.ammoKind === item.ammoKind : sameName(i.name, item.name)))
    : undefined;
  const inventory = existing ? c.inventory.map(i => (i.id === existing.id ? { ...i, quantity: i.quantity + item.quantity } : i)) : [...c.inventory, item];
  return { ...state, character: { ...c, inventory } };
}

export function buildCombatant(spec: CombatantArg, existing: Combatant[]): Combatant {
  const cls = isWeaponClass(spec.weaponClass) ? spec.weaponClass : guessWeaponClass(spec.weaponName ?? '', spec.damage);
  const profile = WEAPONS[cls];
  const hp = spec.hp ?? 20;
  const id = spec.id && /^[a-z0-9_]+$/.test(spec.id) && !existing.some(c => c.id === spec.id) ? spec.id : makeCombatantId(spec.name, existing);
  return {
    id,
    name: spec.name,
    hp: { current: hp, max: hp },
    sp: { body: spec.sp ?? 7, head: spec.headSp ?? Math.min(spec.sp ?? 7, 7) },
    weapon: { name: spec.weaponName ?? profile.label, weaponClass: cls, damage: isValidNotation(spec.damage) ? spec.damage : profile.defaultDamage },
    attackBase: spec.attackBase ?? 10,
    evasionBase: spec.evasionBase ?? 8,
    ref: spec.ref ?? 6,
    initiative: null,
    distance: isDistanceBracket(spec.distance) ? spec.distance : profile.melee ? 'melee' : '7-12m',
    cover: spec.cover === 'partial' || spec.cover === 'full' ? spec.cover : 'none',
    status: 'active',
  };
}

/** A relação com o NPC altera testes sociais contra ele. */
export function relationshipModifiers(npc: Npc | undefined, skillId: string | null): Modifier[] {
  if (!npc) return [];
  const mods: Modifier[] = [];
  const social = ['persuasion', 'conversation', 'trading', 'bribery', 'personal_grooming'];
  if (skillId && social.includes(skillId)) {
    if (npc.trust >= 50) mods.push({ label: `${npc.name} confia em você`, value: 2 });
    else if (npc.trust <= -50) mods.push({ label: `${npc.name} desconfia de você`, value: -2 });
    if (npc.anger >= 60) mods.push({ label: `${npc.name} está com raiva`, value: -2 });
  }
  if (skillId === 'interrogation') {
    if (npc.fear >= 60) mods.push({ label: `${npc.name} tem medo de você`, value: 2 });
    if (npc.respect >= 70) mods.push({ label: `${npc.name} não se intimida fácil`, value: -1 });
  }
  if (skillId === 'human_perception' && npc.trust >= 50) mods.push({ label: 'Você conhece bem essa pessoa', value: 1 });
  return mods;
}

/** Dificuldade dinâmica: ajustes de cena e de flags de alerta. Ponto de extensão central. */
export function sceneModifiers(state: GameState, skillId: string | null): Modifier[] {
  const mods: Modifier[] = [];
  const combatSkills = ['handgun', 'shoulder_arms', 'archery', 'melee_weapon', 'brawling', 'evasion'];
  if (!combatSkills.includes(skillId ?? '')) {
    if (state.scene.threat === 'extreme') mods.push({ label: 'Caos ao redor', value: -2 });
    else if (state.scene.threat === 'high') mods.push({ label: 'Pressão da cena', value: -1 });
  }
  if (skillId === 'stealth' && Object.values(state.flags).some(f => f.key.endsWith('_alerted') && f.value === true)) {
    mods.push({ label: 'Guardas em alerta', value: -2 });
  }
  return mods;
}
