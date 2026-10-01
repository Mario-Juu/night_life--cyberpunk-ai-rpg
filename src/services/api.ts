import type {
  GameContext,
  GmEnvelope,
  GMStatus,
  InterpretResponse,
  ModelMode,
  NarrateResponse,
  PhoneResponse,
  SummarizeResponse,
  NpcProfileRequest,
  NpcProfileResponse,
  WorldgenRequest,
  WorldgenResponse,
} from '@shared/types/gm';
import type { EngineResult } from '@shared/types/turn';
import { useUiStore } from '../store/uiStore';

/** Sempre MAIOR que o orçamento do servidor (GM_BUDGET_MS = 110 s): o servidor responde antes (narração ou fallback). */
const TIMEOUT_MS = 150_000;

export class ApiError extends Error {
  constructor(
    message: string,
    /** Status HTTP (502/504 = a hospedagem cortou a Function por tempo). */
    public status?: number,
  ) {
    super(message);
  }
}

/** A hospedagem (Netlify) derrubou a resposta no meio: vale tentar de novo. */
export const isGatewayCut = (err: unknown) => err instanceof ApiError && (err.status === 502 || err.status === 504 || err.status === 503);

/** Chave Gemini do próprio jogador, se ele configurou uma. */
function keyHeader(): Record<string, string> {
  const key = useUiStore.getState().geminiKey;
  return key ? { 'x-gemini-key': key } : {};
}

async function post<T>(path: string, body: unknown): Promise<GmEnvelope<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...keyHeader() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const cut = res.status === 502 || res.status === 504 || res.status === 503;
      throw new ApiError(data.error || (cut ? 'A hospedagem cortou a resposta do Mestre (tempo limite do servidor).' : `Erro do servidor (${res.status})`), res.status);
    }
    // O corpo tem de ser um envelope ({payload, meta}): uma página de erro da hospedagem com 200
    // viraria "Cannot read properties of undefined" lá na frente.
    const env = data as Partial<GmEnvelope<T>>;
    if (!env || typeof env !== 'object' || !env.payload || !env.meta) throw new ApiError('O Mestre respondeu algo que o jogo não entendeu (resposta fora do formato).');
    return env as GmEnvelope<T>;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') throw new ApiError('O Mestre demorou demais para responder.');
    throw new ApiError('Sem conexão com o servidor.');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStatus(): Promise<GMStatus> {
  try {
    // Com timeout: a tela inicial espera por isto (a Function fria da Netlify pode demorar).
    const res = await fetch('/api/gm/status', { headers: keyHeader(), signal: AbortSignal.timeout(8_000) });
    if (res.ok) return await res.json();
  } catch {
    // servidor offline
  }
  return { status: 'ok', hasKey: false, defaultMode: 'flash', promptVersion: '?' };
}

/** Valida uma chave Gemini (ainda não salva) no servidor do jogo, que pergunta ao Google. */
export async function checkKey(key: string): Promise<{ valid: boolean | null; reason?: string }> {
  try {
    const res = await fetch('/api/gm/key-check', { headers: { 'x-gemini-key': key.trim() }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return await res.json();
  } catch {
    // servidor fora do ar
  }
  return { valid: null, reason: 'network' };
}

export const api = {
  interpret: (context: GameContext, text: string, model: ModelMode, feedback?: string) => post<InterpretResponse>('/api/gm/interpret', { context, text, model, feedback }),
  narrate: (context: GameContext, input: { kind: 'action' | 'prologue'; playerInput?: string; engineResult: EngineResult | null; allowLite?: boolean }, model: ModelMode) =>
    post<NarrateResponse>('/api/gm/narrate', { context, ...input, model }),
  phone: (context: GameContext, npcId: string, message: string, model: ModelMode) => post<PhoneResponse>('/api/gm/phone', { context, npcId, message, model }),
  summarize: (req: { sessionId: string; turnId: string; fromTurn: number; toTurn: number; transcript: string }) => post<SummarizeResponse>('/api/gm/summarize', req),
  profile: (req: NpcProfileRequest) => post<NpcProfileResponse>('/api/gm/profile', req),
  worldgen: (req: WorldgenRequest) => post<WorldgenResponse>('/api/gm/worldgen', req),
};
