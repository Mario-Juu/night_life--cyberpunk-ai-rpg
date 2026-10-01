/**
 * Ferramentas das Habilidades de Papel e da Rede. O motor valida o papel, cobra custos,
 * rola (seed do turno) e aplica o resultado — o narrador só descreve.
 */
import type { GameState, InventoryItem, RollOutcome, RollRequest, StatKey } from '../../types/game';
import { ADDICTION_THERAPY_PRICE, STREET_DRUGS } from '../../rules/streetDrugs';
import { DRUGS, PRICE_CATEGORIES, priceCategoryFor, type PriceCategory } from '../../rules/roles';
import { DECKS, NET_DIFFICULTY_LABEL, PROGRAMS } from '../../rules/net';
import { THERAPY_LABEL } from '../../rules/labels';
import { getSkill } from '../../rules/skills';
import { priceFor } from '../../rules/catalog';
import { instantCheck } from '../instant';
import { humanityTransition } from '../humanity';
import { activateOs, cyberCapacityMax, cyberCapacityUsed, installCyberware, removeCyberware, sceneRipperdoc } from '../cyberware';
import { CYBERWARE, findCyberware } from '../../rules/cyberware';
import { isCyberpsycho } from '../../rules/humanity';
import { appendChat } from '../reducer';
import { emit } from '../events';
import { makeId } from '../ids';
import { advanceTime } from '../world';
import { drugItem } from '../drugs';
import { unlockedDrugs, surgeryValue } from '../roles';
import { NET_ACTION_KINDS, endNetTurn, generateArchitecture, jackIn, makeProgram, netAction, type NetActionKind } from '../net';
import { defineTool, fail, ok } from './registry';
import { QUICKHACKS, QUICKHACK_KEYS, type QuickhackKey } from '../../rules/quickhacks';
import { buildQuickhackRequest, quickhackRolls, useQuickhack } from '../quickhacks';
import { findCombatantLoose } from '../combatants';
import { findNpc } from './helpers';
import { addToInventory, buildItem, findItem } from './helpers';
import type { Rng } from '../dice';

const PLAYER = ['interpreter', 'player'] as const;
const ITEM_CATEGORIES = ['weapon', 'armor', 'ammo', 'consumable', 'gear', 'datashard'] as const;
const PRICE_KEYS = PRICE_CATEGORIES.map(c => c.key);
const ROLE_DENIED = (role: string) => `Só um ${role} pode fazer isso (Habilidade de Papel).`;

function spendMoney(s: GameState, amount: number, reason: string): GameState {
  const next = { ...s, character: { ...s.character, money: s.character.money - amount } };
  return emit(next, 'MONEY_CHANGED', `−${amount} €$ (${reason})`, { value: -amount });
}

const skillLabel = (id: string) => (id === 'surgery' ? 'Cirurgia' : getSkill(id)?.label ?? id);

/** Linhas da Rede viram uma entrada no feed. */
function netChat(s: GameState, lines: string[]): GameState {
  return lines.length ? appendChat(s, { kind: 'net', text: lines.join('\n') }) : s;
}

