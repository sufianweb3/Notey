import { z } from 'zod';
import { createTaskInput, taskStatuses, taskViews } from './schemas';

/*
 * Inputs for agent operations (PRD 6.13). REST v1 and the MCP tools share
 * these, so both behave the same and the OpenAPI spec matches the tools.
 */

const id = z.string().min(1).max(64);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const agentPageTypes = ['doc', 'mindmap', 'canvas'] as const;

export const searchArgs = z.object({
  query: z.string().trim().min(1).max(200).describe('Words to find in page titles, page text and task titles'),
  limit: z.number().int().min(1).max(50).optional().describe('Most results to return (default 20)'),
});

export const readPageArgs = z.object({ pageId: id.describe('Page id from get_workspace_tree or search') });

export const createPageArgs = z.object({
  projectId: id.describe('Project to create the page in'),
  folderId: id.nullable().optional().describe('Folder inside the project (optional)'),
  type: z.enum(agentPageTypes).default('doc').describe('doc, mindmap or canvas'),
  title: z.string().trim().max(200).default(''),
  markdown: z
    .string()
    .max(500_000)
    .optional()
    .describe('Doc: Markdown body. Mindmap: an outline (# Central idea, then nested - bullets). Not used for canvas.'),
});

export const updateModes = ['replace', 'append', 'replace_section'] as const;
export const updatePageArgs = z.object({
  pageId: id,
  title: z.string().trim().max(200).optional().describe('New title'),
  markdown: z.string().max(500_000).optional().describe('Doc: Markdown. Mindmap: an outline.'),
  mode: z
    .enum(updateModes)
    .default('replace')
    .describe('replace: the whole body. append: add at the end. replace_section: replace what is under `heading` (doc) or inside the idea named `heading` (mindmap).'),
  heading: z.string().trim().max(300).optional().describe('For replace_section: the heading text (doc) or idea text (mindmap)'),
});

export const listTasksArgs = z.object({
  view: z.enum(taskViews).optional().describe('inbox, today, upcoming, project or all. Omit to filter by the fields below.'),
  projectId: id.optional().describe("A project's tasks, or 'inbox' for tasks with no project"),
  status: z.enum([...taskStatuses, 'open', 'any'] as const).default('open').describe('todo, doing, done, open (todo + doing) or any'),
  dueFrom: date.optional(),
  dueTo: date.optional(),
  today: date.optional().describe("The user's local date for today/upcoming (default: the server's UTC date)"),
  limit: z.number().int().min(1).max(500).default(100),
});

export const createTaskArgs = createTaskInput;
export const updateTaskArgs = createTaskInput.partial().extend({ taskId: id });
export const completeTaskArgs = z.object({ taskId: id, today: date.optional() });

export const moveItemArgs = z.object({
  kind: z.enum(['folder', 'page'] as const),
  id,
  projectId: id.optional().describe('Target project (default: where it is now)'),
  parentId: id.nullable().optional().describe('Target folder, or null for the top of the project'),
  index: z.number().int().min(0).optional().describe('Position among siblings (default: last)'),
});

export const pinItemArgs = z.object({
  itemType: z.enum(['page', 'folder', 'project', 'task'] as const),
  itemId: id,
  pinned: z.boolean().default(true).describe('false unpins'),
});

export const trashItemArgs = z.object({
  kind: z.enum(['project', 'folder', 'page', 'task'] as const),
  id,
});

export type AgentPage = {
  id: string;
  title: string;
  type: 'doc' | 'canvas' | 'mindmap' | 'tasklist';
  projectId: string;
  folderId: string | null;
  rev: number;
  updatedAt: string;
  updatedBy: string;
  /** Doc: Markdown. Mindmap: outline. Canvas: a description of its elements. */
  markdown: string;
};
