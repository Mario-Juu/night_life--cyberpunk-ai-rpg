/**
 * Ações do jogador interpretadas pelo LLM. O motor valida TUDO
 * (arma, munição, alvo vivo, alcance, dinheiro) e prepara a rolagem quando necessário.
 */
import type { GameState, RollRequest, StatKey } from '../../types/game';
import { SKILLS, getSkill } from '../../rules/skills';
import { STAT_KEYS } from '../../rules/stats';
import { WEAPONS } from '../../rules/weapons';
import { priceFor } from '../../rules/catalog';
import { clampDv } from '../../rules/difficulty';
import { getPlayerWeapon, previewAttackDv, reloadWeapon } from '../combat';
import { healCharacter } from '../health';
import { makeId } from '../ids';
import { emit } from '../events';
import { advanceTime } from '../world';
import { defineTool, fail, ok, type ToolOutcome } from './registry';
import { addToInventory, buildCombatant, buildItem, findItem, findNpc, relationshipModifiers, sceneModifiers } from './helpers';

const PLAYER = ['interpreter', 'player'] as const;
const SKILL_IDS = SKILLS.map(s => s.id);
const ITEM_CATEGORIES = ['weapon', 'armor', 'ammo', 'consumable', 'gear', 'datashard'] as const;

/** Monta um teste de perícia validado (alvo vivo, modificadores de relação e cena). */
function prepareCheck(
  s: GameState,
  a: { skillId: string; stat?: string; dv?: number; reason?: string; targetNpcId?: string; modifier?: number },
): ToolOutcome {
  const skill = getSkill(a.skillId);
  if (!skill) return fail(s, `Perícia desconhecida: ${a.skillId}`);
  const npc = findNpc(s, a.targetNpcId);
  if (a.targetNpcId && !npc) return fail(s, `Alvo "${a.targetNpcId}" não existe na cena.`);
  if (npc?.status === 'dead') return fail(s, `${npc.name} está morto — não há como interagir.`);
  if (npc?.status === 'missing') return fail(s, `${npc.name} está desaparecido.`);
  const stat = (STAT_KEYS as readonly string[]).includes(a.stat ?? '') ? (a.stat as StatKey) : skill.stat;
  const request: RollRequest = {
    id: makeId('roll'),
    kind: 'check',
    origin: 'gm',
    reason: a.reason ?? `Teste de ${skill.label}`,
    stat,
    skillId: skill.id,
    dv: clampDv(a.dv), // sem DV informado → 13 (cotidiano)
    modifier: a.modifier ?? 0,
    targetNpcId: npc?.id,
    modifiers: [...relationshipModifiers(npc, skill.id), ...sceneModifiers(s, skill.id)],
  };
  return { state: s, ok: true, summary: `Teste de ${skill.label} (${stat}) preparado: ${request.reason}`, pendingRoll: request, data: { dv: request.dv } };
}

const checkParams = {
  dv: { type: 'number', desc: 'dificuldade (9 simples · 13 cotidiano · 15 difícil · 17 profissional · 21 heroico · 24 incrível)', min: 6, max: 30 },
  reason: { type: 'string', desc: 'o que está em jogo, em uma frase', max: 200 },
  targetNpcId: { type: 'string', desc: 'id do NPC alvo, se houver', max: 80 },
  modifier: { type: 'number', desc: 'circunstância −4..+4', min: -4, max: 4 },
} as const;

