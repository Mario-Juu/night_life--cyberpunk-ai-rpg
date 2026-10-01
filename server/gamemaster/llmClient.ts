/**
 * Camada de provedor LLM. O resto do jogo só conhece `LlmProvider`:
 * trocar de modelo/fornecedor = escrever outro provider, sem tocar no RPG.
 *
 * Confiabilidade (o plano gratuito do Gemini tem ~20 pedidos/dia POR MODELO e 503s frequentes):
 * - Cadeia por papel: intérprete/resumo começam no flash-lite (classificação), narração no flash.
 * - Disjuntor por chave+modelo: cota diária esgotada esfria até a meia-noite do Pacífico (quando o
 *   Google zera o RPD); cota por minuto respeita o RetryInfo; 503/timeout esfria alguns segundos.
 *   Modelo frio é pulado SEM chamar a API.
 * - Timeout por tentativa (um 503 pode levar 60 s para chegar): corta cedo e passa ao próximo modelo.
 * - Memória por processo de quem precisa do schema simplificado / não aceita thinkingLevel.
 * - Gemini 3: sem temperatura explícita (o Google recomenda o padrão; baixar causa loops).
 */
import { createHash } from 'crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createCacheManager } from './explicitCache';
import type { ModelMode } from '../../shared/types/gm';
import type { FailureKind, LlmAttempt, LlmPurpose } from '../../shared/types/turn';
import { requestKey } from './requestKey';

export interface GenerateRequest {
  system: string;
  prompt: string;
  /** JSON Schema padrão (não específico de provedor). */
  schema: object;
  mode: ModelMode;
  /** Papel da chamada: escolhe a cadeia de modelos, o timeout por tentativa e o nível de raciocínio. */
  purpose?: LlmPurpose;
  temperature?: number;
  /** Prazo absoluto (epoch ms) para TODAS as tentativas desta chamada. */
  deadline?: number;
  /** Modelos a evitar (ex.: o que acabou de devolver JSON inválido) — vão para o fim da fila. */
  avoid?: string[];
  /**
   * Narração: pode cair no flash-lite? (a prosa dele é mais crua). Padrão: não — o jogador escolhe
   * quando todos os flash falharem.
   */
  allowLite?: boolean;
  /** Só os modelos flash-lite (último recurso da narração, depois do Flash). */
  liteOnly?: boolean;
}

export interface GenerateResult {
  text: string;
  model: string;
  modelVersion?: string;
  usage: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; thoughtsTokens?: number };
  attempts: LlmAttempt[];
}

export interface LlmProvider {
  name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** Erro que carrega as tentativas feitas e a causa principal (para o jogador e a observabilidade). */
export class LlmError extends Error {
  constructor(
    message: string,
    public attempts: LlmAttempt[],
    public kind: FailureKind = 'other',
    /** A narração NÃO tentou o flash-lite (o jogador precisa autorizar). */
    public liteSkipped = false,
    /** Alguma falha foi transitória (sobrecarga/timeout): esperar um pouco pode resolver. */
    public waitMayHelp = false,
  ) {
    super(message);
  }
}

const PLACEHOLDER_KEYS = new Set(['', 'MY_GEMINI_API_KEY']);
/**
 * Orçamento total de uma operação do Mestre (todas as tentativas, modelos e reescritas).
 * Fica ABAIXO do tempo que o navegador espera (src/services/api.ts), para o servidor sempre
 * responder — com a narração ou com o fallback — antes de o cliente desistir.
 */
/** Lê um tempo do ambiente; valor inválido (negativo, zero, NaN, Infinity) cai no padrão. */
export function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const gmBudgetMs = () => envMs('GM_BUDGET_MS', 110_000);
const MIN_ATTEMPT_MS = 4_000;

const FAST_PURPOSES: ReadonlySet<LlmPurpose> = new Set(['interpret', 'summarize']);
/**
 * Trabalho de fundo (perfil de NPC, costura do mundo): lite primeiro, para não gastar a cota por minuto
 * dos flash e deixá-los esfriando bem na hora da próxima narração. Tempo de tentativa de narração (escrevem mais).
 */
const BACKGROUND_PURPOSES: ReadonlySet<LlmPurpose> = new Set(['profile', 'worldgen']);
/** Prosa: o lite só entra com a permissão do jogador. */
const NARRATIVE_PURPOSES: ReadonlySet<LlmPurpose> = new Set(['narrate', 'prologue']);
export const isLiteModel = (m: string) => /lite/i.test(m);
const TRANSIENT: ReadonlySet<FailureKind> = new Set(['overloaded', 'timeout', 'quota_minute', 'network']);

/** Tempo máximo de UMA tentativa: classificação é rápida; narração escreve mais. */
export function attemptTimeoutMs(purpose: LlmPurpose = 'narrate'): number {
  if (process.env.GM_TIMEOUT_MS) return envMs('GM_TIMEOUT_MS', 30_000);
  // Narração normal leva 5–20 s; 30 s por tentativa ainda cabe no limite de 60 s da Netlify.
  return FAST_PURPOSES.has(purpose) ? envMs('GM_ATTEMPT_MS_FAST', 20_000) : envMs('GM_ATTEMPT_MS_NARRATE', 30_000);
}

export function getApiKey(): string | null {
  // A chave do jogador (se enviada) tem prioridade sobre a do servidor.
  const own = requestKey();
  if (own) return own;
  const key = process.env.CUSTOM_GEMINI_API_KEY || process.env.RPG_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  return PLACEHOLDER_KEYS.has(key.trim()) ? null : key.trim();
}

export function defaultMode(): ModelMode {
  return 'flash';
}

// ---------------------------------------------------------------- cadeias de modelos

/**
 * Narração: desce de versão em versão do flash antes de cair para o flash-lite.
 * Nenhum modelo "pro" é usado — nem se vier por variável de ambiente.
 */
export const DEFAULT_MODEL_CHAIN = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
/** Intérprete e resumos: o lite resolve em ~2 s e poupa a cota do flash para a narração. */
export const FAST_MODEL_CHAIN = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];

