// Starts the built Node server on a fresh temp data dir for Playwright.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] ?? '3100';
const dataDir = mkdtempSync(join(tmpdir(), 'notey-e2e-'));
const child = spawn(process.execPath, ['dist/server/node.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: port, DATA_DIR: dataDir, PUBLIC_URL: `http://localhost:${port}` },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
