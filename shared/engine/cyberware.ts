/**
 * Cromo: instalar/remover implantes do catálogo com as regras do RED e aplicar os efeitos.
 * Armas e armaduras embutidas viram itens do inventário marcados como `implant` (reusam todo o
 * combate e a ablação de SP); o resto é consultado aqui pelo motor quando precisa.
 */
import type { Character, CyberwareItem, GameState, InventoryItem, Npc } from '../types/game';
import {
  CYBERWARE,
  FOUNDATION_LABEL,
  GRADE_LABEL,
  INSTALL_LABEL,
  MILITARY_REPUTATION,
  MILITARY_TRUST,
  TIER_LABEL,
  averageLoss,
  maxHumanityPenalty,
  surgeryFee,
  type CyberwareDef,
  type FoundationKind,
} from '../rules/cyberware';
import { computeMaxHp } from '../rules/stats';
import { WEAPONS } from '../rules/weapons';
import { getSkill } from '../rules/skills';
import type { Rng } from './dice';
import { emit } from './events';
import { makeId } from './ids';
import { advanceTime } from './world';
import { humanityTransition } from './humanity';
import { defOf, effectsOf, hasCyber, installedOs, osCooldownName, osOnName } from './cyberBonus';
import { instantCheck } from './instant';
import { rollDamage } from './dice';

export * from './cyberBonus';

// ---------------------------------------------------------------- fundações e slots

interface FoundationSlot {
  item: CyberwareItem;
  kind: FoundationKind;
  capacity: number;
  used: number;
}

export function foundations(c: Character): FoundationSlot[] {
  const extra = (kind: FoundationKind) => effectsOf(c).reduce((n, e) => n + (e.kind === 'slots' && e.foundation === kind && kind === 'cyberaudio' ? e.value : 0), 0);
  return c.cyberware
    .map(item => ({ item, def: defOf(item) }))
    .filter((x): x is { item: CyberwareItem; def: CyberwareDef } => !!x.def?.foundation)
    .map(({ item, def }) => {
      const kind = def.foundation!.kind;
      const capacity = def.foundation!.slots + extra(kind);
      const used = c.cyberware.filter(o => o.parentId === item.id).reduce((n, o) => n + (defOf(o)?.slots ?? 1), 0);
      return { item, kind, capacity, used };
    });
}

/** Quantas fundações daquele tipo já existem (qualquer modelo: braço comum + braço de combate = 2). */
function foundationCount(c: Character, kind: FoundationKind): number {
  return c.cyberware.filter(cw => defOf(cw)?.foundation?.kind === kind).length;
}

/** Quantas fundações daquele tipo cabem (2 olhos, 2 braços, 2 pernas…; borgware amplia). */
function foundationMax(c: Character, def: CyberwareDef): number {
  const kind = def.foundation!.kind;
  const bonus = effectsOf(c).reduce((n, e) => n + (e.kind === 'slots' && e.foundation === kind && kind !== 'cyberaudio' ? e.value : 0), 0);
  return def.foundation!.max + bonus;
}

