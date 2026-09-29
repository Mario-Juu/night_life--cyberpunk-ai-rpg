/**
 * Mutações pedidas pelo narrador/telefone. Todas limitadas, atribuídas e registradas.
 * O LLM não define números diretamente: dinheiro entra por recompensa de missão,
 * loot gerado pelo motor ou transferência atribuída e limitada.
 */
import type { CyberwareCategory, Faction, GameState, Mission, Npc, StatKey } from '../../types/game';
import { CRITICAL_INJURIES, findCriticalInjuryTemplate } from '../../rules/criticalInjuries';
import { computeMaxHumanity, STAT_KEYS } from '../../rules/stats';
import { WEAPONS } from '../../rules/weapons';
import { advanceGameTime, formatGameTime } from '../../rules/world';
import { applyDamageToCharacter, healCharacter } from '../health';
import { makeId, slugId } from '../ids';
import { emit } from '../events';
import { advanceTime, normalizeFlagKey, resolveQuest, scheduleEvent, setFlag, setNpcStatus, deliverMessage } from '../world';
import { defineTool, fail, ok } from './registry';
import { ensureNpc } from '../npcs';
import { addToInventory, buildCombatant, buildItem, clamp, findItem, findNpc, sameName } from './helpers';

const NARR = ['narrator', 'engine'] as const;
const NARR_PHONE = ['narrator', 'phone', 'engine'] as const;
const ITEM_CATEGORIES = ['weapon', 'armor', 'ammo', 'consumable', 'gear', 'datashard'] as const;
const MEMORY_TYPES = ['CHARACTER_MEMORY', 'CAMPAIGN_MEMORY', 'NPC_MEMORY', 'WORLD_MEMORY', 'PLAYER_MEMORY', 'SCENE_MEMORY'] as const;
const CYBER = ['Neuralware', 'Cyberóptico', 'Cyberáudio', 'Membro Cibernético', 'Implante Interno', 'Implante Dérmico', 'Borgware'] as const;

/** Maior valor de item que o narrador pode entregar de graça. */
export const MAX_GIFT_VALUE = 1000;
export const MAX_TRANSFER_IN = 1000;

