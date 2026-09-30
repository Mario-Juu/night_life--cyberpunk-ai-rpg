/**
 * Rótulos em PT-BR para valores internos (enums em inglês) que chegam ao jogador.
 * Regra: nenhum valor cru de enum aparece na tela ou no registro.
 */
import type { CombatantStatus, CoverLevel, GameEventType, NpcStatus, RoleId } from '../types/game';
import type { IntentType, ToolOrigin, TurnPhase } from '../types/turn';

export const COMBATANT_STATUS_LABEL: Record<CombatantStatus, string> = {
  active: 'ativo',
  down: 'derrubado',
  fled: 'fugiu',
  dead: 'morto',
  surrendered: 'rendido',
};

export const NPC_STATUS_LABEL: Record<NpcStatus, string> = { alive: 'vivo', missing: 'desaparecido', dead: 'morto' };

export const COVER_LABEL: Record<CoverLevel, string> = { none: 'exposto', partial: 'meia cobertura', full: 'cobertura total' };

export const PHASE_LABEL: Record<TurnPhase, string> = {
  interpreting: 'Interpretando',
  awaiting_roll: 'Aguardando rolagem',
  in_net: 'Na Rede',
  narrating: 'Narrando',
  complete: 'Concluído',
  failed: 'Falhou',
};

export const ORIGIN_LABEL: Record<ToolOrigin, string> = { interpreter: 'intérprete', narrator: 'narrador', phone: 'telefone', player: 'jogador', engine: 'motor' };

export const INTENT_LABEL: Record<IntentType, string> = {
  attack: 'ataque',
  skill: 'perícia',
  social: 'social',
  move: 'movimento',
  trade: 'negócio',
  use_item: 'usar item',
  observe: 'observar',
  dialogue: 'conversa',
  rest: 'descanso',
  netrun: 'Rede',
  other: 'outro',
};

export const ROLE_LABEL: Record<RoleId, string> = { solo: 'Solo', netrunner: 'Trilheiro', tech: 'Técnico', medtech: 'Medicânico', fixer: 'Canal', nomad: 'Nômade' };

export const RELATION_LABEL: Record<string, string> = { trust: 'confiança', respect: 'respeito', fear: 'medo', anger: 'raiva' };

export const EVENT_LABEL: Record<GameEventType, string> = {
  PLAYER_MOVED: 'Deslocamento',
  ITEM_ACQUIRED: 'Item obtido',
  ITEM_REMOVED: 'Item removido',
  ITEM_USED: 'Item usado',
  AMMO_RELOADED: 'Recarga',
  MONEY_CHANGED: 'Eddies',
  DAMAGE_DEALT: 'Dano causado',
  DAMAGE_TAKEN: 'Dano sofrido',
  HEALED: 'Cura',
  INJURY_ADDED: 'Ferimento crítico',
  INJURY_REMOVED: 'Ferimento tratado',
  HUMANITY_CHANGED: 'Humanidade',
  CYBERWARE_INSTALLED: 'Cromo instalado',
  NPC_MET: 'Personagem conhecido',
  NPC_UPDATED: 'Personagem atualizado',
  NPC_DIED: 'Morte',
  PLAYER_DIED: 'Flatline',
  CONDITION_CHANGED: 'Condição',
  QUEST_STARTED: 'Missão iniciada',
  QUEST_UPDATED: 'Missão atualizada',
  QUEST_COMPLETED: 'Missão concluída',
  QUEST_FAILED: 'Missão falhou',
  RELATIONSHIP_CHANGED: 'Relação',
  FACTION_CHANGED: 'Facção',
  REPUTATION_CHANGED: 'Reputação',
  HEAT_CHANGED: 'Calor policial',
  WORLD_FLAG_CHANGED: 'Fato do mundo',
  SCENE_CHANGED: 'Cena',
  TIME_ADVANCED: 'Tempo',
  EFFECT_ADDED: 'Efeito',
  EFFECT_EXPIRED: 'Efeito encerrado',
  MESSAGE_RECEIVED: 'Mensagem recebida',
  MESSAGE_SENT: 'Mensagem enviada',
  MEMORY_CREATED: 'Memória',
  NPC_MEMORY_CREATED: 'Memória de personagem',
  ROLL_MADE: 'Dados',
  CHECK_RESOLVED: 'Teste',
  ATTACK_RESOLVED: 'Ataque',
  COMBAT_STARTED: 'Combate iniciado',
  COMBAT_ENDED: 'Combate encerrado',
  EVENT_SCHEDULED: 'Evento agendado',
  EVENT_TRIGGERED: 'Evento disparado',
  EVENT_CANCELLED: 'Evento cancelado',
  SKILL_IMPROVED: 'Perícia evoluída',
  CYBERPSYCHOSIS: 'Ciberpsicose',
  ROLE_IMPROVED: 'Papel evoluído',
  NET_ACTION: 'Rede',
  NET_JACK_IN: 'Conexão',
  NET_JACK_OUT: 'Desconexão',
  IP_AWARDED: 'Pontos de Melhoria',
  TOOL_REJECTED: 'Pedido recusado',
  SYSTEM: 'Sistema',
};

export const THERAPY_LABEL: Record<string, string> = { standard: 'padrão', extreme: 'intensiva' };
