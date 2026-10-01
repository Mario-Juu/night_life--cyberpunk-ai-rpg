/**
 * Iniciativa aplicada (Cyberpunk RED): REF + 1d10 para todos; a ordem manda nos turnos.
 *
 * Depois da Ação do jogador, o motor resolve os inimigos: primeiro os mais lentos que ele (o resto da
 * rodada), a rodada vira, e os mais rápidos agem no começo da próxima — aí é a vez do jogador de novo.
 * Quem cai antes da própria vez não age. Tudo antes da narração: o Mestre narra o que já aconteceu.
 */
import type { Combatant, EnemyAttackResult, GameState } from '../types/game';
import type { Rng } from './dice';
import { activeAllies, activeEnemies, isAlly, resolveCombatantAttack, resolveEnemyAttack, rollInitiative } from './combat';
import { syncPartyFromCombat, withPartyInCombat } from './party';
import { appendChat, ensureDeathSave, gameReducer } from './reducer';
import { tickRound } from './quickhacks';
import { emit } from './events';

/** Garante iniciativa de todos: rola a do jogador (e de quem não tem) na primeira vez; quem entrou depois rola a sua. */
export function ensureInitiative(stateIn: GameState, rng: Rng): GameState {
  if (!stateIn.combat.active) return stateIn;
  // Equipe presente entra na luta (com o PV que tinha).
  const state = withPartyInCombat(stateIn);
  if (state.combat.playerInitiative === null) {
    const init = rollInitiative(state, rng);
    const combatants = state.combat.combatants.map(t => ({ ...t, initiative: t.initiative ?? init.enemies.find(e => e.id === t.id)?.value ?? null }));
    const s = { ...state, combat: { ...state.combat, playerInitiative: init.player, combatants } };
    return emit(s, 'ROLL_MADE', `Iniciativa: você ${init.player}; ${combatants.filter(t => t.status === 'active').map(t => `${t.name} ${t.initiative}`).join(', ')}`, { data: { initiative: true } });
  }
  if (!state.combat.combatants.some(t => t.status === 'active' && t.initiative === null)) return state;
  return { ...state, combat: { ...state.combat, combatants: state.combat.combatants.map(t => (t.status === 'active' && t.initiative === null ? { ...t, initiative: t.ref + rng(10) } : t)) } };
}

/** Empate com o jogador: o jogador age antes. */
const fasterThanPlayer = (t: Combatant, player: number) => (t.initiative ?? 0) > player;

export interface EnemyPhase {
  state: GameState;
  /** Uma linha por inimigo que agiu (o que o narrador tem de narrar). */
  lines: string[];
  results: EnemyAttackResult[];
}

/** Os inimigos agem na ordem de iniciativa depois da Ação do jogador (e a rodada vira no meio). */
export function runEnemyPhase(s0: GameState, rng: Rng): EnemyPhase {
  if (!s0.combat.active || s0.character.dead) return { state: s0, lines: [], results: [] };
  let s = ensureInitiative(s0, rng);
  const player = s.combat.playerInitiative ?? 0;
  const lines: string[] = [];
  const results: EnemyAttackResult[] = [];
  const order = (faster: boolean) =>
    s.combat.combatants
      .filter(t => t.status === 'active' && fasterThanPlayer(t, player) === faster)
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0))
      .map(t => t.id);

  /** NPC × NPC (aliado e inimigo): aplica e registra a linha. */
  const npcAttack = (attackerId: string, defenderId: string) => {
    const res = resolveCombatantAttack(s, attackerId, defenderId, rng);
    if (!res) return;
    s = appendChat({ ...s, combat: res.combat }, { kind: 'combat', text: res.result.line });
    s = emit(s, 'ATTACK_RESOLVED', res.result.line, { source: attackerId, target: defenderId, value: res.result.hit });
    lines.push(res.result.line);
  };

  const allyTurn = (ally: Combatant) => {
    const foes = activeEnemies(s.combat);
    if (!foes.length || ally.stance === 'hold' || ally.stance === 'retreat') {
      if (ally.stance === 'hold') {
        s = { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => (t.id === ally.id ? { ...t, cover: t.cover === 'none' ? 'partial' : t.cover } : t)) } };
        lines.push(`${ally.name} (aliado) segura posição na cobertura.`);
      }
      return;
    }
    // focus: o alvo combinado · protect: o inimigo mais perigoso · aggressive: o mais ferido.
    const target =
      (ally.stance === 'focus' && foes.find(f => f.id === ally.focusId)) ||
      (ally.stance === 'protect' ? [...foes].sort((a, b) => b.attackBase - a.attackBase)[0] : [...foes].sort((a, b) => a.hp.current - b.hp.current)[0]);
    npcAttack(ally.id, target.id);
  };

  const enemyTurn = (foe: Combatant) => {
    // Escolhe entre o jogador e os aliados (o jogador pesa mais; quem está na cobertura, menos).
    const allies = activeAllies(s.combat);
    if (allies.length) {
      const weights = [3, ...allies.map(a => (a.stance === 'hold' ? 1 : 2))];
      let roll = rng(weights.reduce((n, w) => n + w, 0));
      let pick = 0;
      while (roll > weights[pick]) roll -= weights[pick++];
      if (pick > 0) return npcAttack(foe.id, allies[pick - 1].id);
    }
    const res = resolveEnemyAttack(s, foe.id, rng);
    if (!res) return;
    const before = s.chat.length;
    s = gameReducer(s, { type: 'enemyAttack', result: res.result });
    results.push(res.result);
    lines.push(...s.chat.slice(before).filter(e => e.kind === 'combat').map(e => e.text));
  };

  const act = (ids: string[]) => {
    for (const id of ids) {
      if (s.character.dead || !s.combat.active) return;
      // Pode ter caído/fugido antes da própria vez.
      const t = s.combat.combatants.find(x => x.id === id);
      if (t?.status !== 'active') continue;
      if (isAlly(t)) allyTurn(t);
      else enemyTurn(t);
    }
  };

  // Resto da rodada: quem é mais lento que o jogador.
  act(order(false));
  // A rodada vira: RAM recupera, efeitos vencem, Superaquecimento queima.
  if (s.combat.active) {
    s = tickRound({ ...s, combat: { ...s.combat, round: s.combat.round + 1 } });
    // Começo da nova rodada: quem é mais rápido que o jogador age antes dele.
    act(order(true));
  }
  s = syncPartyFromCombat(ensureDeathSave(s));
  if (!lines.length) s = appendChat(s, { kind: 'combat', text: 'Nenhum inimigo consegue agir nesta rodada.' });
  return { state: s, lines, results };
}
