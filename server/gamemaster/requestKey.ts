/**
 * Chave Gemini do JOGADOR (opcional): quem joga pode usar a própria chave, enviada pelo navegador
 * no cabeçalho `x-gemini-key`. Ela vale só para aquele pedido (AsyncLocalStorage) e nunca é
 * registrada em log. Sem ela, vale a chave do .env do servidor.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<string | undefined>();

const KEY_RE = /^[A-Za-z0-9_\-.]{20,200}$/;

export function sanitizeKey(raw: unknown): string | undefined {
  const k = typeof raw === 'string' ? raw.trim() : '';
  return KEY_RE.test(k) ? k : undefined;
}

export function runWithKey<T>(key: string | undefined, fn: () => T): T {
  return store.run(key, fn);
}

export const requestKey = (): string | undefined => store.getStore();