export const MUTATION_TOOLS = [
  // ---------------------------------------------------------------- relações
  defineTool({
    name: 'modify_relationship',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Ajusta a relação de um NPC com o jogador (deltas limitados a ±25).',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      trust: { type: 'number', desc: 'Δ confiança', min: -25, max: 25 },
      respect: { type: 'number', desc: 'Δ respeito', min: -25, max: 25 },
      fear: { type: 'number', desc: 'Δ medo', min: -25, max: 25 },
      anger: { type: 'number', desc: 'Δ raiva', min: -25, max: 25 },
      reason: { type: 'string', desc: 'motivo', max: 200 },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      if (!npc) return fail(s0, `NPC "${a.npcId}" não existe.`);
      if (npc.status === 'dead') return fail(s0, `${npc.name} está morto.`);
      const next: Npc = {
        ...npc,
        trust: clamp(npc.trust + (a.trust ?? 0), -100, 100),
        respect: clamp(npc.respect + (a.respect ?? 0), 0, 100),
        fear: clamp(npc.fear + (a.fear ?? 0), 0, 100),
        anger: clamp(npc.anger + (a.anger ?? 0), 0, 100),
      };
      const s = { ...s0, npcs: s0.npcs.map(n => (n.id === npc.id ? next : n)) };
      const deltas = { trust: next.trust - npc.trust, respect: next.respect - npc.respect, fear: next.fear - npc.fear, anger: next.anger - npc.anger };
      const text = Object.entries(deltas).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ');
      return ok(emit(s, 'RELATIONSHIP_CHANGED', `${npc.name}: ${text || 'sem mudança'}${a.reason ? ` — ${a.reason}` : ''}`, { target: npc.id, value: deltas.trust, data: deltas }), `${npc.name}: ${text || 'sem mudança'}`);
    },
  }),
  defineTool({
    name: 'modify_reputation',
    kind: 'mutation',
    origins: NARR,
    description: 'Reputação de rua (±1 por turno, 0..10).',
    params: { delta: { type: 'number', desc: '±1', required: true, min: -1, max: 1 }, reason: { type: 'string', desc: 'motivo', max: 200 } },
    run: (s0, a) => {
      const reputation = clamp(s0.character.reputation + a.delta, 0, 10);
      const s = { ...s0, character: { ...s0.character, reputation } };
      return ok(emit(s, 'REPUTATION_CHANGED', `Reputação → ${reputation}${a.reason ? ` (${a.reason})` : ''}`, { value: reputation }), `Reputação ${reputation}`);
    },
  }),
  defineTool({
    name: 'modify_heat',
    kind: 'mutation',
    origins: NARR,
    description: 'Calor policial (±2 por turno, 0..5).',
    params: { delta: { type: 'number', desc: '±2', required: true, min: -2, max: 2 }, reason: { type: 'string', desc: 'motivo', max: 200 } },
    run: (s0, a) => {
      const heat = clamp(s0.world.heat + a.delta, 0, 5);
      const s = { ...s0, world: { ...s0.world, heat } };
      return ok(emit(s, 'HEAT_CHANGED', `Calor → ${heat}${a.reason ? ` (${a.reason})` : ''}`, { value: heat }), `Calor ${heat}`);
    },
  }),
  defineTool({
    name: 'modify_faction',
    kind: 'mutation',
    origins: NARR,
    description: 'Posição com uma facção (±25).',
    params: {
      factionId: { type: 'string', desc: 'id da facção (se existir)', max: 60 },
      name: { type: 'string', desc: 'nome', required: true, max: 80 },
      delta: { type: 'number', desc: 'Δ posição', required: true, min: -25, max: 25 },
      category: { type: 'string', desc: 'categoria', enum: ['Megacorp', 'Gang', 'Rede de Canais', 'Polícia', 'Clã Nômade', 'Outro'] },
    },
    run: (s0, a) => {
      const existing = s0.factions.find(f => f.id === a.factionId || sameName(f.name, a.name));
      if (existing) {
        const standing = clamp(existing.standing + a.delta, -100, 100);
        const s = { ...s0, factions: s0.factions.map(f => (f.id === existing.id ? { ...f, standing } : f)) };
        return ok(emit(s, 'FACTION_CHANGED', `${existing.name}: ${standing}`, { target: existing.id, value: standing }), `${existing.name} ${standing}`);
      }
      const faction: Faction = { id: slugId('fac', a.name), name: a.name, category: (a.category as Faction['category']) ?? 'Outro', standing: a.delta, description: '' };
      return ok(emit({ ...s0, factions: [...s0.factions, faction] }, 'FACTION_CHANGED', `Facção registrada: ${a.name}`, { target: faction.id }), `Facção ${a.name}`);
    },
  }),

  // ---------------------------------------------------------------- mundo
  defineTool({
    name: 'set_flag',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Registra um fato do mundo como flag (snake_case). hidden = o jogador ainda não sabe.',
    params: {
      key: { type: 'string', desc: 'ex.: guard_alerted, militech_package_stolen', required: true, max: 60 },
      value: { type: 'boolean', desc: 'valor (padrão true)' },
      visibility: { type: 'string', desc: 'public ou hidden', enum: ['public', 'hidden'] },
      reason: { type: 'string', desc: 'motivo', max: 200 },
    },
    run: (s0, a) => {
      const key = normalizeFlagKey(a.key);
      if (!key) return fail(s0, `Flag inválida: ${a.key}`);
      const s = setFlag(s0, key, a.value ?? true, (a.visibility as 'public' | 'hidden') ?? 'public', a.reason);
      return ok(s, `${key} = ${String(a.value ?? true)}`);
    },
  }),
  defineTool({
    name: 'update_scene',
    kind: 'mutation',
    origins: NARR,
    description: 'Atualiza a cena: descrição curta, NPCs presentes (ids separados por vírgula) e ameaça.',
    params: {
      description: { type: 'string', desc: 'descrição curta da cena', max: 200 },
      presentNpcIds: { type: 'string', desc: 'ids dos NPCs fisicamente presentes, separados por vírgula', max: 400 },
      threat: { type: 'string', desc: 'nível de ameaça', enum: ['low', 'medium', 'high', 'extreme'] },
      situation: { type: 'string', desc: 'situação atual (1 frase)', max: 300 },
      objective: { type: 'string', desc: 'objetivo imediato do jogador', max: 300 },
      weather: { type: 'string', desc: 'clima', max: 80 },
    },
    run: (s0, a) => {
      const ids = a.presentNpcIds
        ?.split(',')
        .map(x => x.trim())
        .map(x => findNpc(s0, x))
        .filter((n): n is Npc => !!n && n.status !== 'dead')
        .map(n => n.id);
      const scene = {
        ...s0.scene,
        description: a.description ?? s0.scene.description,
        presentNpcIds: ids ?? s0.scene.presentNpcIds,
        threat: (a.threat as typeof s0.scene.threat) ?? s0.scene.threat,
      };
      const world = { ...s0.world, situation: a.situation ?? s0.world.situation, objective: a.objective ?? s0.world.objective, weather: a.weather ?? s0.world.weather };
      return ok(emit({ ...s0, scene, world }, 'SCENE_CHANGED', `Cena: ${scene.description} (ameaça ${scene.threat})`, { data: { presentNpcIds: scene.presentNpcIds } }), 'Cena atualizada');
    },
  }),
  defineTool({
    name: 'advance_time',
    kind: 'mutation',
    origins: NARR,
    description: 'Avança o relógio do jogo (dispara eventos agendados).',
    params: { minutes: { type: 'number', desc: 'minutos', required: true, min: 1, max: 720 } },
    run: (s0, a) => ok(advanceTime(s0, a.minutes), `+${a.minutes} min`),
  }),
  defineTool({
    name: 'schedule_event',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Agenda algo que acontece no mundo mesmo sem o jogador ver (mensagem, flag, NPC some, fato narrativo).',
    params: {
      inMinutes: { type: 'number', desc: 'daqui a quantos minutos', required: true, min: 1, max: 4320 },
      description: { type: 'string', desc: 'o que acontece', required: true, max: 200 },
      kind: { type: 'string', desc: 'tipo', required: true, enum: ['message', 'set_flag', 'npc_status', 'narrative'] },
      npcId: { type: 'string', desc: 'NPC envolvido (message/npc_status)', max: 80 },
      text: { type: 'string', desc: 'texto da mensagem ou do fato', max: 600 },
      flag: { type: 'string', desc: 'flag a definir (set_flag)', max: 60 },
      value: { type: 'boolean', desc: 'valor da flag' },
      npcStatus: { type: 'string', desc: 'novo status do NPC', enum: ['alive', 'missing', 'dead'] },
      conditionFlag: { type: 'string', desc: 'só acontece se esta flag…', max: 60 },
      conditionValue: { type: 'boolean', desc: '…tiver este valor' },
    },
    run: (s0, a) => {
      const at = advanceGameTime(s0.world.time, a.inMinutes);
      const npc = findNpc(s0, a.npcId);
      let action;
      if (a.kind === 'message') {
        if (!npc || !a.text) return fail(s0, 'message exige npcId válido e text.');
        action = { kind: 'message' as const, npcId: npc.id, text: a.text };
      } else if (a.kind === 'set_flag') {
        const key = a.flag ? normalizeFlagKey(a.flag) : null;
        if (!key) return fail(s0, 'set_flag exige flag válida.');
        action = { kind: 'set_flag' as const, key, value: a.value ?? true, visibility: 'hidden' as const };
      } else if (a.kind === 'npc_status') {
        if (!npc || !a.npcStatus) return fail(s0, 'npc_status exige npcId e npcStatus.');
        action = { kind: 'npc_status' as const, npcId: npc.id, status: a.npcStatus as Npc['status'] };
      } else {
        action = { kind: 'narrative' as const, text: a.text ?? a.description };
      }
      const condKey = a.conditionFlag ? normalizeFlagKey(a.conditionFlag) : null;
      const s = scheduleEvent(s0, { at, description: a.description, action, condition: condKey ? { flag: condKey, equals: a.conditionValue ?? true } : undefined });
      return ok(s, `Agendado para ${formatGameTime(at).time}: ${a.description}`);
    },
  }),
  defineTool({
    name: 'cancel_event',
    kind: 'mutation',
    origins: NARR,
    description: 'Cancela um evento agendado.',
    params: { eventId: { type: 'string', desc: 'id do evento', required: true, max: 80 } },
    run: (s0, a) => {
      const ev = s0.scheduled.find(e => e.id === a.eventId && e.status === 'scheduled');
      if (!ev) return fail(s0, 'Evento agendado não encontrado.');
      const s = { ...s0, scheduled: s0.scheduled.map(e => (e.id === ev.id ? { ...e, status: 'cancelled' as const, resolvedTurn: s0.turn } : e)) };
      return ok(emit(s, 'EVENT_CANCELLED', ev.description, { target: ev.id }), 'Evento cancelado');
    },
  }),

  // ---------------------------------------------------------------- NPCs
  defineTool({
    name: 'upsert_npc',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Apresenta um NPC novo ou atualiza dados narrativos (não mexe na relação: use modify_relationship). Reutilize ids existentes.',
    params: {
      id: { type: 'string', desc: 'id existente (npc_…)', max: 60 },
      name: { type: 'string', desc: 'nome', required: true, max: 80 },
      role: { type: 'string', desc: 'função', max: 80 },
      description: { type: 'string', desc: 'descrição', max: 300 },
      currentGoal: { type: 'string', desc: 'o que ele quer agora', max: 200 },
      location: { type: 'string', desc: 'onde está', max: 80 },
      faction: { type: 'string', desc: 'facção', max: 80 },
      pendingMatters: { type: 'string', desc: 'assunto pendente com o jogador', max: 200 },
      isContact: { type: 'boolean', desc: 'tem o número no Agent' },
      present: { type: 'boolean', desc: 'está fisicamente na cena' },
      knowledge: { type: 'string', desc: 'um fato que ele sabe', max: 300 },
      secret: { type: 'boolean', desc: 'o fato é segredo (o jogador não sabe)' },
    },
    run: (s0, a) => {
      const existing = findNpc(s0, a.id) ?? findNpc(s0, a.name);
      const fact = a.knowledge ? [{ id: makeId('fact'), fact: a.knowledge, secret: a.secret ?? true }] : [];
      let s: GameState;
      let npc: Npc;
      if (existing) {
        npc = {
          ...existing,
          role: a.role ?? existing.role,
          description: a.description ?? existing.description,
          currentGoal: a.currentGoal ?? existing.currentGoal,
          location: a.location ?? existing.location,
          faction: a.faction ?? existing.faction,
          pendingMatters: a.pendingMatters ?? existing.pendingMatters,
          isContact: a.isContact ?? existing.isContact,
          knowledge: [...existing.knowledge, ...fact.filter(f => !existing.knowledge.some(k => k.fact === f.fact))].slice(-12),
          lastInteraction: formatGameTime(s0.world.time).time,
        };
        s = emit({ ...s0, npcs: s0.npcs.map(n => (n.id === npc.id ? npc : n)) }, 'NPC_UPDATED', `${npc.name} atualizado`, { target: npc.id });
      } else {
        const base = a.id && /^npc_[a-z0-9_]+$/.test(a.id) ? a.id : slugId('npc', a.name);
        npc = {
          id: s0.npcs.some(n => n.id === base) ? `${base}_${s0.npcs.length}` : base,
          name: a.name,
          role: a.role ?? 'Desconhecido',
          description: a.description ?? '',
          trust: 0,
          respect: 30,
          fear: 0,
          anger: 0,
          currentGoal: a.currentGoal,
          location: a.location ?? s0.world.location.district,
          knowledge: fact,
          status: 'alive',
          faction: a.faction,
          pendingMatters: a.pendingMatters,
          isContact: a.isContact ?? false,
          lastInteraction: formatGameTime(s0.world.time).time,
        };
        s = emit({ ...s0, npcs: [...s0.npcs, npc] }, 'NPC_MET', `Conheceu ${npc.name} (${npc.role})`, { target: npc.id });
      }
      if (a.present !== undefined && npc.status !== 'dead') {
        const others = s.scene.presentNpcIds.filter(id => id !== npc.id);
        s = { ...s, scene: { ...s.scene, presentNpcIds: a.present ? [...others, npc.id] : others } };
      }
      return ok(s, `${npc.name} (${npc.id})`, { id: npc.id });
    },
  }),
  defineTool({
    name: 'npc_status',
    kind: 'mutation',
    origins: NARR,
    description: 'Muda o status de um NPC (alive, missing, dead). Morte é permanente.',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      status: { type: 'string', desc: 'novo status', required: true, enum: ['alive', 'missing', 'dead'] },
      reason: { type: 'string', desc: 'motivo', max: 200 },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      if (!npc) return fail(s0, `NPC "${a.npcId}" não existe.`);
      if (npc.status === 'dead' && a.status !== 'dead') return fail(s0, `${npc.name} está morto. Mortos não voltam.`);
      return ok(setNpcStatus(s0, npc.id, a.status as Npc['status'], a.reason), `${npc.name}: ${a.status}`);
    },
  }),
  defineTool({
    name: 'send_message',
    kind: 'mutation',
    origins: NARR,
    description: 'Um contato manda SMS agora para o Agent do jogador (máx. 1 por turno).',
    params: {
      npcId: { type: 'string', desc: 'id ou nome do remetente (novo = vira contato)', required: true, max: 80 },
      text: { type: 'string', desc: 'mensagem', required: true, max: 600 },
    },
    run: (s0, a) => {
      // Remetente novo vira contato (em vez de a mensagem se perder).
      const { state: s1, npc } = ensureNpc(s0, a.npcId, { isContact: true, role: 'Contato' });
      if (npc.status === 'dead') return fail(s0, `${npc.name} está morto e não manda mensagens.`);
      return ok(deliverMessage(s1, npc.id, a.text), `SMS de ${npc.name}`);
    },
  }),

  // ---------------------------------------------------------------- missões
  defineTool({
    name: 'start_quest',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Registra uma missão. rewardEddies é a ÚNICA forma de pagar pelo trabalho (paga ao concluir).',
    params: {
      id: { type: 'string', desc: 'id curto (m_…)', max: 60 },
      title: { type: 'string', desc: 'título', required: true, max: 100 },
      description: { type: 'string', desc: 'descrição', max: 400 },
      objective: { type: 'string', desc: 'objetivo atual', required: true, max: 300 },
      rewardEddies: { type: 'number', desc: 'pagamento em eddies', min: 0, max: 5000 },
      reward: { type: 'string', desc: 'outras recompensas (texto)', max: 120 },
      giverId: { type: 'string', desc: 'id do NPC contratante', max: 60 },
      completeFlag: { type: 'string', desc: 'flag que conclui a missão', max: 60 },
      failFlag: { type: 'string', desc: 'flag que falha a missão', max: 60 },
    },
    run: (s0, a) => {
      const existing = s0.missions.find(m => m.id === a.id || sameName(m.title, a.title));
      if (existing) return fail(s0, `Missão já existe (${existing.id}). Use update_quest.`);
      const giver = findNpc(s0, a.giverId);
      const base = a.id && /^m_[a-z0-9_]+$/.test(a.id) ? a.id : slugId('m', a.title);
      const mission: Mission = {
        id: s0.missions.some(m => m.id === base) ? `${base}_${s0.missions.length}` : base,
        title: a.title,
        description: a.description ?? '',
        objective: a.objective,
        status: 'ACTIVE',
        reward: a.reward ?? (a.rewardEddies ? `€$${a.rewardEddies}` : undefined),
        rewardEddies: a.rewardEddies ?? 0,
        giverId: giver?.id,
        notes: [],
        completeFlag: a.completeFlag ? normalizeFlagKey(a.completeFlag) ?? undefined : undefined,
        failFlag: a.failFlag ? normalizeFlagKey(a.failFlag) ?? undefined : undefined,
        startedTurn: s0.turn,
      };
      let s = emit({ ...s0, missions: [...s0.missions, mission] }, 'QUEST_STARTED', `Nova missão: ${mission.title}`, { target: mission.id, source: giver?.id, value: mission.rewardEddies });
      const flag = normalizeFlagKey(`quest_${mission.id.replace(/^m_/, '')}_started`);
      if (flag) s = { ...s, flags: { ...s.flags, [flag]: { key: flag, value: true, visibility: 'public', setTurn: s.turn } } };
      return ok(s, `Missão ${mission.id}: ${mission.title}`, { id: mission.id });
    },
  }),
  defineTool({
    name: 'update_quest',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Atualiza objetivo ou adiciona nota a uma missão ativa.',
    params: {
      questId: { type: 'string', desc: 'id da missão', required: true, max: 60 },
      objective: { type: 'string', desc: 'novo objetivo', max: 300 },
      note: { type: 'string', desc: 'nota', max: 300 },
    },
    run: (s0, a) => {
      const m = s0.missions.find(q => q.id === a.questId);
      if (!m) return fail(s0, `Missão ${a.questId} não existe.`);
      const next = { ...m, objective: a.objective ?? m.objective, notes: a.note ? [...m.notes, a.note].slice(-10) : m.notes };
      return ok(emit({ ...s0, missions: s0.missions.map(q => (q.id === m.id ? next : q)) }, 'QUEST_UPDATED', `${m.title}: ${next.objective}`, { target: m.id }), 'Missão atualizada');
    },
  }),
  defineTool({
    name: 'complete_quest',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Conclui uma missão ativa (o motor paga rewardEddies).',
    params: { questId: { type: 'string', desc: 'id', required: true, max: 60 } },
    run: (s0, a) => {
      const m = s0.missions.find(q => q.id === a.questId);
      if (!m || m.status !== 'ACTIVE') return fail(s0, `Missão ${a.questId} não está ativa.`);
      return ok(resolveQuest(s0, m.id, 'COMPLETED'), `Concluída: ${m.title} (+€$${m.rewardEddies})`);
    },
  }),
  defineTool({
    name: 'fail_quest',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Falha ou abandona uma missão ativa.',
    params: {
      questId: { type: 'string', desc: 'id', required: true, max: 60 },
      abandoned: { type: 'boolean', desc: 'abandonada em vez de falha' },
      reason: { type: 'string', desc: 'motivo', max: 200 },
    },
    run: (s0, a) => {
      const m = s0.missions.find(q => q.id === a.questId);
      if (!m || m.status !== 'ACTIVE') return fail(s0, `Missão ${a.questId} não está ativa.`);
      return ok(resolveQuest(s0, m.id, a.abandoned ? 'ABANDONED' : 'FAILED', a.reason), `Missão encerrada: ${m.title}`);
    },
  }),

  // ---------------------------------------------------------------- itens e dinheiro
  defineTool({
    name: 'give_item',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: `Um NPC/cena entrega um item ao jogador. Valor máximo €$${MAX_GIFT_VALUE}. Informe a origem.`,
    params: {
      name: { type: 'string', desc: 'nome', required: true, max: 80 },
      category: { type: 'string', desc: 'categoria', required: true, enum: ITEM_CATEGORIES },
      source: { type: 'string', desc: 'de onde veio (NPC, cena, corpo…)', max: 120 },
      quantity: { type: 'number', desc: 'quantidade', min: 1, max: 30 },
      description: { type: 'string', desc: 'descrição', max: 300 },
      estimatedValue: { type: 'number', desc: 'valor estimado em €$', min: 0, max: MAX_GIFT_VALUE },
      weaponClass: { type: 'string', desc: 'classe da arma', max: 30 },
      damage: { type: 'string', desc: 'dano', max: 10 },
      armorSP: { type: 'number', desc: 'SP', min: 1, max: 13 },
      armorSlot: { type: 'string', desc: 'head/body', enum: ['head', 'body'] },
      ammoKind: { type: 'string', desc: 'tipo de munição', enum: ['M_PISTOL', 'H_PISTOL', 'VH_PISTOL', 'SLUG', 'RIFLE', 'ARROW'] },
      heal: { type: 'number', desc: 'cura (consumível)', min: 1, max: 12 },
    },
    run: (s0, a) => {
      const source = a.source ?? 'cena';
      const item = buildItem({ ...a, value: a.estimatedValue });
      const s = addToInventory(s0, item);
      return ok(emit(s, 'ITEM_ACQUIRED', `Recebeu ${item.quantity}× ${item.name} (${source})`, { target: item.id, source, value: item.quantity }), `+${item.quantity}× ${item.name}`);
    },
  }),
  defineTool({
    name: 'remove_item',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Remove um item do inventário (perdido, entregue, confiscado).',
    params: {
      itemId: { type: 'string', desc: 'id ou nome EXATO', required: true, max: 80 },
      quantity: { type: 'number', desc: 'quantidade (padrão: tudo)', min: 1, max: 99 },
      reason: { type: 'string', desc: 'motivo', max: 200 },
    },
    run: (s0, a) => {
      const item = findItem(s0, a.itemId);
      if (!item) return fail(s0, `Item "${a.itemId}" não está no inventário.`);
      const qty = Math.min(item.quantity, a.quantity ?? item.quantity);
      const inventory = s0.character.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - qty } : i)).filter(i => i.quantity > 0);
      const s = { ...s0, character: { ...s0.character, inventory } };
      return ok(emit(s, 'ITEM_REMOVED', `Perdeu ${qty}× ${item.name}${a.reason ? ` (${a.reason})` : ''}`, { target: item.id, value: qty }), `−${qty}× ${item.name}`);
    },
  }),
  defineTool({
    name: 'transfer_money',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: `Pagamento ou cobrança atribuída a alguém. Entradas: máx. €$${MAX_TRANSFER_IN} (pagamento por trabalho usa start_quest/complete_quest). Saídas até €$5000, limitadas ao saldo.`,
    params: {
      amount: { type: 'number', desc: 'positivo = jogador recebe; negativo = paga', required: true, min: -5000, max: MAX_TRANSFER_IN },
      counterpart: { type: 'string', desc: 'quem paga/recebe', required: true, max: 80 },
      reason: { type: 'string', desc: 'motivo', max: 200 },
    },
    run: (s0, a) => {
      const money = s0.character.money;
      if (a.amount < 0 && money < -a.amount) return fail(s0, `Saldo insuficiente: tem €$${money}, precisa pagar €$${-a.amount}.`);
      const s = { ...s0, character: { ...s0.character, money: money + a.amount } };
      return ok(emit(s, 'MONEY_CHANGED', `${a.amount > 0 ? '+' : ''}${a.amount} €$ — ${a.reason ?? 'sem motivo informado'} (${a.counterpart})`, { source: a.counterpart, value: a.amount }), `Saldo €$${s.character.money}`);
    },
  }),
  defineTool({
    name: 'loot',
    kind: 'mutation',
    origins: [...NARR, 'interpreter', 'player'],
    description: 'Revistar um inimigo abatido. O motor decide o que ele carregava.',
    params: { combatantId: { type: 'string', desc: 'id do combatente caído', required: true, max: 60 } },
    run: (s0, a, ctx) => {
      const foe = s0.combat.combatants.find(c => c.id === a.combatantId);
      if (!foe) return fail(s0, 'Não há esse corpo por aqui.');
      if (foe.status === 'active') return fail(s0, `${foe.name} ainda está de pé.`);
      if (foe.looted) return fail(s0, `${foe.name} já foi revistado.`);
      let s: GameState = { ...s0, combat: { ...s0.combat, combatants: s0.combat.combatants.map(c => (c.id === foe.id ? { ...c, looted: true } : c)) } };
      const found: string[] = [];
      const profile = WEAPONS[foe.weapon.weaponClass];
      if (foe.weapon.weaponClass !== 'unarmed') {
        const weapon = buildItem({ name: foe.weapon.name, category: 'weapon', weaponClass: foe.weapon.weaponClass, damage: foe.weapon.damage, description: `Tirada de ${foe.name}.` });
        if (weapon.weapon && weapon.weapon.magSize) weapon.weapon.loaded = Math.floor(weapon.weapon.magSize / 2);
        s = addToInventory(s, weapon);
        found.push(weapon.name);
        if (profile.ammo) {
          const rounds = ctx.rng(6) + 2;
          s = addToInventory(s, buildItem({ name: 'Munição', category: 'ammo', ammoKind: profile.ammo, quantity: rounds }));
          found.push(`${rounds} cartuchos`);
        }
      }
      const eddies = ctx.rng(6) * 10;
      s = { ...s, character: { ...s.character, money: s.character.money + eddies } };
      found.push(`€$${eddies}`);
      s = emit(s, 'ITEM_ACQUIRED', `Revistou ${foe.name}: ${found.join(', ')}`, { source: foe.id });
      s = emit(s, 'MONEY_CHANGED', `+${eddies} €$ (${foe.name})`, { source: foe.id, value: eddies });
      return ok(s, `Encontrou: ${found.join(', ')}`, { found });
    },
  }),

  // ---------------------------------------------------------------- corpo
  defineTool({
    name: 'damage',
    kind: 'mutation',
    origins: NARR,
    description: 'Dano AMBIENTAL (queda, fogo, explosão), máx. 30. Nunca use para tiros/golpes de combatentes (use enemyActions).',
    params: {
      amount: { type: 'number', desc: 'dano bruto', required: true, min: 1, max: 30 },
      location: { type: 'string', desc: 'body/head', enum: ['body', 'head'] },
      bypassArmor: { type: 'boolean', desc: 'ignora armadura (fogo, veneno)' },
      reason: { type: 'string', desc: 'causa', max: 200 },
    },
    run: (s0, a, ctx) => {
      const { character, application } = applyDamageToCharacter(
        s0.character,
        { notation: `${a.amount}`, rolls: [a.amount], total: a.amount, sixes: 0, critical: false },
        (a.location as 'body' | 'head') ?? 'body',
        { bypassArmor: a.bypassArmor, rng: ctx.rng },
      );
      const s = emit({ ...s0, character }, 'DAMAGE_TAKEN', `−${application.hpDamage} PV (${a.reason ?? 'ambiente'})`, { source: 'environment', target: 'player', value: application.hpDamage, data: { ...application } });
      return ok(s, `−${application.hpDamage} PV (PV ${application.hpAfter})`);
    },
  }),
  defineTool({
    name: 'heal',
    kind: 'mutation',
    origins: NARR,
    description: 'Cura narrativa (tratamento, descanso), máx. 20.',
    params: { amount: { type: 'number', desc: 'PV', required: true, min: 1, max: 20 }, reason: { type: 'string', desc: 'motivo', max: 200 } },
    run: (s0, a) => {
      const character = healCharacter(s0.character, a.amount);
      const gained = character.hp.current - s0.character.hp.current;
      return ok(emit({ ...s0, character }, 'HEALED', `+${gained} PV (${a.reason ?? 'cura'})`, { value: gained }), `+${gained} PV`);
    },
  }),
  defineTool({
    name: 'stabilize',
    kind: 'mutation',
    origins: NARR,
    description: 'O personagem caído foi estabilizado (sem novos Testes de Morte).',
    params: {},
    run: s0 => {
      if (s0.character.hp.current > 0 || s0.character.dead) return fail(s0, 'Nada a estabilizar.');
      return ok(emit({ ...s0, character: { ...s0.character, stabilized: true } }, 'HEALED', 'Estabilizado'), 'Estabilizado');
    },
  }),
  defineTool({
    name: 'add_injury',
    kind: 'mutation',
    origins: NARR,
    description: 'Ferimento crítico narrativo (tortura, acidente). Chave de CRITICAL_INJURIES ou local.',
    params: {
      key: { type: 'string', desc: `uma de: ${CRITICAL_INJURIES.map(i => i.key).join(', ')}`, max: 40 },
      location: { type: 'string', desc: 'body/head', enum: ['body', 'head'] },
    },
    run: (s0, a, ctx) => {
      const pool = CRITICAL_INJURIES.filter(i => i.location === ((a.location as 'body' | 'head') ?? 'body'));
      const tpl = (a.key && findCriticalInjuryTemplate(a.key)) || pool[ctx.rng(pool.length) - 1];
      const injury = { id: makeId('inj'), ...tpl };
      const s = { ...s0, character: { ...s0.character, criticalInjuries: [...s0.character.criticalInjuries, injury] } };
      return ok(emit(s, 'INJURY_ADDED', tpl.name, { target: 'player', data: { key: tpl.key } }), tpl.name);
    },
  }),
  defineTool({
    name: 'remove_injury',
    kind: 'mutation',
    origins: NARR,
    description: 'Ferimento tratado por um Medicânico.',
    params: { injuryId: { type: 'string', desc: 'id do ferimento', required: true, max: 60 } },
    run: (s0, a) => {
      const inj = s0.character.criticalInjuries.find(i => i.id === a.injuryId);
      if (!inj) return fail(s0, 'Ferimento não encontrado.');
      const s = { ...s0, character: { ...s0.character, criticalInjuries: s0.character.criticalInjuries.filter(i => i.id !== inj.id) } };
      return ok(emit(s, 'INJURY_REMOVED', inj.name, { target: inj.id }), `Tratado: ${inj.name}`);
    },
  }),
  defineTool({
    name: 'add_effect',
    kind: 'mutation',
    origins: NARR,
    description: 'Efeito temporário (droga, estimulante, fogo, atordoamento) com penalidade/bônus em um atributo.',
    params: {
      name: { type: 'string', desc: 'nome', required: true, max: 60 },
      description: { type: 'string', desc: 'descrição', max: 200 },
      stat: { type: 'string', desc: 'atributo afetado (ou all)', enum: [...STAT_KEYS, 'all'] },
      statModifier: { type: 'number', desc: 'modificador −4..+2', min: -4, max: 2 },
      durationMinutes: { type: 'number', desc: 'duração (vazio = até remover)', min: 1, max: 2880 },
    },
    run: (s0, a) => {
      const effect = {
        id: makeId('eff'),
        name: a.name,
        source: 'narrador',
        description: a.description ?? '',
        penalties: a.stat && a.statModifier ? { [a.stat as StatKey | 'all']: a.statModifier } : {},
        expiresAt: a.durationMinutes ? advanceGameTime(s0.world.time, a.durationMinutes) : null,
      };
      return ok(emit({ ...s0, activeEffects: [...s0.activeEffects, effect] }, 'EFFECT_ADDED', a.name, { target: effect.id, data: effect.penalties }), a.name);
    },
  }),
  defineTool({
    name: 'modify_humanity',
    kind: 'mutation',
    origins: NARR,
    description: 'Trauma ou reconexão humana (−10..+5).',
    params: { delta: { type: 'number', desc: 'Δ', required: true, min: -10, max: 5 }, reason: { type: 'string', desc: 'motivo', max: 200 } },
    run: (s0, a) => {
      const current = clamp(s0.character.humanity.current + a.delta, 0, s0.character.humanity.max);
      const s = { ...s0, character: { ...s0.character, humanity: { ...s0.character.humanity, current } } };
      return ok(emit(s, 'HUMANITY_CHANGED', `Humanidade → ${current}${a.reason ? ` (${a.reason})` : ''}`, { value: a.delta }), `Humanidade ${current}`);
    },
  }),
  defineTool({
    name: 'add_cyberware',
    kind: 'mutation',
    origins: NARR,
    description: 'Implante instalado (cobre o custo com transfer_money separado).',
    params: {
      name: { type: 'string', desc: 'nome', required: true, max: 80 },
      category: { type: 'string', desc: 'categoria', required: true, enum: CYBER },
      humanityLoss: { type: 'number', desc: 'perda de Humanidade', required: true, min: 0, max: 30 },
      description: { type: 'string', desc: 'efeito', max: 300 },
    },
    run: (s0, a) => {
      const c = s0.character;
      const cw = { id: makeId('cw'), name: a.name, category: a.category as CyberwareCategory, humanityLoss: a.humanityLoss, description: a.description ?? '' };
      const s = {
        ...s0,
        character: { ...c, cyberware: [...c.cyberware, cw], humanity: { current: Math.max(0, c.humanity.current - a.humanityLoss), max: Math.min(c.humanity.max, computeMaxHumanity(c.stats.EMP)) } },
      };
      return ok(emit(s, 'CYBERWARE_INSTALLED', `${a.name} (−${a.humanityLoss} Humanidade)`, { target: cw.id, value: -a.humanityLoss }), a.name);
    },
  }),
  defineTool({
    name: 'award_ip',
    kind: 'mutation',
    origins: NARR,
    description: 'Pontos de Melhoria ao fim de cenas significativas (5–10).',
    params: { amount: { type: 'number', desc: 'PM', required: true, min: 1, max: 20 }, reason: { type: 'string', desc: 'motivo', max: 200 } },
    run: (s0, a) => ok(emit({ ...s0, character: { ...s0.character, ip: s0.character.ip + a.amount } }, 'IP_AWARDED', `+${a.amount} PM${a.reason ? ` (${a.reason})` : ''}`, { value: a.amount }), `+${a.amount} PM`),
  }),

  // ---------------------------------------------------------------- memória
  defineTool({
    name: 'create_memory',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Registra algo que o mundo deve lembrar. Use subject = id da entidade (npc_rafa, WATSON, m_…).',
    params: {
      type: { type: 'string', desc: 'tipo', required: true, enum: MEMORY_TYPES },
      subject: { type: 'string', desc: 'id/rótulo do assunto', required: true, max: 80 },
      content: { type: 'string', desc: 'o fato', required: true, max: 400 },
      importance: { type: 'number', desc: '1 banal … 10 decisivo', min: 1, max: 10 },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.subject);
      const memory = {
        id: makeId('mem'),
        type: a.type as (typeof MEMORY_TYPES)[number],
        subject: npc?.id ?? a.subject,
        content: a.content,
        importance: a.importance ?? 5,
        confidence: 0.9,
        createdTurn: s0.turn,
        lastRelevantTurn: s0.turn,
        tags: [],
      };
      const s = { ...s0, memories: [...s0.memories, memory] };
      return ok(emit(s, memory.type === 'NPC_MEMORY' ? 'NPC_MEMORY_CREATED' : 'MEMORY_CREATED', `${memory.subject}: ${memory.content.slice(0, 80)}`, { target: memory.id }), 'Memória registrada', { id: memory.id });
    },
  }),
  defineTool({
    name: 'update_memory',
    kind: 'mutation',
    origins: NARR,
    description: 'Corrige/reforça uma memória existente.',
    params: {
      memoryId: { type: 'string', desc: 'id', required: true, max: 80 },
      content: { type: 'string', desc: 'novo conteúdo', max: 400 },
      importance: { type: 'number', desc: 'nova importância', min: 1, max: 10 },
      confidence: { type: 'number', desc: '0..1', min: 0, max: 1, int: false },
    },
    run: (s0, a) => {
      const m = s0.memories.find(x => x.id === a.memoryId);
      if (!m) return fail(s0, 'Memória não encontrada.');
      const next = { ...m, content: a.content ?? m.content, importance: a.importance ?? m.importance, confidence: a.confidence ?? m.confidence, lastRelevantTurn: s0.turn };
      return ok({ ...s0, memories: s0.memories.map(x => (x.id === m.id ? next : x)) }, 'Memória atualizada');
    },
  }),

  // ---------------------------------------------------------------- combate
  defineTool({
    name: 'start_combat',
    kind: 'mutation',
    origins: NARR,
    description: 'Inicia (ou reforça) um combate com inimigos. O motor resolve todos os ataques.',
    params: { combatants: { type: 'combatants', desc: 'inimigos', required: true } },
    run: (s0, a) => {
      const combatants = [...(s0.combat.active ? s0.combat.combatants : [])];
      for (const spec of a.combatants) combatants.push(buildCombatant(spec, combatants));
      const combat = s0.combat.active ? { ...s0.combat, combatants } : { active: true, round: 1, playerInitiative: null, combatants, log: [] };
      const s = { ...s0, combat, scene: { ...s0.scene, threat: s0.scene.threat === 'extreme' ? 'extreme' as const : 'high' as const } };
      return ok(emit(s, 'COMBAT_STARTED', `Combate: ${a.combatants.map(c => c.name).join(', ')}`, { data: { ids: combatants.map(c => c.id) } }), `Combatentes: ${combatants.map(c => c.id).join(', ')}`);
    },
  }),
  defineTool({
    name: 'update_combatant',
    kind: 'mutation',
    origins: NARR,
    description: 'Inimigo foge, se rende, morre (após cair), muda de distância ou cobertura. PV só o motor altera.',
    params: {
      id: { type: 'string', desc: 'id do combatente', required: true, max: 60 },
      status: { type: 'string', desc: 'status', enum: ['active', 'down', 'fled', 'dead', 'surrendered'] },
      distance: { type: 'string', desc: 'distância', enum: ['melee', '0-6m', '7-12m', '13-25m', '26-50m', '51-100m'] },
      cover: { type: 'string', desc: 'cobertura', enum: ['none', 'partial', 'full'] },
    },
    run: (s0, a) => {
      const foe = s0.combat.combatants.find(c => c.id === a.id);
      if (!foe) return fail(s0, `Combatente ${a.id} não existe.`);
      if (a.status === 'active' && foe.hp.current <= 0) return fail(s0, `${foe.name} está com 0 PV e não pode voltar a lutar.`);
      if (foe.status === 'dead' && a.status && a.status !== 'dead') return fail(s0, `${foe.name} está morto.`);
      const next = { ...foe, status: (a.status as typeof foe.status) ?? foe.status, distance: (a.distance as typeof foe.distance) ?? foe.distance, cover: (a.cover as typeof foe.cover) ?? foe.cover };
      let s = { ...s0, combat: { ...s0.combat, combatants: s0.combat.combatants.map(c => (c.id === foe.id ? next : c)) } };
      if (next.status === 'dead' && foe.status !== 'dead') s = emit(s, 'NPC_DIED', `${foe.name} morreu`, { target: foe.id });
      return ok(s, `${foe.name}: ${next.status}, ${next.distance}, ${next.cover}`);
    },
  }),
  defineTool({
    name: 'end_combat',
    kind: 'mutation',
    origins: NARR,
    description: 'Encerra o combate.',
    params: { summary: { type: 'string', desc: 'desfecho', max: 200 } },
    run: (s0, a) => {
      if (!s0.combat.active) return fail(s0, 'Não há combate ativo.');
      // Corpos continuam registrados (para loot) até o próximo combate.
      const s = { ...s0, combat: { ...s0.combat, active: false, round: 0, playerInitiative: null }, scene: { ...s0.scene, threat: 'medium' as const } };
      return ok(emit(s, 'COMBAT_ENDED', `Fim do combate${a.summary ? `: ${a.summary}` : ''}`), 'Combate encerrado');
    },
  }),
];
