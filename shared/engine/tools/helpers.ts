import { turnIdOf } from '../events';
import type { AmmoKind, Combatant, GameState, InventoryItem, ItemCategory, Modifier, Npc } from '../../types/game';
import { AMMO_LABEL, WEAPONS, guessWeaponClass, isDistanceBracket, isWeaponClass } from '../../rules/weapons';
import { isValidNotation } from '../dice';
import { makeCombatantId } from '../combat';
import { makeId } from '../ids';
import type { CombatantArg } from './registry';
import { findNpcLoose } from '../npcs';
import { NPC_TEMPLATES, guessTemplate } from '../../rules/npcTemplates';
import type { GrenadeKind, WeaponClass, WeaponQuality } from '../../types/game';
import { STREET_DRUGS, guessStreetDrug } from '../../rules/streetDrugs';

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
  quality?: string;
}

/** Tipo de granada pelo nome. */
export function guessGrenadeKind(name: string): GrenadeKind {
  const n = name.toLowerCase();
  if (/perfurante|armor.?piercing|\bap\b/.test(n)) return 'armor_piercing';
  if (/luz|flash|atordoa/.test(n)) return 'flashbang';
  if (/incendi|napalm|fogo/.test(n)) return 'incendiary';
  if (/sono|sonífer|sleep|tranquil/.test(n)) return 'sleep';
  if (/fumaça|smoke/.test(n)) return 'smoke';
  if (/lacrimo|tear|gás/.test(n)) return 'teargas';
  if (/veneno|tóxic|toxic|poison|biotox/.test(n)) return 'poison';
  if (/emp|pulso/.test(n)) return 'emp';
  return 'basic';
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
    const quality = a.quality === 'poor' || a.quality === 'excellent' ? a.quality : weaponQualityFromName(a.name);
    if (quality) item.weapon.quality = quality;
    // Armas de choque (taser, bastão de choque) apagam em vez de matar.
    if (/choque|taser|stun/i.test(a.name)) item.weapon.nonLethal = 'stun';
    if (profile.thrown) {
      // Granadas empilham (cada arremesso gasta uma).
      item.weapon.grenade = guessGrenadeKind(a.name);
    } else {
      item.quantity = 1;
    }
  }
  if (category === 'armor') {
    const sp = a.armorSP ?? 7;
    item.armor = { slot: a.armorSlot === 'head' ? 'head' : 'body', sp, maxSp: sp };
    item.quantity = 1;
  }
  if (category === 'ammo') {
    item.ammoKind = (Object.keys(AMMO_LABEL) as AmmoKind[]).find(k => k === a.ammoKind) ?? guessAmmoKind(a.name);
    if (/borracha|rubber/i.test(a.name)) item.ammoVariant = 'rubber';
  }
  if (category === 'consumable' && a.heal) item.heal = a.heal;
  if (category === 'consumable') {
    const street = guessStreetDrug(a.name);
    if (street) {
      item.streetDrug = street;
      item.description = item.description || STREET_DRUGS[street].description;
    }
  }
  return item;
}

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'para', 'uma', 'um', 'the', 'of']);
const itemTokens = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t));

/** Mesmo item com nomes um pouco diferentes ("Kit médico" × "Kit Médico de Trauma", "Pistola pesada Militech")? */
export function similarItemName(a: string, b: string): boolean {
  const ta = itemTokens(a);
  const tb = itemTokens(b);
  if (!ta.length || !tb.length) return sameName(a, b);
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every(t => big.includes(t));
}

/** Item que já entrou no inventário NESTE turno (compra ou entrega), pelo nome. */
export function recentAcquisition(state: GameState, name: string): { name: string; via: string } | null {
  const turnId = turnIdOf(state);
  for (const e of state.events) {
    if (e.turnId !== turnId || e.type !== 'ITEM_ACQUIRED') continue;
    const d = e.data as { name?: string; via?: string } | undefined;
    if (d?.name && similarItemName(d.name, name)) return { name: d.name, via: d.via ?? 'give' };
  }
  return null;
}

/** Adiciona ao inventário, empilhando munição/consumíveis de mesmo tipo. */
export function addToInventory(state: GameState, item: InventoryItem): GameState {
  const c = state.character;
  const grenade = !!item.weapon?.grenade;
  const stackable = item.category === 'ammo' || item.category === 'consumable' || grenade;
  const existing = stackable
    ? c.inventory.find(i =>
        grenade
          ? i.weapon?.grenade === item.weapon!.grenade && i.weapon?.weaponClass === item.weapon!.weaponClass
          : i.category === item.category && (item.ammoKind ? i.ammoKind === item.ammoKind && i.ammoVariant === item.ammoVariant : sameName(i.name, item.name)),
      )
    : undefined;
  const inventory = existing ? c.inventory.map(i => (i.id === existing.id ? { ...i, quantity: i.quantity + item.quantity } : i)) : [...c.inventory, item];
  return { ...state, character: { ...c, inventory } };
}

