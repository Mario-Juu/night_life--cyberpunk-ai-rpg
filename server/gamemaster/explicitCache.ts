/**
 * Cache EXPLÍCITO das instruções fixas (system prompt) no Gemini — só para chave paga.
 *
 * O implícito é automático, mas nos flash ele não pegou nas medições; o explícito garante o desconto
 * (~10× mais barato) nos ~6–8 mil tokens fixos de cada chamada, por um custo de armazenamento por hora.
 * - Chave gratuita: o Google recusa a criação (`FreeTier … limit=0`) → a chave é marcada e nunca mais tenta.
 * - Prompt pequeno (< mínimo do modelo) ou modelo que recusa → segue sem cache, como antes.
 * - Lite fica de fora: o implícito já pega nele e o armazenamento custa o dobro.
 * OPCIONAL e desligado por padrão: só liga com GM_EXPLICIT_CACHE=on (ainda não validado com chave paga).
 */
import { createHash } from 'crypto';

export interface CacheApi {
  /** Cria o cache com só as instruções do sistema; devolve o nome e quando expira (ms epoch). */
  create(model: string, system: string, ttlSec: number): Promise<{ name: string; expiresAt: number }>;
}

/** ~4.096 tokens (mínimo dos flash 3.x) com folga: abaixo disso o Google recusa. */
export const MIN_CACHE_CHARS = 17_000;
export const CACHE_TTL_SEC = 3600;
/** Renova antes de vencer para nenhuma chamada usar um cache que expira no meio. */
const RENEW_MARGIN_MS = 5 * 60_000;
const CREATE_TIMEOUT_MS = 8_000;

const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);

export type CacheSkipReason = 'off' | 'small' | 'lite' | 'free_tier' | 'model' | 'error';

export function createCacheManager(api: CacheApi, opts: { now?: () => number; isLite?: (model: string) => boolean } = {}) {
  const now = opts.now ?? Date.now;
  const isLite = opts.isLite ?? ((m: string) => /lite/i.test(m));
  const entries = new Map<string, { name: string; expiresAt: number }>();
  const pending = new Map<string, Promise<string | null>>();
  /** Chaves sem cache explícito (plano gratuito). */
  const freeKeys = new Set<string>();
  /** chave+modelo que recusaram (tamanho mínimo, sem suporte). */
  const refused = new Set<string>();

  const keyOf = (apiKey: string, model: string, system: string) => `${hash(apiKey)}:${model}:${hash(system)}`;

  function skip(apiKey: string, model: string, system: string): CacheSkipReason | null {
    if (process.env.GM_EXPLICIT_CACHE !== 'on') return 'off';
    if (isLite(model)) return 'lite';
    if (system.length < MIN_CACHE_CHARS) return 'small';
    if (freeKeys.has(hash(apiKey))) return 'free_tier';
    if (refused.has(`${hash(apiKey)}:${model}`)) return 'model';
    return null;
  }

  async function create(apiKey: string, model: string, system: string, key: string): Promise<string | null> {
    try {
      const res = await Promise.race([
        api.create(model, system, CACHE_TTL_SEC),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout criando cache')), CREATE_TIMEOUT_MS)),
      ]);
      entries.set(key, res);
      return res.name;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const msg = `${e?.message ?? err}`;
      if (/FreeTier|limit[^0-9]{0,4}0\b/i.test(msg)) freeKeys.add(hash(apiKey));
      else if (e?.status === 400 || /\b400\b|INVALID_ARGUMENT|too (small|few)|minimum/i.test(msg)) refused.add(`${hash(apiKey)}:${model}`);
      // 503/429/timeout: só desta vez; tenta de novo numa próxima chamada.
      return null;
    }
  }

  return {
    /** Nome do cache para esta chave+modelo+instruções, criando/renovando se preciso; null = chamar sem cache. */
    async get(apiKey: string, model: string, system: string): Promise<string | null> {
      if (skip(apiKey, model, system)) return null;
      const key = keyOf(apiKey, model, system);
      const e = entries.get(key);
      if (e && e.expiresAt - now() > RENEW_MARGIN_MS) return e.name;
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const p = create(apiKey, model, system, key).finally(() => pending.delete(key));
      pending.set(key, p);
      return p;
    },
    /** O Google não aceitou o cache nesta chamada: esquece (e, se for o caso, para de usar neste modelo). */
    drop(apiKey: string, model: string, system: string, refuseModel = false) {
      entries.delete(keyOf(apiKey, model, system));
      if (refuseModel) refused.add(`${hash(apiKey)}:${model}`);
    },
    skip,
  };
}