const envList = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
const noPro = (chain: string[]) => [...new Set(chain.filter(m => !/\bpro\b|-pro/i.test(m)))];

export function modelChain(purpose: LlmPurpose | ModelMode = 'narrate'): string[] {
  if (FAST_PURPOSES.has(purpose as LlmPurpose) || BACKGROUND_PURPOSES.has(purpose as LlmPurpose)) {
    const custom = envList(process.env.GM_MODELS_FAST);
    return noPro(custom.length ? custom : FAST_MODEL_CHAIN);
  }
  const custom = envList(process.env.GM_MODELS);
  return noPro(custom.length ? custom : DEFAULT_MODEL_CHAIN);
}

// ---------------------------------------------------------------- classificação de erros

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const m = e?.message?.match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

export interface ErrorInfo {
  kind: FailureKind;
  status?: number;
  /** Quanto esperar antes de tentar o MESMO modelo de novo (RetryInfo), em ms. */
  retryAfterMs?: number;
}

/**
 * Classifica um erro do Gemini. A cota vem em `QuotaFailure.quotaId` (…PerDay… × …PerMinute…);
 * cuidado: a cota DIÁRIA também traz "retry in 6s" — enganoso, por isso o quotaId manda.
 */
export function classifyError(err: unknown): ErrorInfo {
  const e = err as { name?: string; message?: string };
  const message = `${e?.message ?? err ?? ''}`;
  if ((err as { blocked?: string })?.blocked) return { kind: 'blocked' };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || /aborted|timed? ?out/i.test(message)) return { kind: 'timeout' };
  const status = statusOf(err);
  if (/api key not valid|api_key_invalid|permission denied|unauthenticated/i.test(message) || status === 401 || status === 403) return { kind: 'auth', status };
  if (status === 429) {
    const quotaId = /"quotaId":\s*"([^"]+)"/.exec(message)?.[1] ?? '';
    const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(message)?.[1] ?? /retry in (\d+(?:\.\d+)?)s/i.exec(message)?.[1];
    if (/PerDay/i.test(quotaId)) return { kind: 'quota_day', status };
    return { kind: 'quota_minute', status, retryAfterMs: delay ? Math.ceil(Number(delay) * 1000) : 30_000 };
  }
  if (status === 404) return { kind: 'model_unavailable', status };
  if (status === 400) return { kind: 'bad_request', status };
  if (status !== undefined && status >= 500) return { kind: 'overloaded', status };
  if (status === 408) return { kind: 'timeout', status };
  return { kind: status === undefined ? 'network' : 'other', status };
}

