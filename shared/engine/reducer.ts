/**
 * Reducer PURO para ações diretas da interface e resultados já resolvidos pelo motor.
 * Toda aleatoriedade é resolvida ANTES (checks/combat/health) e chega aqui como dado.
 * Mudanças pedidas pelo LLM NÃO passam por aqui: vão pelo registro de ferramentas.
 */
import { SECOND_HEART_COOLDOWN, hasSecondHeart } from './cyberBonus';
import type { ChatEntry, ChatKind, EnemyAttackResult, GameState, NomadUpgradeKey, RollOutcome, RollRequest } from '../types/game';
import { formatGameTime } from '../rules/world';
import { MAX_SKILL_LEVEL, getSkill, skillUpgradeCost } from '../rules/skills';
import { applyPlayerAttack, reloadWeapon } from './combat';
import { applyDamageApplication, deathSavePenalty, healCharacter, needsDeathSave } from './health';
import { spendLuck } from './checks';
import { emit } from './events';
import { makeId } from './ids';
import { allocate, improveRole, toggleNomadUpgrade, type RoleSection } from './roles';
import { applyDrug } from './drugs';
import { ROLE_ABILITY } from '../rules/roles';
import { QUICKHACKS, type QuickhackKey } from '../rules/quickhacks';
import { unlockQuickhack, useQuickhack } from './quickhacks';
import { cryptoRng, sequenceRng } from './dice';

export type GameAction =
  | { type: 'rollResolved'; outcome: RollOutcome }
  | { type: 'enemyAttack'; result: EnemyAttackResult }
  | { type: 'setPendingRoll'; request: RollRequest }
  | { type: 'cancelPendingRoll' }
  | { type: 'reload'; weaponId: string }
  | { type: 'equip'; itemId: string; equipped: boolean }
  | { type: 'useConsumable'; itemId: string; healed: number }
  | { type: 'dropItem'; itemId: string }
  | { type: 'improveSkill'; skillId: string }
  | { type: 'manualHp'; delta: number }
  | { type: 'improveRole' }
  | { type: 'unlockQuickhack'; key: QuickhackKey }
  | { type: 'allocateRole'; section: RoleSection; key: string; delta: number }
  | { type: 'toggleNomadUpgrade'; key: NomadUpgradeKey }
  | { type: 'useDrug'; itemId: string }
  | { type: 'systemMessage'; text: string; kind?: ChatKind }
  | { type: 'phoneSend'; npcId: string; text: string }
  | { type: 'phoneReply'; npcId: string; text: string; suggestedReplies: string[]; read: boolean }
  | { type: 'phoneRead'; npcId: string };

export const MAX_CHAT = 400;

function clock(state: GameState): string {
  return formatGameTime(state.world.time).time;
}

export function appendChat(state: GameState, entry: Omit<ChatEntry, 'id' | 'time' | 'turn'>): GameState {
  const full: ChatEntry = { id: makeId('msg'), time: clock(state), turn: state.turn, ...entry };
  return { ...state, chat: [...state.chat, full].slice(-MAX_CHAT) };
}

/** Segundo Coração: ao chegar a 0 PV, volta com metade (uma vez por dia). */
export function secondHeart(state: GameState): GameState {
  const c = state.character;
  if (c.dead || c.hp.current > 0 || !hasSecondHeart(c) || state.activeEffects.some(e => e.name === SECOND_HEART_COOLDOWN)) return state;
  const hp = Math.ceil(c.hp.max / 2);
  const expiresAt = new Date(new Date(state.world.time).getTime() + 24 * 60 * 60_000).toISOString();
  let s: GameState = {
    ...state,
    character: { ...c, hp: { ...c.hp, current: hp }, deathSavePenalty: 0 },
    activeEffects: [...state.activeEffects, { id: makeId('eff'), name: SECOND_HEART_COOLDOWN, source: 'cyberware', description: 'O segundo coração precisa de um dia para voltar a assumir.', penalties: {}, expiresAt }],
  };
  s = appendChat(s, { kind: 'combat', text: `O Segundo Coração assume: você volta com ${hp} PV.` });
  return emit(s, 'HEALED', `Segundo Coração: ${hp} PV`, { value: hp });
}

