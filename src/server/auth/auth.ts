import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { count } from 'drizzle-orm';
import { uuidv7 } from '../../shared/ids';
import { CLIENT_IP_HEADER } from '../client-ip';
import * as schema from '../db/schema';
import type { NoteyDb } from '../db/types';
import type { NoteyEnv } from '../env';
import { hashPassword, verifyPassword } from './password';

export function createAuth(db: NoteyDb, env: NoteyEnv) {
  return betterAuth({
    appName: 'Notey',
    basePath: '/api/auth',
    ...(env.PUBLIC_URL ? { baseURL: env.PUBLIC_URL } : {}),
    secret: env.NOTEY_SECRET,
    // Same-origin SPA. Without PUBLIC_URL, trust the origin the request was sent to.
    trustedOrigins: async (request) => [env.PUBLIC_URL ?? (request ? new URL(request.url).origin : undefined)],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      // D1 has no interactive transactions; keep both drivers on the same path.
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      // Set by each entry from its host's trusted source (see client-ip.ts).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // Single owner: once a user exists, no other account can ever be created.
          before: async (user) => {
            const [row] = await db.select({ n: count() }).from(schema.user);
            if ((row?.n ?? 0) > 0) return false;
            return { data: user };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
