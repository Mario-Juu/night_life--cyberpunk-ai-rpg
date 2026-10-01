/**
 * Mutações pedidas pelo narrador/telefone. Todas limitadas, atribuídas e registradas.
 * O LLM não define números diretamente: dinheiro entra por recompensa de missão,
 * loot gerado pelo motor ou transferência atribuída e limitada.
 */
import type { ConditionKey, CyberwareCategory, Faction, GameState, Mission, Npc, NpcBondKind, NpcGoalStatus, StatKey } from '../../types/game';
import { leaveAccessPoint } from '../net';
import { refillRam } from '../quickhacks';
import { dismiss, endCombatParty, recruit, withPartyInCombat } from '../party';
import { CONDITION_KEYS, CONDITION_LABEL, setCondition } from '../conditions';
import { findCombatantLoose, mergeCombatants } from '../combatants';
import { NPC_TEMPLATES, NPC_TEMPLATE_KEYS, guessTemplate, templateDocs } from '../../rules/npcTemplates';
import { humanityTransition } from '../humanity';
import { COMBATANT_STATUS_LABEL, COVER_LABEL, NPC_STATUS_LABEL, RELATION_LABEL } from '../../rules/labels';
import { DISTANCE_LABEL } from '../../rules/weapons';
import { THREAT_LABEL } from '../world';
import { releaseGrapple } from '../brawl';
import { installCyberware } from '../cyberware';
import { findCyberware, implantFromName } from '../../rules/cyberware';
import { humanityBand, isCyberpsycho } from '../../rules/humanity';
import { CRITICAL_INJURIES, findCriticalInjuryTemplate } from '../../rules/criticalInjuries';
import { computeMaxHumanity, humanityAfter, STAT_KEYS } from '../../rules/stats';
import { WEAPONS } from '../../rules/weapons';
import { MAX_TRANSFER_IN } from '../../rules/catalog';
import { advanceGameTime, formatGameTime } from '../../rules/world';
import { applyDamageToCharacter, healCharacter } from '../health';
import { makeId, slugId } from '../ids';
import { emit } from '../events';
import { advanceTime, normalizeFlagKey, PAYMENT_WINDOW_TURNS, paymentMatchesQuest, recentPayments, resolveQuest, scheduleEvent, setFlag, setNpcStatus, deliverMessage } from '../world';
import { defineTool, fail, ok } from './registry';
import { ensureNpc } from '../npcs';
import { changeFront, type FrontChange } from '../fronts';
import { BOND_LABEL, NPC_BOND_KINDS, addKnowsAboutPlayer, revealNpcItem, setNpcProfile, targetName, upsertNpcBond, upsertNpcGoal } from '../npcProfile';
import { addToInventory, buildCombatant, buildItem, clamp, DEFAULT_COVER_HP, findItem, findNpc, recentAcquisition, sameName } from './helpers';

const NARR = ['narrator', 'engine'] as const;
const NARR_PHONE = ['narrator', 'phone', 'engine'] as const;
const ITEM_CATEGORIES = ['weapon', 'armor', 'ammo', 'consumable', 'gear', 'datashard'] as const;
const MEMORY_TYPES = ['CHARACTER_MEMORY', 'CAMPAIGN_MEMORY', 'NPC_MEMORY', 'WORLD_MEMORY', 'PLAYER_MEMORY', 'SCENE_MEMORY'] as const;
const CYBER = ['Neuralware', 'Ciberóptico', 'Ciberáudio', 'Membro Cibernético', 'Implante Interno', 'Implante Dérmico', 'Borgware'] as const;

