import type {
  GameContext,
  GmEnvelope,
  GMStatus,
  InterpretResponse,
  ModelMode,
  NarrateResponse,
  PhoneResponse,
  SummarizeResponse,
} from '@shared/types/gm';
import type { EngineResult } from '@shared/types/turn';
import { useUiStore } from '../store/uiStore';

/** Sempre MAIOR que o orçamento do servidor (GM_BUDGET_MS = 110 s): o servidor responde antes (narração ou fallback). */
const TIMEOUT_MS = 150_000;

export class ApiError extends Error {}

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
    if (!res.ok) throw new ApiError(data.error || `Erro do servidor (${res.status})`);
    return data as GmEnvelope<T>;
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
    const res = await fetch('/api/gm/status', { headers: keyHeader() });
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
  narrate: (context: GameContext, input: { kind: 'action' | 'prologue'; playerInput?: string; engineResult: EngineResult | null }, model: ModelMode) =>
    post<NarrateResponse>('/api/gm/narrate', { context, ...input, model }),
  phone: (context: GameContext, npcId: string, message: string, model: ModelMode) => post<PhoneResponse>('/api/gm/phone', { context, npcId, message, model }),
  summarize: (req: { sessionId: string; turnId: string; fromTurn: number; toTurn: number; transcript: string }) => post<SummarizeResponse>('/api/gm/summarize', req),
};