/** Se o personagem está caído e não estabilizado, força o Teste de Morte. */
export function ensureDeathSave(state: GameState): GameState {
  if (state.character.cryoStasis) return state;
  if (!needsDeathSave(state.character)) return state;
  if (state.pendingRoll?.kind === 'deathSave') return state;
  return {
    ...state,
    pendingRoll: {
      id: makeId('roll'),
      kind: 'deathSave',
      origin: 'gm',
      reason: 'Você está sangrando no chão. Teste de Morte!',
      stat: 'BODY',
      skillId: null,
      dv: state.character.stats.BODY,
      modifier: -deathSavePenalty(state.character),
    },
  };
}

function upsertThreadMessage(state: GameState, npcId: string, from: 'npc' | 'player', text: string, unreadDelta: number | 'reset', suggestedReplies?: string[]): GameState {
  const msg = { id: makeId('pm'), from, text, time: clock(state) };
  const exists = state.phone.some(t => t.npcId === npcId);
  const update = (t: GameState['phone'][number]) => ({
    ...t,
    unread: unreadDelta === 'reset' ? 0 : t.unread + unreadDelta,
    suggestedReplies: suggestedReplies ?? t.suggestedReplies,
    messages: [...t.messages, msg].slice(-100),
  });
  const phone = exists ? state.phone.map(t => (t.npcId === npcId ? update(t) : t)) : [...state.phone, update({ npcId, messages: [], unread: 0, suggestedReplies: [] })];
  return { ...state, phone };
}

