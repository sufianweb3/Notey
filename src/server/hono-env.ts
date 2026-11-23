import type { Auth } from './auth/auth';
import type { DbAdapter, NoteyDb } from './db/types';
import type { NoteyEnv } from './env';
import type { Actor } from './services/context';
import type { StorageAdapter } from './storage';

export type Adapters = { db: DbAdapter; storage: StorageAdapter; env: NoteyEnv };

export type Deps = {
  adapter: DbAdapter;
  db: NoteyDb;
  storage: StorageAdapter;
  env: NoteyEnv;
  auth: Auth;
};

export type AppEnv = {
  Variables: {
    actor: Actor;
    userEmail: string;
  };
};
