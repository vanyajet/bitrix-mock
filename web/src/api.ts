export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // Basic-auth, введённый при открытии страницы, браузер сам отправляет на тот же origin.
    res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' }, ...init });
  } catch {
    throw new ApiError(0, 'Сервер недоступен. Проверьте соединение - на бесплатном хостинге первый запуск после простоя занимает до минуты.');
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) {
    if (res.status === 401) throw new ApiError(401, 'Нужна авторизация: обновите страницу и введите пароль от демо.');
    throw new ApiError(res.status, body?.error?.message ?? `Ошибка сервера (${res.status})`);
  }
  return body as T;
}

export function apiGet<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  return request<T>(qs.size ? `${path}?${qs}` : path);
}

export function apiPost<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'POST' });
}