/** Maior valor de item que o narrador pode entregar de graça. */
export const MAX_GIFT_VALUE = 1000;
export { MAX_TRANSFER_IN };

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
      const text = Object.entries(deltas).filter(([, v]) => v).map(([k, v]) => `${RELATION_LABEL[k] ?? k} ${v > 0 ? '+' : ''}${v}`).join(', ');
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
      netAccess: { type: 'boolean', desc: 'false = o jogador se afastou do terminal/servidor/ponto de acesso da Rede (some do painel; conectado, a conexão cai)' },
    },
    run: (s0, a, ctx) => {
      const ids = a.presentNpcIds
        ?.split(',')
        .map(x => x.trim())
        .map(x => findNpc(s0, x))
        .filter((n): n is Npc => !!n && n.status === 'alive')
        .map(n => n.id);
      const scene = {
        ...s0.scene,
        description: a.description ?? s0.scene.description,
        presentNpcIds: ids ?? s0.scene.presentNpcIds,
        threat: (a.threat as typeof s0.scene.threat) ?? s0.scene.threat,
      };
      const world = { ...s0.world, situation: a.situation ?? s0.world.situation, objective: a.objective ?? s0.world.objective, weather: a.weather ?? s0.world.weather };
      let s = emit({ ...s0, scene, world }, 'SCENE_CHANGED', `Cena: ${scene.description} (ameaça ${THREAT_LABEL[scene.threat].toLowerCase()})`, { data: { presentNpcIds: scene.presentNpcIds } });
      if (a.netAccess === false) s = leaveAccessPoint(s, ctx.rng);
      return ok(s, 'Cena atualizada');
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
      goalKnown: { type: 'boolean', desc: 'o jogador sabe/percebe o que ele quer agora (ele disse ou é óbvio)' },
      location: { type: 'string', desc: 'onde está', max: 80 },
      faction: { type: 'string', desc: 'facção', max: 80 },
      pendingMatters: { type: 'string', desc: 'assunto pendente com o jogador', max: 200 },
      isContact: { type: 'boolean', desc: 'tem o número no Agent (animais nunca)' },
      kind: { type: 'string', desc: 'person (padrão) ou animal (bicho: não fala nem usa o Agent)', enum: ['person', 'animal'] },
      present: { type: 'boolean', desc: 'está fisicamente na cena' },
      knowledge: { type: 'string', desc: 'um fato que ele sabe', max: 300 },
      secret: { type: 'boolean', desc: 'o fato é segredo (o jogador não sabe)' },
      learnsAboutPlayer: { type: 'string', desc: 'algo sobre o JOGADOR que o NPC passou a saber (ele contou, viu, ouviu falar)', max: 200 },
      ripperdocTier: {
        type: 'number',
        desc: 'se é RIPPERDOC: nível da clínica — 1 açougueiro de beco/bio-mod, 2 ripperdoc de bairro, 3 clínica estabelecida, 4 clínica corporativa/de elite, 5 lenda. Seja realista com a lore do lugar.',
        min: 1,
        max: 5,
        int: true,
      },
      blackMarket: { type: 'boolean', desc: 'ripperdoc com contatos no mercado negro (hardware militar)' },
    },
    run: (s0, a) => {
      const existing = findNpc(s0, a.id) ?? findNpc(s0, a.name);
      const ripperdoc: Npc['ripperdoc'] =
        a.ripperdocTier !== undefined
          ? { tier: a.ripperdocTier as 1 | 2 | 3 | 4 | 5, blackMarket: a.blackMarket ?? existing?.ripperdoc?.blackMarket ?? false }
          : existing?.ripperdoc && a.blackMarket !== undefined
            ? { ...existing.ripperdoc, blackMarket: a.blackMarket }
            : existing?.ripperdoc;
      // Virar bicho não é uma atualização: um animal não entra na equipe de combate (recruit recusa).
      if (a.kind === 'animal' && existing && s0.party?.members.some(m => m.npcId === existing.id)) {
        return fail(s0, `${existing.name} está na sua equipe: não pode virar animal. Use dismiss_npc antes.`);
      }
      const secret = a.secret ?? true;
      const fact = a.knowledge ? [{ id: makeId('fact'), fact: a.knowledge, secret, playerKnows: secret ? ('no' as const) : ('yes' as const) }] : [];
      // Objetivo novo: o jogador só sabe se o narrador disser; trocar de objetivo esconde de novo.
      const goalKnown = a.goalKnown ?? (a.currentGoal && a.currentGoal !== existing?.currentGoal ? false : existing?.currentGoalKnown);
      let s: GameState;
      let npc: Npc;
      if (existing) {
        npc = {
          ...existing,
          role: a.role ?? existing.role,
          description: a.description ?? existing.description,
          currentGoal: a.currentGoal ?? existing.currentGoal,
          currentGoalKnown: goalKnown,
          location: a.location ?? existing.location,
          faction: a.faction ?? existing.faction,
          pendingMatters: a.pendingMatters ?? existing.pendingMatters,
          kind: (a.kind as Npc['kind']) ?? existing.kind,
          isContact: a.isContact ?? existing.isContact,
          ripperdoc,
          knowledge: [...existing.knowledge, ...fact.filter(f => !existing.knowledge.some(k => k.fact === f.fact))].slice(-12),
          lastInteraction: formatGameTime(s0.world.time).time,
        };
        if (npc.kind === 'animal') npc = { ...npc, isContact: false };
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
          currentGoalKnown: goalKnown,
          location: a.location ?? s0.world.location.district,
          knowledge: fact,
          status: 'alive',
          faction: a.faction,
          pendingMatters: a.pendingMatters,
          isContact: a.isContact ?? false,
          kind: a.kind as Npc['kind'],
          ripperdoc,
          lastInteraction: formatGameTime(s0.world.time).time,
        };
        if (npc.kind === 'animal') npc = { ...npc, isContact: false };
        s = emit({ ...s0, npcs: [...s0.npcs, npc] }, 'NPC_MET', `Conheceu ${npc.name} (${npc.role})`, { target: npc.id });
      }
      if (a.learnsAboutPlayer) s = addKnowsAboutPlayer(s, npc.id, [a.learnsAboutPlayer]);
      if (a.present !== undefined && npc.status !== 'dead') {
        const others = s.scene.presentNpcIds.filter(id => id !== npc.id);
        s = { ...s, scene: { ...s.scene, presentNpcIds: a.present ? [...others, npc.id] : others } };
        if (a.present) s = { ...s, npcs: s.npcs.map(n => (n.id === npc.id && n.offstage ? { ...n, offstage: undefined } : n)) };
      }
      return ok(s, `${npc.name} (${npc.id})`, { id: npc.id });
    },
  }),
  defineTool({
    name: 'npc_profile',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Personalidade de um NPC que importa (recorrente, contratante, aliado, rival). Defina uma vez e mantenha coerente; campos ausentes ficam como estão.',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      traits: { type: 'string', desc: '2–4 traços separados por vírgula (ex.: "desconfiado, vaidoso, leal à irmã")', max: 160 },
      voice: { type: 'string', desc: 'jeito de falar: registro, gíria, manias', max: 200 },
      motivation: { type: 'string', desc: 'o que move a pessoa', max: 200 },
      afraidOf: { type: 'string', desc: 'o que ela teme', max: 160 },
      lines: { type: 'string', desc: 'o que ela não faz de jeito nenhum', max: 200 },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      if (!npc) return fail(s0, `NPC "${a.npcId}" não existe. Apresente com upsert_npc antes.`);
      if (npc.kind === 'animal') return fail(s0, `${npc.name} é um animal: descreva o temperamento na description.`);
      // Chamada vazia não é sucesso: sem nenhum campo, nada é definido e o Mestre acha que já definiu.
      if (![a.traits, a.voice, a.motivation, a.afraidOf, a.lines].some(v => v?.trim())) {
        return fail(s0, `Mande ao menos um campo do perfil de ${npc.name} (traits, voice, motivation, afraidOf ou lines).`);
      }
      const s = setNpcProfile(s0, npc.id, { traits: a.traits, voice: a.voice, motivation: a.motivation, fear: a.afraidOf, lines: a.lines });
      return ok(s, `${npc.name}: ${s.npcs.find(n => n.id === npc.id)!.profile!.traits.join(', ') || 'perfil atualizado'}`);
    },
  }),
  defineTool({
    name: 'npc_goal',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Objetivo de LONGO PRAZO de um NPC (o imediato é currentGoal no upsert_npc). Sem goalId cria; com goalId atualiza o status. O jogador não fica sabendo por aqui: use reveal_npc.',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      goalId: { type: 'string', desc: 'id existente (goal_…) para atualizar', max: 60 },
      text: { type: 'string', desc: 'o que ele quer', max: 200 },
      status: { type: 'string', desc: 'active, done (conseguiu) ou dropped (desistiu)', enum: ['active', 'done', 'dropped'] },
      playerKnows: { type: 'boolean', desc: 'ao criar: o jogador já sabe disso (ex.: o NPC disse abertamente)' },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      if (!npc) return fail(s0, `NPC "${a.npcId}" não existe.`);
      const res = upsertNpcGoal(s0, npc.id, { goalId: a.goalId, text: a.text, status: a.status as NpcGoalStatus | undefined, playerKnows: a.playerKnows ? 'yes' : undefined });
      if ('error' in res) return fail(s0, res.error);
      return ok(res.state, `${npc.name}: ${res.goal.text} (${res.goal.status}, ${res.goal.id})`, { id: res.goal.id });
    },
  }),
  defineTool({
    name: 'npc_bond',
    kind: 'mutation',
    origins: NARR_PHONE,
    description: 'Vínculo de um NPC com outro NPC ou facção (deve dinheiro, é rival, é amante…). Escondido do jogador até reveal_npc, a não ser que playerKnows.',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      targetId: { type: 'string', desc: 'id/nome do outro NPC ou id/nome da facção', required: true, max: 80 },
      kind: { type: 'string', desc: 'tipo do vínculo', required: true, enum: NPC_BOND_KINDS },
      note: { type: 'string', desc: 'detalhe curto', max: 160 },
      playerKnows: { type: 'boolean', desc: 'o jogador já sabe disso' },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      if (!npc) return fail(s0, `NPC "${a.npcId}" não existe.`);
      const target = findNpc(s0, a.targetId)?.id ?? s0.factions.find(f => f.id === a.targetId || sameName(f.name, a.targetId))?.id;
      if (!target) return fail(s0, `"${a.targetId}" não é NPC nem facção conhecidos. Apresente com upsert_npc antes.`);
      const res = upsertNpcBond(s0, npc.id, { targetId: target, kind: a.kind as NpcBondKind, note: a.note, playerKnows: a.playerKnows ? 'yes' : undefined });
      if ('error' in res) return fail(s0, res.error);
      return ok(res.state, `${npc.name} ${BOND_LABEL[res.bond.kind]} ${targetName(res.state, target)} (${res.bond.id})`, { id: res.bond.id });
    },
  }),
  defineTool({
    name: 'reveal_npc',
    kind: 'mutation',
    origins: NARR_PHONE,
    description:
      'O jogador DESCOBRE (level yes) ou passa a DESCONFIAR (suspects) de um segredo, objetivo ou vínculo de um NPC. Só quando a cena mostra como: confissão, documento, escuta, dedução com pistas. itemId = fact_…/goal_…/bond_… do contexto, ou current_goal.',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      itemId: { type: 'string', desc: 'id do segredo/objetivo/vínculo', required: true, max: 60 },
      level: { type: 'string', desc: 'yes = sabe; suspects = desconfia', enum: ['yes', 'suspects'] },
      how: { type: 'string', desc: 'como descobriu (vai para o Diário)', max: 160 },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      if (!npc) return fail(s0, `NPC "${a.npcId}" não existe.`);
      const res = revealNpcItem(s0, npc.id, a.itemId, (a.level as 'yes' | 'suspects' | undefined) ?? 'yes', a.how);
      if ('error' in res) return fail(s0, res.error);
      return ok(res.state, `${a.level === 'suspects' ? 'Desconfia' : 'Descobriu'}: ${res.text}`);
    },
  }),
  defineTool({
    name: 'front_update',
    kind: 'mutation',
    origins: NARR,
    description:
      'Frente do mundo (seção NA CIDADE): advance = o próximo passo acontece agora; delay = o jogador atrapalhou (adia 1 dia); stop = o jogador deteve a trama de vez; hint = o jogador passou a desconfiar do que está por trás; reveal = descobriu.',
    params: {
      frontId: { type: 'string', desc: 'id da frente (front_…)', required: true, max: 80 },
      change: { type: 'string', desc: 'o que mudou', required: true, enum: ['advance', 'delay', 'stop', 'hint', 'reveal'] },
      reason: { type: 'string', desc: 'o que na cena causou isso', max: 200 },
    },
    run: (s0, a) => {
      const res = changeFront(s0, a.frontId, a.change as FrontChange, a.reason);
      if ('error' in res) return fail(s0, res.error);
      return ok(res.state, res.summary);
    },
  }),
  defineTool({
    name: 'recruit_npc',
    kind: 'mutation',
    origins: NARR_PHONE,
    description:
      'O NPC entra na EQUIPE do jogador (luta ao lado dele, segue de lugar em lugar). Só quando ele aceitou na ficção. Amigo precisa confiar (confiança ≥ 20); mercenário entra pela parte de cada trabalho (share ≥ 10). template = ficha de combate (bodyguard, security_operative, sixth_street…). Máx. 3.',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      share: { type: 'number', desc: '% de cada pagamento de trabalho que ele leva (0 = amigo; 10–50 = mercenário)', min: 0, max: 50 },
      template: { type: 'string', desc: 'ficha de combate pronta que combina com ele', enum: NPC_TEMPLATE_KEYS },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      if (!npc) return fail(s0, `NPC "${a.npcId}" não existe.`);
      const res = recruit(s0, npc.id, { template: a.template, share: a.share });
      return 'error' in res ? fail(s0, res.error) : ok(res.state, res.summary);
    },
  }),
  defineTool({
    name: 'dismiss_npc',
    kind: 'mutation',
    origins: [...NARR_PHONE, 'interpreter'],
    description: 'O NPC sai da equipe (dispensado, foi embora, traiu).',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      reason: { type: 'string', desc: 'por quê', max: 200 },
    },
    run: (s0, a) => {
      const npc = findNpc(s0, a.npcId);
      const res = dismiss(s0, npc?.id ?? a.npcId, a.reason);
      return 'error' in res ? fail(s0, res.error) : ok(res.state, res.summary);
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
      return ok(setNpcStatus(s0, npc.id, a.status as Npc['status'], a.reason), `${npc.name}: ${NPC_STATUS_LABEL[a.status as Npc['status']]}`);
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
      if (npc.kind === 'animal') return fail(s0, `${npc.name} é um animal: não usa o Agent nem manda mensagens.`);
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
      const s = resolveQuest(s0, m.id, 'COMPLETED');
      return ok(s, `Concluída: ${m.title} (+€$${s.character.money - s0.character.money})`);
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
      cyberKey: { type: 'string', desc: 'PEÇA DE CROMO solta (chave do catálogo): achada num corpo, roubada, recompensa. Um ripperdoc instala cobrando só a cirurgia — único jeito de ter protótipos.', max: 40 },
    },
    run: (s0, a) => {
      const source = a.source ?? 'cena';
      // O jogador acabou de COMPRAR (ou já recebeu) este item neste turno: o narrador descrevendo o
      // vendedor entregando é a MESMA coisa — não entra de novo na mochila.
      const dup = recentAcquisition(s0, a.name);
      if (dup) return fail(s0, `Item duplicado: "${dup.name}" já entrou no inventário neste turno (${dup.via === 'buy' ? 'comprado pelo jogador' : 'entregue antes'}). Narre a entrega, não dê de novo.`);
      // Implante entregue pela cena (mesmo sem cyberKey) vira PEÇA SOLTA: só funciona depois de instalado.
      const cyber = a.cyberKey ? findCyberware(a.cyberKey) : implantFromName(a.name);
      if (a.cyberKey && !cyber) return fail(s0, `Cromo "${a.cyberKey}" não existe no catálogo.`);
      const item = cyber
        ? { id: makeId('item'), name: `${cyber.name}${cyber.brand ? ` (${cyber.brand})` : ''} — peça solta`, category: 'gear' as const, quantity: 1, description: `${cyber.effect} Precisa de um ripperdoc para instalar.`, value: 0, cyberKey: cyber.key }
        : buildItem({ ...a, value: a.estimatedValue });
      const s = addToInventory(s0, item);
      return ok(emit(s, 'ITEM_ACQUIRED', `Recebeu ${item.quantity}× ${item.name} (${source})`, { target: item.id, source, value: item.quantity, data: { name: item.name, via: 'give' } }), `+${item.quantity}× ${item.name}`);
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
    description: `Pagamento ou cobrança atribuída a alguém. Entradas: máx. €$${MAX_TRANSFER_IN}. NUNCA pague por aqui um trabalho que é missão: complete_quest já paga a recompensa (não chame os dois). Saídas até €$5000, limitadas ao saldo.`,
    params: {
      amount: { type: 'number', desc: 'positivo = jogador recebe; negativo = paga', required: true, min: -5000, max: MAX_TRANSFER_IN },
      counterpart: { type: 'string', desc: 'quem paga/recebe', required: true, max: 80 },
      reason: { type: 'string', desc: 'motivo', max: 200 },
    },
    run: (s0, a) => {
      const money = s0.character.money;
      if (!a.amount) return fail(s0, 'Transferência de €$0 não é transferência: mande o valor que mudou de mão (ou não chame a ferramenta).');
      if (a.amount < 0 && money < -a.amount) return fail(s0, `Saldo insuficiente: tem €$${money}, precisa pagar €$${-a.amount}.`);
      if (a.amount > 0) {
        // Missão concluída há pouco (neste turno ou nos últimos) já pagou o trabalho: não pagar de novo pela cena.
        const reward = recentPayments(s0, 'quest_reward', s0.turn - PAYMENT_WINDOW_TURNS).find(p => {
          const quest = s0.missions.find(m => m.id === p.questId);
          return quest && paymentMatchesQuest(s0, quest, { value: a.amount, source: a.counterpart });
        });
        if (reward) {
          const quest = s0.missions.find(m => m.id === reward.questId)!;
          return fail(s0, `Pagamento duplicado: a recompensa de "${quest.title}" (€$${reward.reward ?? reward.value}) já foi paga pelo motor quando a missão foi concluída. Narre esse pagamento, não pague de novo.`);
        }
        // Eco com o sinal trocado: o JOGADOR acabou de pagar este valor a esta pessoa (pay_money) — não é uma entrada.
        const giver = findNpc(s0, a.counterpart);
        const echo = s0.events.find(
          e =>
            e.type === 'MONEY_CHANGED' &&
            e.source === 'player' &&
            e.turn >= s0.turn - 1 &&
            e.value === -a.amount &&
            (e.target === giver?.id || (typeof e.target === 'string' && sameName(e.target, a.counterpart))),
        );
        if (echo) return fail(s0, `Isso é o pagamento que o JOGADOR fez (${echo.summary}): ele pagou, não recebeu. Não registre de novo; narre a entrega do dinheiro.`);
      }
      const s = { ...s0, character: { ...s0.character, money: money + a.amount } };
      return ok(
        emit(s, 'MONEY_CHANGED', `${a.amount > 0 ? '+' : ''}${a.amount} €$ — ${a.reason ?? 'sem motivo informado'} (${a.counterpart})`, { source: a.counterpart, value: a.amount, data: { kind: 'transfer' } }),
        `Saldo €$${s.character.money}`,
      );
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
      if (foe.side === 'ally') return fail(s0, `${foe.name} é do seu lado — não se revista um aliado caído.`);
      if (foe.status === 'active') return fail(s0, `${foe.name} ainda está de pé.`);
      if (foe.lootUnavailable) return fail(s0, `${foe.name} ficou para trás quando você saiu da cena.`);
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
      const next = humanityTransition(s0, emit(s, 'HUMANITY_CHANGED', `Humanidade → ${current}${a.reason ? ` (${a.reason})` : ''}`, { value: a.delta }));
      return ok(next, `Humanidade ${current}${isCyberpsycho(next.character) ? ' — CIBERPSICOSE' : ` (${humanityBand(next.character).label})`}`);
    },
  }),
  defineTool({
    name: 'add_cyberware',
    kind: 'mutation',
    origins: NARR,
    description:
      'Implante que a HISTÓRIA coloca no personagem sem ele comprar (presente, cirurgia forçada, recompensa). Use key = implante do CATÁLOGO (o motor aplica efeito e rola a Humanidade). Só para algo fora do catálogo: name + category + humanityLoss. Compra do jogador = install_cyberware (intérprete).',
    params: {
      key: { type: 'string', desc: 'chave do catálogo de cromo (preferível)', max: 40 },
      name: { type: 'string', desc: 'nome (fora do catálogo)', max: 80 },
      category: { type: 'string', desc: 'categoria (fora do catálogo)', enum: CYBER },
      humanityLoss: { type: 'number', desc: 'perda de Humanidade (fora do catálogo)', min: 0, max: 30 },
      description: { type: 'string', desc: 'efeito', max: 300 },
    },
    run: (s0, a, ctx) => {
      const def = findCyberware(a.key) ?? (a.key ? undefined : findCyberware(a.name));
      if (def) {
        const res = installCyberware(s0, def.key, ctx.rng, { free: true, noTime: true });
        return res.ok ? ok(res.state, res.summary) : fail(s0, res.error);
      }
      if (!a.name || !a.category || a.humanityLoss === undefined) return fail(s0, `Implante "${a.key ?? a.name}" não está no catálogo: mande name, category e humanityLoss.`);
      const c = s0.character;
      const cw = { id: makeId('cw'), name: a.name, category: a.category as CyberwareCategory, humanityLoss: a.humanityLoss, description: a.description ?? '' };
      const loss = a.humanityLoss;
      const s = {
        ...s0,
        character: {
          ...c,
          cyberware: [...c.cyberware, cw],
          // Cyberpunk RED: cada peça reduz o máximo em 2 (Borgware 4); estético (perda 0) não reduz.
          humanity: humanityAfter(
            { current: c.humanity.current, max: Math.min(c.humanity.max, computeMaxHumanity(c.stats.EMP)) },
            a.humanityLoss,
            a.humanityLoss > 0 ? (a.category === 'Borgware' ? 4 : 2) : 0,
          ),
        },
      };
      const next = humanityTransition(s0, emit(s, 'CYBERWARE_INSTALLED', `${a.name} (−${a.humanityLoss} Humanidade)`, { target: cw.id, value: -a.humanityLoss }));
      return ok(next, `${a.name} (Humanidade ${next.character.humanity.current}${isCyberpsycho(next.character) ? ' — CIBERPSICOSE' : ''})`);
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
      return ok(emit(s, memory.type === 'NPC_MEMORY' ? 'NPC_MEMORY_CREATED' : 'MEMORY_CREATED', `${s.npcs.find(n => n.id === memory.subject)?.name ?? memory.subject}: ${memory.content.slice(0, 80)}`, { target: memory.id }), 'Memória registrada', { id: memory.id });
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
    description:
      'Inicia (ou reforça) um combate. NPCs GENÉRICOS (capangas, gangers, seguranças, policiais) → use template (ficha pronta oficial) + count para grupos; ' +
      'NPC ÚNICO com nome → mande a ficha COMPLETA (hp, sp, headSp, weaponName, weaponClass, damage, attackBase, evasionBase, ref). ' +
      'Quem JÁ está na luta não é recriado (não repita inimigos a cada turno; use update_combatant): um grupo pedido de novo com o mesmo nome conta os que já existem. ' +
      'REFORÇOS de verdade (chegou mais gente) → count com o TOTAL desejado, ou um nome novo (ex.: "Reforço da Maelstrom"). Fichas: ' +
      templateDocs(),
    params: { combatants: { type: 'combatants', desc: 'inimigos (template/count ou ficha completa)', required: true } },
    run: (s0, a) => {
      // Inimigos já na luta (mesmo id/nome) não duplicam — o narrador costuma repeti-los a cada turno.
      const { combatants, added, reused } = mergeCombatants(s0.combat.active ? s0.combat.combatants : [], a.combatants, buildCombatant);
      const combat = s0.combat.active ? { ...s0.combat, combatants } : { active: true, round: 1, playerInitiative: null, combatants, log: [] };
      // A equipe presente entra já na abertura (antes só aparecia no painel depois da primeira ação).
      let s: GameState = withPartyInCombat({ ...s0, combat, scene: { ...s0.scene, threat: s0.scene.threat === 'extreme' ? 'extreme' as const : 'high' as const } });
      if (added.length) s = emit(s, 'COMBAT_STARTED', `Combate: ${added.map(c => c.name).join(', ')}`, { data: { ids: added.map(c => c.id) } });
      const incomplete = a.combatants.filter(c => !c.template && !(guessTemplate(c.name) && c.hp === undefined && c.sp === undefined && c.attackBase === undefined && !c.weaponClass && !c.damage) && (c.hp === undefined || c.sp === undefined || (!c.weaponClass && !c.damage) || c.attackBase === undefined || c.evasionBase === undefined)).map(c => c.name);
      const unknown = a.combatants.filter(c => c.template && !NPC_TEMPLATES[c.template]).map(c => c.template);
      const parts = [
        added.length ? `Novos: ${added.map(c => `${c.id} (${c.name}${c.template ? ` · ficha ${c.template}` : ''}, PV ${c.hp.max}, SP ${c.sp.body})`).join(', ')}` : '',
        reused.length ? `Já estavam na luta (não duplicados): ${reused.map(c => c.id).join(', ')}` : '',
        incomplete.length ? `Ficha incompleta (${incomplete.join(', ')}): campos faltantes vieram do Boosterganger` : '',
        unknown.length ? `Fichas inexistentes ignoradas: ${unknown.join(', ')}` : '',
      ];
      return ok(s, parts.filter(Boolean).join(' · ') || 'Nada mudou.');
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
      coverHp: { type: 'number', desc: 'PV da cobertura total (porta de madeira 5, parede fina 15, carro 30, concreto 50); padrão 20', min: 1, max: 100, int: true },
    },
    run: (s0, a) => {
      const foe = findCombatantLoose(s0.combat.combatants, a.id, { includeDown: true });
      if (!foe) return fail(s0, `Combatente ${a.id} não existe.`);
      if (a.status === 'active' && foe.hp.current <= 0) return fail(s0, `${foe.name} está com 0 PV e não pode voltar a lutar.`);
      // Aliado só cai pelos PV (o motor derruba): o narrador não mata quem luta do lado do jogador.
      if (foe.side === 'ally' && (a.status === 'down' || a.status === 'dead')) {
        return fail(s0, `${foe.name} é aliado: quem o derruba é o dano. Para tirá-lo da luta, ask_ally retreat ou dismiss_npc.`);
      }
      if (foe.status === 'dead' && a.status && a.status !== 'dead') return fail(s0, `${foe.name} está morto.`);
      const cover = (a.cover as typeof foe.cover) ?? foe.cover;
      // Cobertura total tem PV: dá para atirar nela até quebrar.
      const coverHp = cover === 'full' ? a.coverHp ?? (foe.cover === 'full' ? foe.coverHp : undefined) ?? DEFAULT_COVER_HP : undefined;
      const next = { ...foe, status: (a.status as typeof foe.status) ?? foe.status, distance: (a.distance as typeof foe.distance) ?? foe.distance, cover, coverHp };
      let s = { ...s0, combat: { ...s0.combat, combatants: s0.combat.combatants.map(c => (c.id === foe.id ? next : c)) } };
      if (next.status === 'dead' && foe.status !== 'dead') s = emit(s, 'NPC_DIED', `${foe.name} morreu`, { target: foe.id });
      return ok(s, `${foe.name}: ${COMBATANT_STATUS_LABEL[next.status]}, ${DISTANCE_LABEL[next.distance]}, ${COVER_LABEL[next.cover]}`);
    },
  }),
  defineTool({
    name: 'set_condition',
    kind: 'mutation',
    origins: NARR,
    description:
      'Aplica/remove uma condição. restrained = amarrado, algemado, capturado ou rendido sob a mira (não ataca); grappled = agarrado (−2 em tudo); unconscious = desacordado. Use SEMPRE que alguém ficar indefeso — é o que permite uma execução depois.',
    params: {
      target: { type: 'string', desc: '"player" ou id/nome do NPC ou combatente', required: true, max: 80 },
      condition: { type: 'string', desc: 'condição', required: true, enum: CONDITION_KEYS },
      active: { type: 'boolean', desc: 'false = remove (se soltou, acordou)' },
      source: { type: 'string', desc: 'como aconteceu', max: 120 },
    },
    run: (s0, a) => {
      const key = a.condition as ConditionKey;
      const active = a.active ?? true;
      const label = `${CONDITION_LABEL[key]}${active ? '' : ' (removido)'}`;
      if (a.target === 'player') {
        if (s0.character.dead) return fail(s0, 'O personagem está morto.');
        const conditions = setCondition(s0.character.conditions, key, active, s0.turn, a.source);
        const s = emit({ ...s0, character: { ...s0.character, conditions } }, 'CONDITION_CHANGED', `Você: ${label}`, { target: 'player', value: key, data: { active } });
        return ok(s, `Jogador: ${label}`);
      }
      const foe = findCombatantLoose(s0.combat.combatants, a.target, { includeDown: true });
      if (foe) {
        if (foe.status === 'dead') return fail(s0, `${foe.name} está morto.`);
        const next = { ...foe, conditions: setCondition(foe.conditions, key, active, s0.turn, a.source) };
        const s = { ...s0, combat: { ...s0.combat, combatants: s0.combat.combatants.map(c => (c.id === foe.id ? next : c)) } };
        return ok(emit(s, 'CONDITION_CHANGED', `${foe.name}: ${label}`, { target: foe.id, value: key, data: { active } }), `${foe.name}: ${label}`);
      }
      const npc = findNpc(s0, a.target);
      if (!npc) return fail(s0, `Alvo "${a.target}" não existe.`);
      if (npc.status === 'dead') return fail(s0, `${npc.name} está morto.`);
      const next = { ...npc, conditions: setCondition(npc.conditions, key, active, s0.turn, a.source) };
      const s = { ...s0, npcs: s0.npcs.map(n => (n.id === npc.id ? next : n)) };
      return ok(emit(s, 'CONDITION_CHANGED', `${npc.name}: ${label}`, { target: npc.id, value: key, data: { active } }), `${npc.name}: ${label}`);
    },
  }),
  defineTool({
    name: 'lethal_threat',
    kind: 'mutation',
    origins: NARR,
    description:
      'ANUNCIA uma ameaça que mata sem teste se o jogador não escapar: bomba prestes a detonar, Soulkiller/ICE negro rastreando, prédio desabando, míssil travado. ' +
      'Obrigatório ANTES de uma morte inevitável (o jogador precisa de ao menos um turno para reagir). active:false quando ele escapar ou a ameaça passar.',
    params: {
      description: { type: 'string', desc: 'o que vai matar e como escapar (em uma frase)', max: 200 },
      active: { type: 'boolean', desc: 'false = ameaça encerrada' },
    },
    run: (s0, a) => {
      if (a.active === false) {
        if (!s0.scene.lethalThreat) return fail(s0, 'Não há ameaça letal ativa.');
        const s = { ...s0, scene: { ...s0.scene, lethalThreat: undefined } };
        return ok(emit(s, 'SCENE_CHANGED', `Ameaça letal encerrada: ${s0.scene.lethalThreat.description}`), 'Ameaça letal encerrada');
      }
      if (!a.description) return fail(s0, 'Descreva a ameaça.');
      const lethalThreat = s0.scene.lethalThreat ?? { description: a.description, sinceTurn: s0.turn };
      const s = { ...s0, scene: { ...s0.scene, threat: 'extreme' as const, lethalThreat: { ...lethalThreat, description: a.description } } };
      return ok(emit(s, 'SCENE_CHANGED', `AMEAÇA LETAL: ${a.description}`, { data: { lethal: true } }), `Ameaça letal anunciada: ${a.description}`);
    },
  }),
  defineTool({
    name: 'end_combat',
    kind: 'mutation',
    origins: [...NARR, 'player'],
    description: 'Encerra o combate.',
    params: {
      summary: { type: 'string', desc: 'desfecho', max: 200 },
      abandonLoot: { type: 'boolean', desc: 'true se o jogador fugiu/deixou a cena e não pode mais revistar os corpos' },
    },
    run: (s0, a, ctx) => {
      if (!s0.combat.active) return fail(s0, 'Não há combate ativo.');
      if (ctx.origin === 'player' && s0.combat.combatants.some(c => c.status === 'active' && c.side !== 'ally')) {
        return fail(s0, 'Ainda há inimigos de pé. Derrote-os, faça-os fugir ou renda-os antes de encerrar o combate.');
      }
      // Corpos continuam registrados (para loot) até o próximo combate.
      // Equipe: PV voltam para a ficha; quem caiu faz o Teste de Morte.
      const aftermath = endCombatParty(s0, ctx.rng);
      const combatants = a.abandonLoot
        ? aftermath.state.combat.combatants.map(c => (c.side !== 'ally' && c.status !== 'active' && c.status !== 'fled' ? { ...c, lootUnavailable: true } : c))
        : aftermath.state.combat.combatants;
      const s = releaseGrapple({ ...aftermath.state, character: refillRam(aftermath.state.character), combat: { ...aftermath.state.combat, active: false, round: 0, playerInitiative: null, combatants, os: undefined }, scene: { ...aftermath.state.scene, threat: 'medium' as const } });
      return ok(emit(s, 'COMBAT_ENDED', `Fim do combate${a.summary ? `: ${a.summary}` : ''}`), ['Combate encerrado', ...aftermath.lines].join(' '));
    },
  }),
];
