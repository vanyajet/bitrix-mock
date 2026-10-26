import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';

export type Logger = FastifyBaseLogger;

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
  });
}
