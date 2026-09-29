/**
 * Camada de provedor LLM. O resto do jogo só conhece `LlmProvider`:
 * trocar de modelo/fornecedor = escrever outro provider, sem tocar no RPG.
 */
import { GoogleGenAI } from '@google/genai';
import type { ModelMode } from '../../shared/types/gm';
import type { LlmAttempt } from '../../shared/types/turn';

export interface GenerateRequest {
  system: string;
  prompt: string;
  /** JSON Schema padrão (não específico de provedor). */
  schema: object;
  mode: ModelMode;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  modelVersion?: string;
  usage: { inputTokens?: number; outputTokens?: number; cachedTokens?: number };
  attempts: LlmAttempt[];
}

export interface LlmProvider {
  name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** Erro que carrega as tentativas feitas (para observabilidade). */
export class LlmError extends Error {
  constructor(
    message: string,
    public attempts: LlmAttempt[],
  ) {
    super(message);
  }
}

const PLACEHOLDER_KEYS = new Set(['', 'MY_GEMINI_API_KEY']);
const TIMEOUT_MS = Number(process.env.GM_TIMEOUT_MS) || 60_000;

export function getApiKey(): string | null {
  const key = process.env.CUSTOM_GEMINI_API_KEY || process.env.RPG_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  return PLACEHOLDER_KEYS.has(key.trim()) ? null : key.trim();
}

export function defaultMode(): ModelMode {
  return process.env.RPG_MODEL_MODE === 'pro' ? 'pro' : 'flash';
}

export function modelChain(mode: ModelMode): string[] {
  const pro = process.env.GM_MODEL_PRO || 'gemini-3.1-pro-preview';
  const flash = process.env.GM_MODEL_FLASH || 'gemini-3.8-flash';
  const lite = process.env.GM_MODEL_LITE || 'gemini-3.1-flash-lite';
  const chain = mode === 'pro' ? [pro, flash, lite] : [flash, lite, pro];
  return [...new Set(chain.filter(Boolean))];
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const m = e?.message?.match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

/** Erros que justificam tentar o próximo modelo. 400/401/403 são permanentes. */
export function isRetryable(err: unknown): boolean {
  const e = err as { name?: string };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true;
  const status = statusOf(err);
  if (status === undefined) return true;
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!apiKey) throw Object.assign(new Error('Chave da API Gemini não configurada no .env'), { status: 401 });
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export const geminiProvider: LlmProvider = {
  name: 'google-gemini',
  async generate(req) {
    const attempts: LlmAttempt[] = [];
    let lastError: unknown;
    let ai: GoogleGenAI;
    try {
      ai = getClient();
    } catch (err) {
      throw new LlmError((err as Error).message, [{ model: '-', ok: false, latencyMs: 0, error: (err as Error).message }]);
    }
    // GM_RETRIES: novas tentativas no MESMO modelo em 429/503 (útil em chaves gratuitas).
    const retries = Math.max(0, Number(process.env.GM_RETRIES) || 0);
    const tries = modelChain(req.mode).flatMap(model => Array.from({ length: retries + 1 }, (_, i) => ({ model, i })));
    let skip: string | null = null;
    for (const { model, i } of tries) {
      if (model === skip) continue;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const started = Date.now();
      try {
        const response = await ai.models.generateContent({
          model,
          contents: req.prompt,
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            responseJsonSchema: req.schema,
            temperature: req.temperature ?? (req.mode === 'pro' ? 0.85 : 0.75),
            abortSignal: controller.signal,
          },
        });
        attempts.push({ model, ok: true, latencyMs: Date.now() - started });
        const u = response.usageMetadata;
        return {
          text: response.text ?? '',
          model,
          modelVersion: response.modelVersion,
          usage: { inputTokens: u?.promptTokenCount, outputTokens: u?.candidatesTokenCount, cachedTokens: u?.cachedContentTokenCount },
          attempts,
        };
      } catch (err) {
        lastError = err;
        const status = statusOf(err);
        attempts.push({ model, ok: false, latencyMs: Date.now() - started, error: `${status ?? ''} ${(err as Error)?.message ?? err}`.trim().slice(0, 300) });
        if (!isRetryable(err)) break;
        const busy = status === 429 || status === 503;
        if (!busy) skip = model;
        await new Promise(r => setTimeout(r, busy && i < retries ? 2000 * 2 ** i : status === 429 ? 1000 : 300));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new LlmError((lastError as Error)?.message ?? 'Nenhum modelo respondeu.', attempts);
  },
};
