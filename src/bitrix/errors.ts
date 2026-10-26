/** Ошибка Bitrix24 REST ({ error, error_description }) или транспорта. */
export class BitrixApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BitrixApiError';
  }
}

/** Коды, при которых запрос имеет смысл повторить позже. */
const RETRYABLE_CODES = new Set(['QUERY_LIMIT_EXCEEDED', 'OPERATION_TIME_LIMIT', 'INTERNAL_SERVER_ERROR', 'NETWORK_ERROR', 'TIMEOUT']);

export function isRetryableCode(code: string, status: number | null): boolean {
  return RETRYABLE_CODES.has(code) || status === 429 || (status !== null && status >= 500);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