/** Erros que justificam tentar o próximo modelo. Chave inválida e request malformado não. */
export function isRetryable(err: unknown): boolean {
  const { kind } = classifyError(err);
  return kind !== 'auth' && kind !== 'bad_request' && kind !== 'other';
}

/** A causa que o jogador precisa saber, entre várias tentativas que falharam. */
const KIND_PRIORITY: FailureKind[] = ['auth', 'blocked', 'quota_day', 'quota_minute', 'overloaded', 'timeout', 'model_unavailable', 'bad_request', 'invalid_json', 'network', 'other'];
export function mainFailure(kinds: FailureKind[]): FailureKind {
  return KIND_PRIORITY.find(k => kinds.includes(k)) ?? 'other';
}

/** Milissegundos até a próxima meia-noite do Pacífico (quando o RPD do Gemini zera). */
export function msUntilPacificMidnight(now = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now)
      .map(p => [p.type, p.value]),
  );
  const h = Number(parts.hour) % 24;
  const elapsed = (h * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return Math.max(60_000, 24 * 3600_000 - elapsed + 60_000);
}

// ---------------------------------------------------------------- disjuntor e memórias por processo

const OVERLOAD_COOLDOWN_MS = 45_000;
const cooldowns = new Map<string, { until: number; kind: FailureKind }>();
/** Modelos que recusaram o schema completo (400) — vão direto no simplificado. */
const needsSimpleSchema = new Set<string>();
/** Modelos que recusaram thinkingLevel. */
const noThinkingLevel = new Set<string>();

const keyTag = (apiKey: string) => createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
const coolKey = (apiKey: string, model: string) => `${keyTag(apiKey)}:${model}`;

export function coolDown(apiKey: string, model: string, kind: FailureKind, ms: number, now = Date.now()) {
  const until = now + ms;
  const prev = cooldowns.get(coolKey(apiKey, model));
  if (!prev || prev.until < until) cooldowns.set(coolKey(apiKey, model), { until, kind });
}

export function cooldownOf(apiKey: string, model: string, now = Date.now()): { until: number; kind: FailureKind } | null {
  const c = cooldowns.get(coolKey(apiKey, model));
  if (!c) return null;
  if (c.until <= now) {
    cooldowns.delete(coolKey(apiKey, model));
    return null;
  }
  return c;
}

/** A chave esgotou a cota DIÁRIA de todos os modelos (evals ao vivo pulam em vez de falhar). */
export function dailyQuotaExhausted(apiKey: string): boolean {
  const models = new Set([...modelChain('narrate'), ...modelChain('interpret')]);
  return [...models].every(m => cooldownOf(apiKey, m)?.kind === 'quota_day');
}

/** Só para testes. */
export function resetLlmMemory() {
  cooldowns.clear();
  needsSimpleSchema.clear();
  noThinkingLevel.clear();
}

/** Quanto tempo esfriar o modelo depois deste erro (0 = não esfria). */
function cooldownFor(info: ErrorInfo): number {
  switch (info.kind) {
    case 'quota_day':
      return msUntilPacificMidnight();
    case 'quota_minute':
      return info.retryAfterMs ?? 30_000;
    case 'overloaded':
    case 'timeout':
      return OVERLOAD_COOLDOWN_MS;
    case 'model_unavailable':
      return 3600_000;
    default:
      return 0;
  }
}

const MAX_PROPS = 30;

/**
 * Versão "leve" do schema para modelos com limite de complexidade: objetos com muitas
 * propriedades (os `args` das ferramentas, união de ~90 campos) viram objeto livre.
 * Nada se perde: o prompt documenta cada ferramenta e o motor valida os argumentos (zod).
 * Devolve o MESMO objeto se não houver o que simplificar.
 */
export function simplifySchema(schema: object): object {
  let changed = false;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const o = node as Record<string, unknown>;
    if (o.type === 'object' && o.properties && Object.keys(o.properties as object).length > MAX_PROPS) {
      changed = true;
      return { type: 'object', additionalProperties: true, description: 'Argumentos da ferramenta (nomes e tipos exatamente como na documentação das ferramentas no prompt).' };
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]));
  };
  const out = walk(schema) as object;
  return changed ? out : schema;
}

// ---------------------------------------------------------------- orquestração (testável)

