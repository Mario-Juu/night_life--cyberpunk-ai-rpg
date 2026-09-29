/**
 * Monta o contexto em seções:
 * PERSONAGEM + CENA + NPCs + MISSÕES + MUNDO/FLAGS + MEMÓRIAS + RESUMOS + HISTÓRICO + ENTRADA DO TURNO.
 */
import type { Character, RollOutcome } from '../../shared/types/game';
import type { EngineResult } from '../../shared/types/turn';
import type { GameContext } from '../../shared/types/gm';
import { getSkill } from '../../shared/rules/skills';
import { formatGameTime } from '../../shared/rules/world';
import { getRole } from '../../shared/rules/creation';
import { DISTANCE_LABEL } from '../../shared/rules/weapons';
import { statValue } from '../../shared/engine/checks';
import { WOUND_LABEL, characterSp, characterWoundState, woundPenalty } from '../../shared/engine/health';
import { unarmedDamage } from '../../shared/rules/weapons';
import { THREAT_LABEL } from '../../shared/engine/world';

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
      if (i.weapon) d += ` (arma ${i.weapon.weaponClass}, ${i.weapon.damage}${i.weapon.magSize !== null ? `, pente ${i.weapon.loaded}/${i.weapon.magSize}` : ''})`;
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
    c.cyberware.length ? `Ciberware: ${c.cyberware.map(cw => cw.name).join(', ')}` : '',
    c.criticalInjuries.length ? `Ferimentos: ${c.criticalInjuries.map(i => `[${i.id}] ${i.name} (${i.effect})`).join('; ')}` : '',
    `Laços: ${c.bio.familyTie || '—'} · Dívida: ${c.bio.debtReason || '—'} · Sonho: ${c.bio.personalAnchor || '—'}`,
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
  if (ctx.combat.active) {
    lines.push(`COMBATE — rodada ${ctx.combat.round}${ctx.combat.playerInitiative !== null ? `, iniciativa do jogador ${ctx.combat.playerInitiative}` : ''}`);
    for (const c of ctx.combat.combatants)
      lines.push(`  - [${c.id}] ${c.name}: PV ${c.hp.current}/${c.hp.max}, SP ${c.sp.body}, ${c.weapon.name} (${c.weapon.damage}), ${DISTANCE_LABEL[c.distance]}, cobertura ${c.cover}, ${c.status}`);
  } else if (ctx.combat.combatants.length) {
    lines.push(`Corpos/inimigos da última luta: ${ctx.combat.combatants.map(c => `[${c.id}] ${c.name} (${c.status}${c.looted ? ', revistado' : ''})`).join(', ')}`);
  }
  return lines.join('\n');
}

