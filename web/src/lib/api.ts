/**
 * Same-origin fetch wrapper. Auth is carried by httpOnly cookies the page
 * cannot read; on a 401 we try one silent refresh, then report "signed out".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** A human-readable explanation from the hub, when it sent one. */
    readonly detail?: string,
    /** Which input it was about (dotted path), when the hub said. */
    readonly field?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

let refreshing: Promise<boolean> | null = null;
let onSignedOut: () => void = () => {};

export function setSignedOutHandler(fn: () => void): void {
  onSignedOut = fn;
}

export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/auth/web/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const NO_REFRESH = new Set(['/auth/web/login', '/auth/web/refresh', '/auth/web/logout', '/auth/web/register', '/auth/web/reset']);

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  // Signed-out endpoints answer 401 for a wrong password; don't refresh for those.
  if (res.status === 401 && retry && !NO_REFRESH.has(path)) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    onSignedOut();
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let detail: string | undefined;
    let field: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; message?: string; field?: string };
      if (data.error) code = data.error;
      if (typeof data.message === 'string') detail = data.message;
      if (typeof data.field === 'string') field = data.field;
    } catch {
      // non-JSON error
    }
    throw new ApiError(res.status, code, detail, field);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
