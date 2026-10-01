/** Mensagens para o jogador quando o Mestre (LLM) falha — iguais no servidor e no cliente. */
import type { FailureKind } from '../types/turn';

/** O que dizer ao jogador conforme a causa da falha (e o que ele pode fazer). */
export function failureHint(kind?: FailureKind): string {
  switch (kind) {
    case 'quota_day':
      return 'A cota DIÁRIA gratuita desta chave Gemini acabou (o plano grátis dá ~20 pedidos por dia por modelo). Coloque a SUA chave em Configurações ou espere a virada (meia-noite do Pacífico, ~4h de Brasília).';
    case 'quota_minute':
      return 'Muitos pedidos por minuto para esta chave. Espere alguns segundos e continue.';
    case 'overloaded':
    case 'timeout':
      return 'Os servidores do Google estão sobrecarregados agora. Tente de novo em instantes.';
    case 'auth':
      return 'A chave Gemini foi recusada. Confira a chave em Configurações.';
    case 'network':
      return 'Falha de rede entre o servidor do jogo e o Google. Tente de novo.';
    case 'blocked':
      return 'O filtro de conteúdo do Google recusou esta cena (algo sensível no contexto). Tente reformular a ação; se continuar, avise — é um caso para ajustar no jogo.';
    default:
      return 'Tente continuar em instantes.';
  }
}

/** Título curto do aviso (toast). */
export function failureTitle(kind?: FailureKind): string {
  switch (kind) {
    case 'quota_day':
      return 'Cota diária da chave esgotada';
    case 'quota_minute':
      return 'Pedidos demais por minuto';
    case 'overloaded':
    case 'timeout':
      return 'Google sobrecarregado';
    case 'auth':
      return 'Chave Gemini recusada';
    case 'blocked':
      return 'Cena bloqueada pelo filtro do Google';
    default:
      return 'Mestre em modo degradado';
  }
}

/** Vale uma nova tentativa automática? (sobrecarga passa em segundos; cota e chave, não.) */
export function isTransientFailure(kind?: FailureKind): boolean {
  return kind === 'overloaded' || kind === 'timeout' || kind === 'quota_minute' || kind === 'network' || kind === 'invalid_json';
}
