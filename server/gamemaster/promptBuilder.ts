/**
 * Monta o contexto em seções:
 * PERSONAGEM + CENA + NPCs + MISSÕES + MUNDO/FLAGS + MEMÓRIAS + RESUMOS + HISTÓRICO + ENTRADA DO TURNO.
 */
import type { Awareness, Character, Condition, Npc, RollOutcome } from '../../shared/types/game';
import { BOND_LABEL, factAwareness, targetName } from '../../shared/engine/npcProfile';
import { CONDITION_LABEL } from '../../shared/engine/conditions';
import { COMBAT_AWARENESS, DRUGS, MAKER_SPECIALTIES, ROLE_ABILITY, familyVehicle, operatorPerks } from '../../shared/rules/roles';
import { PROGRAMS, netActionsFor } from '../../shared/rules/net';
import { QUICKHACKS, type QuickhackKey } from '../../shared/rules/quickhacks';
import { surgeryValue, unlockedDrugs } from '../../shared/engine/roles';
import { describeNet } from '../../shared/engine/net';
import { humanityBand } from '../../shared/rules/humanity';
import { describeCyberware } from '../../shared/engine/cyberware';
import type { EngineResult } from '../../shared/types/turn';
import type { GameContext, NpcProfileRequest, WorldgenRequest } from '../../shared/types/gm';
import { getSkill } from '../../shared/rules/skills';
import { formatGameTime } from '../../shared/rules/world';
import { getRole } from '../../shared/rules/creation';
import { DISTANCE_LABEL } from '../../shared/rules/weapons';
import { statValue } from '../../shared/engine/checks';
import { WOUND_LABEL, characterSp, characterWoundState, woundPenalty } from '../../shared/engine/health';
import { unarmedDamage } from '../../shared/rules/weapons';
import { THREAT_LABEL } from '../../shared/engine/world';

function humanityLine(c: Character): string {
  const band = humanityBand(c);
  if (band.band === 'stable') return '';
  return `HUMANIDADE ${c.humanity.current}/${c.humanity.max} — ${band.label}: ${band.narrator}`;
}

/** Habilidade de Papel (Cyberpunk RED) — o que o motor já aplica e o que o Mestre deve considerar. */
export function describeRoleAbility(c: Character): string {
  const info = ROLE_ABILITY[c.bio.role];
  const d = c.roleData ?? {};
  let detail = '';
  switch (c.bio.role) {
    case 'solo':
      detail = COMBAT_AWARENESS.filter(o => (d.combatAwareness?.[o.key] ?? 0) > 0)
        .map(o => `${o.label}: ${o.describe(d.combatAwareness![o.key]!)}`)
        .join('; ');
      break;
    case 'netrunner':
      detail = `${netActionsFor(c.roleRank)} Ações de Rede/turno · deck ${c.deck?.name ?? '—'} (${(c.deck?.programs ?? []).filter(p => !p.destroyed).map(p => PROGRAMS[p.key].name).join(', ')})`;
      if (c.quickhacks?.length) detail += ` · QUICKHACKS (RAM ${c.deck?.ram?.current ?? 0}/${c.deck?.ram?.max ?? 0}): ${c.quickhacks.filter(k => k in QUICKHACKS).map(k => `${k} ${QUICKHACKS[k as QuickhackKey].name} (${QUICKHACKS[k as QuickhackKey].ram} RAM)`).join(', ')}`;
      break;
    case 'tech':
      detail = MAKER_SPECIALTIES.map(m => `${m.label} ${d.maker?.[m.key] ?? 0}`).join(', ');
      break;
    case 'medtech':
      detail = `Cirurgia ${surgeryValue(c)} · Farmacêutica ${d.medicine?.pharma ?? 0} (${unlockedDrugs(d).map(k => DRUGS[k].label).join(', ') || '—'}) · Criossistemas ${d.medicine?.cryo ?? 0}`;
      break;
    case 'fixer': {
      const op = operatorPerks(c.roleRank);
      detail = `alcance de mercado: ${op.reach} · pechincha −${Math.round(op.discount * 100)}%${op.jobBonus ? ` · trabalhos +${Math.round(op.jobBonus * 100)}%` : ''}`;
      break;
    }
    case 'nomad':
      detail = `+${c.roleRank} em Condução/Tec. de Veículos · veículo da família: ${familyVehicle(c.roleRank)}`;
      break;
  }
  return `HABILIDADE DE PAPEL: ${info.name} rank ${c.roleRank}${detail ? ` — ${detail}` : ''}`;
}

