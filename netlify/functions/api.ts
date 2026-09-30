/**
 * Netlify: o mesmo servidor Express do jogo (server/app.ts) rodando como Function.
 * O front (dist/) é servido pela CDN da Netlify; /api/* é redirecionado para cá (netlify.toml).
 *
 * A Netlify corta uma Function em 60 s: o orçamento do Mestre fica em 52 s (no servidor próprio
 * são 110 s). Chaves: GEMINI_API_KEY nas variáveis de ambiente do site (opcional) — ou cada
 * jogador coloca a própria nas Configurações do jogo.
 */
import express from 'express';
import serverless from 'serverless-http';
import { createApp } from '../../server/app';
import { createGameMaster } from '../../server/gamemaster/gameMaster';
import { defaultMode, geminiProvider, getApiKey } from '../../server/gamemaster/llmClient';

process.env.GM_BUDGET_MS ??= '52000';

const app = createApp({ gm: createGameMaster(geminiProvider), hasKey: () => getApiKey() !== null, defaultMode });

// Pelo redirect, o caminho pode chegar como /.netlify/functions/api/gm/... — o app espera /api/gm/...
const PREFIX = '/.netlify/functions/api';
const outer = express();
outer.use((req, _res, next) => {
  if (req.url.startsWith(PREFIX)) req.url = `/api${req.url.slice(PREFIX.length)}`;
  next();
});
outer.use(app);

export const handler = serverless(outer);
