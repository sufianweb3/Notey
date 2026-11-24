# Notey PRD

> Version 1.0 · 2026-11-23 · Owner: Abu Sufian · Repo: `sufianweb3/Notey`

## 1. Summary

Notey is a **self-hosted, single-owner workspace app** for docs, notes, tasks, whiteboards and mindmaps. It's simpler than Notion, looks and feels like an Apple app and was built for working with AI from day one:

- Claude, ChatGPT or any agent can work inside **one workspace at a time** through MCP or a REST API.
- A built-in **BYOK** assistant only sees the pages you give it.
- Text pasted from any AI chat lands as clean, native blocks.

Anyone can fork the repo and run it on **Cloudflare, Vercel or their own server** with the same code.

## 2. Why

- Notion is powerful but feels complex, fragmented and messy. Databases everywhere, too many options and too much chrome.
- AI agents need a place to read and write notes and tasks, with hard walls between contexts (client A never leaks into client B).
- AI output (Markdown) usually pastes badly into note apps.
- People want to own their data and pay nothing to run it.

## 3. Users

| User | Description |
|---|---|
| **Owner** | One person per install. Uses it daily on a desktop browser, and on the phone for quick capture and tasks |
| **Agents** | External AI (Claude, ChatGPT, Claude Code, scripts) connected to one workspace with a scoped token |
| **Built-in AI** | The owner's own model via BYOK, limited to granted pages |

V1 has **no second human user** and no real-time co-editing. The data model keeps `created_by` / `updated_by` so teams can be added later.

## 4. Goals, non-goals, anti-goals

**Goals**
1. Capture something (note, task, idea) in under 3 seconds from anywhere in the app (`⌘K` or `N`).
2. One-click deploy to Cloudflare or Vercel. `docker compose up` locally. A fresh fork runs in under 10 minutes on each.
3. Hard workspace isolation for every token, API call and AI request.
4. Markdown from ChatGPT, Claude or Gemini pastes into correct native blocks.
5. Feels calm: a new user finds every core feature without a tutorial.

**Non-goals (V1)**
- Real-time multi-user collaboration, comments, sharing permissions
- Full offline mode with sync
- Notion-style databases (properties, relations, rollups, formulas)
- Templates gallery, public publishing, integrations marketplace
- Native desktop or mobile apps (the PWA covers mobile)

**Anti-goals (failure even if it "works")**
- Notey turns into Notion: settings everywhere, nested toggles, a property panel on every page.
- An AI or token can see data outside its workspace, or the built-in AI reads pages it wasn't given.
- A platform-specific fork of the code (the "Vercel version" drifts from the "Cloudflare version").
- An AI edit silently overwrites the owner's text with no preview or undo.
- Generic "AI slop" UI: gradients, glow, rainbow cards, emoji icons.

## 5. Information architecture

```
Account (single owner)
└── Workspace            sealed context; AI and tokens see one workspace only
    ├── Home             greeting, Pinned, Today, Recent
    ├── Important        everything pinned in this workspace
    ├── Tasks            Inbox, Today, Upcoming, per project; list or board
    ├── Projects
    │   └── Project
    │       ├── Folder (nestable)
    │       │   └── Page
    │       └── Page
    └── Trash            30 days
```

**Page types**

| Type | Engine | Used for |
|---|---|---|
| **Doc** | BlockNote | Docs, notes, meeting notes, specs |
| **Canvas** | Excalidraw | Whiteboard, drawing, shapes, lines, sticky notes |
| **Mindmap** | React Flow + auto-layout | Idea trees you type into |
| **Task list** | Native | A project's to-do list as its own page |

One name per concept everywhere (UI, routes, code): workspace, project, folder, page, task, pin.

## 6. Features and acceptance criteria

### 6.1 Workspaces
- Create, rename, set an icon, reorder and delete (delete needs the name typed; it goes to trash for 30 days).
- Switcher at the top of the sidebar, with `⌘1` to `⌘9` to jump.
- Each workspace has its own settings: name, icon, **AI access** (tokens, built-in AI on/off).
- **AC:** no API, MCP or AI request can read or write across workspaces. An automated test proves this for every endpoint and tool.

