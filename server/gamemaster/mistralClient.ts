/**
 * Mistral (La Plateforme) como RESERVA da narração: entra quando todos os Gemini Flash falham e o
 * jogador autorizou a reserva. Prosa melhor que a do Flash-Lite; plano gratuito ("Experiment") com
 * limite mensal alto. A chave é do SERVIDOR (MISTRAL_API_KEY) — os textos vão para o Mistral.
 */
import type { FailureKind, LlmAttempt } from '../../shared/types/turn';
import { LlmError, gmBudgetMs, simplifySchema, type GenerateRequest, type GenerateResult, type LlmProvider } from './llmClient';

const API = 'https://api.mistral.ai/v1/chat/completions';
const MIN_ATTEMPT_MS = 4_000;

export const mistralKey = () => process.env.MISTRAL_API_KEY?.trim() || null;

/** Medium primeiro (a melhor prosa liberada no plano grátis); Small se o Medium estiver ocupado. */
export function mistralModels(): string[] {
  const custom = (process.env.MISTRAL_MODELS ?? '')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
  return custom.length ? custom : ['mistral-medium-latest', 'mistral-small-latest'];
}

function kindOf(status: number): FailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota_minute';
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 404) return 'model_unavailable';
  return status >= 500 ? 'overloaded' : 'other';
}

type Fetch = typeof fetch;

export function createMistralProvider(fetchImpl: Fetch = fetch): LlmProvider {
  /** Modelos que recusaram o schema completo: vão direto no simplificado. */
  const needsSimple = new Set<string>();
  return {
    name: 'mistral',
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const key = mistralKey();
      const attempts: LlmAttempt[] = [];
      if (!key) throw new LlmError('Mistral não configurado (MISTRAL_API_KEY).', [{ model: 'mistral', ok: false, latencyMs: 0, error: 'auth sem MISTRAL_API_KEY' }], 'auth');
      const deadline = req.deadline ?? Date.now() + gmBudgetMs();
      const perAttempt = Number(process.env.GM_ATTEMPT_MS_NARRATE) || 30_000;
      const simple = simplifySchema(req.schema);
      const kinds: FailureKind[] = [];
      let lastMessage = 'Mistral não respondeu.';
      for (const model of mistralModels()) {
        for (let pass = 0; pass < 2; pass++) {
          const remaining = deadline - Date.now();
          if (remaining < MIN_ATTEMPT_MS) throw new LlmError('Tempo esgotado.', [...attempts, { model, ok: false, latencyMs: 0, error: 'timeout orçamento de tempo esgotado' }], 'timeout');
          const useSimple = needsSimple.has(model);
          const started = Date.now();
          try {
            const res = await fetchImpl(API, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: req.system },
                  { role: 'user', content: req.prompt },
                ],
                response_format: { type: 'json_schema', json_schema: { name: 'resposta', strict: false, schema: useSimple ? simple : req.schema } },
                ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
              }),
              signal: AbortSignal.timeout(Math.min(perAttempt, remaining)),
            });
            const body = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; message?: string };
            if (!res.ok || !body.choices?.[0]?.message?.content) {
              const kind = res.ok ? 'invalid_json' : kindOf(res.status);
              lastMessage = body.message ?? `Mistral ${res.status}`;
              attempts.push({ model, ok: false, latencyMs: Date.now() - started, error: `${kind} ${res.status} ${lastMessage}`.slice(0, 300) });
              if (kind === 'auth') throw new LlmError(lastMessage, attempts, 'auth');
              if (kind === 'bad_request' && !useSimple && simple !== req.schema) {
                needsSimple.add(model);
                continue; // mesmo modelo, schema simplificado
              }
              kinds.push(kind);
              break; // próximo modelo
            }
            attempts.push({ model, ok: true, latencyMs: Date.now() - started });
            return {
              text: body.choices[0].message!.content!,
              model,
              usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens },
              attempts,
            };
          } catch (err) {
            if (err instanceof LlmError) throw err;
            const timeout = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
            lastMessage = (err as Error)?.message ?? String(err);
            attempts.push({ model, ok: false, latencyMs: Date.now() - started, error: `${timeout ? 'timeout' : 'network'} ${lastMessage}`.slice(0, 300) });
            kinds.push(timeout ? 'timeout' : 'network');
            break;
          }
        }
      }
      throw new LlmError(lastMessage, attempts, kinds.includes('quota_minute') ? 'quota_minute' : (kinds[0] ?? 'other'));
    },
  };
}

/**
 * Provedor da narração: Gemini Flash primeiro, SEMPRE. Com a reserva autorizada (allowLite), se os
 * Flash falharem: Mistral → Gemini Flash-Lite. Sem autorização, o erro volta com "reserva oferecida"
 * e o jogador decide no modal.
 */
export function withNarrationBackup(primary: LlmProvider, backup: LlmProvider | null): LlmProvider {
  return {
    name: backup ? `${primary.name}+${backup.name}` : primary.name,
    async generate(req) {
      const narrative = req.purpose === 'narrate' || req.purpose === 'prologue';
      if (!narrative || !req.allowLite || !backup) return primary.generate(req);
      const attempts: LlmAttempt[] = [];
      try {
        return await primary.generate({ ...req, allowLite: false });
      } catch (err) {
        if (!(err instanceof LlmError) || err.kind === 'auth') throw err;
        attempts.push(...err.attempts);
      }
      try {
        const r = await backup.generate(req);
        return { ...r, attempts: [...attempts, ...r.attempts] };
      } catch (err) {
        if (err instanceof LlmError) attempts.push(...err.attempts);
      }
      try {
        const r = await primary.generate({ ...req, allowLite: true, liteOnly: true });
        return { ...r, attempts: [...attempts, ...r.attempts] };
      } catch (err) {
        if (err instanceof LlmError) throw new LlmError(err.message, [...attempts, ...err.attempts], err.kind, false, err.waitMayHelp);
        throw err;
      }
    },
  };
}
