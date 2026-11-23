import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ServiceError, type ServiceErrorCode } from '../../services/context';

const STATUS: Record<ServiceErrorCode, ContentfulStatusCode> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export function errorJson(c: Context, code: string, message: string, status: ContentfulStatusCode) {
  return c.json({ error: { code, message } }, status);
}

export function onError(err: Error, c: Context) {
  if (err instanceof ServiceError) return errorJson(c, err.code, err.message, STATUS[err.code]);
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    return errorJson(c, status === 403 ? 'forbidden' : 'http_error', err.message || 'Request rejected', status);
  }
  console.error(err);
  return errorJson(c, 'internal', 'Something went wrong on the server. Try again.', 500);
}

/** zValidator hook: turn Zod issues into our error shape with the first message. */
export function validationHook(
  result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } },
  c: Context,
) {
  if (!result.success) {
    const issue = result.error?.issues[0];
    const field = issue?.path.join('.');
    return errorJson(c, 'invalid', issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Invalid request', 400);
  }
}