export interface TransportCall {
  model: string;
  system: string;
  prompt: string;
  schema: object;
  temperature?: number;
  thinkingLevel?: 'LOW';
  signal: AbortSignal;
}

export type Transport = (call: TransportCall) => Promise<Omit<GenerateResult, 'attempts'>>;

const sleep = (ms: number) => new Promise(r => setTimeout(r, Math.max(0, ms)));

/**
 * Percorre a cadeia de modelos com disjuntor, timeouts por tentativa e memórias de schema/thinking.
 * `transport` faz a chamada de verdade (Gemini em produção, fakes nos testes).
 */
/** A promessa, ou a rejeição por tempo assim que o sinal abortar (o que vier primeiro). */
function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(Object.assign(new Error('timeout da tentativa'), { name: 'TimeoutError' }));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('timeout da tentativa'), { name: 'TimeoutError' }));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      v => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      e => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export async function runChain(apiKey: string, req: GenerateRequest, transport: Transport): Promise<GenerateResult> {
  const attempts: LlmAttempt[] = [];
  const kinds: FailureKind[] = [];
  let lastError: unknown;
  const purpose = req.purpose ?? 'narrate';
  const deadline = req.deadline ?? Date.now() + gmBudgetMs();
  const perAttempt = attemptTimeoutMs(purpose);
  const fast = FAST_PURPOSES.has(purpose);
  const simple = simplifySchema(req.schema);
  // GM_RETRIES: novas tentativas no MESMO modelo em sobrecarga (evals ao vivo usam; o jogo prefere trocar de modelo).
  const retries = Math.max(0, process.env.GM_RETRIES !== undefined ? Number(process.env.GM_RETRIES) || 0 : 0);

  const full = modelChain(purpose);
  const liteSkipped = NARRATIVE_PURPOSES.has(purpose) && req.allowLite !== true && full.some(isLiteModel) && full.some(m => !isLiteModel(m));
  const base = req.liteOnly ? full.filter(isLiteModel) : liteSkipped ? full.filter(m => !isLiteModel(m)) : full;
  const avoid = new Set(req.avoid ?? []);
  /** Último tipo de falha de cada modelo nesta chamada (decide a segunda volta). */
  const lastKind = new Map<string, FailureKind>();
  const fail = (message: string, kind: FailureKind) =>
    new LlmError(message, attempts, kind, liteSkipped, kinds.some(k => TRANSIENT.has(k)) || [...lastKind.values()].some(k => TRANSIENT.has(k)));
  const ordered = [...base.filter(m => !avoid.has(m)), ...base.filter(m => avoid.has(m))];
  // Modelos frios (cota/sobrecarga) são pulados sem chamada. Se TODOS estiverem frios, tenta os que
  // esquentam primeiro (menos a cota diária, que não volta hoje).
  const now = Date.now();
  let chain = ordered.filter(m => !cooldownOf(apiKey, m, now));
  // Pulados ficam registrados (com o motivo e quanto falta) — senão a cadeia parece "cair direto pro lite".
  for (const m of ordered) {
    const c = cooldownOf(apiKey, m, now);
    if (c && chain.length) attempts.push({ model: m, ok: false, latencyMs: 0, skipped: true, error: `${c.kind} pulado: esfriando por mais ${Math.ceil((c.until - now) / 1000)}s` });
  }
  if (!chain.length) {
    const cold = ordered.map(m => ({ m, c: cooldownOf(apiKey, m, now)! })).filter(x => x.c.kind !== 'quota_day');
    chain = cold.sort((a, b) => a.c.until - b.c.until).map(x => x.m);
    for (const m of ordered) {
      const c = cooldownOf(apiKey, m, now);
      if (c) kinds.push(c.kind);
    }
    if (!chain.length) {
      attempts.push({ model: '-', ok: false, latencyMs: 0, error: 'quota_day todos os modelos em cooldown (cota diária)' });
      throw fail('Cota diária esgotada em todos os modelos desta chave.', 'quota_day');
    }
  }

  // Duas voltas: sobrecarga (503) costuma passar em segundos — antes de desistir, espera um pouco
  // (com jitter) e tenta de novo SÓ os modelos que falharam por motivo transitório. Cota diária não volta hoje.
  for (let lap = 0; lap < 2; lap++) {
    if (lap === 1) {
      const retry = ordered.filter(m => TRANSIENT.has(lastKind.get(m) ?? 'other') && lastKind.get(m) !== 'timeout');
      if (!retry.length || deadline - Date.now() < 15_000) break;
      await sleep(2000 + Math.random() * 1500);
      chain = retry;
    }
    for (const model of chain) {
      for (let i = 0; i <= retries; i++) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) {
          attempts.push({ model, ok: false, latencyMs: 0, error: 'timeout orçamento de tempo esgotado' });
          throw fail((lastError as Error)?.message ?? 'Tempo esgotado.', mainFailure([...kinds, 'timeout']));
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(perAttempt, remaining));
        const started = Date.now();
        const useSimple = needsSimpleSchema.has(model);
        const useThinking = fast && !noThinkingLevel.has(model);
        try {
          // Promise.race com o sinal: um provedor que ignora o abort não segura a cadeia além do orçamento.
          const res = await untilAborted(controller.signal, transport({
            model,
            system: req.system,
            prompt: req.prompt,
            schema: useSimple ? simple : req.schema,
            temperature: req.temperature,
            thinkingLevel: useThinking ? 'LOW' : undefined,
            signal: controller.signal,
          }));
          attempts.push({ model, ok: true, latencyMs: Date.now() - started });
          return { ...res, attempts };
        } catch (err) {
          lastError = err;
          const info = classifyError(controller.signal.aborted ? Object.assign(new Error('timeout da tentativa'), { name: 'TimeoutError' }) : err);
          const message = `${(err as Error)?.message ?? err}`;
          attempts.push({ model, ok: false, latencyMs: Date.now() - started, error: `${info.kind} ${info.status ?? ''} ${message}`.replace(/\s+/g, ' ').trim().slice(0, 300) });
          if (info.kind === 'bad_request') {
            // 400: schema complexo demais (flash-lite) → simplificado; depois, thinkingLevel não suportado.
            if (!useSimple && simple !== req.schema) {
              needsSimpleSchema.add(model);
              i--;
              continue;
            }
            if (useThinking) {
              noThinkingLevel.add(model);
              i--;
              continue;
            }
            kinds.push('bad_request');
            lastKind.set(model, 'bad_request');
            break; // próximo modelo
          }
          kinds.push(info.kind);
          lastKind.set(model, info.kind);
          if (info.kind === 'auth') throw fail(message, 'auth');
          const cool = cooldownFor(info);
          if (cool) coolDown(apiKey, model, info.kind, cool);
          // Só insiste no mesmo modelo em sobrecarga/cota por minuto curta, e se houver retries configurados.
          const transient = info.kind === 'overloaded' || (info.kind === 'quota_minute' && (info.retryAfterMs ?? 0) <= 10_000);
          if (!transient || i >= retries) break;
          const wait = info.kind === 'quota_minute' ? info.retryAfterMs! : 2000 * 2 ** i + Math.random() * 1000;
          await sleep(Math.min(wait, deadline - Date.now() - MIN_ATTEMPT_MS));
        } finally {
          clearTimeout(timer);
        }
      }
    }
  }
  throw fail((lastError as Error)?.message ?? 'Nenhum modelo respondeu.', mainFailure(kinds));
}