export const ROLE_TOOLS = [
  // ---------------------------------------------------------------- Rede
  defineTool({
    name: 'net_architecture',
    kind: 'mutation',
    origins: ['narrator', 'engine'],
    description:
      'Revela a ARQUITETURA de Rede de um ponto de acesso na cena (servidor, prédio, veículo). O motor gera os andares (senhas, arquivos, nós de controle, ICE Negro) pelas tabelas do RED. ' +
      'files/controls: o que o jogador pode encontrar lá dentro (separados por ";"). Só um Trilheiro entra.',
    params: {
      name: { type: 'string', desc: 'nome do sistema (ex.: "Servidor da Maelstrom")', required: true, max: 80 },
      accessPoint: { type: 'string', desc: 'onde fica o ponto de acesso físico', max: 120 },
      difficulty: { type: 'string', desc: 'basic (DV6) · standard (DV8) · uncommon (DV10) · advanced (DV12)', required: true, enum: ['basic', 'standard', 'uncommon', 'advanced'] },
      floors: { type: 'number', desc: 'andares (vazio = 3d6)', min: 3, max: 18 },
      files: { type: 'string', desc: 'arquivos relevantes, separados por ";"', max: 300 },
      controls: { type: 'string', desc: 'sistemas controláveis (câmeras, portas, torretas), separados por ";"', max: 300 },
      daemonName: { type: 'string', desc: 'daemon defensivo desta arquitetura (nome; vazio = não há)', max: 80 },
      daemonDirective: { type: 'string', desc: 'o que o daemon faz (vigiar, caçar, apagar intrusos, proteger torretas)', max: 160 },
    },
    run: (s0, a, ctx) => {
      if (s0.net.run) return fail(s0, 'O jogador está conectado: a arquitetura atual não pode ser trocada agora.');
      const split = (v?: string) => (v ?? '').split(';').map(x => x.trim()).filter(Boolean);
      const architecture = generateArchitecture(
        {
          name: a.name,
          accessPoint: a.accessPoint ?? s0.world.location.spot,
          difficulty: a.difficulty as 'basic',
          floors: a.floors,
          files: split(a.files),
          controls: split(a.controls),
          daemon: a.daemonName ? { name: a.daemonName, directive: a.daemonDirective ?? 'Proteger a arquitetura e identificar intrusos.' } : undefined,
        },
        s0.turn,
        ctx.rng,
      );
      const s = emit({ ...s0, net: { ...s0.net, architecture } }, 'SCENE_CHANGED', `Ponto de acesso: ${architecture.name} (${architecture.floors.length} andares)`, { data: { architectureId: architecture.id } });
      return ok(s, `Arquitetura ${architecture.name} disponível (${architecture.floors.length} andares, dificuldade ${NET_DIFFICULTY_LABEL[a.difficulty as 'basic']}).`, { id: architecture.id });
    },
  }),
  defineTool({
    name: 'quickhack',
    kind: 'action',
    origins: PLAYER,
    description:
      'Trilheiro usa um QUICKHACK no espaço físico (sem entrar numa arquitetura), gastando RAM do deck: Interface + 1d10 contra a defesa do alvo. Em combate é a Ação do turno. ping (sem alvo); memory_wipe também num NPC fora de combate. Só os desbloqueados na ficha.',
    params: {
      hack: { type: 'string', desc: 'qual quickhack', required: true, enum: QUICKHACK_KEYS },
      targetId: { type: 'string', desc: 'id ou nome do inimigo (combate) ou do NPC (memory_wipe fora de combate)', max: 80 },
    },
    run: (s0, a, ctx) => {
      const foe = a.targetId ? findCombatantLoose(s0.combat.combatants, a.targetId) : undefined;
      const npc = !foe && a.targetId ? findNpc(s0, a.targetId) : undefined;
      // Alvo informado que não existe não vira "o primeiro inimigo": o hack iria para a pessoa errada.
      if (a.targetId && !foe && !npc) return fail(s0, `Alvo "${a.targetId}" não está em combate nem é um NPC conhecido.`);
      // Em combate sem alvo informado (hack de alvo único): o primeiro inimigo ativo.
      const auto = !foe && !npc && s0.combat.active && QUICKHACKS[a.hack as QuickhackKey].target !== 'none' ? s0.combat.combatants.find(t => t.status === 'active' && t.side !== 'ally') : undefined;
      const key = a.hack as QuickhackKey;
      const target = { combatantId: (foe ?? auto)?.id, npcId: npc?.id };
      // Ping não tem teste. Os outros: teste de Interface na tela (com Sorte), como um ataque.
      if (!quickhackRolls(key)) {
        const res = useQuickhack(s0, key, target, ctx.rng);
        return res.ok ? ok(res.state, res.summary, res.data) : fail(s0, res.summary);
      }
      const request = buildQuickhackRequest(s0, key, target, 'gm');
      if (typeof request === 'string') return fail(s0, request);
      return { state: s0, ok: true, summary: `${request.reason}: teste de Interface pendente.`, pendingRoll: request };
    },
  }),
  defineTool({
    name: 'jack_in',
    kind: 'action',
    origins: PLAYER,
    description: 'Trilheiro se conecta à arquitetura do ponto de acesso da cena (custa 1 Ação de Rede). O corpo fica vulnerável.',
    params: {},
    run: (s0, _a, ctx) => {
      const res = jackIn(s0, ctx.rng);
      if (!res.ok) return fail(s0, res.error!);
      return ok(netChat(res.state, res.lines), res.lines.join(' '));
    },
  }),
  defineTool({
    name: 'net_action',
    kind: 'action',
    origins: PLAYER,
    description:
      'Ação de Rede do Trilheiro conectado: pathfinder (mapear), backdoor (senha), eye_dee (arquivo), control (nó), cloak (apagar rastros), virus (último andar), daemon (instala agente autônomo persistente no último andar; descreva sua diretriz em virus), slide (fugir de ICE), zap (1d6 REZ no ICE), program (atacar ICE com Sword/Banhammer), activate (ligar booster/defensor), down/up (andar), jack_out (sair com segurança), extinguish (apagar fogo). Várias por turno, até o limite do rank.',
    params: {
      action: { type: 'string', desc: 'a ação', required: true, enum: NET_ACTION_KINDS },
      iceId: { type: 'string', desc: 'alvo (id do ICE)', max: 40 },
      programId: { type: 'string', desc: 'programa (id ou chave: sword, banhammer, armor, worm…)', max: 40 },
      virus: { type: 'string', desc: 'o que o vírus faz', max: 160 },
      dv: { type: 'number', desc: 'DV do vírus (Mestre)', min: 6, max: 24 },
    },
    run: (s0, a, ctx) => {
      const res = netAction(s0, { kind: a.action as NetActionKind, iceId: a.iceId, programId: a.programId, virus: a.virus, dv: a.dv }, ctx.rng);
      if (!res.ok) return fail(s0, res.error!);
      return ok(netChat(res.state, res.lines), res.lines.join(' '));
    },
  }),
  defineTool({
    name: 'net_end_turn',
    kind: 'action',
    origins: ['player', 'engine'],
    description: 'Encerra o turno na Rede: o ICE ativo age e as Ações de Rede se renovam.',
    params: {},
    run: (s0, _a, ctx) => {
      if (!s0.net.run) return fail(s0, 'Não está conectado.');
      const res = endNetTurn(s0, ctx.rng);
      return ok(netChat(res.state, res.lines), res.lines.join(' ') || 'Turno na Rede encerrado.');
    },
  }),
  defineTool({
    name: 'buy_program',
    kind: 'action',
    origins: PLAYER,
    description: 'Trilheiro compra um programa (instalado no deck, se houver slot) ou um deck melhor.',
    params: {
      program: { type: 'string', desc: 'programa ou deck (deck_poor/deck_standard/deck_excellent)', required: true, enum: [...Object.keys(PROGRAMS), 'deck_poor', 'deck_standard', 'deck_excellent'] },
      sellerNpcId: { type: 'string', desc: 'id do vendedor', max: 80 },
    },
    run: (s0, a) => {
      const deck = s0.character.deck;
      if (s0.character.bio.role !== 'netrunner' || !deck) return fail(s0, ROLE_DENIED('Trilheiro'));
      if (a.program.startsWith('deck_')) {
        const quality = a.program.slice(5) as 'poor';
        const info = DECKS[quality];
        if (s0.character.money < info.price) return fail(s0, `Eddies insuficientes (€$${info.price}).`);
        let s = spendMoney(s0, info.price, info.name);
        s = { ...s, character: { ...s.character, deck: { ...deck, name: info.name, quality, slots: info.slots, programs: deck.programs.slice(0, info.slots) } } };
        return ok(emit(s, 'ITEM_ACQUIRED', `Novo deck: ${info.name}`), `Comprou ${info.name} (${info.slots} slots).`);
      }
      const prof = PROGRAMS[a.program as keyof typeof PROGRAMS];
      const installed = deck.programs.filter(p => !p.destroyed);
      if (installed.length >= deck.slots) return fail(s0, `Deck cheio (${deck.slots} slots).`);
      if (s0.character.money < prof.price) return fail(s0, `Eddies insuficientes: ${prof.name} custa €$${prof.price}.`);
      let s = spendMoney(s0, prof.price, prof.name);
      s = { ...s, character: { ...s.character, deck: { ...deck, programs: [...installed, makeProgram(prof.key)] } } };
      return ok(emit(s, 'ITEM_ACQUIRED', `Programa instalado: ${prof.name}`), `Instalou ${prof.name} por €$${prof.price}.`);
    },
  }),

  // ---------------------------------------------------------------- Técnico
  defineTool({
    name: 'craft',
    kind: 'action',
    origins: PLAYER,
    description:
      'Técnico (Fabricante): upgrade (aprimorar item do inventário), fabricate (construir item) ou invent (criar algo novo). O motor cobra materiais (uma categoria de preço abaixo), passa o tempo e rola TECH + perícia + especialidade.',
    params: {
      mode: { type: 'string', desc: 'o que fazer', required: true, enum: ['upgrade', 'fabricate', 'invent'] },
      itemId: { type: 'string', desc: 'upgrade: id do item a aprimorar', max: 80 },
      name: { type: 'string', desc: 'fabricate/invent: nome do item', max: 80 },
      category: { type: 'string', desc: 'fabricate/invent: categoria', enum: ITEM_CATEGORIES },
      priceCategory: { type: 'string', desc: 'invent: categoria de preço (expensive ou acima)', enum: PRICE_KEYS },
      description: { type: 'string', desc: 'o que o item faz', max: 200 },
      weaponClass: { type: 'string', desc: 'classe da arma', max: 30 },
      damage: { type: 'string', desc: 'dano (ex.: 3d6)', max: 10 },
      armorSP: { type: 'number', desc: 'SP da armadura', min: 1, max: 18 },
      armorSlot: { type: 'string', desc: 'head ou body', enum: ['head', 'body'] },
      ammoKind: { type: 'string', desc: 'tipo de munição', enum: ['M_PISTOL', 'H_PISTOL', 'VH_PISTOL', 'SLUG', 'RIFLE', 'ARROW'] },
      quantity: { type: 'number', desc: 'quantidade', min: 1, max: 50 },
    },
    run: (s0, a, ctx) => {
      if (s0.character.bio.role !== 'tech') return fail(s0, ROLE_DENIED('Técnico'));
      const maker = s0.character.roleData.maker ?? {};
      const spec = a.mode === 'upgrade' ? 'upgrade' : a.mode === 'fabricate' ? 'fabrication' : 'invention';
      const rank = maker[spec] ?? 0;
      if (rank <= 0) return fail(s0, `Sem pontos em ${spec === 'upgrade' ? 'Aprimoramento' : spec === 'fabrication' ? 'Fabricação' : 'Invenção'}.`);
      const label = spec === 'upgrade' ? 'Aprimoramento' : spec === 'fabrication' ? 'Fabricação' : 'Invenção';

      // Alvo e categoria de preço.
      let item: InventoryItem | undefined;
      let cat: (typeof PRICE_CATEGORIES)[number];
      if (a.mode === 'upgrade') {
        item = findItem(s0, a.itemId);
        if (!item) return fail(s0, `Você não tem "${a.itemId}".`);
        if (item.upgrade) return fail(s0, `${item.name} já foi aprimorado (um aprimoramento por item).`);
        cat = priceCategoryFor(item.value ?? 50);
      } else if (a.mode === 'fabricate') {
        if (!a.name || !a.category) return fail(s0, 'Diga o nome e a categoria do item.');
        item = buildItem({ name: a.name, category: a.category, description: a.description, weaponClass: a.weaponClass, damage: a.damage, armorSP: a.armorSP, armorSlot: a.armorSlot, ammoKind: a.ammoKind, quantity: a.quantity ?? 1 });
        const price = priceFor({ category: item.category, quantity: 1, weaponClass: item.weapon?.weaponClass, armorSP: item.armor?.sp, ammoKind: item.ammoKind, proposedPrice: 100 }).total;
        item.value = price;
        cat = priceCategoryFor(price);
      } else {
        if (!a.name) return fail(s0, 'Dê um nome à invenção.');
        const key = (a.priceCategory as PriceCategory) ?? 'expensive';
        cat = PRICE_CATEGORIES.find(c => c.key === key)!;
        if (cat.price < 500) cat = PRICE_CATEGORIES.find(c => c.key === 'expensive')!;
        item = { id: makeId('item'), name: a.name, category: (a.category as InventoryItem['category']) ?? 'gear', quantity: 1, description: a.description ?? 'Invenção de um Técnico.', value: cat.price };
      }

      // Materiais: uma categoria de preço abaixo (Superluxo: metade).
      const idx = PRICE_CATEGORIES.indexOf(cat);
      const materials = (cat.key === 'super_luxury' ? Math.round(cat.price / 2) : PRICE_CATEGORIES[Math.max(0, idx - 1)].price) * (a.mode === 'fabricate' ? item.quantity : 1);
      if (s0.character.money < materials) return fail(s0, `Materiais custam €$${materials} e você tem €$${s0.character.money}.`);
      let s = spendMoney(s0, materials, `materiais: ${label}`);
      s = advanceTime(s, cat.hours * 60);

      const skillId = item.weapon ? 'weaponstech' : item.category === 'armor' || item.category === 'gear' ? 'basic_tech' : 'basic_tech';
      const res = instantCheck(s, { reason: `${label}: ${item.name}`, stat: 'TECH', skillId, dv: cat.dv, bonus: { label, value: rank } }, ctx.rng);
      s = res.state;
      if (!res.outcome.check.success) return ok(s, `${label} de ${item.name} FALHOU (${skillLabel(skillId)}); materiais perdidos (€$${materials}), ${cat.hours}h gastas.`, { success: false });

      if (a.mode === 'upgrade') {
        const target = item;
        const upgrade = target.weapon ? '+1 para acertar' : target.armor ? '+1 SP' : 'aprimorado';
        const inventory = s.character.inventory.map(i =>
          i.id === target.id ? { ...i, upgrade, armor: i.armor ? { ...i.armor, sp: i.armor.sp + 1, maxSp: i.armor.maxSp + 1 } : i.armor, name: `${i.name} (aprimorado)` } : i,
        );
        s = { ...s, character: { ...s.character, inventory } };
        return ok(emit(s, 'ITEM_USED', `${target.name} aprimorado: ${upgrade}`), `${target.name} aprimorado (${upgrade}).`, { success: true });
      }
      s = addToInventory(s, item);
      return ok(emit(s, 'ITEM_ACQUIRED', `${label}: ${item.name}`, { target: item.id }), `${label} concluída: ${item.quantity}× ${item.name} (${cat.hours}h, €$${materials} em materiais).`, { success: true });
    },
  }),

  // ---------------------------------------------------------------- Cromo

  defineTool({
    name: 'install_cyberware',
    kind: 'action',
    origins: PLAYER,
    description:
      'Comprar e instalar um implante do catálogo com um RIPPERDOC (o preço inclui a cirurgia). O motor confere o nível da clínica (T1–T5), se o cromo é militar (só mercado negro + confiança) ou protótipo (só se o jogador já tiver a peça), dinheiro, fundação e slots; rola a perda de Humanidade. ' +
      'Sem ripperdoc na cena, só bio-mods básicos de shopping. key = chave do catálogo.',
    params: {
      key: { type: 'string', desc: `chave do catálogo: ${Object.values(CYBERWARE).map(d => `${d.key}=${d.name}${d.brand ? ` ${d.brand}` : ''} T${d.tier}${d.grade !== 'civil' ? ` ${d.grade}` : ''}`).join(', ')}`, required: true, max: 40 },
      skillId: { type: 'string', desc: 'só para chips de perícia: a perícia do chip', max: 40 },
      ripperdocId: { type: 'string', desc: 'id/nome do ripperdoc que opera (vazio = o presente na cena)', max: 80 },
    },
    run: (s0, a, ctx) => {
      const def = findCyberware(a.key);
      if (!def) return fail(s0, `Implante "${a.key}" não existe no catálogo.`);
      const res = installCyberware(s0, def.key, ctx.rng, { skillId: a.skillId, ripperdocId: a.ripperdocId });
      return res.ok ? ok(res.state, res.summary, { key: def.key, loss: res.loss }) : fail(s0, res.error);
    },
  }),
  defineTool({
    name: 'remove_cyberware',
    kind: 'action',
    origins: PLAYER,
    description: 'Remover um implante (numa clínica). Devolve a Humanidade MÁXIMA; a perdida só volta com terapia.',
    params: { cyberwareId: { type: 'string', desc: 'id do implante (cw_…) ou chave do catálogo', required: true, max: 60 } },
    run: (s0, a) => {
      const res = removeCyberware(s0, a.cyberwareId);
      return res.ok ? ok(res.state, res.summary) : fail(s0, res.error);
    },
  }),
  defineTool({
    name: 'upgrade_cyber_capacity',
    kind: 'action',
    origins: PLAYER,
    description: 'Ripperdoc amplia a capacidade fisiológica de cromo em +2. Não recupera Humanidade; é uma adaptação cirúrgica de longo prazo.',
    params: { ripperdocId: { type: 'string', desc: 'id/nome do ripperdoc presente (vazio = o presente)', max: 80 } },
    run: (s0, a) => {
      if (s0.combat.active) return fail(s0, 'Não se amplia capacidade de cromo no meio de um combate.');
      const doc = sceneRipperdoc(s0, a.ripperdocId);
      if (!doc) return fail(s0, 'Você precisa de um ripperdoc na cena para adaptar seu corpo.');
      const bonus = s0.character.cyberCapacityBonus ?? 0;
      if (bonus >= 20) return fail(s0, 'Seu corpo já recebeu o máximo de adaptações de capacidade desta campanha.');
      const price = 500 + bonus * 100;
      if (s0.character.money < price) return fail(s0, `A adaptação custa €$${price}; você tem €$${s0.character.money}.`);
      const character = { ...s0.character, money: s0.character.money - price, cyberCapacityBonus: bonus + 2 };
      let s: GameState = { ...s0, character };
      s = emit(s, 'MONEY_CHANGED', `−${price} €$ (ampliação de capacidade de cromo)`, { value: -price, source: doc.id });
      s = emit(s, 'ROLE_IMPROVED', `Capacidade de cromo ampliada: ${cyberCapacityUsed(character)}/${cyberCapacityMax(character)}`, { target: 'player', data: { cyberCapacity: true } });
      return ok(s, `${doc.name} recalibra seus limites: capacidade de cromo ${cyberCapacityUsed(character)}/${cyberCapacityMax(character)} (+2).`);
    },
  }),
  defineTool({
    name: 'activate_cyberware',
    kind: 'action',
    origins: PLAYER,
    description:
      'Ligar o sistema operacional de combate: Sandevistan (tempo dilatado: iniciativa, ataque extra, esquiva de balas) ou Berserk (dano corpo a corpo e redução de dano). Dura algumas rodadas, uma vez por luta, e cobra estresse neural na hora.',
    params: { key: { type: 'string', desc: 'implante (opcional: usa o SO instalado)', max: 40 } },
    run: (s0, _a, ctx) => {
      const res = activateOs(s0, ctx.rng);
      return res.ok ? ok(res.state, res.summary) : fail(s0, res.error);
    },
  }),

  // ---------------------------------------------------------------- Humanidade

  defineTool({
    name: 'therapy',
    kind: 'action',
    origins: PLAYER,
    description:
      'Terapia (Cyberpunk RED): standard €$500 = +2d6 Humanidade; extreme €$1000 = +4d6; addiction €$1000 = desintoxicação que cura TODOS os vícios em drogas de rua. Leva uma semana. Humanidade não passa do máximo (que o ciberware reduz).',
    params: { mode: { type: 'string', desc: 'standard, extreme ou addiction', required: true, enum: ['standard', 'extreme', 'addiction'] } },
    run: (s0, a, ctx) => {
      const c = s0.character;
      if (isCyberpsycho(c)) return fail(s0, 'Em ciberpsicose ninguém procura terapia sozinho — alguém precisa te conter antes.');
      if (s0.combat.active) return fail(s0, 'Não dá para fazer terapia no meio de um combate.');
      if (a.mode === 'addiction') {
        const list = c.addictions ?? [];
        if (!list.length) return fail(s0, 'Você não tem vício nenhum para tratar.');
        if (c.money < ADDICTION_THERAPY_PRICE) return fail(s0, `A desintoxicação custa €$${ADDICTION_THERAPY_PRICE} e você tem €$${c.money}.`);
        let s = spendMoney(s0, ADDICTION_THERAPY_PRICE, 'desintoxicação');
        s = { ...s, character: { ...s.character, addictions: [] } };
        s = advanceTime(s, 7 * 24 * 60);
        const names = list.map(k => STREET_DRUGS[k].label).join(', ');
        s = emit(s, 'CONDITION_CHANGED', `Vícios curados: ${names}`, { target: 'player' });
        return ok(s, `Uma semana de clínica de desintoxicação: livre de ${names}.`);
      }
      if (c.humanity.current >= c.humanity.max) return fail(s0, 'Sua Humanidade já está no máximo possível (só remover ciberware aumenta o máximo).');
      const price = a.mode === 'extreme' ? 1000 : 500;
      if (c.money < price) return fail(s0, `A terapia custa €$${price} e você tem €$${c.money}.`);
      const dice = a.mode === 'extreme' ? 4 : 2;
      const rolled = Array.from({ length: dice }, () => ctx.rng(6)).reduce((n, v) => n + v, 0);
      let s = advanceTime(spendMoney(s0, price, `terapia ${THERAPY_LABEL[a.mode] ?? a.mode}`), 7 * 24 * 60);
      const current = Math.min(c.humanity.max, c.humanity.current + rolled);
      s = { ...s, character: { ...s.character, humanity: { ...s.character.humanity, current } } };
      s = humanityTransition(s0, emit(s, 'HUMANITY_CHANGED', `Terapia: +${current - c.humanity.current} Humanidade (${dice}d6 = ${rolled})`, { value: current - c.humanity.current }));
      return ok(s, `Uma semana de terapia: +${current - c.humanity.current} Humanidade (agora ${current}/${c.humanity.max}).`);
    },
  }),

  // ---------------------------------------------------------------- Medicânico
  defineTool({
    name: 'treat_injury',
    kind: 'action',
    origins: PLAYER,
    description:
      'Tratar um Ferimento Crítico do personagem: quick_fix (Primeiros Socorros/Paramédico; tira as penalidades por ora) ou treatment (Paramédico ou Cirurgia do Medicânico; cura de vez).',
    params: {
      injuryId: { type: 'string', desc: 'id do ferimento', required: true, max: 60 },
      method: { type: 'string', desc: 'quick_fix ou treatment', required: true, enum: ['quick_fix', 'treatment'] },
    },
    run: (s0, a, ctx) => {
      const inj = s0.character.criticalInjuries.find(i => i.id === a.injuryId);
      if (!inj) return fail(s0, 'Ferimento não encontrado.');
      const c = s0.character;
      if (a.method === 'quick_fix') {
        if (inj.quickFixed) return fail(s0, `${inj.name} já recebeu um remendo.`);
        const skillId = (c.skills.paramedic ?? 0) > (c.skills.first_aid ?? 0) ? 'paramedic' : 'first_aid';
        let s = advanceTime(s0, 10);
        const res = instantCheck(s, { reason: `Remendo: ${inj.name}`, stat: 'TECH', skillId, dv: inj.quickFixDv }, ctx.rng);
        s = res.state;
        if (!res.outcome.check.success) return ok(s, `Remendo em ${inj.name} falhou.`, { success: false });
        s = { ...s, character: { ...s.character, criticalInjuries: s.character.criticalInjuries.map(i => (i.id === inj.id ? { ...i, quickFixed: true } : i)) } };
        return ok(emit(s, 'HEALED', `Remendo: ${inj.name}`, { target: inj.id }), `${inj.name} remendado: penalidades suspensas até o tratamento.`, { success: true });
      }
      const surgery = surgeryValue(c);
      const skillId = surgery > (c.skills.paramedic ?? 0) ? 'surgery' : 'paramedic';
      if (skillId === 'paramedic' && (c.skills.paramedic ?? 0) === 0) return fail(s0, 'Tratamento definitivo exige Paramédico ou a Cirurgia de um Medicânico (procure um).');
      let s = advanceTime(s0, 60);
      const res = instantCheck(s, { reason: `Tratamento: ${inj.name}`, stat: 'TECH', skillId, dv: inj.treatmentDv }, ctx.rng);
      s = res.state;
      if (!res.outcome.check.success) return ok(s, `Tratamento de ${inj.name} falhou.`, { success: false });
      s = { ...s, character: { ...s.character, criticalInjuries: s.character.criticalInjuries.filter(i => i.id !== inj.id) } };
      return ok(emit(s, 'INJURY_REMOVED', inj.name, { target: inj.id }), `${inj.name} tratado (${skillLabel(skillId)}).`, { success: true });
    },
  }),
  defineTool({
    name: 'brew_drug',
    kind: 'action',
    origins: PLAYER,
    description: 'Medicânico (Farmacêutica) fabrica doses de uma droga médica liberada: €$200 de insumos, 1 hora, DV 13.',
    params: { drug: { type: 'string', desc: 'droga', required: true, enum: Object.keys(DRUGS) } },
    run: (s0, a, ctx) => {
      if (s0.character.bio.role !== 'medtech') return fail(s0, ROLE_DENIED('Medicânico'));
      const drug = a.drug as keyof typeof DRUGS;
      if (!unlockedDrugs(s0.character.roleData).includes(drug)) return fail(s0, `${DRUGS[drug].label} ainda não foi liberada (Farmacêutica).`);
      if (s0.character.money < 200) return fail(s0, 'Insumos custam €$200.');
      let s = advanceTime(spendMoney(s0, 200, `insumos: ${DRUGS[drug].label}`), 60);
      const pharma = s.character.roleData.medicine?.pharma ?? 0;
      const res = instantCheck(s, { reason: `Farmacêutica: ${DRUGS[drug].label}`, stat: 'TECH', skillId: 'paramedic', dv: 13, bonus: { label: 'Farmacêutica', value: pharma } }, ctx.rng);
      s = res.state;
      if (!res.outcome.check.success) return ok(s, `A síntese de ${DRUGS[drug].label} falhou; insumos perdidos.`, { success: false });
      const doses = Math.max(1, s.character.skills.paramedic ?? 1);
      s = addToInventory(s, drugItem(drug, doses));
      return ok(emit(s, 'ITEM_ACQUIRED', `${doses}× ${DRUGS[drug].label}`), `Fabricou ${doses} dose(s) de ${DRUGS[drug].label}.`, { success: true });
    },
  }),
];
