-- Empties a Notey database but keeps the schema and migration history, so the
-- next visit shows /setup again. Used after `pnpm smoke <url> --full`.
-- Cloudflare: wrangler d1 execute notey --remote --file scripts/reset-instance.sql
DELETE FROM search_fts;
DELETE FROM change_log;
DELETE FROM ai_message;
DELETE FROM ai_grant;
DELETE FROM ai_chat;
DELETE FROM ai_provider;
DELETE FROM oauth_grant;
DELETE FROM oauth_client;
DELETE FROM api_token;
DELETE FROM file;
DELETE FROM pin;
DELETE FROM task_completion;
DELETE FROM task;
DELETE FROM page_version;
DELETE FROM page;
DELETE FROM folder;
DELETE FROM project;
DELETE FROM workspace;
DELETE FROM rate_limit;
DELETE FROM verification;
DELETE FROM session;
DELETE FROM account;
DELETE FROM user;
DELETE FROM __notey_lock;
