/**
 * Quickhacks do Trilheiro no espaço físico: RAM do deck, teste de Interface contra a defesa do alvo
 * e efeitos que reaproveitam o combate (perder ataque, dano sem armadura, bônus para acertar, dano por rodada).
 */
import type { Character, Combatant, CombatantHack, D10Roll, GameState, RollOrigin, RollRequest } from '../types/game';
import { NPC_TEMPLATES } from '../rules/npcTemplates';
import {
  QUICKHACKS,
  QUICKHACK_DV,
  RAM_BASE,
  RAM_REGEN_PER_ROUND,
  STARTER_QUICKHACKS,
  type QuickhackKey,
} from '../rules/quickhacks';
import { rollD10, rollDamage, type Rng } from './dice';
import { emit } from './events';
import { makeId } from './ids';
import { playerCannotAct, setCondition } from './conditions';
import { damageCombatant } from './combat';

/** Dano fixo por rodada do Superaquecimento (fixo: o tick roda no reducer, sem dado). */
export const OVERHEAT_TICK = 3;

const isNetrunner = (c: Character) => c.bio.role === 'netrunner';

export function ramMax(c: Character): number {
  if (!c.deck) return 0;
  return RAM_BASE[c.deck.quality] + Math.floor(c.roleRank / 2);
}

/** Trilheiro: hacks de nível 1 e RAM no deck (campanhas novas e saves antigos). Idempotente. */
export function withQuickhackDefaults(c: Character): Character {
  if (!isNetrunner(c)) return c;
  let next = c;
  if (!next.quickhacks) next = { ...next, quickhacks: [...STARTER_QUICKHACKS] };
  if (next.deck && !next.deck.ram) next = { ...next, deck: { ...next.deck, ram: { current: ramMax(next), max: ramMax(next) } } };
  // Rank subiu: o máximo acompanha.
  if (next.deck?.ram && next.deck.ram.max !== ramMax(next)) next = { ...next, deck: { ...next.deck, ram: { current: Math.min(next.deck.ram.current, ramMax(next)), max: ramMax(next) } } };
  return next;
}

export const knownQuickhacks = (c: Character): QuickhackKey[] => (c.quickhacks ?? []).filter((k): k is QuickhackKey => k in QUICKHACKS);

/** Por que este hack ainda não pode ser desbloqueado (null = pode). */
export function unlockBlocker(c: Character, key: QuickhackKey): string | null {
  const def = QUICKHACKS[key];
  if (!isNetrunner(c)) return 'Só Trilheiros usam quickhacks.';
  if (knownQuickhacks(c).includes(key)) return 'Já desbloqueado.';
  const prev = Object.values(QUICKHACKS).find(d => d.branch === def.branch && d.tier === def.tier - 1);
  if (prev && !knownQuickhacks(c).includes(prev.key)) return `Precisa de ${prev.name} antes.`;
  if (c.roleRank < def.minRank) return `Precisa de Interface rank ${def.minRank}.`;
  if (c.ip < def.ipCost) return `Precisa de ${def.ipCost} PM (você tem ${c.ip}).`;
  return null;
}

export function unlockQuickhack(c: Character, key: QuickhackKey): Character | string {
  const blocker = unlockBlocker(c, key);
  if (blocker) return blocker;
  return withQuickhackDefaults({ ...c, ip: c.ip - QUICKHACKS[key].ipCost, quickhacks: [...knownQuickhacks(c), key] });
}

/** Defesa do alvo contra quickhack: pelo nível da ficha; netrunner +2. */
export function quickhackDv(t: Combatant): number {
  const tpl = t.template ? NPC_TEMPLATES[t.template] : undefined;
  const base = tpl ? QUICKHACK_DV[tpl.tier] : QUICKHACK_DV.unknown;
  return base + (/netrunner|trilheiro/i.test(`${t.template ?? ''} ${t.name}`) ? 2 : 0);
}

