import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateWorkspaceInput, SessionUser, UpdateWorkspaceInput, Workspace } from '@shared/schemas';
import { api } from './api';
import { fixtureOverride } from '../fixtures/workspaces';

export const keys = {
  setup: ['setup'] as const,
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  trash: ['workspaces', 'trash'] as const,
};

export const setupQuery = queryOptions({
  queryKey: keys.setup,
  queryFn: () => api<{ needsSetup: boolean }>('/api/setup'),
  staleTime: Infinity,
});

/** The signed-in owner, or null when there is no session. */
export const meQuery = queryOptions({
  queryKey: keys.me,
  // Better Auth answers 200 with null when signed out, so a signed-out visit
  // doesn't log a failed request in the console.
  queryFn: async () => {
    const res = await api<{ user: SessionUser } | null>('/api/auth/get-session');
    return res?.user ? { id: res.user.id, name: res.user.name, email: res.user.email } : null;
  },
  staleTime: 5 * 60_000,
});

export const workspacesQuery = queryOptions({
  queryKey: keys.workspaces,
  queryFn: async () => (await fixtureOverride('workspaces')) ?? (await api<{ workspaces: Workspace[] }>('/api/workspaces')).workspaces,
  staleTime: 30_000,
});

export const trashQuery = queryOptions({
  queryKey: keys.trash,
  queryFn: async () => (await fixtureOverride('trash')) ?? (await api<{ workspaces: Workspace[] }>('/api/workspaces/trash')).workspaces,
});

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => api<{ workspace: Workspace }>('/api/workspaces', { body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateWorkspaceInput & { id: string }) =>
      api<{ workspace: Workspace }>(`/api/workspaces/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useReorderWorkspaces() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api<{ workspaces: Workspace[] }>('/api/workspaces/reorder', { body: { ids } }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: keys.workspaces, exact: true });
      const prev = qc.getQueryData<Workspace[]>(keys.workspaces);
      if (prev) {
        const byId = new Map(prev.map((w) => [w.id, w]));
        qc.setQueryData(
          keys.workspaces,
          ids.map((id) => byId.get(id)).filter((w): w is Workspace => !!w),
        );
      }
      return { prev };
    },
    onError: (_e, _ids, ctx) => ctx?.prev && qc.setQueryData(keys.workspaces, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.workspaces, exact: true }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) =>
      api<{ ok: true }>(`/api/workspaces/${id}/delete`, { body: { confirmName } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useRestoreWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ workspace: Workspace }>(`/api/workspaces/${id}/restore`, { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}
