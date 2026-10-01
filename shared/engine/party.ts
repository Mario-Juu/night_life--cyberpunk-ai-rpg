/**
 * Equipe (party): NPCs que lutam ao lado do jogador. O motor controla os aliados; o jogador só PEDE —
 * e o aliado decide se faz (aceita, faz do jeito dele ou recusa) pela lealdade, confiança, medo e limites.
 * PV e ferimentos persistem entre lutas; cada membro leva sua parte do pagamento dos trabalhos.
 */
import type { AllyStance, Combatant, GameState, Npc, NpcCombatBlock, PartyMember } from '../types/game';
import { NPC_TEMPLATES } from '../rules/npcTemplates';
import type { Rng } from './dice';
import { emit } from './events';
import { setNpcStatus } from './world';
import { buildCombatant } from './tools/helpers';

export const MAX_PARTY = 3;
/** Confiança mínima para alguém topar entrar de graça (mercenário com parte ≥ 10% entra sem). */
export const RECRUIT_TRUST = 20;

export const STANCE_LABEL: Record<AllyStance, string> = {
  aggressive: 'no ataque',
  focus: 'focando um alvo',
  protect: 'cobrindo você',
  hold: 'segurando posição',
  retreat: 'recuando',
};

export const members = (s: Pick<GameState, 'party'>): PartyMember[] => s.party?.members ?? [];
export const memberOf = (s: Pick<GameState, 'party'>, npcId: string) => members(s).find(m => m.npcId === npcId);

function setMembers(s: GameState, list: PartyMember[]): GameState {
  return { ...s, party: { members: list } };
}
function patchMember(s: GameState, npcId: string, fn: (m: PartyMember) => PartyMember): GameState {
  return setMembers(s, members(s).map(m => (m.npcId === npcId ? fn(m) : m)));
}
function patchNpc(s: GameState, npcId: string, fn: (n: Npc) => Npc): GameState {
  return { ...s, npcs: s.npcs.map(n => (n.id === npcId ? fn(n) : n)) };
}

/** Ficha de combate a partir de uma ficha pronta (o que o aliado sabe fazer). */
export function combatBlockFrom(template: string): NpcCombatBlock {
  const c = buildCombatant({ name: 'x', template }, []);
  return { template: c.template, hp: c.hp, sp: c.sp, weapon: c.weapon, attackBase: c.attackBase, evasionBase: c.evasionBase, ref: c.ref, body: c.body, brawlingBase: c.brawlingBase, cool: c.cool, will: c.will };
}

/** Recruta um NPC para a equipe. Mercenário (parte ≥ 10%) topa sem confiança; amigo precisa confiar. */
export function recruit(s0: GameState, npcId: string, opts: { template?: string; share?: number } = {}): { state: GameState; summary: string } | { error: string } {
  const npc = s0.npcs.find(n => n.id === npcId);
  if (!npc) return { error: `NPC "${npcId}" não existe.` };
  if (npc.status !== 'alive') return { error: `${npc.name} não está em condições (${npc.status}).` };
  if (npc.kind === 'animal') return { error: `${npc.name} é um animal: não entra na equipe de combate.` };
  if (memberOf(s0, npcId)) return { error: `${npc.name} já está na equipe.` };
  if (members(s0).length >= MAX_PARTY) return { error: `A equipe já tem ${MAX_PARTY} pessoas.` };
  const share = Math.max(0, Math.min(50, Math.round(opts.share ?? 0)));
  if (share < 10 && npc.trust < RECRUIT_TRUST) return { error: `${npc.name} ainda não confia o bastante para lutar de graça (confiança ${npc.trust}/${RECRUIT_TRUST}). Ofereça uma parte (≥10%) ou ganhe a confiança antes.` };
  const template = opts.template && NPC_TEMPLATES[opts.template] ? opts.template : npc.combat?.template ?? 'bodyguard';
  const loyalty = Math.max(10, Math.min(90, 40 + Math.round(npc.trust / 2)));
  let s = patchNpc(s0, npcId, n => ({ ...n, combat: n.combat ?? combatBlockFrom(template), importance: 'core', offstage: undefined }));
  // Rastro de uma saída anterior: sem limpar, withPartyInCombat veria o combatente "fugido" e o
  // recém-recrutado nunca voltaria para a luta.
  s = { ...s, combat: { ...s.combat, combatants: s.combat.combatants.filter(t => !(t.npcId === npcId && t.side === 'ally' && t.status !== 'active')) } };
  s = setMembers(s, [...members(s), { npcId, share, loyalty, since: s.turn, stance: 'aggressive' }]);
  const present = s.scene.presentNpcIds.includes(npcId) ? s.scene.presentNpcIds : [...s.scene.presentNpcIds, npcId];
  s = { ...s, scene: { ...s.scene, presentNpcIds: present } };
  s = emit(s, 'NPC_UPDATED', `${npc.name} entrou na equipe${share ? ` (${share}% de cada trabalho)` : ''}`, { target: npcId, data: { party: 'join', share } });
  return { state: s, summary: `${npc.name} agora anda com você${share ? ` por ${share}% de cada trabalho` : ''} (lealdade ${loyalty}).` };
}

