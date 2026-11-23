import { count } from 'drizzle-orm';
import type { SetupInput, Workspace } from '../../shared/schemas';
import type { Auth } from '../auth/auth';
import { acquireLock } from '../db/migrate';
import { user } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { ServiceError } from './context';
import { createWorkspace } from './workspace';

export async function needsSetup(adapter: DbAdapter): Promise<boolean> {
  const [row] = await adapter.db.select({ n: count() }).from(user);
  return (row?.n ?? 0) === 0;
}

/**
 * First run: creates the owner account and the first workspace, and signs the
 * owner in. After this, sign-up is closed for good (see the user.create hook).
 * Returns the sign-up response so the caller can forward its session cookie.
 */
export async function runSetup(
  adapter: DbAdapter,
  auth: Auth,
  input: SetupInput,
  headers: Headers,
): Promise<{ response: Response; workspace: Workspace }> {
  const release = await acquireLock(adapter, 'setup', 30_000);
  if (!release) throw new ServiceError('conflict', 'Setup is already running. Try again in a moment.');
  try {
    if (!(await needsSetup(adapter))) throw new ServiceError('conflict', 'Notey is already set up. Sign in instead.');
    const response = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      headers,
      asResponse: true,
    });
    if (!response.ok) {
      throw new ServiceError('invalid', "Couldn't create the account. Check the details and try again.");
    }
    const { user: created } = (await response.clone().json()) as { user: { id: string; name: string } };
    const workspace = await createWorkspace(
      adapter.db,
      { actor: { kind: 'user', userId: created.id, name: created.name } },
      { name: input.workspaceName },
    );
    return { response, workspace };
  } finally {
    await release();
  }
}
