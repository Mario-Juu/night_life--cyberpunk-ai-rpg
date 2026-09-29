/**
 * Respostas de contingência quando o LLM falha. Marcadas como `degraded`
 * e SEM ferramentas: o mundo não muda por causa de uma falha de rede.
 */
import type { EngineResult } from '../../shared/types/turn';
import type { GameContext, InterpretResponse, NarrateResponse, PhoneResponse } from '../../shared/types/gm';
import { formatGameTime, getDistrict } from '../../shared/rules/world';
import { describeEngineResult } from './promptBuilder';

export function fallbackInterpret(text: string): InterpretResponse {
  return { intent: { type: 'other', summary: text.slice(0, 200), confidence: 0 }, toolCalls: [] };
}

export function fallbackNarrate(ctx: GameContext, kind: 'action' | 'prologue', engineResult: EngineResult | null, playerInput?: string): NarrateResponse {
  const base = { dialogues: [], toolCalls: [], discoveries: [], enemyActions: [], degraded: true };
  if (kind === 'prologue') {
    const c = ctx.character;
    const d = getDistrict(ctx.world.location.district);
    const weapon = c.inventory.find(i => i.weapon)?.name ?? 'sua arma';
    return {
      ...base,
      narration: `${d.name}, ${formatGameTime(ctx.world.time).time}. O cheiro de chuva ácida entra pela fresta da janela. Na bancada, a tela da administração pisca em vermelho: ${c.bio.debtReason || 'aviso de despejo'}.\n\nVocê confere a ${weapon}. Restam €$${c.money}. No Agent, uma mensagem nova de Rafa "Zero-Um" brilha na tela trincada.\n\nO que você faz, choom?`,
      suggestedActions: ['Ler a mensagem do Rafa', 'Checar a janela e a rota de fuga', 'Descer até a rua'],
    };
  }
  const mechanics = engineResult && (engineResult.roll || engineResult.tools.length) ? `\n\nO motor registrou:\n${describeEngineResult(engineResult)}` : '';
  return {
    ...base,
    narration: `⚠ O sinal com o Mestre caiu. ${playerInput ? `Sua ação ("${playerInput.slice(0, 140)}") foi processada pelo motor, mas a cena não foi narrada.` : ''}${mechanics}\n\nTente continuar em instantes.`,
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
