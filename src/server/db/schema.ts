import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/*
 * Notey schema. Conventions (PRD §7):
 * - ids are UUIDv7 strings, timestamps are ISO-8601 UTC strings
 * - every table except the auth tables and oauth_client carries workspace_id
 * - soft delete via deleted_at; trash is purged after 30 days
 */

// ── Better Auth (property names must match Better Auth's field names) ───────
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
});

// ── Workspace content ───────────────────────────────────────────────────────
const ws = () =>
  text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' });

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  sort: integer('sort').notNull().default(0),
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const project = sqliteTable(
  'project',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    name: text('name').notNull(),
    icon: text('icon'),
    sort: integer('sort').notNull().default(0),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('project_ws_idx').on(t.workspaceId)],
);

export const folder = sqliteTable(
  'folder',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('folder_ws_idx').on(t.workspaceId, t.projectId)],
);

export const page = sqliteTable(
  'page',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    folderId: text('folder_id'),
    sort: integer('sort').notNull().default(0),
    type: text('type', { enum: ['doc', 'canvas', 'mindmap', 'tasklist'] }).notNull(),
    title: text('title').notNull().default(''),
    icon: text('icon'),
    contentJson: text('content_json'),
    contentMd: text('content_md').notNull().default(''),
    rev: integer('rev').notNull().default(0),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('page_ws_idx').on(t.workspaceId, t.projectId),
    index('page_updated_idx').on(t.workspaceId, t.updatedAt),
  ],
);

export const pageVersion = sqliteTable(
  'page_version',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'cascade' }),
    workspaceId: ws(),
    rev: integer('rev').notNull(),
    title: text('title').notNull().default(''),
    contentJson: text('content_json'),
    author: text('author').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('page_version_page_idx').on(t.workspaceId, t.pageId)],
);

export const task = sqliteTable(
  'task',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    projectId: text('project_id'),
    pageId: text('page_id'),
    title: text('title').notNull(),
    notesMd: text('notes_md').notNull().default(''),
    status: text('status', { enum: ['todo', 'doing', 'done'] }).notNull().default('todo'),
    kind: text('kind', { enum: ['once', 'repeat', 'dated'] }).notNull().default('once'),
    dueDate: text('due_date'),
    dueTime: text('due_time'),
    rrule: text('rrule'),
    sort: integer('sort').notNull().default(0),
    completedAt: text('completed_at'),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('task_ws_idx').on(t.workspaceId, t.status, t.dueDate)],
);

export const taskCompletion = sqliteTable(
  'task_completion',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    workspaceId: ws(),
    occurrenceDate: text('occurrence_date').notNull(),
    completedAt: text('completed_at').notNull(),
  },
  (t) => [index('task_completion_task_idx').on(t.workspaceId, t.taskId)],
);

export const pin = sqliteTable(
  'pin',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    itemType: text('item_type', { enum: ['page', 'folder', 'project', 'task'] }).notNull(),
    itemId: text('item_id').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('pin_item_uq').on(t.workspaceId, t.itemType, t.itemId)],
);

export const file = sqliteTable(
  'file',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    storageKey: text('storage_key').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('file_ws_idx').on(t.workspaceId)],
);

export const apiToken = sqliteTable(
  'api_token',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scope: text('scope', { enum: ['read', 'write'] }).notNull(),
    source: text('source', { enum: ['manual', 'oauth'] }).notNull().default('manual'),
    lastUsedAt: text('last_used_at'),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
    /** Rate limit (PRD 6.13): requests counted per one-minute window. */
    rateWindow: integer('rate_window').notNull().default(0),
    rateCount: integer('rate_count').notNull().default(0),
    /** OAuth tokens: the app that holds it. */
    clientId: text('client_id'),
  },
  (t) => [index('api_token_ws_idx').on(t.workspaceId)],
);

export const oauthClient = sqliteTable('oauth_client', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').notNull(),
  createdAt: text('created_at').notNull(),
});

export const oauthGrant = sqliteTable('oauth_grant', {
  id: text('id').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClient.id, { onDelete: 'cascade' }),
  workspaceId: ws(),
  scope: text('scope', { enum: ['read', 'write'] }).notNull(),
  codeHash: text('code_hash'),
  expiresAt: text('expires_at').notNull(),
  /** The authorization request this code answers (OAuth 2.1 + PKCE). */
  redirectUri: text('redirect_uri').notNull().default(''),
  codeChallenge: text('code_challenge').notNull().default(''),
});

/*
 * ai_provider is per workspace so a provider configured for client A is never
 * usable from client B (PRD §7 rule: every table carries workspace_id).
 */
export const aiProvider = sqliteTable('ai_provider', {
  id: text('id').primaryKey(),
  workspaceId: ws(),
  kind: text('kind', { enum: ['openai', 'anthropic', 'google', 'openrouter', 'openai-compatible'] }).notNull(),
  label: text('label').notNull(),
  baseUrl: text('base_url'),
  apiKeyEnc: text('api_key_enc').notNull(),
  defaultModel: text('default_model'),
});

export const aiChat = sqliteTable('ai_chat', {
  id: text('id').primaryKey(),
  workspaceId: ws(),
  pageId: text('page_id'),
  title: text('title').notNull().default(''),
  createdAt: text('created_at').notNull(),
});

export const aiGrant = sqliteTable(
  'ai_grant',
  {
    id: text('id').primaryKey(),
    workspaceId: ws(),
    chatId: text('chat_id')
      .notNull()
      .references(() => aiChat.id, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
  },
  (t) => [uniqueIndex('ai_grant_uq').on(t.chatId, t.pageId)],
);

export const aiMessage = sqliteTable('ai_message', {
  id: text('id').primaryKey(),
  workspaceId: ws(),
  chatId: text('chat_id')
    .notNull()
    .references(() => aiChat.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const changeLog = sqliteTable(
  'change_log',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    workspaceId: text('workspace_id').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    op: text('op', { enum: ['create', 'update', 'delete', 'restore', 'move'] }).notNull(),
    actor: text('actor').notNull(),
    at: text('at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [index('change_log_ws_seq_idx').on(t.workspaceId, t.seq)],
);
