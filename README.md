# Notey

A self-hosted, single-owner workspace for docs, tasks, whiteboards and mindmaps, built to work with AI. One codebase runs on Cloudflare, Vercel or your own server.

> Status: milestone M0 (foundation). Owner setup, sign-in and workspaces work on all three targets. Docs, tasks and the rest follow; see [PRD.md](PRD.md) §11.

## Run locally

```bash
pnpm install
pnpm dev            # http://localhost:5173, data in ./data
```

Open the app and create the owner account at `/setup`.

## Docker

```bash
docker compose up --build    # http://localhost:3000, data in the notey-data volume
```

`NOTEY_SECRET` is generated into the volume on first run. Behind a reverse proxy, set `PUBLIC_URL` and `TRUST_PROXY=1`.

## Cloudflare (Workers + D1 + R2)

```bash
pnpm wrangler login
pnpm deploy:cf                                   # creates the D1 database and R2 bucket on first deploy
openssl rand -base64 32 | pnpm wrangler secret put NOTEY_SECRET
```

## Vercel (Functions + Blob, database on Turso or Cloudflare D1)

1. `vercel link`, then add a private Blob store to the project.
2. Pick a database:
   - **Turso:** add it from the Vercel Marketplace (it sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`).
   - **Cloudflare D1:** run `pnpm deploy:gateway`. Generate one secret and set it twice: `pnpm wrangler secret put GATEWAY_SECRET -c wrangler.gateway.jsonc`, and `NOTEY_DB_GATEWAY_SECRET` on Vercel. Also set `NOTEY_DB_GATEWAY_URL` (the Worker's URL) and `NOTEY_VERCEL_REGION` to the Vercel region nearest the database (`pnpm wrangler d1 info notey-vercel` shows its region).
3. Set `NOTEY_SECRET` (32+ random bytes, base64) in the project's environment variables.
4. `vercel deploy --prod`. Vercel runs `pnpm build:vercel`.

After any deploy, visit the URL straight away and claim it at `/setup`, then run `pnpm smoke <url>` to check it.

## Develop

`pnpm test` · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck` · `pnpm build`. Read [CLAUDE.md](CLAUDE.md), [PRD.md](PRD.md) and [DESIGN.md](DESIGN.md) first.

MIT licensed.
