/**
 * Netlify: o mesmo servidor Express do jogo (server/app.ts) rodando como Function.
 * O front (dist/) é servido pela CDN da Netlify; /api/* é redirecionado para cá (netlify.toml).
 *
 * TEMPO: a Netlify DERRUBA a Function no limite do plano (60 s hoje; contas antigas têm 26 s ou 10 s)
 * e o navegador recebe um 502 seco. Por isso o orçamento do Mestre não é fixo: a cada chamada
 * perguntamos quanto tempo resta (context.getRemainingTimeInMillis) e deixamos uma folga, para o
 * servidor SEMPRE responder — com a narração ou com o aviso de reserva — antes do corte.
 * Chaves: GEMINI_API_KEY nas variáveis do site (opcional) — ou cada jogador usa a própria.
 */
import express from 'express';
import serverless from 'serverless-http';
import { createApp } from '../../server/app';
import { createGameMaster } from '../../server/gamemaster/gameMaster';
import { defaultMode, geminiProvider, getApiKey } from '../../server/gamemaster/llmClient';

/** Folga entre o fim do orçamento do Mestre e o corte da Netlify (resposta + rede). */
const SAFETY_MS = 6_000;
/** Sem a informação do ambiente: assume o limite atual de 60 s. */
const FALLBACK_BUDGET_MS = 52_000;
/** GM_BUDGET_MS fixo nas variáveis do site vence o cálculo automático. */
const fixedBudget = process.env.GM_BUDGET_MS;

const app = createApp({
  gm: createGameMaster(geminiProvider),
  hasKey: () => getApiKey() !== null,
  defaultMode,
});

// Pelo redirect, o caminho pode chegar como /.netlify/functions/api/gm/... — o app espera /api/gm/...
const PREFIX = '/.netlify/functions/api';
const outer = express();
outer.use((req, _res, next) => {
  if (req.url.startsWith(PREFIX)) req.url = `/api${req.url.slice(PREFIX.length)}`;
  next();
});
outer.use(app);

const inner = serverless(outer);
let logged = false;

type LambdaContext = { getRemainingTimeInMillis?: () => number };

export const handler = async (event: unknown, context: LambdaContext) => {
  const remaining = typeof context?.getRemainingTimeInMillis === 'function' ? context.getRemainingTimeInMillis() : undefined;
  if (!fixedBudget) {
    // Cada container da Function atende um pedido por vez: ajustar o orçamento aqui vale só para este pedido.
    process.env.GM_BUDGET_MS = String(remaining ? Math.max(8_000, remaining - SAFETY_MS) : FALLBACK_BUDGET_MS);
  }
  if (!logged) {
    logged = true;
    console.log(`[NIGHT//LIFE] Netlify: ${remaining ? `${Math.round(remaining / 1000)} s disponíveis por chamada` : 'tempo por chamada desconhecido'}; orçamento do Mestre ${Math.round(Number(process.env.GM_BUDGET_MS) / 1000)} s.`);
  }
  return inner(event as never, context as never);
};