### 6.2 Projects, folders, pages
- The sidebar tree supports drag to reorder and move, inline rename (double-click or `F2`) and a right-click menu (rename, duplicate, move, pin, copy link, delete).
- Breadcrumb on every page: Workspace / Project / Folder / Page.
- New page via `+` on hover, `⌘N`, or `⌘K` then "New doc / canvas / mindmap / task list".
- **AC:** moving a page keeps its links. Deleting a folder sends its contents to trash together and restores them together.

### 6.3 Doc editor
- Blocks: paragraph, H1 to H3, bulleted, numbered, checklist, **task** (linked to Tasks), quote, callout, divider, code (syntax highlight), table, image, file, **chart**, **canvas embed**, **mindmap embed**, math (KaTeX), Mermaid diagram, toggle, link to page (`@` or `[[`).
- `/` menu to insert, Markdown shortcuts (`# `, `- `, `[] `, `> `, three backticks), drag handle on hover, `⌘⇧↑/↓` to move blocks.
- Selection toolbar: bold, italic, strike, code, link, highlight, text color (4 muted options), **Ask AI**.
- Title, then an optional icon. No cover images, no properties panel.
- Autosave (debounced 600 ms), with a "Saved" indicator that only appears on failure or while offline.
- **AC:** a 5,000-block doc stays responsive (typing latency under 50 ms).

### 6.4 AI-ready paste
- Pasting Markdown or AI-chat HTML is converted to native blocks: headings, lists, nested lists, checklists, tables, code fences with language, block quotes, bold/italic/inline code, links, horizontal rules, math (`$...$`, `$$...$$`), Mermaid fences.
- `⌘⇧V` pastes as plain text.
- **AC:** a fixture set of 20 real responses from ChatGPT, Claude and Gemini (`tests/fixtures/paste/`) converts with no raw Markdown symbols left in the output.

### 6.5 Tasks
- **Kinds:**
  - **Once**: a simple checkbox
  - **Repeating**: daily, weekdays, weekly on chosen days, monthly or custom (RRULE)
  - **Date-based**: a due date and optional time
- **Fields:** title, notes (short rich text), status (**To do, Doing, Done**), due date/time, repeat rule, project, pin.
- **Views:** Inbox (no project), Today (due today plus overdue), Upcoming (next 14 days by day), per project. Each view can be shown as a **list** or a **board** (To do / Doing / Done columns).
- **Quick add:** `T` anywhere, or the + bar at the top of each list. Natural language for dates: "Call Rafi tomorrow 3pm", "Review logs every day".
- Completing a repeating task logs the completion and rolls the due date to the next occurrence.
- A **task block** in a doc shows the live task (same row, two places). Plain checklist items stay local to the doc.
- **AC:** completing a task in a doc updates Tasks within one refresh cycle, and the reverse.

### 6.6 Important (pins)
- Pin any page, folder, project or task (star icon, `⌘⇧P`, or right-click).
- **Important** lists pins grouped by type, in an order you can drag. Home shows the top pins as a "Pinned" row.
- **AC:** pins are per workspace and survive moves and renames.

### 6.7 Home
- Greeting and date, **Pinned** (up to 6), **Today** tasks (complete them inline), **Recent** pages (last 8 edited, showing "Edited by Claude" when an agent made the change).
- Empty state: three starter actions (New doc, New task, Connect an AI).

### 6.8 Canvas (whiteboard)
- Excalidraw: shapes, lines, arrows, freehand drawing, text, sticky notes (a styled rectangle preset), images, frames.
- Themed with Notey tokens (off-white paper, charcoal ink, lime highlight).
- Embeddable in docs as a live preview block. Clicking it opens the full canvas.
- Export as PNG or SVG.

### 6.9 Mindmap
- A central node, `Tab` for a child, `Enter` for a sibling, `Delete` to remove, drag to re-parent, collapse branches.
- Auto layout (left-right or radial), with a minimal theme.
- Convert to and from a Markdown outline (agents create mindmaps by sending an outline).

### 6.10 Charts, tables, images
- **Table** block: rows and columns, header row, column alignment, cells that act like numbers (sorting happens in the chart, not the table).
- **Chart** block: bar, line, area or pie, from a small inline data grid or pasted CSV. Monochrome palette plus lime for highlights.
- **Image** block: upload, paste or drag, with resize handles, caption and click to zoom.

