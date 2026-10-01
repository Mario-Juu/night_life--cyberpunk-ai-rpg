import express, { type Request, type Response } from 'express';
import type { z } from 'zod';
import type { GameContext, GMStatus, ModelMode, NpcProfileRequest, WorldgenRequest } from '../shared/types/gm';
import type { EngineResult } from '../shared/types/turn';
import type { GameMaster } from './gamemaster/gameMaster';
import { PROMPT_VERSION } from './gamemaster/systemPrompt';
import { InterpretBody, NarrateBody, PhoneBody, ProfileBody, SummarizeBody, WorldgenBody } from './validation';
import { requestKey, runWithKey, sanitizeKey } from './gamemaster/requestKey';
import { checkApiKey, type KeyCheck } from './gamemaster/llmClient';

export interface AppOptions {
  gm: GameMaster;
  hasKey: () => boolean;
  defaultMode: () => ModelMode;
  /** Nome da reserva da narração, para o jogador saber o que está autorizando. */
  backupLabel?: () => string;
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

/**
 * Express 4 não encaminha rejeição de handler async: sem isto, uma exceção no caminho de ERRO
 * (ex.: o fallback também falhar) deixa a requisição pendurada e derruba o processo (unhandledRejection).
 */
const route = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: express.NextFunction) => {
  fn(req, res).catch(next);
};

export function createApp({ gm, hasKey, defaultMode, checkKey = checkApiKey, backupLabel = () => 'Flash-Lite' }: AppOptions) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  // Chave Gemini do próprio jogador (cabeçalho), válida só para este pedido.
  app.use('/api/gm', (req, res, next) => {
    const raw = req.header('x-gemini-key');
    const key = sanitizeKey(raw);
    // Chave mandada mas malformada: recusar. Descartar em silêncio faria o pedido correr na chave do
    // SERVIDOR (cota e custo do host) enquanto o jogador acha que usa a dele.
    if (raw !== undefined && raw.trim() !== '' && !key) {
      res.status(400).json({ error: 'Chave Gemini inválida no cabeçalho: sem espaços, 20 a 200 caracteres. Confira a chave nas Configurações.' });
      return;
    }
    runWithKey(key, next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', game: 'NIGHT//LIFE', timestamp: new Date().toISOString() });
  });

  app.get('/api/gm/status', (_req, res) => {
    const status: GMStatus = { status: 'ok', hasKey: !!requestKey() || hasKey(), defaultMode: defaultMode(), promptVersion: PROMPT_VERSION, backup: backupLabel() };
    res.json(status);
  });

  /** Tela de acesso: a chave que o jogador colou (cabeçalho x-gemini-key) é aceita pelo Google? */
  app.get('/api/gm/key-check', route(async (_req, res) => {
    res.json(await checkKey(requestKey()));
  }));

  /** 1. Intenção: texto livre → ferramentas (o cliente executa no motor). */
  app.post('/api/gm/interpret', route(async (req, res) => {
    const body = parse(InterpretBody, req, res);
    if (!body) return;
    res.json(await gm.interpret(asContext(body.context), body.text, body.model ?? defaultMode(), body.feedback));
  }));

  /** 2. Narração: resultado do motor → cena. */
  app.post('/api/gm/narrate', route(async (req, res) => {
    const body = parse(NarrateBody, req, res);
    if (!body) return;
    res.json(
      await gm.narrate(
        asContext(body.context),
        { kind: body.kind, playerInput: body.playerInput, engineResult: body.engineResult as EngineResult | null, allowLite: body.allowLite },
        body.model ?? defaultMode(),
      ),
    );
  }));

  app.post('/api/gm/phone', route(async (req, res) => {
    const body = parse(PhoneBody, req, res);
    if (!body) return;
    res.json(await gm.phone(asContext(body.context), body.npcId, body.message, body.model ?? defaultMode()));
  }));

  app.post('/api/gm/summarize', route(async (req, res) => {
    const body = parse(SummarizeBody, req, res);
    if (!body) return;
    res.json(await gm.summarize(body, body.model ?? defaultMode()));
  }));

  /** Perfil de NPC que ganhou importância (fora do turno). */
  app.post('/api/gm/profile', route(async (req, res) => {
    const body = parse(ProfileBody, req, res);
    if (!body) return;
    res.json(await gm.profile(body as unknown as NpcProfileRequest));
  }));

  /** Costura das frentes do mundo (uma vez por campanha, fora do turno). */
  app.post('/api/gm/worldgen', route(async (req, res) => {
    const body = parse(WorldgenBody, req, res);
    if (!body) return;
    res.json(await gm.worldgen(body as unknown as WorldgenRequest));
  }));

  // Rota existe, método não: 405 com Allow (e OPTIONS responde o que a rota aceita).
  const ROUTES: Record<string, string> = {
    '/api/health': 'GET', '/api/gm/status': 'GET', '/api/gm/key-check': 'GET',
    '/api/gm/interpret': 'POST', '/api/gm/narrate': 'POST', '/api/gm/phone': 'POST',
    '/api/gm/summarize': 'POST', '/api/gm/profile': 'POST', '/api/gm/worldgen': 'POST',
  };
  app.use('/api', (req, res) => {
    const allow = ROUTES[req.originalUrl.split('?')[0].replace(/\/+$/, '')];
    if (allow) {
      res.setHeader('Allow', `${allow}, OPTIONS`);
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      res.status(405).json({ error: `Método ${req.method} não é aceito aqui (use ${allow}).` });
      return;
    }
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('[server]', err);
    if (res.headersSent) return;
    const e = err as { type?: string; status?: number; statusCode?: number };
    if (e.type === 'entity.too.large') {
      res.status(413).json({ error: 'Estado muito grande para enviar ao Mestre.' });
      return;
    }
    // Corpo malformado (JSON inválido, charset/encoding estranho) é erro do CLIENTE, não do servidor.
    const status = e.status ?? e.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: 'Requisição inválida: corpo não pôde ser lido.' });
      return;
    }
    res.status(500).json({ error: 'Falha interna do servidor.' });
  });

  return app;
}