/** Aplica um ataque do jogador (estado de combate, arma, eventos). */
function applyAttackOutcome(state: GameState, outcome: RollOutcome): GameState {
  let s = state;
  const a = outcome.attack!;
  const applied = applyPlayerAttack(s, a);
  s = { ...s, character: applied.character, combat: applied.combat };
  if (a.spotWeakness) s = { ...s, combat: { ...s.combat, roleUsage: { ...s.combat.roleUsage, spotWeaknessRound: s.combat.round } } };
  s = emit(s, 'ATTACK_RESOLVED', `${a.weaponName} → ${a.targetName}: ${a.failure ?? (a.hit ? 'acerto' : 'erro')}`, {
    source: 'player',
    target: a.targetId,
    value: a.hit,
    data: { total: outcome.check.total, dv: outcome.check.dv, ammoAfter: a.ammoAfter, failure: a.failure },
  });
  if (a.application) {
    s = emit(s, 'DAMAGE_DEALT', `${a.targetName}: −${a.application.hpDamage} PV (${a.application.hpBefore} → ${a.application.hpAfter})`, {
      source: 'player',
      target: a.targetId,
      value: a.application.hpDamage,
      data: { ...a.application, criticalInjury: a.application.criticalInjury?.name },
    });
  }
  for (const h of a.areaHits ?? []) {
    if (h.targetId === a.targetId || !h.application) continue;
    s = emit(s, 'DAMAGE_DEALT', `${h.name}: −${h.application.hpDamage} PV (explosão)`, { source: 'player', target: h.targetId, value: h.application.hpDamage });
  }
  return s;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'rollResolved': {
      const { outcome } = action;
      const req = outcome.request;
      let s: GameState = { ...state, character: spendLuck(state.character, outcome.check.luckSpent) };

      if (outcome.attack) {
        s = applyAttackOutcome(s, outcome);
        if (outcome.followUp?.attack) s = applyAttackOutcome(s, outcome.followUp);
      } else if (outcome.quickhack) {
        const q = outcome.quickhack;
        const rolls = q.effectRolls.length ? sequenceRng(q.effectRolls) : cryptoRng;
        // Repete com a Sorte de ANTES do gasto (useQuickhack limita a Sorte ao saldo; com o saldo já
        // descontado, o total mudaria e o efeito aplicado divergiria do que a rolagem mostrou).
        const pre = { ...s, character: { ...s.character, luck: state.character.luck } };
        const res = useQuickhack(pre, q.key as QuickhackKey, { combatantId: req.targetId, npcId: req.targetNpcId }, rolls, { d10: outcome.check.d10, luck: outcome.check.luckSpent });
        if (res.ok) s = { ...res.state, character: spendLuck(res.state.character, outcome.check.luckSpent) };
      } else if (outcome.deathSave) {
        const c = s.character;
        s = { ...s, character: { ...c, deathSavePenalty: c.deathSavePenalty + 1, dead: !outcome.deathSave.success } };
        s = emit(s, 'CHECK_RESOLVED', outcome.deathSave.success ? 'Teste de Morte superado' : 'Teste de Morte falhou — flatline', { target: 'player', value: outcome.deathSave.success });
      } else if (outcome.initiative) {
        const init = outcome.initiative;
        s = {
          ...s,
          combat: {
            ...s.combat,
            playerInitiative: init.player,
            combatants: s.combat.combatants.map(t => ({ ...t, initiative: init.enemies.find(e => e.id === t.id)?.value ?? t.initiative })),
          },
        };
        s = emit(s, 'CHECK_RESOLVED', `Iniciativa ${init.player}`, { value: init.player });
      } else {
        // O DV fica só em `data` (o resumo é visível ao jogador).
        s = emit(s, 'CHECK_RESOLVED', `${req.reason}: ${outcome.check.success ? 'sucesso' : 'falha'} (total ${outcome.check.total})`, {
          source: 'player',
          target: req.targetNpcId ?? req.skillId ?? undefined,
          value: outcome.check.success,
          data: { skillId: req.skillId, total: outcome.check.total, dv: outcome.check.dv, margin: outcome.check.margin },
        });
      }

      s = appendChat(s, { kind: 'roll', text: req.reason, roll: outcome });
      return { ...s, pendingRoll: null };
    }

    case 'enemyAttack': {
      const res = action.result;
      let s = state;
      if (res.skipped || res.jammed) {
        // Travou: a próxima ação dele é destravar. Pulou: o motivo é consumido.
        const next = res.jammed ? 'destravando a arma' : undefined;
        s = { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(c => (c.id === res.attackerId ? { ...c, skipNextAttack: next } : c)) } };
        const text = res.jammed ? `A arma de ${res.attackerName} TRAVOU — nada disparou.` : `${res.attackerName} não ataca (${res.skipped}).`;
        s = appendChat(s, { kind: 'combat', text });
        return emit(s, 'ATTACK_RESOLVED', text, { source: res.attackerId, target: 'player', value: false });
      }
      if (res.shield) {
        const sh = res.shield;
        const foe = s.combat.combatants.find(c => c.id === sh.id);
        let text: string;
        if (sh.corpse) {
          const left = Math.max(0, (s.character.humanShield?.corpseHp ?? foe?.body ?? 4) - sh.hpDamage);
          s = { ...s, character: { ...s.character, humanShield: left > 0 ? { id: sh.id, corpseHp: left } : undefined, grappling: left > 0 ? s.character.grappling : undefined } };
          text = `${res.attackerName} acerta o cadáver de ${sh.name} que você usa de escudo${left > 0 ? '' : ' — o corpo se desfaz e você fica exposto'}.`;
        } else {
          const hp = Math.max(0, (foe?.hp.current ?? 0) - sh.hpDamage);
          s = { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(c => (c.id === sh.id ? { ...c, hp: { ...c.hp, current: hp }, status: hp <= 0 ? 'dead' : c.status } : c)) } };
          if (hp <= 0) s = { ...s, character: { ...s.character, humanShield: { id: sh.id, corpseHp: foe?.body ?? 4 } } };
          text = `${res.attackerName} atira — e acerta ${sh.name}, seu escudo humano: −${sh.hpDamage} PV${hp <= 0 ? ' (morto; agora é um escudo-cadáver)' : ''}.`;
          if (hp <= 0) s = emit(s, 'NPC_DIED', `${sh.name} morreu como escudo humano`, { target: sh.id });
        }
        s = appendChat(s, { kind: 'combat', text });
        return emit(s, 'DAMAGE_DEALT', text, { source: res.attackerId, target: sh.id, value: sh.hpDamage });
      }
      if (res.application) s = { ...s, character: applyDamageApplication(s.character, res.application) };
      s = secondHeart(s);
      if (res.deflected) s = { ...s, combat: { ...s.combat, roleUsage: { ...s.combat.roleUsage, deflectionRound: s.combat.round } } };
      const hpLost = res.application?.hpDamage ?? 0;
      const summary = res.hit
        ? `${res.attackerName} acertou você${hpLost ? `: −${hpLost} PV` : ', mas a armadura segurou tudo'}${res.deflected ? ` (Desvio de Dano evitou ${res.deflected})` : ''}${res.reduced ? ` (o cromo absorveu ${res.reduced})` : ''}${res.application?.criticalInjury ? ` e ${res.application.criticalInjury.name}` : ''}.`
        : `${res.attackerName} errou${res.defenseKind === 'evasion' ? ' — você esquivou' : ''}.`;
      // Totais e defesa ficam em `data` (o texto é visível ao jogador).
      s = appendChat(s, { kind: 'combat', text: summary });
      s = emit(s, res.hit ? 'DAMAGE_TAKEN' : 'ATTACK_RESOLVED', summary, {
        source: res.attackerId,
        target: 'player',
        value: res.application?.hpDamage ?? 0,
        data: { attackTotal: res.attackTotal, defenseTotal: res.defenseTotal, defenseKind: res.defenseKind },
      });
      if (res.application?.criticalInjury) s = emit(s, 'INJURY_ADDED', res.application.criticalInjury.name, { source: res.attackerId, target: 'player' });
      return ensureDeathSave(s);
    }

    case 'setPendingRoll':
      // Um pedido do motor/turno nunca é substituído por um pedido local.
      if (state.pendingRoll?.origin === 'gm') return state;
      return { ...state, pendingRoll: action.request };

    case 'cancelPendingRoll':
      if (state.pendingRoll?.origin !== 'player') return state;
      return { ...state, pendingRoll: null };

    case 'reload': {
      const result = reloadWeapon(state.character, action.weaponId);
      if ('error' in result) return appendChat(state, { kind: 'system', text: result.error });
      if (result.loadedRounds === 0) return appendChat({ ...state, character: result.character }, { kind: 'system', text: 'Arma destravada.' });
      const s = appendChat({ ...state, character: result.character }, { kind: 'system', text: `Recarregou ${result.loadedRounds} cartucho(s).` });
      return emit(s, 'AMMO_RELOADED', `Recarga: +${result.loadedRounds}`, { target: action.weaponId, value: result.loadedRounds });
    }

    case 'equip': {
      const item = state.character.inventory.find(i => i.id === action.itemId);
      if (!item) return state;
      // Armadura embutida (Pele Tecida, Subdérmica) nunca sai: vale a maior SP equipada.
      if (item.implant && item.armor) return state;
      const inventory = state.character.inventory.map(i => {
        if (i.id === item.id) return { ...i, equipped: action.equipped };
        if (action.equipped && item.armor && i.armor?.slot === item.armor.slot && !i.implant) return { ...i, equipped: false };
        if (action.equipped && item.weapon && i.weapon) return { ...i, equipped: false };
        return i;
      });
      return { ...state, character: { ...state.character, inventory } };
    }

    case 'useConsumable': {
      const item = state.character.inventory.find(i => i.id === action.itemId && i.category === 'consumable');
      if (!item) return state;
      const inventory = state.character.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
      const character = healCharacter({ ...state.character, inventory }, action.healed);
      const gained = character.hp.current - state.character.hp.current;
      let s = appendChat({ ...state, character }, { kind: 'system', text: `Usou ${item.name}: +${gained} PV.` });
      s = emit(s, 'ITEM_USED', item.name, { target: item.id });
      return gained ? emit(s, 'HEALED', `+${gained} PV (${item.name})`, { value: gained }) : s;
    }

    case 'dropItem': {
      const item = state.character.inventory.find(i => i.id === action.itemId);
      if (!item) return state;
      if (item.implant) return appendChat(state, { kind: 'system', text: `${item.name} é um implante — só sai numa clínica.` });
      const s = { ...state, character: { ...state.character, inventory: state.character.inventory.filter(i => i.id !== item.id) } };
      return emit(s, 'ITEM_REMOVED', `Descartou ${item.name}`, { target: item.id, value: item.quantity });
    }

    case 'improveSkill': {
      const skill = getSkill(action.skillId);
      if (!skill) return state;
      const current = state.character.skills[skill.id] ?? 0;
      if (current >= MAX_SKILL_LEVEL) return state;
      const cost = skillUpgradeCost(current + 1, skill.difficult);
      if (state.character.ip < cost) return state;
      const character = { ...state.character, ip: state.character.ip - cost, skills: { ...state.character.skills, [skill.id]: current + 1 } };
      return emit({ ...state, character }, 'SKILL_IMPROVED', `${skill.label} → ${current + 1} (−${cost} PM)`, { target: skill.id, value: current + 1 });
    }

    case 'improveRole': {
      const next = improveRole(state.character);
      if (typeof next === 'string') return appendChat(state, { kind: 'system', text: next });
      const cost = state.character.ip - next.ip;
      const info = ROLE_ABILITY[next.bio.role];
      return emit({ ...state, character: next }, 'ROLE_IMPROVED', `${info.name} → rank ${next.roleRank} (−${cost} PM)`, { value: next.roleRank });
    }

    case 'unlockQuickhack': {
      const next = unlockQuickhack(state.character, action.key);
      if (typeof next === 'string') return appendChat(state, { kind: 'system', text: next });
      const def = QUICKHACKS[action.key];
      return emit({ ...state, character: next }, 'ROLE_IMPROVED', `Quickhack desbloqueado: ${def.name}${def.ipCost ? ` (−${def.ipCost} PM)` : ''}`, { data: { quickhack: action.key } });
    }

    case 'allocateRole': {
      const next = allocate(state.character, action.section, action.key, action.delta, state.combat.active);
      if (typeof next === 'string') return appendChat(state, { kind: 'system', text: next });
      return { ...state, character: next };
    }

    case 'toggleNomadUpgrade': {
      const next = toggleNomadUpgrade(state.character, action.key);
      if (typeof next === 'string') return appendChat(state, { kind: 'system', text: next });
      return emit({ ...state, character: next }, 'ROLE_IMPROVED', `Moto: ${next.nomadUpgrades?.length ?? 0} melhoria(s) ativa(s).`, { target: 'player', data: { nomadUpgrade: action.key } });
    }

    case 'useDrug': {
      const item = state.character.inventory.find(i => i.id === action.itemId && i.drug);
      if (!item?.drug) return state;
      const res = applyDrug(state, item.drug);
      if (typeof res === 'string') return appendChat(state, { kind: 'system', text: res });
      const inventory = res.character.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
      const s = appendChat({ ...res, character: { ...res.character, inventory } }, { kind: 'system', text: `Usou ${item.name}.` });
      return emit(s, 'ITEM_USED', item.name, { target: item.id });
    }

    case 'manualHp': {
      const c = state.character;
      const current = Math.max(0, Math.min(c.hp.max, c.hp.current + action.delta));
      if (current === c.hp.current) return state;
      const s = { ...state, character: { ...c, hp: { ...c.hp, current }, deathSavePenalty: current > 0 ? 0 : c.deathSavePenalty } };
      return ensureDeathSave(emit(s, 'SYSTEM', `Ajuste manual de PV: ${action.delta > 0 ? '+' : ''}${action.delta}`, { value: action.delta }));
    }

    case 'systemMessage':
      return appendChat(state, { kind: action.kind ?? 'system', text: action.text });

    case 'phoneSend': {
      const npc = state.npcs.find(n => n.id === action.npcId);
      if (npc?.status === 'dead') return state;
      const s = upsertThreadMessage(state, action.npcId, 'player', action.text, 'reset', []);
      return emit(s, 'MESSAGE_SENT', `Para ${npc?.name ?? action.npcId}: ${action.text.slice(0, 80)}`, { target: action.npcId });
    }

    case 'phoneReply': {
      const s = upsertThreadMessage(state, action.npcId, 'npc', action.text, action.read ? 'reset' : 1, action.suggestedReplies.slice(0, 3));
      return emit(s, 'MESSAGE_RECEIVED', `De ${state.npcs.find(n => n.id === action.npcId)?.name ?? action.npcId}: ${action.text.slice(0, 80)}`, { source: action.npcId });
    }

    case 'phoneRead':
      return { ...state, phone: state.phone.map(t => (t.npcId === action.npcId ? { ...t, unread: 0 } : t)) };
  }
}
