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

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
