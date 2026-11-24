# CLAUDE.md · Notey

Notey is a self-hosted, single-owner workspace app (docs, tasks, canvas, mindmap) with MCP/API access and BYOK AI. One codebase deploys to **Cloudflare, Vercel and Node/Docker**.

**Read before any work:** `PRD.md` (what and why) and `DESIGN.md` (how it looks). If they conflict with this file, ask.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), ESM only |
| Package manager | pnpm |
| Frontend | React 19, Vite, TanStack Router, TanStack Query, Tailwind v4, Radix primitives, Motion, Lucide, Sonner |
| Editor | BlockNote core + `@blocknote/react` (MPL-2.0). **Do not install any `@blocknote/xl-*` package** (GPL) |
| Canvas | Excalidraw (lazy-loaded) |
| Mindmap | React Flow + elkjs or d3-hierarchy layout (lazy-loaded) |
| Charts | Recharts |
| API | Hono, Zod, `@hono/zod-openapi` |
| DB | Drizzle ORM, SQLite dialect: D1 / libSQL (Turso) / libSQL file |
| Auth | Better Auth (single owner, password + passkey) |
| AI | Vercel AI SDK (`ai`), providers: openai, anthropic, google, openai-compatible |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP transport |
| Tests | Vitest (unit + service), Playwright (e2e smoke) |
| PWA | vite-plugin-pwa |

## Repo layout

```
src/
  web/                 React SPA
    routes/            TanStack Router file routes
    components/        ui/ (primitives), shell/, editor/, tasks/, canvas/, mindmap/, ai/
    lib/               api client, query keys, shortcuts, polling
    styles/            tokens.css (generated from DESIGN.md), globals.css
  server/
    app.ts             Hono app factory: createApp(adapters) -> Hono
    routes/            api/, v1/, mcp/, oauth/, ai/
    services/          workspace, project, folder, page, task, pin, search, file, token, ai
    db/                schema.ts, migrations/, client types
    md/                block JSON <-> Markdown, outline <-> mindmap
    auth/              Better Auth config, ctx middleware
  adapters/
    db/                d1.ts, libsql.ts, d1-gateway.ts (Vercel → D1 via the gateway Worker)
    storage/           r2.ts, vercel-blob.ts, disk.ts
  entry/
    cloudflare.ts      Worker entry (assets + app)
    node.ts            @hono/node-server entry
    d1-gateway.ts      Worker that gives the Vercel deploy a D1 database
  shared/              zod schemas, types shared by web and server
api/[[...route]].ts    Vercel Functions entry
tests/                 unit/, services/, isolation/, e2e/, fixtures/paste/
wrangler.jsonc  vercel.json  Dockerfile  docker-compose.yml
```

## Commands

```bash
pnpm dev               # Vite + node server, local SQLite in ./data
pnpm build             # web + server bundles for all targets
pnpm test              # vitest
pnpm test:e2e          # playwright smoke
pnpm db:generate       # drizzle-kit generate migrations
pnpm lint && pnpm typecheck
pnpm deploy:cf         # build SPA + wrangler deploy
pnpm deploy:gateway    # D1 gateway Worker for Vercel (wrangler.gateway.jsonc)
pnpm build:vercel      # writes .vercel/output (Vercel runs this as its build command)
pnpm smoke <url>       # smoke test a deploy; --full also claims a fresh instance (then reset it)
pnpm start             # run the built Node server (dist/server/node.mjs)
pnpm design:lint       # npx @google/design.md lint DESIGN.md
pnpm design:tokens     # export DESIGN.md tokens -> src/web/styles/tokens.css
```

## Hard rules

