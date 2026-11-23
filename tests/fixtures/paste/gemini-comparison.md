## SQLite vs Postgres for a single-user app

| Feature | SQLite | Postgres |
| --- | --- | --- |
| Setup | None, it's a file | Server process |
| Concurrency | One writer at a time | Many writers |
| Full-text search | FTS5 | `tsvector` |
| Hosting cost | Free tier everywhere | Usually paid |

**In short:** for one person, **SQLite** is simpler and fast enough. Pick Postgres when you expect *many* concurrent writers.