export function dismiss(s0: GameState, npcId: string, reason?: string): { state: GameState; summary: string } | { error: string } {
  const m = memberOf(s0, npcId);
  const npc = s0.npcs.find(n => n.id === npcId);
  if (!m || !npc) return { error: `"${npcId}" não está na equipe.` };
  let s = setMembers(s0, members(s0).filter(x => x.npcId !== npcId));
  // Sai da luta também.
  s = { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => (t.npcId === npcId && t.status === 'active' ? { ...t, status: 'fled' as const } : t)) } };
  s = emit(s, 'NPC_UPDATED', `${npc.name} saiu da equipe${reason ? ` — ${reason}` : ''}`, { target: npcId, data: { party: 'leave' } });
  return { state: s, summary: `${npc.name} deixou a equipe.` };
}

/** Membros presentes na cena entram na luta como aliados (com o PV que tinham). Idempotente. */
export function withPartyInCombat(s0: GameState): GameState {
  if (!s0.combat.active) return s0;
  let s = s0;
  for (const m of members(s0)) {
    const npc = s.npcs.find(n => n.id === m.npcId);
    if (!npc?.combat || npc.status !== 'alive' || !s.scene.presentNpcIds.includes(npc.id)) continue;
    if (s.combat.combatants.some(t => t.npcId === npc.id)) continue;
    if (npc.combat.hp.current <= 0) continue; // ainda caído da última luta
    const b = npc.combat;
    const ally: Combatant = {
      id: `ally_${npc.id.replace(/^npc_/, '')}`,
      name: npc.name,
      hp: { ...b.hp },
      sp: { ...b.sp },
      weapon: { ...b.weapon },
      attackBase: b.attackBase,
      evasionBase: b.evasionBase,
      ref: b.ref,
      initiative: null,
      distance: '0-6m',
      cover: 'none',
      status: 'active',
      template: b.template,
      body: b.body,
      brawlingBase: b.brawlingBase,
      cool: b.cool,
      will: b.will,
      side: 'ally',
      npcId: npc.id,
      stance: m.stance,
      focusId: m.focusId,
    };
    s = { ...s, combat: { ...s.combat, combatants: [...s.combat.combatants, ally] } };
  }
  return s;
}

/** PV/SP dos aliados voltam para a ficha do NPC (persistem entre lutas). */
export function syncPartyFromCombat(s0: GameState): GameState {
  let s = s0;
  for (const t of s0.combat.combatants) {
    if (!t.npcId || t.side !== 'ally') continue;
    s = patchNpc(s, t.npcId, n => (n.combat ? { ...n, combat: { ...n.combat, hp: { ...t.hp }, sp: { ...t.sp } } } : n));
  }
  return s;
}

/**
 * Fim da luta: aliado caído faz um Teste de Morte (d10 < CORPO sobrevive com 1 PV); senão, morre.
 * Os sobreviventes levam o PV que ficaram.
 */
export function endCombatParty(s0: GameState, rng: Rng): { state: GameState; lines: string[] } {
  let s = syncPartyFromCombat(s0);
  const lines: string[] = [];
  for (const t of s0.combat.combatants) {
    if (!t.npcId || t.side !== 'ally' || (t.status !== 'down' && t.status !== 'dead')) continue;
    const npc = s.npcs.find(n => n.id === t.npcId);
    if (!npc) continue;
    const roll = rng(10);
    const body = t.body ?? 6;
    if (t.status === 'down' && roll < body) {
      s = patchNpc(s, npc.id, n => ({ ...n, combat: n.combat ? { ...n.combat, hp: { ...n.combat.hp, current: 1 } } : n.combat }));
      s = patchMember(s, npc.id, m => ({ ...m, loyalty: Math.max(0, m.loyalty - 5) }));
      lines.push(`${npc.name} sobrevive por pouco (Teste de Morte ${roll} < CORPO ${body}): 1 PV.`);
    } else {
      s = setNpcStatus(s, npc.id, 'dead', 'morreu em combate ao lado do jogador');
      s = setMembers(s, members(s).filter(m => m.npcId !== npc.id));
      lines.push(`${npc.name} não resistiu aos ferimentos${t.status === 'down' ? ` (Teste de Morte ${roll} ≥ CORPO ${body})` : ''}.`);
    }
  }
  return { state: lines.length ? emit(s, 'NPC_UPDATED', lines.join(' '), { data: { party: 'aftermath' } }) : s, lines };
}