1. **Portability.** Code in `src/server/**` and `src/shared/**` must run on Workers, Vercel and Node. Use Web APIs only (`fetch`, `crypto.subtle`, `Request`/`Response`, streams). No `fs`, `path`, `process.env` reads, `Buffer` or Node-only packages outside `src/adapters/**` and `src/entry/node.ts`. Config comes from the `env` object passed into `createApp`.
2. **Workspace isolation.** Every service function takes `ctx: { workspaceId, actor }` and every query filters by `workspace_id`. Never accept a workspace id from a request body when a token is bound to one. Add an isolation test for every new endpoint and MCP tool in `tests/isolation/`.
3. **AI scope.** The built-in AI context builder may only load the current page plus pages in `ai_grant` for that chat. Never pass workspace-wide content without the chat-level opt-in. Keep the test that asserts ungranted content never reaches a prompt.
4. **Machine edits.** Every agent or AI write snapshots a `page_version` first, sets `updated_by`, writes `change_log` and is undoable. Agents can't permanently delete.
5. **Secrets.** BYOK keys are encrypted with AES-GCM (key derived from `NOTEY_SECRET`) and never returned by any endpoint. Tokens are stored as SHA-256 hashes only.
6. **Markdown is a first-class format.** Keep `page.content_md` in sync on every save. The paste fixtures in `tests/fixtures/paste/` must all pass.
7. **No platform forks.** No `if (vercel)` branches in features. Differences live in adapters and entry files only.
8. **Licenses.** MIT, MPL-2.0, Apache-2.0 and ISC dependencies only. Check before adding a package. No tldraw (needs a production license key).
9. **Bundle budget.** Main chunk under 250 KB gzip. Excalidraw, React Flow, KaTeX, Mermaid and Recharts are lazy-loaded.

## UI work

- Read `DESIGN.md` first. Its tokens override skill defaults. Tokens only, no raw hex or px in components.
- Use the **ui-ux-craft** skill (`.claude/skills/ui-ux-craft/`, from `sufianweb3/ui-ux-craft`) for any UI, copy or state work.
- Use **Emil Kowalski's skills** (`emilkowalski/skills`): `apple-design` and `animate` for motion and gestures, `emil-design-eng` for component polish, `break-ui` for worst-case data and `review-animations` before closing a UI milestone.
- Every component ships all interaction states. Every data view ships ideal, empty, loading, partial and error states with realistic fixtures in `src/web/fixtures/`.
- Lime (`accent`) is a fill for signals only, never text on light surfaces.

Install the skills once:
```bash
mkdir -p .claude/skills
git clone --depth 1 https://github.com/sufianweb3/ui-ux-craft .claude/skills/ui-ux-craft
git clone --depth 1 https://github.com/emilkowalski/skills /tmp/emil && cp -r /tmp/emil/skills/* .claude/skills/
```

## How to work

- Build milestone by milestone (PRD §11). M0 ends with a deploy on **all three targets**. Don't start M1 until that works.
- Keep it lean: no extra services, queues, Redis, WebSockets or microservices. Polling + SQLite is the design.
- Write tests where bugs would hurt: isolation, AI scope, Markdown conversion, task recurrence, migrations. Skip snapshot tests for UI.
- Small commits with clear messages. Update `PRD.md` / `DESIGN.md` in the same commit when a decision changes.
- When something in PRD.md is ambiguous, make the smallest reasonable call, note it under "Calls made" in PRD.md and continue.

## Definition of done (per feature)

- Typecheck, lint and tests pass. Isolation tests are added if the feature touches data.
- Works in light and dark, keyboard only, at 375 px and 1440 px.
- Empty, loading and error states exist.
- No console errors. Bundle budget holds (`pnpm build` prints chunk sizes).

## Environment

| Var | Where | Notes |
|---|---|---|
| `NOTEY_SECRET` | all | 32+ random bytes, base64. Generated by deploy buttons or the first local run |
| `TURSO_URL`, `TURSO_TOKEN` | Vercel | libSQL database (option 1) |
| `NOTEY_DB_GATEWAY_URL`, `NOTEY_DB_GATEWAY_SECRET` | Vercel | D1 through the gateway Worker (option 2, used when `TURSO_URL` is unset) |
| `NOTEY_VERCEL_REGION` | Vercel (build) | Optional function region, e.g. `sin1`; put it next to the database |
| `GATEWAY_SECRET` | Gateway Worker | Same value as `NOTEY_DB_GATEWAY_SECRET` |
| `BLOB_READ_WRITE_TOKEN` | Vercel | Vercel Blob |
| `DB` (binding), `FILES` (binding) | Cloudflare | D1 and R2 in `wrangler.jsonc` |
| `DATA_DIR` | Node | defaults to `./data` |
| `PUBLIC_URL` | all | used for OAuth redirects and MCP metadata |
| `NOTEY_TOKEN_RATE_LIMIT` | all (optional) | requests per minute per API/MCP token, default 60 |