### 6.11 Search and command menu
- `⌘K` searches page titles and content, tasks and commands (new page, go to, toggle theme, switch workspace).
- Results ranked by title match, then recency. Full-text search uses SQLite FTS5.
- Search only ever covers the current workspace (a toggle can extend it to all workspaces for the owner only; AI never gets this).

### 6.12 History, trash, export
- Page versions: a snapshot on every 5 minutes of activity, before each AI or agent write and on demand. You can view and restore any version.
- Trash keeps items for 30 days with restore. Permanent delete is owner only.
- Export a page as Markdown or PDF (browser print). Export a whole workspace as a `.zip` of Markdown files plus canvas JSON. Import Markdown files and folders.

### 6.13 External AI access (API + MCP)

**Tokens**
- Created per workspace in Settings > AI access, each with a name and a scope: **Read** or **Read + Write**.
- Shown once, stored as a hash, revocable, with last-used time shown.

**MCP**
- Streamable HTTP at `/mcp`.
- **OAuth 2.1 with dynamic client registration** for Claude.ai and ChatGPT connectors. The consent screen asks the owner to choose **one workspace** and the scope, and the issued token is bound to that workspace.
- Bearer token header for Claude Code, Codex and scripts.

**MCP tools** (all limited to the token's workspace)

| Tool | Scope | Description |
|---|---|---|
| `get_workspace_tree` | read | Projects, folders, pages (ids, titles, types) |
| `search` | read | Full-text search across pages and tasks |
| `read_page` | read | Doc as Markdown; canvas as an element summary; mindmap as an outline |
| `list_tasks` | read | Filter by view, project, status or due range |
| `create_page` | write | Type and title, plus Markdown (doc) or an outline (mindmap) |
| `update_page` | write | Replace, append or replace a section by heading |
| `create_task` / `update_task` / `complete_task` | write | |
| `move_item` / `pin_item` | write | |
| `trash_item` | write | Soft delete only. Tokens can never permanently delete |

- **REST API** at `/api/v1/*` with the same operations and the same token model. An OpenAPI spec is generated from the Zod schemas.
- Every agent write: creates a version snapshot first, records the actor (`agent:<token name>`), shows "Edited by <name>" on the page and in Recent and is undoable from history.
- Rate limit: 60 requests per minute per token (configurable).

### 6.14 Built-in AI (BYOK)
- **Providers:** OpenAI, Anthropic, Google, OpenRouter and any OpenAI-compatible base URL. Keys are encrypted at rest (AES-GCM with the instance secret) and never sent to the browser.
- **Access model:** the assistant sees **only the current page plus pages you @mention** in its chat. Grants are listed at the top of the chat and can be removed. No workspace-wide search unless you turn it on for that chat.
- **Surfaces:**
  - Selection toolbar: Ask AI (improve, shorten, expand, fix grammar, change tone, translate, summarize, make table, extract tasks)
  - Side chat panel (`⌘J`)
  - `/ai` block for drafting
- **Behavior:** every edit is shown as a **preview** (diff or draft) to accept or discard. After you accept, "Undo AI edit" is one click away. Streaming has a Stop button. A failed request keeps your prompt.
- Can be turned off per workspace.

### 6.15 Settings
- Account (name, password, passkeys), Appearance (System / Light / Dark), Workspaces, AI providers, AI access (tokens and connected apps), Import/Export, About (version, update notice from GitHub releases).

### 6.16 Mobile (PWA)
- Installable, with a bottom tab bar: Home, Important, Tasks, Search, plus a + button for quick capture.
- Reading and editing docs, full task management, viewing canvases (canvas editing works but is desktop-first).

## 7. Data model (SQLite, Drizzle)

```
user, session, account, passkey          (Better Auth)
workspace      id, name, icon, sort, ai_enabled, created_at, deleted_at
project        id, workspace_id, name, icon, sort, created_at, deleted_at
folder         id, workspace_id, project_id, parent_id?, name, sort, deleted_at
page           id, workspace_id, project_id, folder_id?, type(doc|canvas|mindmap|tasklist),
               title, icon, content_json, content_md, rev, created_by, updated_by,
               created_at, updated_at, deleted_at
page_version   id, page_id, workspace_id, rev, content_json, author, reason, created_at
task           id, workspace_id, project_id?, page_id?, title, notes_md,
               status(todo|doing|done), kind(once|repeat|dated), due_date?, due_time?,
               rrule?, sort, completed_at?, created_by, updated_by, created_at, updated_at, deleted_at
task_completion id, task_id, workspace_id, occurrence_date, completed_at
pin            id, workspace_id, item_type(page|folder|project|task), item_id, sort
file           id, workspace_id, storage_key, name, mime, size, created_at
api_token      id, workspace_id, name, token_hash, scope(read|write), source(manual|oauth),
               last_used_at, created_at, revoked_at
oauth_client   id, name, redirect_uris, created_at
oauth_grant    id, client_id, workspace_id, scope, code_hash?, expires_at
ai_provider    id, kind, label, base_url?, api_key_enc, default_model
ai_chat        id, workspace_id, page_id?, title, created_at
ai_grant       id, chat_id, page_id
ai_message     id, chat_id, role, content, created_at
change_log     seq (autoincrement), workspace_id, entity, entity_id, op, actor, at
search_fts     FTS5 over page.title, page.content_md, task.title, task.notes_md
```

Rules:
- **Every** table except auth and `oauth_client` carries `workspace_id`, and every query filters by it from the request context.
- `content_md` is regenerated on every save of a doc (and outline for mindmaps). AI, search and MCP read it.
- IDs are UUIDv7 (sortable). Timestamps are ISO strings stored as UTC.

## 8. Architecture

```
Browser (React SPA, PWA)
   │  fetch /api/*  + polling /api/changes?since=seq
   ▼
Hono app (one codebase)
   ├── /api/*      app routes (session cookie)
   ├── /api/v1/*   public REST (bearer token)
   ├── /mcp        MCP server (OAuth or bearer, workspace-bound)
   ├── /oauth/*    authorize, token, register, consent screen
   └── /ai/*       BYOK proxy, streaming
        │
   services (workspace-scoped, platform-agnostic)
        │
   adapters ── db:      D1 | libSQL (Turso) | libSQL file
            ── storage: R2 | Vercel Blob | local disk
            ── env:     secrets and config
```

**Entry points**

| Target | Entry | DB | Files |
|---|---|---|---|
| Cloudflare | `src/entry/cloudflare.ts` (Worker + static assets) | D1 binding | R2 binding |
| Vercel | `api/[[...route]].ts` (Hono on Vercel Functions) + static SPA | Turso (`TURSO_URL`, `TURSO_TOKEN`) | Vercel Blob |
| Local / Docker | `src/entry/node.ts` (`@hono/node-server`) | `./data/notey.db` | `./data/files` |

**Key decisions**
- **SPA + Hono** so the same code runs everywhere. No server rendering (a private app doesn't need SEO).
- **Live refresh** by polling `change_log` (every 4 s while the tab is visible, 30 s in the background). If an agent edits a page that's open, the page updates in place when you aren't typing. If you are typing, a banner appears: "Claude edited this page. Reload / Keep mine".
- **Conflict rule:** each page has a `rev`, and a save with a stale `rev` returns 409. The client resolves it by the rule above. No CRDTs in V1.
- **Migrations** run automatically on the first request after deploy (Drizzle migrator per adapter), guarded by a lock row.
- **Secrets:** `NOTEY_SECRET` (session signing + AES key derivation). The deploy buttons generate it, and the local first run writes it to `.env`.
- **First run:** if no user exists, `/setup` creates the owner account and the first workspace. After that, signup is closed.

## 9. Security

- Session: httpOnly, Secure, SameSite=Lax cookies. CSRF token on mutating `/api/*` routes.
- Tokens: 32-byte random, prefixed `ntk_`, stored as a SHA-256 hash, compared in constant time.
- Workspace isolation is enforced in the service layer (`ctx.workspaceId` is required by every service function) and covered by tests.
- BYOK keys are encrypted with AES-GCM and never returned by any endpoint (only the last 4 characters are shown).
- The built-in AI context builder only loads pages in `ai_grant` for that chat (plus the current page). A test asserts that ungranted page content never appears in a prompt.
- Uploads: max 25 MB, MIME sniffed, SVG sanitized, served with `Content-Disposition` and CSP.
- CSP on the SPA. Excalidraw and KaTeX are self-hosted (no third-party CDNs at runtime).
- Login rate limit (5 per minute per IP) and passkey support.

## 10. Non-functional

| Area | Target |
|---|---|
| First load (cold, 4G) | Under 2.5 s to interactive. Code-split the canvas and mindmap engines |
| Navigation between pages | Under 150 ms with cached tree |
| Bundle | Main chunk under 250 KB gzip. Excalidraw and React Flow lazy-loaded |
| Accessibility | WCAG 2.2 AA, full keyboard use (see DESIGN.md) |
| Browsers | Last 2 versions of Chrome, Safari, Firefox and Edge; iOS Safari 17+ |
| Free tier fit | Runs within Cloudflare free (Workers, D1, R2) and Vercel Hobby + Turso free for one person |

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | Foundation | Repo scaffold, adapters, auth + `/setup`, workspace CRUD, migrations. **Deployed and smoke-tested on all 3 targets** |
| **M1** | Shell + docs | Sidebar (collapsible), tree, breadcrumbs, doc editor, AI paste, images, search, trash, history |
| **M2** | Tasks + Important + Home | All task kinds and views, quick add, task block, pins, Home |
| **M3** | Canvas + mindmap + charts | Excalidraw page and embed, mindmap page and outline sync, chart and table blocks |
| **M4** | API + MCP | Tokens, REST v1, OpenAPI, MCP with OAuth consent, isolation tests, "Edited by" trail |
| **M5** | Built-in AI | Providers, selection actions, chat panel with grants, preview/accept/undo |
| **M6** | Mobile + polish | PWA, bottom tabs, import/export, a11y pass, performance budget, deploy buttons and README |

## 12. Success metrics

- A fresh fork deploys on each target in under 10 minutes by following the README.
- 20 of 20 paste fixtures convert cleanly.
- 0 cross-workspace leaks across the isolation test suite.
- The owner uses Notey daily instead of Notion for 30 days (self-reported).

## 13. Calls made (change them if you disagree)

- 4 page types (Doc, Canvas, Mindmap, Task list). Sticky notes live on the canvas.
- Plain checklists stay inside the doc. Only `/task` blocks become real tasks.
- No cover images or page properties, to keep pages calm.
- Polling instead of WebSockets, for parity across all 3 hosts.
- Agents can soft-delete but never permanently delete.
- License: MIT for Notey itself (compatible with BlockNote core MPL-2.0, Excalidraw MIT, React Flow MIT). BlockNote XL packages are not used.

**M0 (2026-11-23)**
- Product name is **Notey**, matching the repo and CLAUDE.md.
- Passwords are hashed with PBKDF2-SHA256 through WebCrypto (100k iterations, the Workers maximum) instead of Better Auth's default scrypt, which runs in JS and exceeds the Workers free-plan CPU budget. Passkeys come with Settings > Account; M0 ships password sign-in only.
- CSRF: mutating `/api/*` routes accept JSON only, Hono's `csrf()` rejects cross-origin form posts, Better Auth checks `Origin` on its own routes, and cookies are SameSite=Lax. No separate CSRF token.
- Login rate limit (5 per minute per IP) uses Better Auth's database store. Each entry sets one trusted header, `x-notey-client-ip`, from its host (Cloudflare `cf-connecting-ip`, Vercel `x-real-ip`, Node the socket, or `X-Forwarded-For` when `TRUST_PROXY=1`), so clients can't spoof it.
- Sign-up is closed twice: `/api/auth/sign-up/*` returns 403, and a `user.create` hook refuses any user once one exists. `/setup` is open until the owner is created, so claim a new deploy right away.
- Workspace settings (create, rename, reorder, delete, restore) are owner-only. Agents can read only their own workspace. The last workspace can't be deleted.
- `ai_provider`, `ai_grant` and `ai_message` also carry `workspace_id`, per the §7 rule that every non-auth table does.
- Migrations: drizzle-kit writes SQL, `pnpm db:generate` bundles it into `src/server/db/migrations/index.ts`, and a small runner applies it on the first request on every host, guarded by a lock row in `__notey_lock`. (Drizzle's own D1 migrator reads from disk, which Workers can't do.)
- Local and Docker: if `NOTEY_SECRET` is unset it's generated into `$DATA_DIR/.env` (not `./.env`), so a Docker volume keeps the secret next to the database.
- Vercel: `pnpm build:vercel` writes `.vercel/output` (Build Output API) with the API pre-bundled by esbuild, instead of relying on Vercel's per-file TypeScript compile.
- M0 shell: a full sidebar from 840 px and a top bar below that. The icon rail, collapse, tree and bottom tab bar arrive in M1 and M6.

**M1 (2026-11-24)**
- Editor UI is `@blocknote/shadcn` (MPL-2.0). Its shadcn colour names are remapped to Notey tokens inside BlockNote's `.bn-root` only, because shadcn's "accent" (a hover grey) collides with our lime `accent`.
- One Markdown ↔ block converter (`src/server/md`, pure TS over `marked`) serves `content_md` on every save, AI paste on the client, and agent writes later. Page links are `[Title](notey://page/<id>)`; inline LaTeX is `$…$`; GitHub alerts (`> [!NOTE]`) become callouts.
- The 20 paste fixtures in `tests/fixtures/paste/` are written in each assistant's house style, not captured from real chats. Swap in real captures as you collect them.
- In the tree, each container lists its folders first, then its pages; drag reorders within those groups.
- Search indexes plain text derived from `content_md`, so snippets never show Markdown syntax.
- History snapshots the state *before* a save when the last snapshot is 5 or more minutes old, before any agent write, before a restore, and on demand. No pruning yet.
- Uploaded SVGs are not rewritten; every upload is served same-origin with `nosniff`, a sandboxing CSP and the type sniffed from its bytes, so scripts in an SVG can't run.
- File URLs are workspace-scoped (`/api/workspaces/:ws/files/:id`), like every other content route.
- Below 600 px the sidebar opens as a sheet from a top-bar button until M6 adds the bottom tab bar. Home shows greeting and Recent; Pinned and Today join in M2.
- Image zoom is on double-click (a single click selects the image for editing). "Download Markdown" per page ships now rather than waiting for M6 export.
- `⌘N` and `⌘1`–`⌘9` are bound, but Chrome and Edge on Windows keep Ctrl+N and Ctrl+1–9 for themselves outside an installed PWA. The command menu offers both actions.

**Deploy targets (2026-11-24)**
- **Vercel without Turso.** The owner couldn't connect Turso, so the Vercel deploy can use a Cloudflare D1 database through a small gateway Worker (`src/entry/d1-gateway.ts`, `wrangler.gateway.jsonc`, `pnpm deploy:gateway`). The Vercel entry picks Turso when `TURSO_URL` is set, otherwise the gateway (`NOTEY_DB_GATEWAY_URL`, `NOTEY_DB_GATEWAY_SECRET`). The gateway runs SQL only for requests carrying a 32-byte shared secret, checked in constant time. This is a deliberate exception to "no extra services": Cloudflare's REST API would need a user-made token and allows only 1,200 calls per 5 minutes per account, which steady typing exceeds. The full service and isolation suites run a second time through the gateway path (`gateway` Vitest project).
- **Region.** A D1 database is placed near whoever creates it. Set `NOTEY_VERCEL_REGION` (e.g. `sin1`) so the Vercel function runs next to it; across an ocean, each request was about 5 times slower.
- **Docker** is verified in GitHub Actions (`.github/workflows/ci.yml`): the image builds, runs, passes `pnpm smoke --full`, and keeps its data and `NOTEY_SECRET` across a restart. The runtime image holds only `@libsql/client` beside the bundles.
- The libSQL adapter uses `drizzle-orm/libsql/web`, which takes any client and never imports native libSQL, so serverless bundles stay portable.

## 14. Open questions

- **Fonts:** Inter and JetBrains Mono are licensed OFL-1.1, which isn't on the CLAUDE.md allowed list (MIT, MPL-2.0, Apache-2.0, ISC). M0 names them in the font stack but bundles no font files, so browsers fall back to the system UI font. Allow OFL for fonts, or pick a font under an allowed license?
- Should a workspace be exportable and importable into another install (moving a client workspace between servers)? Not in V1 unless you say so.
