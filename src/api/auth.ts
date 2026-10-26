import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const PUBLIC_PATHS = new Set(['/api/health']);
const PUBLIC_PREFIXES = ['/mock/'];

export function isPublicPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? '';
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Токен из `Authorization: Bearer`, `X-Dashboard-Token` или Basic auth (логин любой, пароль = токен). */
export function extractToken(req: Pick<FastifyRequest, 'headers'>): string | undefined {
  const header = req.headers['x-dashboard-token'];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers.authorization;
  if (!auth) return undefined;
  const [scheme, value] = auth.split(' ', 2);
  if (!value) return undefined;
  if (scheme?.toLowerCase() === 'bearer') return value;
  if (scheme?.toLowerCase() === 'basic') {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx >= 0 ? decoded.slice(idx + 1) : undefined;
  }
  return undefined;
}

/**
 * Закрывает всё приложение (статику и /api), кроме health и mock-эндпоинтов.
 * На 401 отдаём WWW-Authenticate: Basic, чтобы браузер показал окно логина при открытии ссылки.
 */
export function registerDashboardAuth(app: FastifyInstance, token: string): void {
  app.addHook('onRequest', async (req, reply) => {
    if (isPublicPath(req.url)) return;
    const provided = extractToken(req);
    if (provided && safeEqual(provided, token)) return;
    reply.header('WWW-Authenticate', 'Basic realm="CRM Analytics Demo", charset="UTF-8"');
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Dashboard token required' } });
  });
}
