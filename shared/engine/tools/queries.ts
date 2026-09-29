/** Ferramentas de consulta: não alteram o estado; o resultado vai para o contexto do narrador. */
import { defineTool, fail, ok } from './registry';
import { findNpc } from './helpers';
import { characterSp, characterWoundState, WOUND_LABEL } from '../health';
import { formatGameTime, getDistrict } from '../../rules/world';
import { searchLore } from '../../rules/lore';
import { THREAT_LABEL, computeThreat } from '../world';

const Q = ['interpreter'] as const;

export const QUERY_TOOLS = [
  defineTool({
    name: 'get_character',
    kind: 'query',
    origins: Q,
    description: 'Ficha resumida do protagonista (PV, SP, dinheiro, estado).',
    params: {},
    run: s => {
      const c = s.character;
      return ok(s, `${c.bio.handle}: PV ${c.hp.current}/${c.hp.max} (${WOUND_LABEL[characterWoundState(c)]}), €$${c.money}`, {
        hp: c.hp,
        sp: characterSp(c),
        money: c.money,
        humanity: c.humanity,
        luck: c.luck,
        injuries: c.criticalInjuries.map(i => i.name),
        effects: s.activeEffects.map(e => e.name),
      });
    },
  }),
  defineTool({
    name: 'get_scene',
    kind: 'query',
    origins: Q,
    description: 'Cena atual: descrição, NPCs presentes e ameaça.',
    params: {},
    run: s => {
      const present = s.scene.presentNpcIds.map(id => s.npcs.find(n => n.id === id)?.name ?? id);
      return ok(s, `${s.scene.description || 'Cena sem descrição'} · presentes: ${present.join(', ') || 'ninguém'} · ameaça ${THREAT_LABEL[computeThreat(s)]}`, {
        ...s.scene,
        combat: s.combat.active ? s.combat.combatants.map(c => ({ id: c.id, name: c.name, status: c.status, hp: c.hp })) : null,
      });
    },
  }),
  defineTool({
    name: 'get_location',
    kind: 'query',
    origins: Q,
    description: 'Local e hora atuais.',
    params: {},
    run: s => {
      const t = formatGameTime(s.world.time);
      const d = getDistrict(s.world.location.district);
      return ok(s, `${s.world.location.district} › ${s.world.location.subDistrict} › ${s.world.location.spot}, ${t.time}`, { ...s.world.location, district_vibe: d.vibe, time: t });
    },
  }),
  defineTool({
    name: 'get_npc',
    kind: 'query',
    origins: Q,
    description: 'Estado de um NPC (vivo/morto, relação, objetivo). Não revela segredos ao jogador.',
    params: { npcId: { type: 'string', desc: 'id ou nome exato do NPC', required: true, max: 80 } },
    run: (s, a) => {
      const n = findNpc(s, a.npcId);
      if (!n) return fail(s, `NPC "${a.npcId}" não existe no mundo.`);
      return ok(s, `${n.name} (${n.status}) confiança ${n.trust}`, {
        id: n.id,
        name: n.name,
        status: n.status,
        role: n.role,
        trust: n.trust,
        respect: n.respect,
        fear: n.fear,
        anger: n.anger,
        currentGoal: n.currentGoal,
        location: n.location,
        knowledge: n.knowledge,
      });
    },
  }),
  defineTool({
    name: 'get_relationship',
    kind: 'query',
    origins: Q,
    description: 'Números da relação com um NPC.',
    params: { npcId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 } },
    run: (s, a) => {
      const n = findNpc(s, a.npcId);
      if (!n) return fail(s, `NPC "${a.npcId}" não existe.`);
      return ok(s, `${n.name}: confiança ${n.trust}, respeito ${n.respect}, medo ${n.fear}, raiva ${n.anger}`, { trust: n.trust, respect: n.respect, fear: n.fear, anger: n.anger });
    },
  }),
  defineTool({
    name: 'get_quest',
    kind: 'query',
    origins: Q,
    description: 'Detalhes de uma missão.',
    params: { questId: { type: 'string', desc: 'id ou título exato', required: true, max: 100 } },
    run: (s, a) => {
      const m = s.missions.find(q => q.id === a.questId || q.title.toLowerCase() === a.questId.toLowerCase());
      if (!m) return fail(s, `Missão "${a.questId}" não existe.`);
      return ok(s, `${m.title}: ${m.status} — ${m.objective}`, m);
    },
  }),
  defineTool({
    name: 'get_inventory',
    kind: 'query',
    origins: Q,
    description: 'Inventário com ids, munição e armaduras.',
    params: {},
    run: s =>
      ok(
        s,
        s.character.inventory.map(i => `${i.name}×${i.quantity}`).join(', '),
        s.character.inventory.map(i => ({ id: i.id, name: i.name, qty: i.quantity, weapon: i.weapon, armor: i.armor, equipped: i.equipped })),
      ),
  }),
  defineTool({
    name: 'lookup_lore',
    kind: 'query',
    origins: Q,
    description: 'Fatos fixos do cenário (gangues, corporações, distritos).',
    params: { query: { type: 'string', desc: 'assunto', required: true, max: 120 } },
    run: (s, a) => {
      const hits = searchLore(a.query);
      if (!hits.length) return fail(s, `Nada no banco de lore sobre "${a.query}".`);
      return ok(s, hits.map(h => `${h.title}: ${h.text}`).join(' | '), hits);
    },
  }),
];
