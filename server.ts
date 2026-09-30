import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import { createApp } from './server/app';
import { createGameMaster } from './server/gamemaster/gameMaster';
import { defaultMode, geminiProvider, getApiKey } from './server/gamemaster/llmClient';
import { createMistralProvider, mistralKey, withNarrationBackup } from './server/gamemaster/mistralClient';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  const app = createApp({
    // Narração: Gemini Flash; com a reserva autorizada, Mistral (se MISTRAL_API_KEY) e por fim Flash-Lite.
    gm: createGameMaster(withNarrationBackup(geminiProvider, createMistralProvider())),
    hasKey: () => getApiKey() !== null,
    defaultMode,
    backupLabel: () => (mistralKey() ? 'Mistral Medium' : 'Flash-Lite'),
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NIGHT//LIFE] Servidor online em http://localhost:${PORT}`);
    if (!getApiKey()) console.warn('[NIGHT//LIFE] Sem chave Gemini no .env: cada jogador precisa colocar a própria nas Configurações do jogo.');
  });
}

start().catch(err => {
  console.error('Falha ao iniciar servidor:', err);
  process.exit(1);
});
