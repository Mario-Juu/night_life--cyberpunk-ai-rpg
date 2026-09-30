/**
 * Ações do jogador interpretadas pelo LLM. O motor valida TUDO
 * (arma, munição, alvo vivo, alcance, dinheiro) e prepara a rolagem quando necessário.
 */
import { CHROME_WORDS, implantFromName } from '../../rules/cyberware';
import type { GameState, RollRequest, StatKey } from '../../types/game';
import { SKILLS, getSkill } from '../../rules/skills';
import { STAT_KEYS } from '../../rules/stats';
import { BRACKET_NEAR_EDGE, DISTANCE_LABEL, WEAPONS, bracketFor, moveMeters } from '../../rules/weapons';
import { priceFor, qualityPrice } from '../../rules/catalog';
import { clampDv } from '../../rules/difficulty';
import { attackBlocker, buildAttackRequest, getPlayerWeapon, movementValue, previewAttackDv, reloadWeapon, type AttackMode, type AttackOptions } from '../combat';
import { healCharacter } from '../health';
import { makeId } from '../ids';
import { emit } from '../events';
import { advanceTime } from '../world';
import { defineTool, fail, ok, type ToolOutcome } from './registry';
import { addToInventory, buildCombatant, buildItem, findItem, findNpc, relationshipModifiers, sameName, sceneModifiers } from './helpers';
import { saveContact } from '../npcs';
import { findCombatantLoose } from '../combatants';
import { COMBATANT_STATUS_LABEL } from '../../rules/labels';
import { BRAWL_ACTIONS, brawl, type BrawlAction } from '../brawl';
import { DRUGS, operatorPerks } from '../../rules/roles';
import { applyDrug } from '../drugs';
import { facedown } from '../facedown';
import { useStreetDrug } from '../streetDrugs';
import { activeOs, hasDoubleHealing } from '../cyberBonus';
import { combatantHelpless, killPlayer, killTarget, npcHelpless, playerCanBeKilled, playerCannotAct } from '../conditions';

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
    description:
      'Atacar um alvo. Se não houver combate, o motor o inicia. O motor valida arma, munição e alcance. ' +
      'mode "autofire" = rajada (SMG/fuzil, 10 tiros, 2d6 × margem); "suppressive" = fogo de supressão (10 tiros, sem alvo: inimigos a até 25 m testam nervos ou perdem a ação). ' +
      'twice = Cadência 2 (pistola leve/média, faca, punhos): dois ataques na mesma ação. ambush = o alvo NÃO sabe do jogador (furtivo/emboscada): não esquiva. ' +
      'Granadas: weaponId da granada (arremesso; atinge todos na mesma faixa de distância).',
    params: {
      targetId: { type: 'string', desc: 'id do combatente ou do NPC', max: 80 },
      targetName: { type: 'string', desc: 'nome de um alvo ainda não registrado (ex.: "Segurança")', max: 60 },
      weaponId: { type: 'string', desc: 'id da arma no inventário ("unarmed" = socos/chutes; "martial_arts" = artes marciais; vazio = arma equipada)', max: 80 },
      aimedHead: { type: 'boolean', desc: 'tiro mirado na cabeça (−8, dano ×2)' },
      mode: { type: 'string', enum: ['single', 'autofire', 'suppressive'], desc: 'tiro normal (padrão), rajada ou fogo de supressão' },
      twice: { type: 'boolean', desc: 'Cadência 2: atacar duas vezes' },
      ambush: { type: 'boolean', desc: 'alvo desprevenido (emboscada/ataque furtivo)' },
    },
    run: (s0, a) => {
      let s = s0;
      if (s.character.dead) return fail(s, 'O personagem está morto.');
      const weapon = getPlayerWeapon(s.character, a.weaponId);
      if (a.weaponId && weapon.id !== a.weaponId) return fail(s, `Você não tem a arma "${a.weaponId}".`);
      const profile = WEAPONS[weapon.weapon?.weaponClass ?? 'unarmed'];
      const opts: AttackOptions = { aimedHead: a.aimedHead, mode: a.mode as AttackMode | undefined, twice: a.twice, ambush: a.ambush };
      const early = attackBlocker(s.character, weapon, undefined, { ...opts, mode: opts.mode === 'suppressive' ? 'suppressive' : opts.mode }, activeOs(s));
      if (early && early !== 'Alvo não identificado.') return fail(s, early);
      if (opts.mode === 'suppressive') {
        if (playerCannotAct(s.character)) return fail(s, playerCannotAct(s.character)!);
        if (!s.combat.combatants.some(t => t.status === 'active')) return fail(s, 'Não há inimigos para suprimir.');
        const request = buildAttackRequest(s.character, weapon, undefined, opts, 'gm');
        return { state: s, ok: true, summary: `Fogo de supressão preparado com ${weapon.name}`, pendingRoll: request, data: { weaponId: weapon.id } };
      }

      // Resolve o alvo: combatente → NPC conhecido → novo alvo nomeado.
      const blocked = playerCannotAct(s.character);
      if (blocked) return fail(s, blocked);
      // Busca tolerante (id, nome, apelido, NPC ligado): o alvo que já existe nunca vira um combatente novo.
      const npcForTarget = findNpc(s, a.targetId ?? a.targetName);
      let target =
        findCombatantLoose(s.combat.combatants, a.targetId, { includeDown: true }) ??
        findCombatantLoose(s.combat.combatants, a.targetName, { includeDown: true }) ??
        (npcForTarget ? s.combat.combatants.find(c => c.id === `foe_${npcForTarget.id.replace(/^npc_/, '')}` || c.name === npcForTarget.name) : undefined);
      if (target && target.status !== 'active') {
        const hint = target.status === 'down' || target.status === 'surrendered' ? ' Para acabar com ele, execute-o (golpe fatal).' : '';
        return fail(s, `${target.name} já está fora de combate (${COMBATANT_STATUS_LABEL[target.status]}).${hint}`);
      }
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

      const blocker = attackBlocker(s.character, weapon, target, opts, activeOs(s));
      if (blocker) return fail(s, blocker);
      const preview = previewAttackDv(weapon, target, opts.mode);
      const request = buildAttackRequest(s.character, weapon, target, opts, 'gm');
      return { state: s, ok: true, summary: `${request.reason} (${preview.label})`, pendingRoll: request, data: { targetId: target.id, weaponId: weapon.id } };
    },
  }),
  defineTool({
    name: 'execute',
    kind: 'action',
    origins: ['interpreter', 'player', 'narrator', 'engine'],
    description:
      'EXECUÇÃO: golpe fatal num alvo INDEFESO (caído, rendido, amarrado, inconsciente) — arma na cabeça à queima-roupa, faca na garganta. Sem rolagem: o alvo MORRE. ' +
      'O jogador executa NPCs indefesos. O narrador mata o JOGADOR (targetId "player") sem rolagem só se ele estiver imobilizado/inconsciente OU sob lethal_threat desde um turno anterior e não escapou (tiro na cabeça do capturado, explosão nuclear, Soulkiller).',
    params: {
      targetId: { type: 'string', desc: '"player" ou id/nome do combatente ou NPC', required: true, max: 80 },
      weaponId: { type: 'string', desc: 'arma do jogador (vazio = equipada; "unarmed" = mãos)', max: 80 },
      cause: { type: 'string', desc: 'como, em uma frase', max: 200 },
    },
    run: (s0, a, ctx) => {
      const cause = a.cause ?? 'execução';
      const byPlayer = ctx.origin === 'interpreter' || ctx.origin === 'player';

      if (a.targetId === 'player') {
        if (byPlayer) return fail(s0, 'O jogador não pode executar a si mesmo por aqui.');
        if (s0.character.dead) return fail(s0, 'O personagem já está morto.');
        const h = playerCanBeKilled(s0);
        if (!h.allowed) {
          return fail(
            s0,
            'Morte sem rolagem exige aviso prévio: o jogador precisa estar indefeso (set_condition restrained/unconscious) OU sob ameaça letal anunciada (lethal_threat) desde um turno ANTERIOR. Anuncie agora e dê a ele um turno para reagir; ataques normais vão em enemyActions.',
          );
        }
        return ok(killPlayer(s0, cause), `FLATLINE: jogador morto sem rolagem (${h.reason}) — ${cause}`);
      }

      let s = s0;
      if (byPlayer) {
        if (s.character.dead) return fail(s, 'O personagem está morto.');
        const blocked = playerCannotAct(s.character);
        if (blocked) return fail(s, blocked);
      }
      const combatant = findCombatantLoose(s.combat.combatants, a.targetId, { includeDown: true });
      const npc = combatant ? undefined : findNpc(s, a.targetId);
      if (!combatant && !npc) return fail(s, `Alvo "${a.targetId}" não existe.`);
      const name = combatant?.name ?? npc!.name;
      if ((combatant?.status ?? npc!.status) === 'dead') return fail(s, `${name} já está morto.`);
      const helpless = combatant ? combatantHelpless(combatant) : npcHelpless(npc!);
      if (!helpless) return fail(s, `${name} NÃO está indefeso (caído, rendido, amarrado ou inconsciente): ataque-o normalmente.`);

      if (byPlayer) {
        const weapon = getPlayerWeapon(s.character, a.weaponId);
        if (a.weaponId && weapon.id !== a.weaponId) return fail(s, `Você não tem a arma "${a.weaponId}".`);
        const profile = WEAPONS[weapon.weapon?.weaponClass ?? 'unarmed'];
        if (!profile.melee) {
          if ((weapon.weapon?.loaded ?? 0) <= 0) return fail(s, `${weapon.name} está descarregada: só um clique seco. ${name} continua vivo.`);
          const inventory = s.character.inventory.map(i => (i.id === weapon.id && i.weapon ? { ...i, weapon: { ...i.weapon, loaded: i.weapon.loaded - 1 } } : i));
          s = { ...s, character: { ...s.character, inventory } };
        }
      }
      return ok(killTarget(s, { combatant, npc }, cause), `${name} foi executado — ${cause}`);
    },
  }),
  defineTool({
    name: 'approach',
    kind: 'action',
    origins: PLAYER,
    description: 'Avançar (ou recuar) em combate usando a Ação de Movimento: MOVE × 2 metros por turno, sem rolagem. Para golpear quem já está ao alcance do movimento, use attack direto (ele já inclui a aproximação).',
    params: {
      targetId: { type: 'string', desc: 'id ou nome do combatente', required: true, max: 80 },
      retreat: { type: 'boolean', desc: 'true = se afastar' },
    },
    run: (s0, a) => {
      const foe = findCombatantLoose(s0.combat.combatants, a.targetId);
      if (!foe) return fail(s0, `"${a.targetId}" não está no combate.`);
      const blocked = playerCannotAct(s0.character);
      if (blocked) return fail(s0, blocked);
      const meters = moveMeters(movementValue(s0.character));
      const from = BRACKET_NEAR_EDGE[foe.distance];
      const to = a.retreat ? bracketFor(Math.max(from, 1) + meters + 1) : bracketFor(Math.max(0, from - meters));
      if (to === foe.distance) return fail(s0, a.retreat ? 'Você não consegue se afastar mais.' : 'Você já está colado nele.');
      const s = { ...s0, combat: { ...s0.combat, combatants: s0.combat.combatants.map(c => (c.id === foe.id ? { ...c, distance: to } : c)) } };
      return ok(s, `${a.retreat ? 'Recuou' : 'Avançou'} ${meters} m: ${foe.name} agora a ${DISTANCE_LABEL[to].toLowerCase()}.`);
    },
  }),
  defineTool({
    name: 'grapple',
    kind: 'action',
    origins: PLAYER,
    description:
      'Briga (Cyberpunk RED): grab (agarrar, teste resistido DEX+Briga; ambos −2), choke (estrangular: CORPO direto nos PV), throw (arremessar: CORPO nos PV, alvo cai e o agarrão acaba), shield (usar o agarrado como escudo humano contra tiros), release (soltar), escape (se soltar de quem te agarra).',
    params: {
      action: { type: 'string', desc: 'o golpe', required: true, enum: BRAWL_ACTIONS },
      targetId: { type: 'string', desc: 'id ou nome do combatente', max: 80 },
    },
    run: (s0, a, ctx) => {
      const res = brawl(s0, a.action as BrawlAction, a.targetId, ctx.rng);
      return res.ok ? ok(res.state, res.summary) : fail(s0, res.summary);
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
    name: 'facedown',
    kind: 'action',
    origins: PLAYER,
    description:
      'ENCARADA (Facedown do RED): duelo de nervos antes da briga — "encaro o ganger até ele baixar a arma", "olho nos olhos do chefe". ' +
      'COOL + Reputação + 1d10 dos dois lados, resolvido na hora. Quem perde recua; se brigar mesmo assim, tem −2 contra o vencedor. Não é Intimidação (esta é perícia contra um alvo sob pressão).',
    params: {
      targetId: { type: 'string', desc: 'id/nome do combatente ou NPC', required: true, max: 80 },
    },
    run: (s0, a, ctx) => {
      const blocked = playerCannotAct(s0.character);
      if (blocked) return fail(s0, blocked);
      const combatant = findCombatantLoose(s0.combat.combatants, a.targetId);
      const npc = findNpc(s0, a.targetId) ?? (combatant ? findNpc(s0, combatant.name) : undefined);
      if (!combatant && !npc) return fail(s0, `Ninguém chamado "${a.targetId}" para encarar.`);
      if ((npc?.status === 'dead') || (combatant && combatant.status !== 'active')) return fail(s0, 'O alvo não está em condições de encarar ninguém.');
      if (combatant?.facedown) return fail(s0, `Você já encarou ${combatant.name} neste combate.`);
      const r = facedown(s0, { combatant, npc }, ctx.rng);
      const summary = r.won
        ? `${r.opponent.name} baixou os olhos: recua ou luta com −2 contra você (${r.outcome.check.total} × ${r.opponent.total}).`
        : `Você piscou primeiro diante de ${r.opponent.name}: −2 contra ele se partir para a briga (${r.outcome.check.total} × ${r.opponent.total}).`;
      return { state: r.state, ok: true, summary, data: { won: r.won, total: r.outcome.check.total, opponent: r.opponent.total } };
    },
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
    description: 'Burlar um dispositivo LOCAL (fechadura eletrônica, câmera, alarme, terminal simples) com Eletrônica/Segurança. Invadir uma REDE/arquitetura é jack_in + net_action (só Trilheiros).',
    params: checkParams,
    run: (s, a) => prepareCheck(s, { ...a, skillId: 'electronics_security' }),
  }),
  defineTool({
    name: 'save_contact',
    kind: 'action',
    origins: [...PLAYER, 'narrator', 'phone'],
    description: 'Salvar/trocar contato com alguém: a pessoa passa a aparecer no Agent (telefone).',
    params: { npcId: { type: 'string', desc: 'id ou nome (ou apelido) da pessoa', required: true, max: 80 } },
    run: (s0, a) => {
      const res = saveContact(s0, a.npcId);
      if (res.npc.status === 'dead') return fail(s0, `${res.npc.name} está morto.`);
      return ok(res.state, res.changed ? `Contato de ${res.npc.name} salvo no Agent.` : `${res.npc.name} já estava nos contatos.`, { npcId: res.npc.id });
    },
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
      ammoKind: { type: 'string', desc: 'tipo de munição', enum: ['M_PISTOL', 'H_PISTOL', 'VH_PISTOL', 'SLUG', 'RIFLE', 'ARROW', 'GRENADE', 'ROCKET'] },
      heal: { type: 'number', desc: 'cura (consumíveis)', min: 1, max: 20 },
      quality: { type: 'string', desc: 'qualidade da arma: poor (mais barata, trava num 1), standard, excellent (+1 para acertar, mais cara)', enum: ['poor', 'standard', 'excellent'] },
      sellerNpcId: { type: 'string', desc: 'id do vendedor', max: 80 },
    },
    run: (s0, a) => {
      const seller = findNpc(s0, a.sellerNpcId);
      if (seller?.status === 'dead') return fail(s0, `${seller.name} está morto — não vende nada.`);
      // Cromo não é mercadoria de balcão: compra + cirurgia com um ripperdoc (tier, grau, Humanidade).
      const implant = implantFromName(a.name);
      if (implant) return fail(s0, `"${a.name}" é um implante (${implant.name}). Implante se compra e instala com um ripperdoc: use install_cyberware (key "${implant.key}").`);
      // Na clínica de um ripperdoc, "comprar" algo com cara de cromo é instalar um implante do catálogo.
      const atClinic = seller?.ripperdoc || s0.npcs.some(n => n.ripperdoc && s0.scene.presentNpcIds.includes(n.id));
      const plain = a.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (atClinic && CHROME_WORDS.test(plain))
        return fail(s0, `"${a.name}" parece cromo, e isto é uma clínica de ripperdoc: implante não é mercadoria — use install_cyberware com a key do catálogo mais próxima (ex.: neural_link, amplified_hearing, cybereye…).`);
      const item = buildItem({ ...a, quantity: a.quantity ?? 1 });
      const base = priceFor({
        category: item.category,
        quantity: item.quantity,
        weaponClass: item.weapon?.weaponClass,
        armorSP: item.armor?.sp,
        ammoKind: item.ammoKind,
        streetDrug: item.streetDrug,
        proposedPrice: a.price,
      });
      const { source } = base;
      let total = base.total;
      // Qualidade: uma categoria de preço abaixo (ruim) ou acima (excelente).
      const quality = item.weapon?.quality;
      if (quality && source !== 'proposed') {
        total = qualityPrice(Math.round(total / item.quantity), quality) * item.quantity;
        if (!/\((ruim|excelente)\)/i.test(item.name)) item.name = `${item.name} (${quality === 'poor' ? 'ruim' : 'excelente'})`;
      }
      const perks: string[] = [];
      // Operador (Canal): pechincha e "leve 6, pague 5" em munição/consumíveis.
      if (s0.character.bio.role === 'fixer') {
        const op = operatorPerks(s0.character.roleRank);
        if (op.bulkBonus && (item.category === 'ammo' || item.category === 'consumable') && item.quantity >= 5) {
          const free = Math.floor(item.quantity / 5);
          item.quantity += free;
          perks.push(`+${free} de brinde`);
        }
        const discount = Math.round(total * op.discount);
        if (discount > 0) {
          total -= discount;
          perks.push(`pechincha −€$${discount}`);
        }
      }
      const money = s0.character.money;
      if (money < total) return fail(s0, `Eddies insuficientes: ${item.name} custa €$${total} e você tem €$${money}.`);
      let s: GameState = { ...s0, character: { ...s0.character, money: money - total } };
      s = addToInventory(s, { ...item, value: Math.round(total / item.quantity) });
      s = emit(s, 'MONEY_CHANGED', `−${total} €$ (compra: ${item.name})`, { value: -total, target: seller?.id, data: { priceSource: source } });
      s = emit(s, 'ITEM_ACQUIRED', `Comprou ${item.quantity}× ${item.name}`, { target: item.id, value: item.quantity, data: { name: item.name, via: 'buy' } });
      return ok(s, `Comprou ${item.quantity}× ${item.name} por €$${total}${perks.length ? ` (Operador: ${perks.join(', ')})` : ''} (saldo €$${s.character.money}).`, { total, balance: s.character.money });
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
      if (item.streetDrug) {
        const r = useStreetDrug(s0, item.streetDrug, ctx.rng);
        const inv = r.state.character.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
        const s = emit({ ...r.state, character: { ...r.state.character, inventory: inv } }, 'ITEM_USED', `Usou ${item.name}`, { target: item.id });
        return ok(s, `Usou ${item.name}: ${r.summary}`, { addicted: r.addictedNow });
      }
      if (item.drug) {
        const res = applyDrug(s0, item.drug);
        if (typeof res === 'string') return fail(s0, res);
        const inv = res.character.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
        const s = emit({ ...res, character: { ...res.character, inventory: inv } }, 'ITEM_USED', `Usou ${item.name}`, { target: item.id });
        return ok(s, `Usou ${item.name}: ${DRUGS[item.drug].description}`);
      }
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
        const antibiotic = s.activeEffects.some(e => e.name === DRUGS.antibiotic.label) ? 2 : 0;
        // Anticorpos Aprimorados (cromo): cura natural dobrada.
        const natural = s.character.stats.BODY * (hasDoubleHealing(s.character) ? 2 : 1);
        s = { ...s, character: healCharacter(s.character, natural + antibiotic) };
        const gained = s.character.hp.current - before;
        if (gained) s = emit(s, 'HEALED', `+${gained} PV (descanso)`, { value: gained });
      }
      return ok(s, `Descansou ${a.hours}h.`);
    },
  }),
];