// ---------------------------------------------------------------- validação de chave

export interface KeyCheck {
  /** true = o Google aceitou; false = recusou; null = não deu para verificar (rede). */
  valid: boolean | null;
  reason?: 'missing' | 'invalid' | 'network';
}

/**
 * Valida uma chave Gemini listando modelos (não consome a cota de geração de texto).
 * Chave inválida: o Google responde 400 ("API key not valid") ou 401/403.
 */
export async function checkApiKey(apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  if (!apiKey) return { valid: false, reason: 'missing' };
  try {
    const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { valid: true };
    if (res.status === 400 || res.status === 401 || res.status === 403) return { valid: false, reason: 'invalid' };
    return { valid: null, reason: 'network' };
  } catch {
    return { valid: null, reason: 'network' };
  }
}

// ---------------------------------------------------------------- Gemini

/** Um cliente por chave (cada jogador pode usar a sua). */
const clients = new Map<string, GoogleGenAI>();
function getClient(apiKey: string): GoogleGenAI {
  let client = clients.get(apiKey);
  if (!client) {
    if (clients.size > 50) clients.clear();
    client = new GoogleGenAI({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

/** O mínimo do SDK que o transporte usa (o GoogleGenAI real ou um falso nos testes). */
export interface GeminiLike {
  models: { generateContent(params: { model: string; contents: string; config: Record<string, unknown> }): Promise<{ text?: string; modelVersion?: string; usageMetadata?: Record<string, number | undefined>; promptFeedback?: { blockReason?: string } }> };
  caches: { create(params: { model: string; config: Record<string, unknown> }): Promise<{ name?: string; expireTime?: string }> };
}

/** Cache explícito das instruções fixas (um por processo; só age com chave paga). */
const caches = new Map<GeminiLike, ReturnType<typeof createCacheManager>>();
function cacheFor(ai: GeminiLike) {
  let m = caches.get(ai);
  if (!m) {
    m = createCacheManager({
      async create(model, system, ttlSec) {
        const c = await ai.caches.create({ model, config: { systemInstruction: system, ttl: `${ttlSec}s`, displayName: 'nightlife-system' } });
        if (!c.name) throw new Error('cache sem nome');
        return { name: c.name, expiresAt: c.expireTime ? new Date(c.expireTime).getTime() : Date.now() + ttlSec * 1000 };
      },
    });
    caches.set(ai, m);
  }
  return m;
}
/** Modelos que aceitam o cache mas não o schema junto: vão com cache e só responseMimeType JSON. */
const noSchemaWithCache = new Set<string>();

export function geminiTransport(ai: GeminiLike, apiKey: string): Transport {
  const cache = cacheFor(ai);
  return async call => {
    const send = (cached: string | null, withSchema: boolean) =>
      ai.models.generateContent({
        model: call.model,
        contents: call.prompt,
        config: {
          // Com cache, as instruções já estão nele (o Google recusa mandar de novo).
          ...(cached ? { cachedContent: cached } : { systemInstruction: call.system }),
          responseMimeType: 'application/json',
          ...(withSchema ? { responseJsonSchema: call.schema } : {}),
          ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
          ...(call.thinkingLevel ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          abortSignal: call.signal,
        },
      });
    const cached = await cache.get(apiKey, call.model, call.system);
    let response;
    if (!cached) response = await send(null, true);
    else {
      try {
        response = await send(cached, !noSchemaWithCache.has(call.model));
      } catch (err) {
        if (statusOf(err) !== 400 && statusOf(err) !== 404 && statusOf(err) !== 403) throw err;
        if (!noSchemaWithCache.has(call.model) && statusOf(err) === 400) {
          // Talvez seja o schema junto do cache: tenta só com o cache (o parser e o motor validam o JSON).
          try {
            response = await send(cached, false);
            noSchemaWithCache.add(call.model);
          } catch (err2) {
            if (statusOf(err2) !== 400 && statusOf(err2) !== 404 && statusOf(err2) !== 403) throw err2;
          }
        }
        if (!response) {
          // Cache recusado (vencido, apagado, sem suporte): esquece neste modelo e segue sem ele.
          cache.drop(apiKey, call.model, call.system, true);
          response = await send(null, true);
        }
      }
    }
    // O filtro de conteúdo do Google recusou o prompt: resposta vazia. Erro claro (não "JSON inválido").
    const blocked = response.promptFeedback?.blockReason;
    if (blocked) throw Object.assign(new Error(`blocked ${blocked}: o filtro de conteúdo do Google recusou o prompt`), { blocked });
    const u = response.usageMetadata;
    return {
      text: response.text ?? '',
      model: call.model,
      modelVersion: response.modelVersion,
      usage: { inputTokens: u?.promptTokenCount, outputTokens: u?.candidatesTokenCount, cachedTokens: u?.cachedContentTokenCount, thoughtsTokens: u?.thoughtsTokenCount },
    };
  };
}

export const geminiProvider: LlmProvider = {
  name: 'google-gemini',
  async generate(req) {
    const apiKey = getApiKey();
    if (!apiKey) {
      const msg = 'Nenhuma chave Gemini: configure a sua nas Configurações do jogo (ou no .env do servidor).';
      throw new LlmError(msg, [{ model: '-', ok: false, latencyMs: 0, error: msg }], 'auth');
    }
    return runChain(apiKey, req, geminiTransport(getClient(apiKey) as unknown as GeminiLike, apiKey));
  },
};
