/** Ferramentas dos sistemas urbanos: disponibilidade, perseguição e pressão de facção. */
import { CYBERWARE } from '../../rules/cyberware';
import { getSkill } from '../../rules/skills';
import { buyMarketCyberware, openNightMarket, orderCyberware, resolveChase, startChase } from '../citySystems';
import { instantCheck } from '../instant';
import { defineTool, fail, ok } from './registry';

const PLAYER = ['interpreter', 'player'] as const;
const NARR = ['narrator', 'phone'] as const;
const CYBER_KEYS = Object.keys(CYBERWARE);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const URBAN_TOOLS = [
  defineTool({
    name: 'open_night_market',
    kind: 'mutation',
    origins: NARR,
    description: 'Abre um Mercado Noturno com estoque EXPLÍCITO de peças de cromo. Não coloque protótipos; militar exige blackMarket.',
    params: {
      name: { type: 'string', desc: 'nome do mercado', required: true, max: 80 },
      cyberStock: { type: 'string', desc: `chaves de cromo separadas por vírgula: ${CYBER_KEYS.join(', ')}`, max: 1000 },
      blackMarket: { type: 'boolean', desc: 'aceita hardware militar' },
      hours: { type: 'number', desc: 'duração em horas (só informativa por enquanto)', min: 1, max: 72 },
    },
    run: (s, a) => {
      const stock = (a.cyberStock ?? '').split(',').map(k => k.trim()).filter(k => k in CYBERWARE);
      return ok(openNightMarket(s, { name: a.name, district: s.world.location.district, cyberStock: stock, blackMarket: a.blackMarket, endsAt: a.hours ? new Date(new Date(s.world.time).getTime() + a.hours * 3_600_000).toISOString() : undefined }), `${a.name} abriu: ${stock.length} peças de cromo no estoque.`);
    },
  }),
  defineTool({
    name: 'buy_market_cyberware',
    kind: 'action',
    origins: PLAYER,
    description: 'Compra do Mercado Noturno uma peça solta presente naquela banca. Ainda exige cirurgia em um ripperdoc.',
    params: { key: { type: 'string', desc: 'chave do implante', required: true, enum: CYBER_KEYS } },
    run: (s, a) => {
      const r = buyMarketCyberware(s, a.key);
      return r.error ? fail(s, r.error) : ok(r.state, `Comprou ${CYBERWARE[a.key].name} como peça solta por €$${r.price}.`);
    },
  }),
  defineTool({
    name: 'order_cyberware',
    kind: 'action',
    origins: PLAYER,
    description: 'Um Canal com Operador suficiente encomenda cromo raro. O pagamento sai agora; a peça chega automaticamente quando o relógio avançar.',
    params: { key: { type: 'string', desc: 'chave do implante', required: true, enum: CYBER_KEYS }, fixerId: { type: 'string', desc: 'id do Canal que conseguiu a peça', max: 80 } },
    run: (s, a) => {
      const r = orderCyberware(s, a.key, a.fixerId);
      return r.error ? fail(s, r.error) : ok(r.state, `Encomendou ${CYBERWARE[a.key].name}: €$${r.price}, chegada em ${r.hours}h.`);
    },
  }),
  defineTool({
    name: 'start_chase',
    kind: 'mutation',
    origins: NARR,
    description: 'Inicia uma perseguição veicular. pressure 1–4; 5 encurrala. Integridade vai de 1 a 6.',
    params: {
      opponent: { type: 'string', desc: 'quem persegue ou foge', required: true, max: 80 },
      reason: { type: 'string', desc: 'motivo da perseguição', required: true, max: 160 },
      factionId: { type: 'string', desc: 'facção envolvida, se houver', max: 80 },
      pressure: { type: 'number', desc: '1..4', min: 1, max: 4 },
      vehicleIntegrity: { type: 'number', desc: 'integridade do veículo do jogador, 1..6', min: 1, max: 6 },
      opponentIntegrity: { type: 'number', desc: 'integridade do veículo oponente, 1..6', min: 1, max: 6 },
    },
    run: (s, a) => ok(startChase(s, { opponent: a.opponent, reason: a.reason, factionId: a.factionId, pressure: a.pressure, vehicleIntegrity: a.vehicleIntegrity ?? 4, opponentIntegrity: a.opponentIntegrity ?? 4 }), `Perseguição iniciada contra ${a.opponent}.`),
  }),
  defineTool({
    name: 'chase_action',
    kind: 'action',
    origins: PLAYER,
    description: 'Ação numa perseguição: drive/evade reduz pressão, escape tenta abrir distância, ram danifica ambos, shoot danifica o veículo adversário. Rola na hora.',
    params: { action: { type: 'string', desc: 'manobra', required: true, enum: ['drive', 'evade', 'ram', 'shoot', 'escape'] } },
    run: (s, a, ctx) => {
      if (!s.world.chase) return fail(s, 'Não há perseguição em curso.');
      const skillId = a.action === 'shoot' ? 'handgun' : 'drive';
      const skill = getSkill(skillId)!;
      const r = instantCheck(s, { reason: `Perseguição: ${a.action}`, stat: skill.stat, skillId, dv: 13 }, ctx.rng);
      const total = r.outcome.check.total;
      const resolved = resolveChase(r.state, a.action as 'drive' | 'evade' | 'ram' | 'shoot' | 'escape', total);
      return ok(resolved.state, resolved.summary, { success: r.outcome.check.success });
    },
  }),
  defineTool({
    name: 'modify_faction_heat',
    kind: 'mutation',
    origins: NARR,
    description: 'Ajusta o calor específico com uma facção (−3..+3, 0..5), separado do Heat policial global.',
    params: { factionId: { type: 'string', desc: 'id da facção', required: true, max: 80 }, delta: { type: 'number', desc: 'mudança', required: true, min: -3, max: 3 }, reason: { type: 'string', desc: 'motivo', max: 160 } },
    run: (s, a) => {
      const faction = s.factions.find(f => f.id === a.factionId);
      if (!faction) return fail(s, `Facção "${a.factionId}" não existe.`);
      const heat = clamp((faction.heat ?? 0) + a.delta, 0, 5);
      const next = { ...s, factions: s.factions.map(f => (f.id === faction.id ? { ...f, heat } : f)) };
      return ok(next, `${faction.name}: calor ${heat}/5${a.reason ? ` (${a.reason})` : ''}.`);
    },
  }),
];