function rollLoss(hl: string, rng: Rng): number {
  const m = /^(\d)d(\d)$/.exec(hl);
  if (!m) return 0;
  return Array.from({ length: Number(m[1]) }, () => rng(Number(m[2]))).reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------- instalar / remover

export interface InstallOpts {
  /** Presente/implante forçado (sem custo). */
  free?: boolean;
  /** Usa a perda média (criação de personagem, NPCs) em vez de rolar. */
  average?: boolean;
  /** Skill Chip: qual perícia. */
  skillId?: string;
  /** Não avança o relógio (criação, sandbox). */
  noTime?: boolean;
  /** Ripperdoc que faz a cirurgia (id/nome). Sem ele, vale o ripperdoc presente na cena. */
  ripperdocId?: string;
}

/** O ripperdoc indicado ou o melhor presente na cena. */
export function sceneRipperdoc(s: GameState, idOrName?: string): Npc | undefined {
  if (idOrName) {
    const q = idOrName.toLowerCase();
    const npc = s.npcs.find(n => n.id === idOrName || n.name.toLowerCase() === q);
    if (npc?.ripperdoc && npc.status !== 'dead') return npc;
  }
  return s.npcs
    .filter(n => n.ripperdoc && n.status !== 'dead' && s.scene.presentNpcIds.includes(n.id))
    .sort((a, b) => b.ripperdoc!.tier - a.ripperdoc!.tier)[0];
}

export type AccessResult = { ok: true; price: number; owned?: InventoryItem; doc?: Npc } | { ok: false; error: string };

/**
 * Senso de mundo: quem instala o quê. Bio-mod de shopping só faz o básico; cada clínica tem seu
 * nível; hardware militar só no mercado negro e para quem o doutor confia; protótipo não se compra.
 * Uma peça que o jogador JÁ TEM (achada, recebida) paga só a cirurgia.
 */
export function cyberAccess(s: GameState, def: CyberwareDef, opts: Pick<InstallOpts, 'free' | 'ripperdocId'> = {}): AccessResult {
  const copies = def.paired ? 2 : 1;
  if (opts.free || s.sandbox) return { ok: true, price: def.price * copies };
  const c = s.character;
  const owned = c.inventory.find(i => i.cyberKey === def.key);
  const doc = sceneRipperdoc(s, opts.ripperdocId);
  const basic = def.tier === 1 && def.grade === 'civil' && (def.install === 'mall' || def.install === 'none');
  if (!doc) {
    if (basic) return { ok: true, price: owned ? 0 : def.price * copies, owned };
    return { ok: false, error: `${def.name} (${TIER_LABEL[def.tier]}) precisa de um ripperdoc na cena — sem um, só bio-mods básicos de shopping.` };
  }
  const tier = doc.ripperdoc!.tier;
  const needed = owned ? Math.max(1, def.tier - 1) : def.tier;
  if (tier < needed) return { ok: false, error: `${doc.name} (clínica nível ${tier}) não tem estrutura para cromo nível ${def.tier} (${TIER_LABEL[def.tier]}). Procure uma clínica melhor.` };
  if (def.install === 'hospital' && tier < 3) return { ok: false, error: `${def.name} exige cirurgia de hospital — ${doc.name} não tem estrutura (precisa de clínica nível 3+).` };
  if (!owned) {
    if (def.grade === 'prototype') return { ok: false, error: `${def.name} é ${GRADE_LABEL.prototype.toLowerCase()}: não está à venda em lugar nenhum. Só achando ou ganhando a peça.` };
    if (def.grade === 'military') {
      if (!doc.ripperdoc!.blackMarket) return { ok: false, error: `${doc.name} não mexe com hardware militar (${def.brand ?? 'militar'}) — isso é coisa de mercado negro.` };
      if (doc.trust < MILITARY_TRUST && c.reputation < MILITARY_REPUTATION)
        return { ok: false, error: `${doc.name} não vende hardware militar para quem não conhece (confiança ${MILITARY_TRUST}+ com ele ou Reputação ${MILITARY_REPUTATION}+).` };
    }
  }
  return { ok: true, price: owned ? surgeryFee(def) : def.price * copies, owned, doc };
}

export type InstallResult = { ok: true; state: GameState; summary: string; loss: number } | { ok: false; error: string };

export function installCyberware(s0: GameState, key: string, rng: Rng, opts: InstallOpts = {}): InstallResult {
  const def = CYBERWARE[key];
  if (!def) return { ok: false, error: `Implante desconhecido: ${key}.` };
  const c = s0.character;
  if (c.dead) return { ok: false, error: 'O personagem está morto.' };
  if (s0.combat.active && !opts.free) return { ok: false, error: 'Ninguém instala cromo no meio de um tiroteio.' };
  const copies = def.paired ? 2 : 1;

  // Pré-requisitos.
  if (def.foundation) {
    const count = foundationCount(c, def.foundation.kind);
    if (count >= foundationMax(c, def)) return { ok: false, error: `Você já tem o máximo de ${FOUNDATION_LABEL[def.foundation.kind]} (${foundationMax(c, def)}).` };
  }
  if (def.os && installedOs(c)) return { ok: false, error: `Só cabe um sistema operacional: você já tem ${installedOs(c)!.def.name} (Sandevistan OU Berserk).` };
  if (def.speedware && c.cyberware.some(cw => defOf(cw)?.speedware)) return { ok: false, error: 'Só cabe uma speedware (Kerenzikov OU Sandevistan).' };
  if (def.effects.some(e => e.kind === 'body') && c.cyberware.some(cw => defOf(cw)?.effects.some(e => e.kind === 'body')))
    return { ok: false, error: `${def.name} não soma com o reforço muscular que você já tem.` };
  const chip = def.effects.some(e => e.kind === 'skill_chip');
  if (chip && !getSkill(opts.skillId ?? '')) return { ok: false, error: 'Diga qual perícia o chip ensina.' };
  for (const e of def.effects) {
    if (e.kind === 'body_set') {
      if (!hasCyber(c, 'grafted_muscle')) return { ok: false, error: `${def.name} exige Músculo Enxertado & Osso Reforçado.` };
      if (c.stats.BODY < e.minBody) return { ok: false, error: `${def.name} exige CORPO ${e.minBody}.` };
    }
  }
  const parents: string[] = [];
  if (def.requires) {
    const free = foundations(c).filter(f => f.kind === def.requires && f.capacity - f.used >= (def.slots ?? 1));
    if (free.length < copies) {
      const have = foundations(c).filter(f => f.kind === def.requires).length;
      return {
        ok: false,
        error: have === 0 ? `${def.name} precisa de ${FOUNDATION_LABEL[def.requires]} instalado antes.` : `Sem slots livres em ${FOUNDATION_LABEL[def.requires]}${copies > 1 ? ' (precisa de dois, um de cada lado)' : ''}.`,
      };
    }
    parents.push(...free.slice(0, copies).map(f => f.item.id));
  }
  const access = cyberAccess(s0, def, opts);
  if (!access.ok) return access;
  const price = access.price;
  if (!opts.free && c.money < price) return { ok: false, error: `${def.name} custa €$${price}${access.owned ? ' (só a cirurgia)' : ' (com a cirurgia)'} e você tem €$${c.money}.` };

  // Instala.
  let s: GameState = s0;
  let loss = 0;
  const added: CyberwareItem[] = [];
  const items: InventoryItem[] = [];
  for (let i = 0; i < copies; i++) {
    const l = opts.average ? averageLoss(def.hl) : rollLoss(def.hl, rng);
    loss += l;
    const cw: CyberwareItem = { id: makeId('cw'), key, name: copies > 1 ? `${def.name} (${i ? 'dir.' : 'esq.'})` : def.name, category: def.category, humanityLoss: l, description: def.effect, parentId: parents[i], skillId: chip ? opts.skillId : undefined };
    added.push(cw);
  }
  const main = added[0];
  for (const e of def.effects) {
    if (e.kind === 'weapon') {
      const p = WEAPONS[e.weaponClass];
      const mag = p.melee ? null : p.defaultMag;
      items.push({ id: makeId('item'), name: `${e.name} (implante)`, category: 'weapon', quantity: 1, description: def.effect, value: 0, implant: main.id, weapon: { weaponClass: e.weaponClass, damage: e.damage, magSize: mag, loaded: mag ?? 0, ammo: p.ammo } });
    }
    if (e.kind === 'armor') {
      for (const slot of ['head', 'body'] as const) items.push({ id: makeId('item'), name: `${def.name} (${slot === 'head' ? 'cabeça' : 'corpo'})`, category: 'armor', quantity: 1, description: def.effect, equipped: true, value: 0, implant: main.id, armor: { slot, sp: e.sp, maxSp: e.sp } });
    }
  }
  let stats = c.stats;
  for (const e of def.effects) {
    if (e.kind === 'body') stats = { ...stats, BODY: Math.min(e.max, stats.BODY + e.value) };
    if (e.kind === 'body_set') stats = { ...stats, BODY: e.value };
  }
  const hpMax = stats.BODY !== c.stats.BODY ? computeMaxHp(stats.BODY, stats.WILL) : c.hp.max;
  const character: Character = {
    ...c,
    stats,
    hp: { max: hpMax, current: Math.max(0, c.hp.current + (hpMax - c.hp.max)) },
    money: opts.free ? c.money : c.money - price,
    cyberware: [...c.cyberware, ...added],
    // A peça solta (se era sua) vira implante.
    inventory: [...c.inventory.filter(i => i.id !== access.owned?.id), ...items],
    humanity: { current: Math.max(0, c.humanity.current - loss), max: Math.max(0, c.humanity.max - maxHumanityPenalty(def) * copies) },
  };
  s = { ...s0, character };
  if (!opts.free) s = emit(s, 'MONEY_CHANGED', `−${price} €$ (${def.name})`, { value: -price });
  s = emit(s, 'CYBERWARE_INSTALLED', `${def.name} (−${loss} Humanidade)`, { target: main.id, value: -loss, data: { key } });
  if (!opts.noTime) s = advanceTime(s, def.install === 'hospital' ? 24 * 60 : def.install === 'clinic' ? 4 * 60 : 60);
  s = humanityTransition(s0, s);
  const where = access.doc ? `${access.doc.name}` : INSTALL_LABEL[def.install];
  return {
    ok: true,
    state: s,
    loss,
    summary: `${def.name} instalado (${where}${opts.free ? '' : `, €$${price}${access.owned ? ' de cirurgia' : ''}`}): −${loss} Humanidade (${s.character.humanity.current}/${s.character.humanity.max}). ${def.effect}`,
  };
}

export type RemoveResult = { ok: true; state: GameState; summary: string } | { ok: false; error: string };

/** Remoção: devolve o máximo de Humanidade (a perda já sofrida só volta com terapia). */
export function removeCyberware(s0: GameState, idOrKey: string): RemoveResult {
  const c = s0.character;
  const cw = c.cyberware.find(x => x.id === idOrKey) ?? c.cyberware.find(x => x.key === idOrKey);
  if (!cw) return { ok: false, error: 'Implante não encontrado.' };
  if (c.cyberware.some(o => o.parentId === cw.id)) return { ok: false, error: `Remova antes as opções instaladas em ${cw.name}.` };
  if (s0.combat.active) return { ok: false, error: 'Não dá para operar no meio de um combate.' };
  const def = defOf(cw);
  let stats = c.stats;
  for (const e of def?.effects ?? []) if (e.kind === 'body') stats = { ...stats, BODY: Math.max(1, stats.BODY - e.value) };
  const hpMax = stats.BODY !== c.stats.BODY ? computeMaxHp(stats.BODY, stats.WILL) : c.hp.max;
  const character: Character = {
    ...c,
    stats,
    hp: { max: hpMax, current: Math.min(hpMax, c.hp.current) },
    cyberware: c.cyberware.filter(x => x.id !== cw.id),
    inventory: c.inventory.filter(i => i.implant !== cw.id),
    humanity: { ...c.humanity, max: c.humanity.max + (def ? maxHumanityPenalty(def) : cw.humanityLoss > 0 ? 2 : 0) },
  };
  const s = emit({ ...s0, character }, 'ITEM_REMOVED', `Implante removido: ${cw.name}`, { target: cw.id });
  return { ok: true, state: s, summary: `${cw.name} removido. A Humanidade máxima volta a ${character.humanity.max} (a perdida só volta com terapia).` };
}

/**
 * Liga o sistema operacional (Sandevistan/Berserk). Em combate dura rodadas; fora dele, 1 minuto.
 * Custa estresse neural na hora: VONTADE + Resistência vs DV do modelo — falhou, sangra por dentro
 * (dano direto; os militares também corroem a Humanidade). Uma ativação por luta.
 */
export function activateOs(s0: GameState, rng: Rng): RemoveResult {
  const inst = installedOs(s0.character);
  if (!inst) return { ok: false, error: 'Você não tem Sandevistan nem Berserk.' };
  const { def, os } = inst;
  if (s0.character.dead) return { ok: false, error: 'O personagem está morto.' };
  if (s0.activeEffects.some(e => e.name === osCooldownName(def))) return { ok: false, error: `${def.name} ainda está recarregando.` };
  const at = (m: number) => new Date(new Date(s0.world.time).getTime() + m * 60_000).toISOString();
  let s: GameState = s0;
  if (s.combat.active) {
    const init = s.combat.playerInitiative;
    s = { ...s, combat: { ...s.combat, os: { key: def.key, startRound: s.combat.round, rounds: os.rounds }, playerInitiative: init === null ? null : init + os.initiative } };
  } else {
    s = { ...s, activeEffects: [...s.activeEffects, { id: makeId('eff'), name: osOnName(def), source: 'cyberware', description: def.effect, penalties: {}, expiresAt: at(1) }] };
  }
  s = { ...s, activeEffects: [...s.activeEffects, { id: makeId('eff'), name: osCooldownName(def), source: 'cyberware', description: `Recarrega em ${os.cooldownMin} min.`, penalties: {}, expiresAt: at(os.cooldownMin + (s.combat.active ? 0 : 1)) }] };
  s = emit(s, 'EFFECT_ADDED', `${def.name} ativado`, { data: { key: def.key } });

  const strain = instantCheck(s, { reason: `Estresse neural (${def.name})`, stat: 'WILL', skillId: 'endurance', dv: os.strainDv }, rng);
  s = strain.state;
  const parts = [`${def.name} ativado: ${os.kind === 'sandevistan' ? 'o mundo desacelera' : 'a fúria assume'} por ${s.combat.active ? `${os.rounds} rodada${os.rounds > 1 ? 's' : ''}` : '1 minuto'}.`];
  if (!strain.outcome.check.success) {
    const before = s;
    const dmg = rollDamage(os.strainDamage, rng).total;
    const c = s.character;
    // O próprio cromo não mata: sangramento nasal, vasos estourando — no máximo até 1 PV.
    const hp = Math.max(Math.min(1, c.hp.current), c.hp.current - dmg);
    let character = { ...c, hp: { ...c.hp, current: hp } };
    let hum = 0;
    if (os.strainHumanity) {
      hum = rollDamage(os.strainHumanity, rng).total;
      character = { ...character, humanity: { ...character.humanity, current: Math.max(0, character.humanity.current - hum) } };
    }
    s = emit({ ...s, character }, 'DAMAGE_TAKEN', `Estresse neural: −${c.hp.current - hp} PV${hum ? `, −${hum} Humanidade` : ''}`, { target: 'player', value: c.hp.current - hp });
    if (hum) s = humanityTransition(before, s);
    parts.push(`Estresse neural: −${c.hp.current - hp} PV${hum ? ` e −${hum} Humanidade` : ''} (sangue no nariz, vasos estourando).`);
  }
  return { ok: true, state: s, summary: parts.join(' ') };
}

/** @deprecated nome antigo: o Sandevistan agora é um sistema operacional. */
export const activateSandevistan = (s0: GameState, rng: Rng) => activateOs(s0, rng);

/** Linha de cromo para o contexto do Mestre. */
export function describeCyberware(c: Character): string {
  if (!c.cyberware.length) return '';
  return `Cromo: ${c.cyberware
    .map(cw => {
      const def = cw.key ? CYBERWARE[cw.key] : undefined;
      const tag = def ? ` (${def.brand ? `${def.brand}, ` : ''}${TIER_LABEL[def.tier]}${def.grade !== 'civil' ? `, ${GRADE_LABEL[def.grade]}` : ''})` : '';
      return `${cw.name}${tag}${def && (def.os || def.effects.some(e => e.kind !== 'narrative')) ? ` [${def.effect}]` : ''}`;
    })
    .join('; ')}`;
}