function setRam(c: Character, current: number): Character {
  if (!c.deck?.ram) return c;
  return { ...c, deck: { ...c.deck, ram: { ...c.deck.ram, current: Math.max(0, Math.min(c.deck.ram.max, current)) } } };
}

/** O deck descansa: RAM cheia (fora de combate). */
export function refillRam(c: Character): Character {
  return c.deck?.ram && c.deck.ram.current < c.deck.ram.max ? setRam(c, c.deck.ram.max) : c;
}

function patchCombatant(s: GameState, id: string, fn: (t: Combatant) => Combatant): GameState {
  return { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => (t.id === id ? fn(t) : t)) } };
}

const addHack = (t: Combatant, hack: CombatantHack): Combatant => ({ ...t, hacks: [...(t.hacks ?? []).filter(h => h.key !== hack.key), hack] });

/** Dano direto (ignora armadura): PV caem; 0 = caído. */
function directDamage(t: Combatant, amount: number): Combatant {
  const hp = Math.max(0, t.hp.current - amount);
  return { ...t, hp: { ...t.hp, current: hp }, status: hp <= 0 && t.status === 'active' ? 'down' : t.status };
}

/**
 * Virada de rodada: RAM recupera, Superaquecimento queima, efeitos vencidos saem.
 * Determinístico (sem dado): roda dentro do reducer.
 */
export function tickRound(state: GameState): GameState {
  if (!state.combat.active) return state;
  const round = state.combat.round;
  let s = state;
  const c = s.character;
  if (c.deck?.ram) s = { ...s, character: setRam(c, c.deck.ram.current + RAM_REGEN_PER_ROUND) };
  for (const t of s.combat.combatants) {
    if (!t.hacks?.length) continue;
    const burning = t.status === 'active' && t.hacks.some(h => h.dot && h.untilRound >= round);
    let next = burning ? directDamage(t, OVERHEAT_TICK) : t;
    next = { ...next, hacks: next.hacks!.filter(h => h.untilRound >= round) };
    s = patchCombatant(s, t.id, () => next);
    if (burning) s = emit(s, 'DAMAGE_DEALT', `${t.name} queima (Superaquecimento): −${OVERHEAT_TICK} PV${next.status === 'down' ? ' — caiu' : ''}`, { target: t.id, value: OVERHEAT_TICK });
  }
  return s;
}