function describeNpcs(ctx: GameContext): string {
  return (
    ctx.npcs
      .map(n => {
        const secrets = n.knowledge.filter(k => k.secret).map(k => k.fact);
        const known = n.knowledge.filter(k => !k.secret).map(k => k.fact);
        return [
          `  - [${n.id}] ${n.name} (${n.role}) ${n.status === 'dead' ? '☠ MORTO' : n.status === 'missing' ? 'DESAPARECIDO' : ''}`.trimEnd(),
          `    confiança ${n.trust} · respeito ${n.respect} · medo ${n.fear} · raiva ${n.anger}${n.location ? ` · em ${n.location}` : ''}`,
          n.currentGoal ? `    objetivo: ${n.currentGoal}` : '',
          n.pendingMatters ? `    pendente: ${n.pendingMatters}` : '',
          known.length ? `    fatos públicos: ${known.join(' | ')}` : '',
          secrets.length ? `    SEGREDOS (o jogador NÃO sabe): ${secrets.join(' | ')}` : '',
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
    const reason = { no_ammo: 'ARMA SEM MUNIÇÃO (clique seco, nada disparou)', out_of_range: 'ALVO FORA DO ALCANCE', in_cover: 'ALVO EM COBERTURA TOTAL', no_target: 'ALVO INDISPONÍVEL' }[o.attack.failure];
    lines.push(`ATAQUE NÃO REALIZADO: ${reason}.`);
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
    lines.push(`Ataque com ${a.weaponName} contra ${a.targetName}: ${a.hit ? 'ACERTOU' : 'ERROU'}. Munição no pente: ${a.ammoAfter ?? '—'}.`);
    if (a.application && a.damage) {
      const app = a.application;
      lines.push(`Dano ${a.damage.notation} [${a.damage.rolls.join(', ')}] = ${app.raw} ${app.location === 'head' ? 'na CABEÇA (×2)' : 'no corpo'} − SP ${app.spBefore} → ${app.hpDamage} de dano (PV ${app.hpBefore} → ${app.hpAfter}).${app.ablated ? ` Armadura do alvo cai para SP ${app.spAfter}.` : ''}`);
      if (app.criticalInjury) lines.push(`FERIMENTO CRÍTICO: ${app.criticalInjury.name} (+5 direto).`);
      if (a.targetStatusAfter === 'down') lines.push(`${a.targetName} CAIU (0 PV). Decida com update_combatant se morreu, desmaiou ou agoniza.`);
    }
  }
  return lines.join('\n');
}

export function describeEngineResult(r: EngineResult | null): string {
  if (!r) return '(sem mecânica neste turno)';
  const lines: string[] = [];
  if (r.intent) lines.push(`Intenção: ${r.intent.type} — ${r.intent.summary}`);
  for (const t of r.tools) lines.push(`${t.ok ? '✓' : '✗'} ${t.tool}: ${t.summary}${t.data ? ` ${JSON.stringify(t.data).slice(0, 600)}` : ''}`);
  if (r.roll) lines.push(describeOutcome(r.roll));
  if (!lines.length) lines.push('(nenhuma ação mecânica: apenas narre a reação)');
  if (r.offscreen.length) lines.push(`ACONTECEU FORA DE CENA (incorpore se fizer sentido): ${r.offscreen.join(' | ')}`);
  return lines.join('\n');
}

function contextSections(ctx: GameContext): string {
  const quests = ctx.quests
    .map(m => `  - [${m.id}] ${m.title} (${m.status})${m.status === 'ACTIVE' ? `: ${m.objective}` : ''}${m.rewardEddies ? ` · paga €$${m.rewardEddies}` : ''}${m.giverId ? ` · de ${m.giverId}` : ''}`)
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

export function buildNarratePrompt(ctx: GameContext, input: { kind: 'action' | 'prologue'; playerInput?: string; engineResult: EngineResult | null }, isPro: boolean, correction?: string): string {
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

${turnBlock}${correction ? `\n\n# CORREÇÃO OBRIGATÓRIA\nSua narração anterior contradisse o motor: ${correction}\nReescreva respeitando o resultado.` : ''}${isPro ? '\n\n[MODO PRO]: prosa noir densa, pausas e linguagem corporal.' : ''}`;
}

export function buildPhonePrompt(ctx: GameContext, npcId: string, message: string): string {
  const npc = ctx.npcs.find(n => n.id === npcId);
  const thread = ctx.phone.find(t => t.npcId === npcId);
  const t = formatGameTime(ctx.world.time);
  const secrets = npc?.knowledge.filter(k => k.secret).map(k => k.fact) ?? [];
  return `
CONTATO: [${npcId}] ${npc?.name ?? npcId} — ${npc?.role ?? 'Contato'}
Relação: confiança ${npc?.trust ?? 0} · respeito ${npc?.respect ?? 0} · medo ${npc?.fear ?? 0} · raiva ${npc?.anger ?? 0}
Objetivo atual: ${npc?.currentGoal ?? '—'} · Pendente: ${npc?.pendingMatters ?? '—'}
${secrets.length ? `Segredos que ele guarda (só revela se tiver motivo): ${secrets.join(' | ')}` : ''}

JOGADOR: ${ctx.character.bio.handle}, €$${ctx.character.money}, PV ${ctx.character.hp.current}/${ctx.character.hp.max}, em ${ctx.world.location.district} (${ctx.world.location.spot}) às ${t.time}
Missões: ${ctx.quests.filter(q => q.status === 'ACTIVE').map(q => `[${q.id}] ${q.title}`).join('; ') || 'nenhuma'}
Flags: ${ctx.flags.map(f => `${f.key}=${String(f.value)}`).join(', ') || '—'}

CONVERSA ATÉ AGORA:
${thread?.last.map(m => `${m.from === 'player' ? 'JOGADOR' : npc?.name}: "${m.text}"`).join('\n') || '(início)'}

NOVA MENSAGEM DO JOGADOR:
"${message}"
`.trim();
}
