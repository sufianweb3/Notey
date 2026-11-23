export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra fields from the server, e.g. the current rev on a 409. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const NETWORK_MESSAGE = "Couldn't reach Notey. Check your connection and try again.";

/** JSON fetch against the same-origin API. Throws ApiError with a user-facing message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network', NETWORK_MESSAGE);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> }; message?: string; code?: string } | null) ?? {};
    const message = err.error?.message ?? err.message ?? `Request failed (${res.status}). Try again.`;
    throw new ApiError(res.status, err.error?.code ?? err.code ?? 'http_error', message, err.error?.details);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Try again.';
}
