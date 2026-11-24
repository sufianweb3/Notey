/** Config passed into createApp by each entry. Never read process.env in src/server. */
export interface NoteyEnv {
  NOTEY_SECRET: string;
  PUBLIC_URL?: string;
  /** Requests per minute per API/MCP token (default 60). */
  NOTEY_TOKEN_RATE_LIMIT?: string;
}

export function assertEnv(env: Partial<NoteyEnv>): asserts env is NoteyEnv {
  if (!env.NOTEY_SECRET || env.NOTEY_SECRET.length < 32) {
    throw new Error('NOTEY_SECRET is missing or shorter than 32 characters');
  }
}
