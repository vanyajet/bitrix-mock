import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// src/static.ts и dist/static.js лежат на одном уровне относительно web/dist.
const WEB_DIST = fileURLToPath(new URL('../web/dist/', import.meta.url));

/** Раздаёт собранный фронт и делает SPA-fallback на index.html. */
export async function registerStatic(app: FastifyInstance): Promise<void> {
  const hasBuild = existsSync(`${WEB_DIST}index.html`);
  if (hasBuild) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      wildcard: false,
      setHeaders(res, filePath) {
        res.header('Cache-Control', filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  } else {
    app.log.warn({ dir: WEB_DIST }, 'frontend build not found, run `npm run build:web`');
  }

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url.startsWith('/mock/');
    if (req.method === 'GET' && !isApi && hasBuild) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url.split('?')[0]} not found` } });
  });
}