/**
 * Monta um combatente.
 * - Com `template`: a FICHA PRONTA manda (PV, SP, armas, bases). Só nome, distância e cobertura vêm do pedido.
 * - Sem template (NPC com nome, único): usa a ficha que o narrador mandou; o que faltar vem do
 *   Boosterganger (ficha oficial mais básica) — nunca de números inventados.
 */
export function buildCombatant(spec: CombatantArg, existing: Combatant[]): Combatant {
  // Genérico SEM nenhum número ("Ganger da Maelstrom", "Segurança") → a ficha pronta que combina com o nome.
  // Se a IA mandou qualquer valor de ficha, ela está montando um NPC próprio: respeita o que veio.
  const noStats = [spec.hp, spec.sp, spec.headSp, spec.weaponClass, spec.damage, spec.attackBase, spec.evasionBase, spec.ref, spec.weaponName].every(v => v === undefined);
  const key = spec.template && NPC_TEMPLATES[spec.template] ? spec.template : noStats ? guessTemplate(spec.name) : null;
  const tpl = key ? NPC_TEMPLATES[key] : undefined;
  const base = tpl ?? NPC_TEMPLATES.boosterganger;
  const custom = !tpl;
  const tplWeapon = base.weapons[0];
  const cls: WeaponClass = custom
    ? isWeaponClass(spec.weaponClass)
      ? spec.weaponClass
      : spec.weaponName || spec.damage
        ? guessWeaponClass(spec.weaponName ?? '', spec.damage)
        : tplWeapon.weaponClass
    : tplWeapon.weaponClass;
  const profile = WEAPONS[cls];
  const hp = custom ? spec.hp ?? base.hp : base.hp;
  const bodySp = custom ? spec.sp ?? base.sp.body : base.sp.body;
  const id = spec.id && /^[a-z0-9_]+$/.test(spec.id) && !existing.some(c => c.id === spec.id) ? spec.id : makeCombatantId(spec.name, existing);
  const weaponName = custom ? spec.weaponName ?? (spec.weaponClass || spec.damage ? profile.label : tplWeapon.name) : tplWeapon.name;
  const damage = custom ? (isValidNotation(spec.damage) ? spec.damage : spec.weaponClass ? profile.defaultDamage : tplWeapon.damage) : tplWeapon.damage;
  const cover = spec.cover === 'partial' || spec.cover === 'full' ? spec.cover : 'none';
  return {
    id,
    name: spec.name,
    hp: { current: hp, max: hp },
    sp: { body: bodySp, head: custom ? spec.headSp ?? Math.min(bodySp, base.sp.head) : base.sp.head },
    weapon: { name: weaponName, weaponClass: cls, damage, quality: weaponQualityFromName(weaponName) },
    attackBase: custom ? spec.attackBase ?? tplWeapon.base : tplWeapon.base,
    evasionBase: custom ? spec.evasionBase ?? base.skills.evasion ?? 8 : base.skills.evasion ?? 8,
    ref: custom ? spec.ref ?? base.stats.REF ?? 6 : base.stats.REF ?? 6,
    initiative: null,
    distance: isDistanceBracket(spec.distance) ? spec.distance : profile.melee ? 'melee' : '7-12m',
    cover,
    coverHp: cover === 'full' ? DEFAULT_COVER_HP : undefined,
    status: 'active',
    template: tpl?.key,
    body: base.stats.BODY,
    brawlingBase: base.skills.brawling ?? (base.stats.DEX ?? 5) + 2,
    cool: base.stats.COOL,
    will: base.stats.WILL,
    ...(spec.side === 'ally' ? { side: 'ally' as const, stance: 'aggressive' as const } : {}),
  };
}

/** PV padrão de uma cobertura total quando ninguém disse do que ela é feita. */
export const DEFAULT_COVER_HP = 20;

/** "Pistola (ruim)", "Katana (excelente)" → qualidade da arma. */
export function weaponQualityFromName(name: string): WeaponQuality | undefined {
  const n = name.toLowerCase();
  if (/\b(ruim|poor|vagabund|improvisad)/.test(n)) return 'poor';
  if (/\b(excelente|excellent|premium)/.test(n)) return 'excellent';
  return undefined;
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
