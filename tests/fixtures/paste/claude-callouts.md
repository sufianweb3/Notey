Before you run the migration, read these:

> [!WARNING]
> This drops the `legacy_sessions` table. Take a backup first.

> [!TIP]
> Run it on a copy with `wrangler d1 export` and compare row counts.

> Regular quotes still work, like this one from the docs:
> "Migrations run on the first request after deploy."