function describeConditions(list: Condition[]): string {
  return list.map(x => `${CONDITION_LABEL[x.key]} desde o turno ${x.sinceTurn}${x.source ? ` (${x.source})` : ''}`).join('; ');
}

export function describeCharacter(c: Character): string {
  const sp = characterSp(c);
  const wound = characterWoundState(c);
  const stats = (Object.keys(c.stats) as Array<keyof Character['stats']>).map(k => `${k} ${statValue(c, k)}`).join(', ');
  const skills = Object.entries(c.skills)
    .filter(([, lvl]) => lvl > 0)
    .map(([id, lvl]) => `${id}=${lvl}`)
    .join(', ');
  const items = c.inventory
    .map(i => {
      let d = `  - [${i.id}] ${i.name} ×${i.quantity}`;
      if (i.weapon) {
        const w = i.weapon;
        const tags = [w.quality === 'poor' ? 'RUIM' : w.quality === 'excellent' ? 'EXCELENTE' : '', w.jammed ? 'TRAVADA' : '', w.nonLethal ? 'não letal' : '', w.grenade ? `granada ${w.grenade}` : ''].filter(Boolean);
        d += ` (arma ${w.weaponClass}, ${w.damage}${w.magSize !== null ? `, pente ${w.loaded}/${w.magSize}` : ''}${tags.length ? `, ${tags.join(', ')}` : ''})`;
      }
      if (i.streetDrug) d += ' (droga de rua)';
      if (i.armor) d += ` (armadura ${i.armor.slot === 'head' ? 'cabeça' : 'corpo'} SP ${i.armor.sp}/${i.armor.maxSp})`;
      if (i.equipped) d += ' [equipado]';
      return d;
    })
    .join('\n');
  return [
    `${c.bio.name} "${c.bio.handle}" · ${getRole(c.bio.role).label} · ${c.bio.age} anos · ${c.bio.occupation}`,
    `PV ${c.hp.current}/${c.hp.max} — ${WOUND_LABEL[wound]}${woundPenalty(wound) ? ` (${woundPenalty(wound)} em tudo)` : ''}${c.dead ? ' — MORTO' : ''}`,
    `SP cabeça ${sp.head} / corpo ${sp.body} · Humanidade ${c.humanity.current}/${c.humanity.max} · Sorte ${c.luck.current}/${c.luck.max} · €$${c.money} · Reputação ${c.reputation} · PM ${c.ip}`,
    `Atributos: ${stats}`,
    `Perícias: ${skills}`,
    `Desarmado (Briga): ${unarmedDamage(c.stats.BODY)}`,
    `Inventário:\n${items || '  (vazio)'}`,
    describeCyberware(c),
    c.criticalInjuries.length ? `Ferimentos: ${c.criticalInjuries.map(i => `[${i.id}] ${i.name} (${i.effect})`).join('; ')}` : '',
    c.conditions?.length ? `CONDIÇÕES: ${describeConditions(c.conditions)}` : '',
    c.grappling ? `AGARRANDO: ${c.grappling}${c.humanShield ? ` (escudo humano${c.humanShield.corpseHp !== undefined ? `-cadáver, ${c.humanShield.corpseHp} PV` : ''})` : ''}` : '',
    humanityLine(c),
    c.addictions?.length ? `VICIADO em: ${c.addictions.join(', ')} (abstinência quando sóbrio)` : '',
    describeRoleAbility(c),
    `Laço: ${c.bio.familyTie || '—'} · Sonho: ${c.bio.personalAnchor || '—'}`,
    `Pressão imediata (é do PRÓPRIO jogador, não do laço): ${c.bio.debtReason || '—'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function describeScene(ctx: GameContext): string {
  const t = formatGameTime(ctx.world.time);
  const l = ctx.world.location;
  const present = ctx.scene.presentNpcIds.map(id => ctx.npcs.find(n => n.id === id)?.name ?? id);
  const lines = [
    `${t.weekday}, ${t.date} · ${t.time} · ${ctx.world.weather} · Calor ${ctx.world.heat}/5 · Ameaça ${THREAT_LABEL[ctx.scene.effectiveThreat]}`,
    `Local: ${l.district} › ${l.subDistrict} › ${l.spot}`,
    `Cena: ${ctx.scene.description || '—'} · Presentes: ${present.join(', ') || 'ninguém'}`,
    `Situação: ${ctx.world.situation}`,
    `Objetivo imediato: ${ctx.world.objective}`,
  ];
  if (ctx.activeEffects.length) lines.push(`Efeitos ativos: ${ctx.activeEffects.map(e => e.name).join(', ')}`);
  const lt = ctx.scene.lethalThreat;
  if (lt) {
    const armed = lt.sinceTurn < ctx.turn;
    lines.push(`⚠ AMEAÇA LETAL (desde o turno ${lt.sinceTurn}): ${lt.description}${armed ? ' — se o jogador não escapar AGORA, execute(targetId "player") é permitido' : ' — recém-anunciada: o jogador ainda tem este turno para reagir'}`);
  }
  if (ctx.net) lines.push(...describeNet({ net: ctx.net }));
  if (ctx.sandbox) lines.push('MODO SANDBOX (teste de mecânicas): atenda na hora pedidos meta do jogador (spawnar inimigos por template, criar rede, aplicar condições/ameaças, ferir, curar) usando as ferramentas; narração curta e direta.');
  if (ctx.combat.active) {
    lines.push(`COMBATE — rodada ${ctx.combat.round}${ctx.combat.playerInitiative !== null ? `, iniciativa do jogador ${ctx.combat.playerInitiative}` : ''}`);
    for (const c of ctx.combat.combatants)
      lines.push(`  - [${c.id}] ${c.name}${c.side === 'ally' ? ` (ALIADO${c.stance ? `, ${c.stance}` : ''})` : ''}: PV ${c.hp.current}/${c.hp.max}, SP ${c.sp.body}, ${c.weapon.name} (${c.weapon.damage}), ${DISTANCE_LABEL[c.distance]}, cobertura ${c.cover}${c.cover === 'full' && c.coverHp !== undefined ? ` (${c.coverHp} PV)` : ''}, ${c.status}${c.conditions?.length ? `, ${describeConditions(c.conditions)}` : ''}${c.skipNextAttack ? `, PERDE o próximo ataque (${c.skipNextAttack})` : ''}${c.hacks?.length ? `, hackeado: ${c.hacks.map(h => h.label).join(', ')}` : ''}${c.facedown ? `, Encarada: ${c.facedown === 'player' ? 'recuou diante do jogador (−2)' : 'venceu o jogador (jogador −2 contra ele)'}` : ''}`);
  } else if (ctx.combat.combatants.length) {
    lines.push(`Corpos/inimigos da última luta: ${ctx.combat.combatants.map(c => `[${c.id}] ${c.name} (${c.status}${c.looted ? ', revistado' : ''})`).join(', ')}`);
  }
  return lines.join('\n');
}

/** Quantos NPCs (além dos presentes) levam o perfil completo; os demais só nome, relação e traços. */
const FULL_DEPTH_NPCS = 4;

const AWARE_LABEL = { yes: 'o jogador SABE', suspects: 'o jogador DESCONFIA', no: 'SÓ VOCÊ SABE' } as const;

/** Personalidade, objetivos, vínculos e fatos — cada um marcado com o que o JOGADOR sabe. */
export function describeNpcDepth(npc: Npc, ctx: Pick<GameContext, 'npcs' | 'factions'>, indent = '    '): string[] {
  const lines: string[] = [];
  const p = npc.profile;
  if (p) {
    const parts = [
      p.traits.length ? `traços: ${p.traits.join(', ')}` : '',
      p.voice ? `voz: ${p.voice}` : '',
      p.motivation ? `move-se por: ${p.motivation}` : '',
      p.fear ? `teme: ${p.fear}` : '',
      p.lines ? `nunca: ${p.lines}` : '',
    ].filter(Boolean);
    if (parts.length) lines.push(`${indent}PERFIL — ${parts.join(' · ')}`);
  }
  if (npc.currentGoal) lines.push(`${indent}quer agora [current_goal]: ${npc.currentGoal} (${AWARE_LABEL[npc.currentGoalKnown ? 'yes' : 'no']})`);
  for (const g of npc.goals ?? []) {
    if (g.status === 'active') lines.push(`${indent}objetivo [${g.id}]: ${g.text} (${AWARE_LABEL[g.playerKnows]})`);
  }
  const closed = (npc.goals ?? []).filter(g => g.status !== 'active');
  if (closed.length) lines.push(`${indent}objetivos encerrados: ${closed.map(g => `${g.text} (${g.status === 'done' ? 'conseguiu' : 'desistiu'})`).join(' | ')}`);
  for (const b of npc.bonds ?? []) lines.push(`${indent}vínculo [${b.id}]: ${BOND_LABEL[b.kind]} ${targetName(ctx, b.targetId)}${b.note ? ` — ${b.note}` : ''} (${AWARE_LABEL[b.playerKnows]})`);
  const facts = (a: Awareness) => npc.knowledge.filter(k => factAwareness(k) === a);
  const known = facts('yes');
  const suspected = facts('suspects');
  const hidden = facts('no');
  if (known.length) lines.push(`${indent}o jogador SABE: ${known.map(k => k.fact).join(' | ')}`);
  if (suspected.length) lines.push(`${indent}o jogador DESCONFIA (sem certeza): ${suspected.map(k => `[${k.id}] ${k.fact}`).join(' | ')}`);
  if (npc.kind !== 'animal') lines.push(`${indent}sabe do jogador: ${npc.knowsAboutPlayer?.length ? npc.knowsAboutPlayer.join(' | ') : 'só o que viu acontecer'}`);
  if (hidden.length) lines.push(`${indent}SÓ VOCÊ SABE (ninguém age como se o jogador soubesse): ${hidden.map(k => `[${k.id}] ${k.fact}${k.weight === 3 ? ' (muda tudo)' : ''}`).join(' | ')}`);
  return lines;
}

function describeNpcs(ctx: GameContext): string {
  return (
    ctx.npcs
      .map((n, i) => {
        const full = ctx.scene.presentNpcIds.includes(n.id) || i < FULL_DEPTH_NPCS;
        return [
          `  - [${n.id}] ${n.name} (${n.role}) ${n.ripperdoc ? `RIPPERDOC nível ${n.ripperdoc.tier}${n.ripperdoc.blackMarket ? ' + mercado negro' : ''} ` : ''}${n.kind === 'animal' ? 'ANIMAL (não fala, não usa o Agent) ' : ''}${n.status === 'dead' ? '☠ MORTO' : n.status === 'missing' ? 'DESAPARECIDO' : ''}`.trimEnd(),
          `    confiança ${n.trust} · respeito ${n.respect} · medo ${n.fear} · raiva ${n.anger}${n.location ? ` · em ${n.location}` : ''}`,
          n.conditions?.length ? `    condições: ${describeConditions(n.conditions)}` : '',
          n.pendingMatters ? `    pendente: ${n.pendingMatters}` : '',
          ...(full ? describeNpcDepth(n, ctx) : n.profile?.traits.length ? [`    traços: ${n.profile.traits.join(', ')}`] : []),
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n') || '  (nenhum relevante)'
  );
}

function describeWorld(ctx: GameContext): string {
  const pub = ctx.flags.filter(f => f.visibility === 'public').map(f => `${f.key}=${String(f.value)}`);
  const hidden = ctx.flags.filter(f => f.visibility === 'hidden').map(f => `${f.key}=${String(f.value)}`);
  const lines = [
    `Flags conhecidas: ${pub.join(', ') || '—'}`,
    `Flags ocultas (só o Mestre): ${hidden.join(', ') || '—'}`,
    `Facções: ${ctx.factions.map(f => `${f.name} ${f.standing}`).join(', ')}`,
    `O jogador sabe: ${ctx.playerKnowledge.join(' | ') || '—'}`,
  ];
  if (ctx.upcoming.length) lines.push(`Agenda do mundo (só o Mestre): ${ctx.upcoming.map(u => `[${u.id}] ${formatGameTime(u.at).time} ${u.description}`).join('; ')}`);
  return lines.join('\n');
}

const FRONT_AWARE = { no: 'o jogador NÃO sabe da trama', suspects: 'o jogador DESCONFIA', yes: 'o jogador SABE da trama' } as const;

/** Tramas do mundo: o que está por trás (só o Mestre), o que já aconteceu e o próximo passo. */
export function describeFronts(ctx: GameContext): string {
  const fronts = ctx.fronts ?? [];
  const lines = fronts.map(f => {
    const head = `  - [${f.id}] ${f.title} — ${f.status === 'active' ? `passo ${f.stage}/${f.total}` : f.status === 'resolved' ? 'CONCLUÍDA (aconteceu)' : 'DETIDA pelo jogador'} · ${FRONT_AWARE[f.playerAware]}`;
    return [
      head,
      f.continues ? `    CONTINUAÇÃO de "${f.continues.title}", que ${f.continues.outcome}` : '',
      `    quem: ${f.who} · onde: ${f.place || '—'} · por quê: ${f.motive || '—'} · quem sofre: ${f.victim || '—'}${f.seedNpc ? ` · rosto: ${f.seedNpc}` : ''}`,
      f.done.length ? `    já aconteceu: ${f.done.join(' → ')}` : '',
      f.next ? `    próximo (${formatGameTime(f.next.at).weekday} ${formatGameTime(f.next.at).time}): ${f.next.title} · o jogador segura se: ${f.next.blockHint}` : '',
      f.twist ? `    reviravolta (SÓ VOCÊ SABE): ${f.twist}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  const news = (ctx.news ?? []).map(n => `  - [${n.source}] ${n.headline}`);
  return [lines.join('\n') || '  (cidade quieta)', news.length ? `Manchetes recentes no NCNet do jogador:\n${news.join('\n')}` : ''].filter(Boolean).join('\n');
}

export function describeOutcome(o: RollOutcome): string {
  const c = o.check;
  const skill = getSkill(c.skillId)?.label ?? 'sem perícia';
  const lines: string[] = [`Teste: ${o.request.reason}`];
  if (o.deathSave) {
    lines.push(`TESTE DE MORTE: d10 ${o.deathSave.roll} → ${c.total} (precisa ≤ BODY ${o.deathSave.target}) → ${o.deathSave.success ? 'SOBREVIVEU (por enquanto)' : 'FALHOU — O PERSONAGEM MORREU'}`);
    return lines.join('\n');
  }
  if (o.initiative) {
    lines.push(`INICIATIVA: jogador ${o.initiative.player}; inimigos: ${o.initiative.enemies.map(e => `${e.id} ${e.value}`).join(', ')}`);
    return lines.join('\n');
  }
  if (o.attack?.failure) {
    const reason = { no_ammo: 'ARMA SEM MUNIÇÃO (clique seco, nada disparou)', out_of_range: 'ALVO FORA DO ALCANCE', in_cover: 'ALVO EM COBERTURA TOTAL', no_target: 'ALVO INDISPONÍVEL', jammed: 'ARMA TRAVADA (nada disparou; destravar custa uma ação)' }[o.attack.failure];
    lines.push(`ATAQUE NÃO REALIZADO: ${reason}.`);
    return lines.join('\n');
  }
  if (o.quickhack) {
    const dice = c.d10.crit ? `${c.d10.rolls.join('+')} (CRÍTICO)` : c.d10.fumble ? `${c.d10.rolls[0]}−${c.d10.rolls[1]} (FALHA CRÍTICA)` : `${c.d10.natural}`;
    lines.push(
      `QUICKHACK: Interface ${c.statValue} + d10 ${dice}${c.luckSpent ? ` + Sorte ${c.luckSpent}` : ''} = ${c.total} vs defesa ${c.dv} → ${c.success ? 'SUCESSO' : 'FALHA'}`,
      `Efeito aplicado pelo motor: ${o.quickhack.summary}`,
    );
    return lines.join('\n');
  }
  const dice = c.d10.crit ? `${c.d10.rolls.join('+')} (CRÍTICO)` : c.d10.fumble ? `${c.d10.rolls[0]}−${c.d10.rolls[1]} (FALHA CRÍTICA)` : `${c.d10.natural}`;
  const mods = c.modifiers.map(m => `${m.label} ${m.value > 0 ? '+' : ''}${m.value}`).join(', ');
  lines.push(
    `${c.stat} ${c.statValue} + ${skill} ${c.skillValue} + d10 ${dice}${mods ? ` + [${mods}]` : ''}${c.luckSpent ? ` + Sorte ${c.luckSpent}` : ''} = ${c.total} vs DV ${c.dv}`,
    `RESULTADO: ${c.success ? 'SUCESSO' : 'FALHA'} (margem ${c.margin > 0 ? '+' : ''}${c.margin})`,
  );
  const a = o.attack;
  if (a) {
    if (a.closedIn) lines.push(`O jogador AVANÇOU até ${a.targetName} (Ação de Movimento) antes do golpe — agora estão corpo a corpo.`);
    lines.push(`Ataque com ${a.weaponName} contra ${a.targetName}: ${a.hit ? 'ACERTOU' : 'ERROU'}. Munição no pente: ${a.ammoAfter ?? '—'}.`);
    if (a.application && a.damage) {
      const app = a.application;
      lines.push(`Dano ${a.damage.notation} [${a.damage.rolls.join(', ')}] = ${app.raw} ${app.location === 'head' ? 'na CABEÇA (×2)' : 'no corpo'} − SP ${app.spBefore} → ${app.hpDamage} de dano (PV ${app.hpBefore} → ${app.hpAfter}).${app.ablated ? ` Armadura do alvo cai para SP ${app.spAfter}.` : ''}`);
      if (app.criticalInjury) lines.push(`FERIMENTO CRÍTICO: ${app.criticalInjury.name} (+5 direto).`);
      if (a.knockedOut) lines.push(`${a.targetName} foi NOCAUTEADO (arma de choque): está vivo e inconsciente.`);
      else if (a.targetStatusAfter === 'down') lines.push(`${a.targetName} CAIU (0 PV). Decida com update_combatant se morreu, desmaiou ou agoniza.`);
      if (a.nonLethal === 'rubber') lines.push('Munição de borracha: dói e derruba, mas não mata.');
    }
    if (a.autofireMult) lines.push(`RAJADA: 10 tiros, dano 2d6 × ${a.autofireMult}.`);
    if (a.ambush) lines.push('EMBOSCADA: o alvo foi pego desprevenido; os outros inimigos perdem a próxima ação (surpresa).');
    if (a.jammedNow) lines.push('A ARMA (de qualidade ruim) TRAVOU neste disparo: nada saiu. O jogador precisa gastar uma ação destravando.');
    if (a.coverDamage) lines.push(`O tiro acertou a COBERTURA de ${a.targetName}: ${a.coverDamage.before} → ${a.coverDamage.after} PV${a.coverDamage.after <= 0 ? ' — DESTRUÍDA, o alvo ficou exposto' : ''}. O alvo em si não foi ferido.`);
    if (a.areaHits?.length) {
      lines.push(`EXPLOSÃO${a.grenade && a.grenade !== 'basic' ? ` (${a.grenade})` : ''} na área de ${a.targetName}:`);
      for (const h of a.areaHits) {
        lines.push(`  - ${h.name}: ${h.dodged ? 'saltou para fora da área' : [h.application ? `−${h.application.hpDamage} PV (PV ${h.application.hpBefore} → ${h.application.hpAfter})` : '', h.effect ?? '', h.statusAfter === 'down' ? 'FORA DE COMBATE' : ''].filter(Boolean).join(', ') || 'sem efeito'}`);
      }
    }
    if (a.suppression) {
      lines.push(`FOGO DE SUPRESSÃO (10 tiros, sem dano direto): ${a.suppression.length ? a.suppression.map(x => `${x.name} ${x.held ? 'segurou os nervos' : 'mergulhou na cobertura e PERDE o próximo ataque'}`).join('; ') : 'ninguém ao alcance'}.`);
    }
  }
  if (o.followUp) lines.push('— SEGUNDO ATAQUE (Cadência 2, mesma ação) —', describeOutcome(o.followUp));
  return lines.join('\n');
}

export function describeEngineResult(r: EngineResult | null): string {
  if (!r) return '(sem mecânica neste turno)';
  const lines: string[] = [];
  if (r.intent) lines.push(`Intenção: ${r.intent.type} — ${r.intent.summary}`);
  for (const t of r.tools) {
    if (t.tool === 'enemy_phase') lines.push(`TURNO DOS INIMIGOS (já resolvido pelo motor, na ordem de iniciativa — narre EXATAMENTE isto, sem enemyActions): ${t.summary}`);
    else lines.push(`${t.ok ? '✓' : '✗'} ${t.tool}: ${t.summary}${t.data ? ` ${JSON.stringify(t.data).slice(0, 600)}` : ''}`);
  }
  if (r.roll) lines.push(describeOutcome(r.roll));
  if (!lines.length) lines.push('(nenhuma ação mecânica: apenas narre a reação)');
  if (r.offscreen.length) lines.push(`ACONTECEU FORA DE CENA (incorpore se fizer sentido): ${r.offscreen.join(' | ')}`);
  return lines.join('\n');
}

function contextSections(ctx: GameContext): string {
  const quests = ctx.quests
    .map(m => `  - [${m.id}] ${m.title} (${m.status})${m.status === 'ACTIVE' ? `: ${m.objective}` : ''}${m.rewardEddies ? (m.status === 'COMPLETED' ? ` · €$${m.rewardEddies} JÁ PAGOS (não pague de novo)` : ` · paga €$${m.rewardEddies}`) : ''}${m.giverId ? ` · de ${m.giverId}` : ''}`)
    .join('\n');
  const memories = ctx.memories.map(m => `  - (${m.type}, imp ${m.importance}) ${m.subject}: ${m.content}`).join('\n');
  const summaries = ctx.summaries.map(s => `  - Turnos ${s.fromTurn}–${s.toTurn}: ${s.text}`).join('\n');
  const phone = ctx.phone.map(t => `  - ${t.npcName}: ${t.last.map(m => `${m.from === 'player' ? 'Jogador' : t.npcName}: "${m.text}"`).join(' | ')}`).join('\n');
  const history = ctx.recentHistory.map(e => `${e.kind === 'player' ? 'JOGADOR' : e.kind === 'narration' ? 'MESTRE' : e.kind.toUpperCase()} (t${e.turn}): ${e.text}`).join('\n\n');
  return `
# PERSONAGEM
${describeCharacter(ctx.character)}

# CENA ATUAL
${describeScene(ctx)}

# NPCs RELEVANTES
${describeNpcs(ctx)}

# MISSÕES
${quests || '  (nenhuma)'}

# MUNDO
${describeWorld(ctx)}

# NA CIDADE (tramas que andam sozinhas)
${describeFronts(ctx)}

# EQUIPE (lutam ao seu lado; o motor decide o que aceitam)
${ctx.party?.length ? ctx.party.map(m => `  - [${m.npcId}] ${m.name} · PV ${m.hp} · lealdade ${m.loyalty}/100 · ${m.share ? `${m.share}% de cada trabalho` : 'sem cobrar'} · ${m.stance}${m.present ? '' : ' · NÃO está na cena'}`).join('\n') : '  (sozinho)'}

# MEMÓRIAS RELEVANTES
${memories || '  (nenhuma)'}

# RESUMO DA CAMPANHA
${summaries || '  (campanha recente)'}

# COMUNICADOR (fora da cena física)
${phone || '  (sem conversas)'}

# HISTÓRICO RECENTE
${history || '(início)'}
`.trim();
}

export function buildInterpretPrompt(ctx: GameContext, text: string, feedback?: string): string {
  return `${contextSections(ctx)}

# AÇÃO DO JOGADOR (turno ${ctx.turn})
"${text}"

Interprete a intenção e escolha as ferramentas.${feedback ? `

# SUA TENTATIVA ANTERIOR FOI RECUSADA PELO MOTOR
${feedback}
Refaça as chamadas usando exatamente os parâmetros aceitos.` : ''}`;
}

export function buildNarratePrompt(ctx: GameContext, input: { kind: 'action' | 'prologue'; playerInput?: string; engineResult: EngineResult | null }, correction?: string): string {
  const role = getRole(ctx.character.bio.role).label;
  const turnBlock =
    input.kind === 'prologue'
      ? `# PRÓLOGO
Crie a CENA DE ABERTURA (cold open): in medias res, impacto sensorial, o ofício de ${role} em ação, um incidente ligado à dívida ou ao laço.
Rafa "Zero-Um" já mandou SMS oferecendo um corre de €$600 (ele NÃO está na cena). Use update_scene (descrição, ameaça, situação, objetivo) e advance_time.
Termine com um gancho e "O que você faz, choom?". Sem enemyActions.`
      : `# AÇÃO DO JOGADOR
"${input.playerInput ?? ''}"

# RESULTADO DO MOTOR — VERDADE ABSOLUTA
${describeEngineResult(input.engineResult)}

Narre a consequência exatamente como o motor determinou.`;
  return `${contextSections(ctx)}

${turnBlock}${correction ? `\n\n# CORREÇÃO OBRIGATÓRIA\nSua narração anterior contradisse o motor: ${correction}\nReescreva respeitando o resultado.` : ''}`;
}

/** Costura do mundo: o personagem e os textos crus das frentes. */
export function buildWorldgenPrompt(req: WorldgenRequest): string {
  const p = req.player;
  return `PERSONAGEM: ${p.handle}, ${p.role}, ${p.occupation} em ${p.district}. Pressão: ${p.debtReason || '—'}. Laço: ${p.familyTie || '—'}. Sonho: ${p.personalAnchor || '—'}.

FRENTES (reescreva o texto, mantendo a estrutura):
${JSON.stringify(req.fronts, null, 1)}`;
}

/** Pedido de perfil (fora do turno): quem é o NPC, o que já se viu dele e o mundo do jogador. */
export function buildProfilePrompt(req: NpcProfileRequest): string {
  const n = req.npc;
  const p = req.player;
  const current = n.profile?.traits.length ? `${n.profile.traits.join(', ')}${n.profile.voice ? ` · voz: ${n.profile.voice}` : ''}` : 'nenhum';
  const ask = req.needs === 'both' ? 'perfil completo + DEPTH (goal e secret)' : req.needs === 'depth' ? 'só DEPTH (goal e secret); traits pode repetir o perfil atual' : 'perfil (traits, voice, motivation, fear, lines)';
  return `
NPC: [${n.id}] ${n.name} — ${n.role}${n.faction ? ` (${n.faction})` : ''} · importância: ${n.importance === 'core' ? 'CENTRAL' : 'recorrente'}
Descrição: ${n.description || '—'}
Quer agora: ${n.currentGoal || '—'}
Perfil atual: ${current}
PEDIDO: ${ask}

JOGADOR: ${p.handle}, ${p.role}, ${p.occupation} em ${p.district}. Pressão: ${p.debtReason || '—'}. Laço: ${p.familyTie || '—'}.

OUTROS (para bond; use o id): ${req.others.map(o => `[${o.id}] ${o.name} (${o.role})`).join('; ') || '—'}

EVIDÊNCIA:
${req.evidence || '(quase nada: só o nome e o papel)'}
`.trim();
}

export function buildPhonePrompt(ctx: GameContext, npcId: string, message: string): string {
  const npc = ctx.npcs.find(n => n.id === npcId);
  const thread = ctx.phone.find(t => t.npcId === npcId);
  const t = formatGameTime(ctx.world.time);
  return `
CONTATO: [${npcId}] ${npc?.name ?? npcId} — ${npc?.role ?? 'Contato'}
Relação: confiança ${npc?.trust ?? 0} · respeito ${npc?.respect ?? 0} · medo ${npc?.fear ?? 0} · raiva ${npc?.anger ?? 0}
Pendente: ${npc?.pendingMatters ?? '—'}
${npc ? describeNpcDepth(npc, ctx, '').join('\n') : ''}
O que é "SÓ VOCÊ SABE" só sai se o contato tiver motivo; se sair, chame reveal_npc.

JOGADOR: ${ctx.character.bio.handle}, €$${ctx.character.money}, PV ${ctx.character.hp.current}/${ctx.character.hp.max}, em ${ctx.world.location.district} (${ctx.world.location.spot}) às ${t.time}
Missões: ${ctx.quests.filter(q => q.status === 'ACTIVE').map(q => `[${q.id}] ${q.title}`).join('; ') || 'nenhuma'}
Flags: ${ctx.flags.map(f => `${f.key}=${String(f.value)}`).join(', ') || '—'}

CONVERSA ATÉ AGORA:
${thread?.last.map(m => `${m.from === 'player' ? 'JOGADOR' : npc?.name}: "${m.text}"`).join('\n') || '(início)'}

NOVA MENSAGEM DO JOGADOR:
"${message}"
`.trim();
}
