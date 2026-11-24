import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: { name: 'libsql', include: ['tests/{unit,services,isolation}/**/*.test.ts'] },
      },
      {
        // The Vercel path: Drizzle sqlite-proxy → HTTP gateway protocol → D1.
        extends: true,
        test: {
          name: 'gateway',
          include: ['tests/{services,isolation}/**/*.test.ts', 'tests/unit/gateway.test.ts'],
          exclude: ['tests/services/migrate.test.ts'],
          env: { NOTEY_TEST_DB: 'gateway' },
        },
      },
    ],
  },
});