/** Descanso/cura entre lutas: aliados recuperam PV (como o jogador). */
export function healParty(s0: GameState, amount: number): GameState {
  let s = s0;
  for (const m of members(s0)) s = patchNpc(s, m.npcId, n => (n.combat ? { ...n, combat: { ...n.combat, hp: { ...n.combat.hp, current: Math.min(n.combat.hp.max, n.combat.hp.current + amount) } } } : n));
  return s;
}

export type AskOutcome = 'accept' | 'adapt' | 'refuse';

/** Como o aliado faz "do jeito dele" quando não aceita o pedido por inteiro. */
const ADAPTED: Record<AllyStance, AllyStance> = { aggressive: 'protect', focus: 'aggressive', protect: 'protect', hold: 'hold', retreat: 'hold' };

/**
 * O jogador PEDE algo a um aliado; ele decide. Chance: lealdade, confiança e medo do jogador; pedido
 * arriscado pesa contra; contra os princípios dele (perfil "nunca…"), pesa muito. Rolagem d100.
 */
export function askAlly(
  s0: GameState,
  npcId: string,
  req: { stance: AllyStance; targetId?: string; risky?: boolean; againstPrinciples?: boolean },
  rng: Rng,
): { state: GameState; outcome: AskOutcome; summary: string } | { error: string } {
  const m = memberOf(s0, npcId);
  const npc = s0.npcs.find(n => n.id === npcId);
  if (!m || !npc) return { error: `"${npcId}" não está na equipe.` };
  // "Foca nele" sem alvo válido viraria um pedido sem efeito: o aliado atacaria o que quisesse.
  if (req.stance === 'focus' && !s0.combat.combatants.some(t => t.id === req.targetId && t.status === 'active' && t.side !== 'ally')) {
    return { error: 'focus precisa de um inimigo ATIVO na luta em targetId (id do combatente).' };
  }
  const chance = Math.max(5, Math.min(95, 35 + Math.round(m.loyalty / 2) + Math.round(npc.trust / 5) + Math.round(npc.fear / 10) - (req.risky ? 20 : 0) - (req.againstPrinciples ? 45 : 0)));
  const roll = rng(100);
  const outcome: AskOutcome = roll <= chance ? 'accept' : roll <= chance + 20 && !req.againstPrinciples ? 'adapt' : 'refuse';
  const stance = outcome === 'accept' ? req.stance : outcome === 'adapt' ? ADAPTED[req.stance] : m.stance;
  const focusId = outcome === 'accept' && req.stance === 'focus' ? req.targetId : undefined;
  let s = patchMember(s0, npcId, x => ({ ...x, stance, focusId, loyalty: Math.max(0, Math.min(100, x.loyalty + (outcome === 'refuse' && req.againstPrinciples ? -5 : 0))) }));
  s = {
    ...s,
    combat: {
      ...s.combat,
      combatants: s.combat.combatants.map(t => {
        if (t.npcId !== npcId) return t;
        // Recuar sai da luta; qualquer outro pedido traz de volta quem tinha recuado (e ainda está de pé).
        const status = stance === 'retreat' && t.status === 'active' ? 'fled' : t.status === 'fled' && t.hp.current > 0 ? 'active' : t.status;
        return { ...t, stance, focusId, status };
      }),
    },
  };
  const what = outcome === 'accept' ? `topa (${STANCE_LABEL[stance]})` : outcome === 'adapt' ? `faz do jeito dele (${STANCE_LABEL[stance]})` : `recusa (continua ${STANCE_LABEL[stance]})`;
  s = emit(s, 'NPC_UPDATED', `${npc.name} ${what}`, { target: npcId, data: { ask: req.stance, outcome, chance, roll } });
  return { state: s, outcome, summary: `${npc.name} ${what} — chance ${chance}%, rolou ${roll}.${req.againstPrinciples && outcome === 'refuse' ? ' O pedido bate de frente com os princípios dele.' : ''}` };
}

/** Parte de cada membro no pagamento de um trabalho (o jogador repassa na hora). */
export function partyCuts(s: Pick<GameState, 'party'>, paid: number): Array<{ npcId: string; cut: number }> {
  return members(s)
    .filter(m => m.share > 0)
    .map(m => ({ npcId: m.npcId, cut: Math.round((paid * m.share) / 100) }))
    .filter(x => x.cut > 0);
}
