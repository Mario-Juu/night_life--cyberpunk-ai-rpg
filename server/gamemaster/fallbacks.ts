/**
 * Respostas de contingência quando o LLM falha. Marcadas como `degraded`
 * e SEM ferramentas: o mundo não muda por causa de uma falha de rede.
 */
import type { FailureKind } from '../../shared/types/turn';
import { failureHint } from '../../shared/rules/failures';
import type { EngineResult } from '../../shared/types/turn';
import type { GameContext, InterpretResponse, NarrateResponse, PhoneResponse } from '../../shared/types/gm';
import { formatGameTime, getDistrict } from '../../shared/rules/world';

const QUERY_TOOLS = ['get_character', 'get_scene', 'get_location', 'get_npc', 'get_relationship', 'get_quest', 'get_inventory', 'lookup_lore'];

/** Resumo do motor legível para o JOGADOR (sem nomes de ferramentas, ids ou dados internos). */
function playerFacingResult(r: EngineResult): string {
  const lines: string[] = [];
  const roll = r.roll;
  if (roll?.attack) {
    const a = roll.attack;
    lines.push(a.failure ? `Ataque em ${a.targetName}: não aconteceu.` : a.hit ? `Ataque em ${a.targetName}: acertou${a.application ? ` (−${a.application.hpDamage} PV)` : ''}.` : `Ataque em ${a.targetName}: errou.`);
  } else if (roll?.deathSave) lines.push(roll.deathSave.success ? 'Teste de Morte: você resiste.' : 'Teste de Morte: falhou.');
  else if (roll) lines.push(`${roll.request.reason}: ${roll.check.success ? 'sucesso' : 'falha'}.`);
  for (const t of r.tools.filter(t => t.summary && !QUERY_TOOLS.includes(t.tool))) lines.push(`${t.ok ? '✓' : '✗'} ${t.summary}`);
  return lines.length ? `\n\nO que o motor já resolveu:\n${lines.slice(0, 8).join('\n')}` : '';
}

export function fallbackInterpret(text: string): InterpretResponse {
  return { intent: { type: 'other', summary: text.slice(0, 200), confidence: 0 }, toolCalls: [] };
}

/** Corta no fim de uma palavra (sugestão não pode terminar em "dentr"). */
const shorten = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}…`);

export function fallbackNarrate(ctx: GameContext, kind: 'action' | 'prologue', engineResult: EngineResult | null, playerInput?: string, failure?: FailureKind): NarrateResponse {
  const base = { dialogues: [], toolCalls: [], discoveries: [], enemyActions: [], degraded: true };
  if (kind === 'prologue') {
    const c = ctx.character;
    const l = ctx.world.location;
    const weapon = c.inventory.find(i => i.weapon)?.name ?? 'sua arma';
    // A reserva segue a abertura sorteada (lugar, cena, quem mandou a 1ª mensagem) — antes era sempre o
    // cubículo e o Rafa, mesmo numa campanha que começa num bar ou nas Badlands.
    const first = ctx.phone[0];
    const sender = first?.npcName;
    const place = l.district === 'BADLANDS' ? `${l.subDistrict}` : `${getDistrict(l.district).name}`;
    return {
      ...base,
      narration: `${l.spot}, ${place} — ${formatGameTime(ctx.world.time).time}. ${ctx.scene.description || ''}${ctx.scene.description ? '.' : ''}\n\n${ctx.world.situation}\n\nVocê confere a ${weapon}. Restam €$${c.money}.${sender ? ` No Agent, uma mensagem nova de ${sender}.` : ''}\n\nO que você faz, choom?`.replace(/\.\./g, '.'),
      suggestedActions: [sender ? `Ler a mensagem de ${sender}` : 'Olhar em volta', 'Avaliar a saída mais próxima', shorten(ctx.world.objective, 60)],
    };
  }
  const mechanics = engineResult ? playerFacingResult(engineResult) : '';
  return {
    ...base,
    narration: `⚠ O sinal com o Mestre caiu. ${playerInput ? `Sua ação ("${playerInput.slice(0, 140)}") foi processada pelo motor, mas a cena não foi narrada.` : ''}${mechanics}\n\n${failureHint(failure)}`,
    suggestedActions: ['Continuar a partir daqui', 'Avaliar a situação'],
  };
}

export function fallbackPhone(ctx: GameContext): PhoneResponse {
  return {
    replyText: `Sinal oscilando na rede de ${getDistrict(ctx.world.location.district).name}, choom. Manda de novo daqui a pouco.`,
    suggestedReplies: [],
    toolCalls: [],
    degraded: true,
  };
}

/** Resumo determinístico (sem LLM) a partir do transcript. */
export function fallbackSummary(transcript: string): string {
  return transcript
    .split('\n')
    .filter(l => /^(JOGADOR|EVENTO)/.test(l))
    .slice(0, 12)
    .join(' ')
    .slice(0, 1200);
}