export interface QuickhackResult {
  state: GameState;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

/**
 * Usa um quickhack. Em combate é a Ação do jogador (a rodada vira). Teste: Interface + 1d10 > defesa.
 * Falha: a RAM é gasta mesmo assim; 1 natural = retroalimentação (RAM zera).
 */
export type QuickhackTarget = { combatantId?: string; npcId?: string };

/** Por que este quickhack não pode ser usado agora (null = pode). Sem efeito nem dado. */
export function quickhackBlocker(s0: GameState, key: QuickhackKey, target: QuickhackTarget): string | null {
  const def = QUICKHACKS[key];
  const c = withQuickhackDefaults(s0.character);
  const cannot = playerCannotAct(c);
  if (cannot) return cannot;
  if (!isNetrunner(c) || !c.deck) return 'Só um Trilheiro com ciberdeck usa quickhacks.';
  if (!c.cyberware.some(cw => cw.key === 'interface_plugs' || cw.key === 'neural_link')) return 'Sem Neural Link/Plugues de Interface não há como hackear.';
  if (s0.net.run) return 'Você está mergulhado numa arquitetura: desconecte para usar quickhacks.';
  if (!knownQuickhacks(c).includes(key)) return `${def.name} ainda não foi desbloqueado (Ficha → Papel → Quickhacks).`;
  const ram = c.deck.ram!;
  if (ram.current < def.ram) return `RAM insuficiente para ${def.name}: precisa de ${def.ram}, tem ${ram.current}.`;

  const inCombat = s0.combat.active;
  const foe = target.combatantId ? s0.combat.combatants.find(t => t.id === target.combatantId) : undefined;
  const npc = target.npcId ? s0.npcs.find(n => n.id === target.npcId) : undefined;
  if (def.target === 'combatant' && !inCombat) return `${def.name} só funciona em combate, contra um inimigo.`;
  if (def.target !== 'none') {
    if (inCombat && def.target !== 'combatant_or_npc' && !foe) return 'Escolha um inimigo como alvo.';
    if (foe && foe.status !== 'active') return `${foe.name} já está fora de combate.`;
    if (foe?.side === 'ally') return `${foe.name} é seu aliado.`;
    if (foe?.distance === '51-100m') return `${foe.name} está longe demais (quickhack: até 50 m com linha de visão).`;
    if (!foe && !npc) return 'Escolha um alvo.';
    if (npc && (npc.kind === 'animal' || npc.status === 'dead')) return `${npc.name} não tem o que hackear.`;
    if (npc && s0.party?.members.some(m => m.npcId === npc.id)) return `${npc.name} é do seu lado — não se hackeia a cabeça de um aliado.`;
  }
  return null;
}

/** Defesa contra o quickhack (alvo em combate pela ficha; NPC fora de combate, a padrão). */
export function quickhackDvFor(s: GameState, target: QuickhackTarget): number {
  const foe = target.combatantId ? s.combat.combatants.find(t => t.id === target.combatantId) : undefined;
  return foe ? quickhackDv(foe) : QUICKHACK_DV.unknown;
}

/** Ping (sem alvo) não tem teste; os outros viram rolagem na tela, como um ataque. */
export const quickhackRolls = (key: QuickhackKey) => QUICKHACKS[key].target !== 'none';

/**
 * Teste de Interface pendente (dado na tela, com Sorte), como um ataque. Texto = por que não dá.
 * origin 'player' = painel (cancelável); 'gm' = veio do texto do jogador pelo intérprete.
 */
export function buildQuickhackRequest(s: GameState, key: QuickhackKey, target: QuickhackTarget, origin: RollOrigin): RollRequest | string {
  const blocked = quickhackBlocker(s, key, target);
  if (blocked) return blocked;
  const def = QUICKHACKS[key];
  const name =
    (target.combatantId && s.combat.combatants.find(t => t.id === target.combatantId)?.name) || (target.npcId && s.npcs.find(n => n.id === target.npcId)?.name) || 'o alvo';
  return {
    id: makeId('roll'),
    kind: 'quickhack',
    origin,
    reason: `${def.name} em ${name} (${def.ram} RAM)`,
    stat: 'INT',
    skillId: null,
    dv: quickhackDvFor(s, target),
    modifier: 0,
    targetId: target.combatantId,
    targetNpcId: target.npcId,
    quickhack: key,
  };
}

/** preset: d10 e Sorte já rolados na tela (rolagem pendente); sem ele, rola aqui (Ping, testes). */
export function useQuickhack(s0: GameState, key: QuickhackKey, target: QuickhackTarget, rng: Rng, preset?: { d10: D10Roll; luck: number }): QuickhackResult {
  const def = QUICKHACKS[key];
  const fail = (summary: string): QuickhackResult => ({ state: s0, ok: false, summary });
  const blocked = quickhackBlocker(s0, key, target);
  if (blocked) return fail(blocked);
  const c = withQuickhackDefaults(s0.character);
  const ram = c.deck!.ram!;
  const inCombat = s0.combat.active;
  const foe = target.combatantId ? s0.combat.combatants.find(t => t.id === target.combatantId) : undefined;
  const npc = target.npcId ? s0.npcs.find(n => n.id === target.npcId) : undefined;

  // Teste de Interface.
  const d10 = preset?.d10 ?? rollD10(rng);
  const luck = preset?.luck ?? 0;
  const dv = quickhackDvFor(s0, target);
  const total = c.roleRank + d10.total + luck;
  const success = def.target === 'none' || total > dv;
  let s: GameState = { ...s0, character: setRam(c, ram.current - def.ram) };
  const rollText = def.target === 'none' ? '' : ` (Interface ${c.roleRank} + d10 ${d10.total}${luck ? ` + Sorte ${luck}` : ''} = ${total} vs ${dv})`;
  const where = foe?.name ?? npc?.name ?? 'a área';

  if (d10.fumble && def.target !== 'none') {
    s = { ...s, character: setRam(s.character, 0) };
    return finish(s, false, `${def.name} em ${where} FALHOU feio${rollText}: retroalimentação — a RAM do deck zerou.`, { fumble: true });
  }
  if (!success) return finish(s, false, `${def.name} em ${where} falhou${rollText}: o alvo segurou a intrusão. −${def.ram} RAM.`, {});

  const round = s.combat.round;
  const hack = (h: Omit<CombatantHack, 'key' | 'label'>): CombatantHack => ({ key, label: def.name, ...h });
  let summary = '';
  switch (key) {
    case 'ping': {
      if (inCombat) {
        for (const t of s.combat.combatants.filter(x => x.status === 'active' && x.side !== 'ally')) s = patchCombatant(s, t.id, x => addHack(x, hack({ untilRound: round + 2, hitBonus: 1 })));
        summary = 'Ping: todos os inimigos marcados (+1 para acertar por 2 rodadas).';
      } else summary = 'Ping: o Mestre revela câmeras, dispositivos e quem está conectado ou escondido por perto.';
      break;
    }
    case 'reboot_optics':
      s = patchCombatant(s, foe!.id, t => addHack({ ...t, skipNextAttack: 'ótica reiniciada (cego)' }, hack({ untilRound: round + 1, hitBonus: 2 })));
      summary = `${foe!.name} fica cego: perde o próximo ataque (+2 para acertá-lo).`;
      break;
    case 'sonic_shock':
      s = patchCombatant(s, foe!.id, t => addHack(t, hack({ untilRound: round + 2, attackMod: -2 })));
      summary = `${foe!.name} desorientado: −2 nos ataques por 2 rodadas e sem como pedir reforço.`;
      break;
    case 'memory_wipe': {
      if (foe) {
        const mook = !foe.template || NPC_TEMPLATES[foe.template]?.tier === 'mook';
        s = patchCombatant(s, foe.id, t => (mook ? { ...t, status: 'fled' } : { ...t, skipNextAttack: 'memória apagada (confuso)' }));
        summary = mook ? `${foe.name} esquece o que fazia ali e vai embora.` : `${foe.name} perde o fio da meada: perde o próximo ataque.`;
      } else {
        const n = npc!;
        s = { ...s, npcs: s.npcs.map(x => (x.id === n.id ? { ...x, knowsAboutPlayer: undefined, anger: 0, fear: 0 } : x)) };
        summary = `${n.name} esquece o encontro e o que sabia de você.`;
      }
      break;
    }
    case 'weapon_glitch':
      s = patchCombatant(s, foe!.id, t => ({ ...t, skipNextAttack: 'arma em pane' }));
      summary = `A arma de ${foe!.name} trava: ele perde o próximo ataque.`;
      break;
    case 'cripple_movement':
      s = patchCombatant(s, foe!.id, t => addHack(t, hack({ untilRound: round + 2, hitBonus: 2 })));
      summary = `${foe!.name} com os membros travados: +2 para acertá-lo por 2 rodadas; não consegue fugir.`;
      break;
    case 'cyberware_malfunction':
      s = patchCombatant(s, foe!.id, t => addHack({ ...t, sp: { ...t.sp, body: Math.max(0, t.sp.body - 2) } }, hack({ untilRound: round + 3, attackMod: -3 })));
      summary = `O cromo de ${foe!.name} entra em pane: −3 nos ataques por 3 rodadas e −2 de SP no corpo.`;
      break;
    case 'cyberpsychosis': {
      const victim = s.combat.combatants.find(t => t.status === 'active' && t.side !== 'ally' && t.id !== foe!.id);
      if (victim) {
        const dmg = rollDamage(foe!.weapon.damage, rng);
        const r = damageCombatant(victim, dmg, { location: 'body', halfArmor: false, rng });
        s = patchCombatant(s, victim.id, t => ({ ...t, hp: { ...t.hp, current: r.application.hpAfter }, sp: { ...t.sp, body: r.application.spAfter }, status: r.statusAfter }));
        summary = `${foe!.name} surta e ataca ${victim.name} (${r.application.hpDamage} de dano${r.statusAfter === 'down' ? ', caiu' : ''}).`;
      } else summary = `${foe!.name} surta sem ninguém por perto para atacar.`;
      s = patchCombatant(s, foe!.id, t => addHack({ ...t, skipNextAttack: 'em surto ciberpsicótico' }, hack({ untilRound: round + 2, attackMod: -4 })));
      summary += ' Fica 2 rodadas fora de si.';
      break;
    }
    case 'short_circuit': {
      const dmg = rollDamage('2d6', rng).total;
      s = patchCombatant(s, foe!.id, t => directDamage(t, dmg));
      summary = `Curto-circuito em ${foe!.name}: ${dmg} de dano direto.`;
      break;
    }
    case 'overheat': {
      const dmg = rollDamage('2d6', rng).total;
      s = patchCombatant(s, foe!.id, t => addHack(directDamage(t, dmg), hack({ untilRound: round + 2, dot: String(OVERHEAT_TICK) })));
      summary = `${foe!.name} superaquece: ${dmg} de dano agora e ${OVERHEAT_TICK} por rodada por 2 rodadas.`;
      break;
    }
    case 'synapse_burnout': {
      const half = foe!.hp.current <= foe!.hp.max / 2;
      const dmg = rollDamage(half ? '5d6' : '3d6', rng).total;
      s = patchCombatant(s, foe!.id, t => directDamage(t, dmg));
      summary = `Queima sináptica em ${foe!.name}: ${dmg} de dano direto${half ? ' (já estava ferido: +2d6)' : ''}.`;
      break;
    }
    case 'system_collapse': {
      const boss = foe!.template ? NPC_TEMPLATES[foe!.template]?.tier === 'miniboss' : false;
      if (boss) {
        const dmg = rollDamage('4d6', rng).total;
        s = patchCombatant(s, foe!.id, t => directDamage(t, dmg));
        summary = `${foe!.name} resiste ao colapso, mas leva ${dmg} de dano direto.`;
      } else {
        s = patchCombatant(s, foe!.id, t => ({ ...t, status: 'down', conditions: setCondition(t.conditions, 'unconscious', true, s0.turn, 'colapso do sistema') }));
        summary = `Colapso do sistema: ${foe!.name} apaga na hora (vivo).`;
      }
      break;
    }
  }
  const after = foe ? s.combat.combatants.find(t => t.id === foe.id) : undefined;
  return finish(s, true, `${def.name}${rollText}: ${summary} −${def.ram} RAM.`, { targetStatusAfter: after?.status });

  /** Fecha: evento (a rodada vira na fase dos inimigos, depois da Ação do jogador). */
  function finish(state: GameState, ok: boolean, text: string, data: Record<string, unknown>): QuickhackResult {
    const out = emit(state, 'NET_ACTION', text, { target: foe?.id ?? npc?.id, data: { quickhack: key, ok, ...data } });
    const ram = out.character.deck?.ram;
    return { state: out, ok: true, summary: `${text}${ram ? ` RAM ${ram.current}/${ram.max}.` : ''}`, data: { quickhack: key, success: ok, ...data } };
  }
}
