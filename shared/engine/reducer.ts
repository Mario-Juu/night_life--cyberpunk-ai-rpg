/**
 * Reducer PURO para ações diretas da interface e resultados já resolvidos pelo motor.
 * Toda aleatoriedade é resolvida ANTES (checks/combat/health) e chega aqui como dado.
 * Mudanças pedidas pelo LLM NÃO passam por aqui: vão pelo registro de ferramentas.
 */
import type { ChatEntry, ChatKind, EnemyAttackResult, GameState, RollOutcome, RollRequest } from '../types/game';
import { formatGameTime } from '../rules/world';
import { MAX_SKILL_LEVEL, getSkill, skillUpgradeCost } from '../rules/skills';
import { applyPlayerAttack, reloadWeapon } from './combat';
import { applyDamageApplication, deathSavePenalty, healCharacter, needsDeathSave } from './health';
import { spendLuck } from './checks';
import { emit } from './events';
import { makeId } from './ids';

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

/** Se o personagem está caído e não estabilizado, força o Teste de Morte. */
export function ensureDeathSave(state: GameState): GameState {
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

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'rollResolved': {
      const { outcome } = action;
      const req = outcome.request;
      let s: GameState = { ...state, character: spendLuck(state.character, outcome.check.luckSpent) };

      if (outcome.attack) {
        const a = outcome.attack;
        const applied = applyPlayerAttack(s, a);
        s = { ...s, character: applied.character, combat: applied.combat };
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
      if (s.combat.active && req.kind === 'attack') s = { ...s, combat: { ...s.combat, round: s.combat.round + 1 } };
      return { ...s, pendingRoll: null };
    }

    case 'enemyAttack': {
      const res = action.result;
      let s = state;
      if (res.application) s = { ...s, character: applyDamageApplication(s.character, res.application) };
      const summary = res.hit
        ? `${res.attackerName} acertou você: −${res.application?.hpDamage ?? 0} PV${res.application?.criticalInjury ? ` e ${res.application.criticalInjury.name}` : ''}.`
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
      const s = appendChat({ ...state, character: result.character }, { kind: 'system', text: `Recarregou ${result.loadedRounds} cartucho(s).` });
      return emit(s, 'AMMO_RELOADED', `Recarga: +${result.loadedRounds}`, { target: action.weaponId, value: result.loadedRounds });
    }

    case 'equip': {
      const item = state.character.inventory.find(i => i.id === action.itemId);
      if (!item) return state;
      const inventory = state.character.inventory.map(i => {
        if (i.id === item.id) return { ...i, equipped: action.equipped };
        if (action.equipped && item.armor && i.armor?.slot === item.armor.slot) return { ...i, equipped: false };
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
      const s = { ...state, character: { ...state.character, inventory: state.character.inventory.filter(i => i.id !== item.id) } };
      return emit(s, 'ITEM_REMOVED', `Descartou ${item.name}`, { target: item.id, value: item.quantity });
    }

    case 'improveSkill': {
      const skill = getSkill(action.skillId);
      if (!skill) return state;
      const current = state.character.skills[skill.id] ?? 0;
      if (current >= MAX_SKILL_LEVEL) return state;
      const cost = skillUpgradeCost(current + 1);
      if (state.character.ip < cost) return state;
      const character = { ...state.character, ip: state.character.ip - cost, skills: { ...state.character.skills, [skill.id]: current + 1 } };
      return emit({ ...state, character }, 'SKILL_IMPROVED', `${skill.label} → ${current + 1} (−${cost} PM)`, { target: skill.id, value: current + 1 });
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
