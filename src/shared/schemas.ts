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
  /**
   * Doc: BlockNote document JSON (shared/blocks.ts). Canvas: CanvasContent
   * (shared/canvas.ts). Mindmap: MindmapContent (shared/mindmap.ts). Null for a new page.
   */
  content: unknown;
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
export const docContent = z.array(z.looseObject({ type: z.string() })).max(20_000);
export const canvasContent = z.object({
  kind: z.literal('canvas'),
  elements: z.array(z.looseObject({ id: z.string().min(1).max(64), type: z.string().min(1).max(32) })).max(20_000),
  files: z.record(z.string().min(1).max(64), z.object({ mimeType: z.string().max(100), url: z.string().max(300) })).default({}),
});
type MindNodeShape = { id: string; text: string; collapsed?: boolean; children: MindNodeShape[] };
const mindNodeSchema: z.ZodType<MindNodeShape> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    text: z.string().max(2_000),
    collapsed: z.boolean().optional(),
    children: z.array(mindNodeSchema).max(1_000),
  }),
);
export const mindmapContent = z.object({
  kind: z.literal('mindmap'),
  layout: z.enum(['right', 'radial']).default('right'),
  root: mindNodeSchema,
});
export const saveContentInput = z.object({
  rev: z.number().int().min(0),
  content: z.union([docContent, canvasContent, mindmapContent]),
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

/** Things that can go to Trash: tree items and tasks. */
export const trashKinds = ['project', 'folder', 'page', 'task'] as const;
export type TrashKind = (typeof trashKinds)[number];
export const itemRefInput = z.object({ kind: z.enum(trashKinds), id: z.string().min(1) });

export type TrashItem = {
  kind: TrashKind;
  id: string;
  name: string;
  deletedAt: string;
  /** Number of folders and pages that went to trash with it. */
  contains: number;
  /** Where it lived, e.g. "Website / Drafts". */
  location: string;
};

export type VersionSummary = { id: string; rev: number; title: string; author: string; reason: string; createdAt: string };
export type VersionDetail = VersionSummary & { type: PageType; content: unknown; contentMd: string };

export type SearchHit = {
  kind: 'page' | 'task';
  /** Tasks only. */
  status?: TaskStatus;
  id: string;
  title: string;
  /** Snippet with matches wrapped in \u0001 … \u0002. */
  snippet: string;
  projectId: string | null;
  updatedAt: string;
};

export type Change = { seq: number; entity: string; entityId: string; op: string; actor: string; at: string };

export type FileInfo = { id: string; name: string; mime: string; size: number; url: string };
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ── M2: tasks and pins ──────────────────────────────────────────────────────
export const taskStatuses = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export type TaskKind = 'once' | 'repeat' | 'dated';

export type Task = {
  id: string;
  projectId: string | null;
  pageId: string | null;
  title: string;
  notesMd: string;
  status: TaskStatus;
  kind: TaskKind;
  dueDate: string | null;
  dueTime: string | null;
  rrule: string | null;
  sort: number;
  completedAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const createTaskInput = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(300),
  notesMd: z.string().max(20_000).optional(),
  status: z.enum(taskStatuses).optional(),
  dueDate: calendarDate.nullable().optional(),
  dueTime: clockTime.nullable().optional(),
  rrule: z.string().max(200).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  pageId: z.string().min(1).nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const updateTaskInput = createTaskInput
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;

export const taskViews = ['inbox', 'today', 'upcoming', 'project', 'all'] as const;
export type TaskView = (typeof taskViews)[number];
export const taskListQuery = z.object({
  view: z.enum(taskViews),
  today: calendarDate,
  projectId: z.string().optional(),
  /** Board view: include recently done tasks. */
  includeDone: z.enum(['0', '1']).optional(),
});

/** The owner's local date decides what "today" and "overdue" mean. */
export const completeTaskInput = z.object({ today: calendarDate });
export const reorderInput = z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) });

export type TaskCounts = { today: number; overdue: number; inbox: number };

export const pinTypes = ['page', 'folder', 'project', 'task'] as const;
export type PinType = (typeof pinTypes)[number];
export const pinInput = z.object({ itemType: z.enum(pinTypes), itemId: z.string().min(1) });

export type PinItem = {
  id: string;
  itemType: PinType;
  itemId: string;
  sort: number;
  title: string;
  icon: string | null;
  pageType?: PageType;
  projectId?: string | null;
  /** Pages: last edit; tasks: due date. */
  updatedAt?: string;
  updatedBy?: string;
  task?: Task;
  /** Projects: how many of their tasks are done. */
  progress?: { done: number; total: number };
};

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