export const ACTION_TOOLS = [
  defineTool({
    name: 'attack',
    kind: 'action',
    origins: PLAYER,
    description: 'Atacar um alvo. Se não houver combate, o motor o inicia. O motor valida arma, munição e alcance.',
    params: {
      targetId: { type: 'string', desc: 'id do combatente ou do NPC', max: 80 },
      targetName: { type: 'string', desc: 'nome de um alvo ainda não registrado (ex.: "Segurança")', max: 60 },
      weaponId: { type: 'string', desc: 'id da arma no inventário ("unarmed" = socos/chutes; vazio = arma equipada)', max: 80 },
      aimedHead: { type: 'boolean', desc: 'tiro mirado na cabeça (−8, dano ×2)' },
    },
    run: (s0, a) => {
      let s = s0;
      if (s.character.dead) return fail(s, 'O personagem está morto.');
      const weapon = getPlayerWeapon(s.character, a.weaponId);
      if (a.weaponId && weapon.id !== a.weaponId) return fail(s, `Você não tem a arma "${a.weaponId}".`);
      const profile = WEAPONS[weapon.weapon?.weaponClass ?? 'unarmed'];
      if (!profile.melee && (weapon.weapon?.loaded ?? 0) <= 0) {
        return fail(s, `${weapon.name} está descarregada: só um clique seco. Nenhum disparo acontece.`);
      }

      // Resolve o alvo: combatente → NPC conhecido → novo alvo nomeado.
      let target = s.combat.combatants.find(c => c.id === a.targetId || (a.targetName && c.name.toLowerCase() === a.targetName.toLowerCase()));
      if (target && target.status !== 'active') return fail(s, `${target.name} já está fora de combate (${target.status}).`);
      if (!target) {
        const npc = findNpc(s, a.targetId ?? a.targetName);
        if (npc?.status === 'dead') return fail(s, `${npc.name} já está morto.`);
        const name = npc?.name ?? a.targetName;
        if (!name) return fail(s, 'Alvo não identificado.');
        const combatant = buildCombatant({ id: npc ? `foe_${npc.id.replace(/^npc_/, '')}` : undefined, name, distance: profile.melee ? 'melee' : '0-6m' }, s.combat.combatants);
        const wasActive = s.combat.active;
        s = {
          ...s,
          combat: wasActive
            ? { ...s.combat, combatants: [...s.combat.combatants, combatant] }
            : { active: true, round: 1, playerInitiative: null, combatants: [combatant], log: [] },
        };
        if (!wasActive) s = emit(s, 'COMBAT_STARTED', `Combate iniciado contra ${name}`, { target: combatant.id });
        target = combatant;
      }

      const preview = previewAttackDv(weapon, target);
      if (!profile.melee && preview.dv === null) return fail(s, `${target.name} está fora do alcance de ${weapon.name}.`);
      if (target.cover === 'full') return fail(s, `${target.name} está atrás de cobertura total.`);
      const request: RollRequest = {
        id: makeId('roll'),
        kind: 'attack',
        origin: 'gm',
        reason: `${a.aimedHead ? 'Tiro mirado na cabeça' : 'Ataque'} com ${weapon.name} em ${target.name}`,
        stat: profile.melee ? 'DEX' : 'REF',
        skillId: profile.skillId,
        dv: preview.dv ?? 0,
        modifier: 0,
        targetId: target.id,
        weaponId: weapon.id,
        aimedHead: a.aimedHead,
      };
      return { state: s, ok: true, summary: `Ataque preparado contra ${target.name} (${preview.label})`, pendingRoll: request, data: { targetId: target.id, weaponId: weapon.id } };
    },
  }),
  defineTool({
    name: 'skill_check',
    kind: 'action',
    origins: PLAYER,
    description: 'Teste de perícia para uma ação arriscada ou incerta.',
    params: {
      skillId: { type: 'string', desc: 'id canônico da perícia', required: true, enum: SKILL_IDS },
      stat: { type: 'string', desc: 'atributo (padrão: o da perícia)', enum: STAT_KEYS },
      ...checkParams,
    },
    run: (s, a) => prepareCheck(s, a),
  }),
  defineTool({
    name: 'persuade',
    kind: 'action',
    origins: PLAYER,
    description: 'Convencer ou enganar alguém (Persuasão, COOL).',
    params: checkParams,
    run: (s, a) => prepareCheck(s, { ...a, skillId: 'persuasion' }),
  }),
  defineTool({
    name: 'intimidate',
    kind: 'action',
    origins: PLAYER,
    description: 'Ameaçar ou interrogar (Intimidação, COOL).',
    params: checkParams,
    run: (s, a) => prepareCheck(s, { ...a, skillId: 'interrogation' }),
  }),
  defineTool({
    name: 'hack',
    kind: 'action',
    origins: PLAYER,
    description: 'Invadir um sistema (Interface, INT).',
    params: checkParams,
    run: (s, a) => prepareCheck(s, { ...a, skillId: 'interface' }),
  }),
  defineTool({
    name: 'speak',
    kind: 'action',
    origins: PLAYER,
    description: 'Conversar com um NPC sem risco (sem rolagem).',
    params: {
      npcId: { type: 'string', desc: 'id ou nome exato do NPC', required: true, max: 80 },
      topic: { type: 'string', desc: 'assunto', max: 200 },
    },
    run: (s, a) => {
      const npc = findNpc(s, a.npcId);
      if (!npc) return ok(s, `Fala com alguém ainda não registrado (${a.npcId}).`);
      if (npc.status === 'dead') return fail(s, `${npc.name} está morto e não pode responder.`);
      if (npc.status === 'missing') return fail(s, `${npc.name} está desaparecido.`);
      const present = s.scene.presentNpcIds.includes(npc.id);
      return ok(s, `Conversa com ${npc.name}${a.topic ? ` sobre ${a.topic}` : ''}${present ? '' : ' (não está na cena física — só pelo Agent)'}.`, { npcId: npc.id, present });
    },
  }),
  defineTool({
    name: 'move_location',
    kind: 'action',
    origins: [...PLAYER, 'narrator'],
    description: 'Deslocar-se para outro local (avança o relógio).',
    params: {
      district: { type: 'string', desc: 'distrito (WATSON, HEYWOOD…)', max: 40 },
      subDistrict: { type: 'string', desc: 'bairro', max: 80 },
      spot: { type: 'string', desc: 'lugar específico', required: true, max: 120 },
      minutes: { type: 'number', desc: 'tempo de deslocamento', min: 0, max: 240 },
    },
    run: (s0, a, ctx) => {
      if (s0.combat.active && ctx.origin !== 'narrator') return fail(s0, 'Em combate: sair daqui exige fugir (teste de Atletismo ou Evasão).');
      const location = {
        district: a.district?.toUpperCase() || s0.world.location.district,
        subDistrict: a.subDistrict ?? (a.district ? '' : s0.world.location.subDistrict),
        spot: a.spot,
      };
      let s: GameState = {
        ...s0,
        world: { ...s0.world, location },
        scene: { id: makeId('scene'), description: a.spot, presentNpcIds: [], threat: 'low', startedTurn: s0.turn },
      };
      s = emit(s, 'PLAYER_MOVED', `${location.district} › ${location.subDistrict} › ${location.spot}`, { target: location.district, data: location });
      s = advanceTime(s, a.minutes ?? 15);
      return ok(s, `Deslocou-se para ${location.spot} (${location.district}).`);
    },
  }),
  defineTool({
    name: 'buy_item',
    kind: 'action',
    origins: PLAYER,
    description: 'Comprar um item. Preço de tabela do motor quando existir; o saldo é verificado.',
    params: {
      name: { type: 'string', desc: 'nome do item', required: true, max: 80 },
      category: { type: 'string', desc: 'categoria', required: true, enum: ITEM_CATEGORIES },
      price: { type: 'number', desc: 'preço pedido pelo vendedor (usado só se não houver tabela)', min: 1, max: 20000 },
      quantity: { type: 'number', desc: 'quantidade', min: 1, max: 50 },
      weaponClass: { type: 'string', desc: 'classe da arma', max: 30 },
      damage: { type: 'string', desc: 'dano (ex.: 3d6)', max: 10 },
      armorSP: { type: 'number', desc: 'SP da armadura', min: 1, max: 18 },
      armorSlot: { type: 'string', desc: 'head ou body', enum: ['head', 'body'] },
      ammoKind: { type: 'string', desc: 'tipo de munição', enum: ['M_PISTOL', 'H_PISTOL', 'VH_PISTOL', 'SLUG', 'RIFLE', 'ARROW'] },
      heal: { type: 'number', desc: 'cura (consumíveis)', min: 1, max: 20 },
      sellerNpcId: { type: 'string', desc: 'id do vendedor', max: 80 },
    },
    run: (s0, a) => {
      const seller = findNpc(s0, a.sellerNpcId);
      if (seller?.status === 'dead') return fail(s0, `${seller.name} está morto — não vende nada.`);
      const item = buildItem({ ...a, quantity: a.quantity ?? 1 });
      const { total, source } = priceFor({
        category: item.category,
        quantity: item.quantity,
        weaponClass: item.weapon?.weaponClass,
        armorSP: item.armor?.sp,
        ammoKind: item.ammoKind,
        proposedPrice: a.price,
      });
      const money = s0.character.money;
      if (money < total) return fail(s0, `Eddies insuficientes: ${item.name} custa €$${total} e você tem €$${money}.`);
      let s: GameState = { ...s0, character: { ...s0.character, money: money - total } };
      s = addToInventory(s, { ...item, value: Math.round(total / item.quantity) });
      s = emit(s, 'MONEY_CHANGED', `−${total} €$ (compra: ${item.name})`, { value: -total, target: seller?.id, data: { priceSource: source } });
      s = emit(s, 'ITEM_ACQUIRED', `Comprou ${item.quantity}× ${item.name}`, { target: item.id, value: item.quantity });
      return ok(s, `Comprou ${item.quantity}× ${item.name} por €$${total} (saldo €$${s.character.money}).`, { total, balance: s.character.money });
    },
  }),
  defineTool({
    name: 'pay_money',
    kind: 'action',
    origins: PLAYER,
    description: 'O jogador paga/transfere/gasta eddies (dívida, conta, aluguel, suborno, presente). O motor confere o saldo e desconta.',
    params: {
      amount: { type: 'number', desc: 'valor em €$', required: true, min: 1, max: 100000 },
      recipient: { type: 'string', desc: 'para quem vai o dinheiro', required: true, max: 80 },
      reason: { type: 'string', desc: 'motivo do pagamento', max: 200 },
      questId: { type: 'string', desc: 'missão relacionada (anota o pagamento nela)', max: 60 },
    },
    run: (s0, args) => {
      const a = { ...args, reason: args.reason ?? 'pagamento' };
      const money = s0.character.money;
      if (money < a.amount) return fail(s0, `Saldo insuficiente: você tem €$${money} e quer pagar €$${a.amount}. Nenhum pagamento foi feito.`);
      const npc = findNpc(s0, a.recipient);
      if (npc?.status === 'dead') return fail(s0, `${npc.name} está morto — não há a quem pagar.`);
      let s: GameState = { ...s0, character: { ...s0.character, money: money - a.amount } };
      s = emit(s, 'MONEY_CHANGED', `−${a.amount} €$ para ${a.recipient} (${a.reason})`, { source: 'player', target: npc?.id ?? a.recipient, value: -a.amount });
      const quest = a.questId ? s.missions.find(m => m.id === a.questId) : undefined;
      if (quest) {
        const note = `Pagou €$${a.amount} a ${a.recipient}: ${a.reason}`;
        s = { ...s, missions: s.missions.map(m => (m.id === quest.id ? { ...m, notes: [...m.notes, note].slice(-10) } : m)) };
        s = emit(s, 'QUEST_UPDATED', `${quest.title}: ${note}`, { target: quest.id });
      }
      return ok(s, `Pagou €$${a.amount} a ${a.recipient} (${a.reason}). Saldo agora: €$${s.character.money}.`, { amount: a.amount, balance: s.character.money });
    },
  }),
  defineTool({
    name: 'use_item',
    kind: 'action',
    origins: PLAYER,
    description: 'Usar um consumível do inventário.',
    params: { itemId: { type: 'string', desc: 'id ou nome exato do item', required: true, max: 80 } },
    run: (s0, a, ctx) => {
      const item = findItem(s0, a.itemId);
      if (!item) return fail(s0, `Você não tem "${a.itemId}".`);
      if (item.category !== 'consumable') return fail(s0, `${item.name} não é consumível.`);
      const inventory = s0.character.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
      const healed = item.heal ? ctx.rng(item.heal) : 0;
      const character = healCharacter({ ...s0.character, inventory }, healed);
      let s = emit({ ...s0, character }, 'ITEM_USED', `Usou ${item.name}`, { target: item.id });
      const gained = character.hp.current - s0.character.hp.current;
      if (gained > 0) s = emit(s, 'HEALED', `+${gained} PV (${item.name})`, { value: gained });
      return ok(s, `Usou ${item.name}${gained ? `: +${gained} PV` : ''}.`);
    },
  }),
  defineTool({
    name: 'reload',
    kind: 'action',
    origins: PLAYER,
    description: 'Recarregar uma arma com munição compatível do inventário.',
    params: { weaponId: { type: 'string', desc: 'id da arma (vazio = equipada)', max: 80 } },
    run: (s0, a) => {
      const weapon = getPlayerWeapon(s0.character, a.weaponId);
      const res = reloadWeapon(s0.character, weapon.id);
      if ('error' in res) return fail(s0, res.error);
      const s = emit({ ...s0, character: res.character }, 'AMMO_RELOADED', `Recarregou ${weapon.name} (+${res.loadedRounds})`, { target: weapon.id, value: res.loadedRounds });
      return ok(s, `Recarregou ${weapon.name}: +${res.loadedRounds} cartuchos.`);
    },
  }),
  defineTool({
    name: 'equip_item',
    kind: 'action',
    origins: PLAYER,
    description: 'Equipar ou guardar arma/armadura.',
    params: {
      itemId: { type: 'string', desc: 'id ou nome exato', required: true, max: 80 },
      equipped: { type: 'boolean', desc: 'true = equipar' },
    },
    run: (s0, a) => {
      const item = findItem(s0, a.itemId);
      if (!item || (!item.weapon && !item.armor)) return fail(s0, `"${a.itemId}" não é equipável.`);
      const equip = a.equipped ?? true;
      const inventory = s0.character.inventory.map(i => {
        if (i.id === item.id) return { ...i, equipped: equip };
        if (equip && item.armor && i.armor?.slot === item.armor.slot) return { ...i, equipped: false };
        if (equip && item.weapon && i.weapon) return { ...i, equipped: false };
        return i;
      });
      return ok({ ...s0, character: { ...s0.character, inventory } }, `${equip ? 'Equipou' : 'Guardou'} ${item.name}.`);
    },
  }),
  defineTool({
    name: 'rest',
    kind: 'action',
    origins: PLAYER,
    description: 'Descansar por algumas horas (8h+ recupera PV igual ao BODY).',
    params: { hours: { type: 'number', desc: 'horas', required: true, min: 1, max: 24 } },
    run: (s0, a) => {
      if (s0.combat.active) return fail(s0, 'Impossível descansar em combate.');
      let s = advanceTime(s0, a.hours * 60);
      if (a.hours >= 8 && s.character.hp.current > 0) {
        const before = s.character.hp.current;
        s = { ...s, character: healCharacter(s.character, s.character.stats.BODY) };
        const gained = s.character.hp.current - before;
        if (gained) s = emit(s, 'HEALED', `+${gained} PV (descanso)`, { value: gained });
      }
      return ok(s, `Descansou ${a.hours}h.`);
    },
  }),
];

