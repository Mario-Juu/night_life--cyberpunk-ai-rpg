import express, { type Request, type Response } from 'express';
import type { z } from 'zod';
import type { GameContext, GMStatus, ModelMode } from '../shared/types/gm';
import type { EngineResult } from '../shared/types/turn';
import type { GameMaster } from './gamemaster/gameMaster';
import { PROMPT_VERSION } from './gamemaster/systemPrompt';
import { InterpretBody, NarrateBody, PhoneBody, SummarizeBody } from './validation';
import { requestKey, runWithKey, sanitizeKey } from './gamemaster/requestKey';
import { checkApiKey, type KeyCheck } from './gamemaster/llmClient';

export interface AppOptions {
  gm: GameMaster;
  hasKey: () => boolean;
  defaultMode: () => ModelMode;
  /** Valida a chave do jogador junto ao Google (injetável nos testes). */
  checkKey?: (key: string | undefined) => Promise<KeyCheck>;
}

function parse<T extends z.ZodType>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const issue = result.error.issues[0];
    res.status(400).json({ error: `Requisição inválida: ${issue?.path.join('.') || 'corpo'} — ${issue?.message}` });
    return null;
  }
  return result.data;
}

const asContext = (c: unknown) => c as GameContext;

export function createApp({ gm, hasKey, defaultMode, checkKey = checkApiKey }: AppOptions) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  // Chave Gemini do próprio jogador (cabeçalho), válida só para este pedido.
  app.use('/api/gm', (req, _res, next) => runWithKey(sanitizeKey(req.header('x-gemini-key')), next));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', game: 'NIGHT//LIFE', timestamp: new Date().toISOString() });
  });

  app.get('/api/gm/status', (_req, res) => {
    const status: GMStatus = { status: 'ok', hasKey: !!requestKey() || hasKey(), defaultMode: defaultMode(), promptVersion: PROMPT_VERSION };
    res.json(status);
  });

  /** Tela de acesso: a chave que o jogador colou (cabeçalho x-gemini-key) é aceita pelo Google? */
  app.get('/api/gm/key-check', async (_req, res) => {
    res.json(await checkKey(requestKey()));
  });

  /** 1. Intenção: texto livre → ferramentas (o cliente executa no motor). */
  app.post('/api/gm/interpret', async (req, res) => {
    const body = parse(InterpretBody, req, res);
    if (!body) return;
    res.json(await gm.interpret(asContext(body.context), body.text, body.model ?? defaultMode(), body.feedback));
  });

  /** 2. Narração: resultado do motor → cena. */
  app.post('/api/gm/narrate', async (req, res) => {
    const body = parse(NarrateBody, req, res);
    if (!body) return;
    res.json(
      await gm.narrate(
        asContext(body.context),
        { kind: body.kind, playerInput: body.playerInput, engineResult: body.engineResult as EngineResult | null },
        body.model ?? defaultMode(),
      ),
    );
  });

  app.post('/api/gm/phone', async (req, res) => {
    const body = parse(PhoneBody, req, res);
    if (!body) return;
    res.json(await gm.phone(asContext(body.context), body.npcId, body.message, body.model ?? defaultMode()));
  });

  app.post('/api/gm/summarize', async (req, res) => {
    const body = parse(SummarizeBody, req, res);
    if (!body) return;
    res.json(await gm.summarize(body, body.model ?? defaultMode()));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('[server]', err);
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Estado muito grande para enviar ao Mestre.' });
      return;
    }
    res.status(500).json({ error: 'Falha interna do servidor.' });
  });

  return app;
}
