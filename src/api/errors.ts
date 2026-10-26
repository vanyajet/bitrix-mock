import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Единый формат ошибок API: { error: { code, message, details? } }. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const statusCode = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (statusCode >= 500) req.log.error({ err }, 'request failed');
    return reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'INTERNAL_ERROR' : ('code' in err && typeof err.code === 'string' ? err.code : 'BAD_REQUEST'),
        message: statusCode >= 500 ? 'Internal Server Error' : err.message,
      },
    });
  });
}
