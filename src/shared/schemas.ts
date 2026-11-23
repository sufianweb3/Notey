import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** A workspace icon is a short glyph: one emoji or one or two letters. */
export const workspaceIcon = z
  .string()
  .trim()
  .max(16)
  .refine((v) => [...new Intl.Segmenter().segment(v)].length <= 2, 'Use one emoji or up to 2 letters');

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  sort: z.number(),
  aiEnabled: z.boolean(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const createWorkspaceInput = z.object({
  name: trimmed(60),
  icon: workspaceIcon.optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export const updateWorkspaceInput = z
  .object({
    name: trimmed(60).optional(),
    icon: workspaceIcon.nullable().optional(),
    aiEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInput>;

export const reorderWorkspacesInput = z.object({ ids: z.array(z.string()).min(1).max(500) });

export const deleteWorkspaceInput = z.object({ confirmName: z.string() });

export const setupInput = z.object({
  name: trimmed(80),
  email: z.email().max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(256),
  workspaceName: trimmed(60),
});
export type SetupInput = z.infer<typeof setupInput>;

export const signInInput = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type ApiError = { error: { code: string; message: string } };

// ── M1: projects, folders, pages ────────────────────────────────────────────
export const pageTypes = ['doc', 'canvas', 'mindmap', 'tasklist'] as const;
export type PageType = (typeof pageTypes)[number];

export type ProjectNode = { id: string; name: string; icon: string | null; sort: number };
export type FolderNode = { id: string; projectId: string; parentId: string | null; name: string; sort: number };
export type PageNode = {
  id: string;
  projectId: string;
  folderId: string | null;
  type: PageType;
  title: string;
  icon: string | null;
  sort: number;
  updatedAt: string;
  updatedBy: string;
};
export type Tree = { projects: ProjectNode[]; folders: FolderNode[]; pages: PageNode[] };

export type PageDetail = PageNode & {
  /** BlockNote document JSON (see shared/blocks.ts), null for a new page. */
  content: unknown[] | null;
  contentMd: string;
  rev: number;
  createdAt: string;
  createdBy: string;
};

const name60 = trimmed(80);
const icon = workspaceIcon;

export const createProjectInput = z.object({ name: name60, icon: icon.optional() });
export const updateProjectInput = z
  .object({ name: name60.optional(), icon: icon.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const createFolderInput = z.object({
  projectId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  name: name60,
});
export const renameFolderInput = z.object({ name: name60 });

export const createPageInput = z.object({
  projectId: z.string().min(1),
  folderId: z.string().min(1).nullable().optional(),
  type: z.enum(pageTypes).default('doc'),
  title: z.string().trim().max(200).default(''),
});
export const updatePageInput = z
  .object({ title: z.string().trim().max(200).optional(), icon: icon.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Block JSON is capped at 2 MB so one save can't exhaust a Worker. */
export const MAX_CONTENT_BYTES = 2_000_000;
export const saveContentInput = z.object({
  rev: z.number().int().min(0),
  content: z.array(z.looseObject({ type: z.string() })).max(20_000),
});

export const itemKinds = ['project', 'folder', 'page'] as const;
export type ItemKind = (typeof itemKinds)[number];

/**
 * Moves an item. Folders and pages take a target project and an optional
 * parent folder; projects only reorder. `index` is the position among
 * siblings of the same kind (end if omitted).
 */
export const moveInput = z.object({
  kind: z.enum(itemKinds),
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  parentId: z.string().min(1).nullable().optional(),
  index: z.number().int().min(0).optional(),
});
export type MoveInput = z.infer<typeof moveInput>;

export const itemRefInput = z.object({ kind: z.enum(itemKinds), id: z.string().min(1) });

export type TrashItem = {
  kind: ItemKind;
  id: string;
  name: string;
  deletedAt: string;
  /** Number of folders and pages that went to trash with it. */
  contains: number;
  /** Where it lived, e.g. "Website / Drafts". */
  location: string;
};

export type VersionSummary = { id: string; rev: number; title: string; author: string; reason: string; createdAt: string };
export type VersionDetail = VersionSummary & { content: unknown[] | null; contentMd: string };

export type SearchHit = {
  kind: 'page';
  id: string;
  title: string;
  /** Snippet with matches wrapped in \u0001 … \u0002. */
  snippet: string;
  projectId: string;
  updatedAt: string;
};

export type Change = { seq: number; entity: string; entityId: string; op: string; actor: string; at: string };

export type FileInfo = { id: string; name: string; mime: string; size: number; url: string };
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
