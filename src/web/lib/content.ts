import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  FolderNode,
  ItemKind,
  TrashKind,
  MoveInput,
  PageDetail,
  PageNode,
  PageType,
  ProjectNode,
  SearchHit,
  TrashItem,
  Tree,
  VersionDetail,
  VersionSummary,
} from '@shared/schemas';
import { api } from './api';

/** Query keys for one workspace's content. Everything hangs off ['ws', id]. */
export const ck = {
  ws: (ws: string) => ['ws', ws] as const,
  tree: (ws: string) => ['ws', ws, 'tree'] as const,
  page: (ws: string, id: string) => ['ws', ws, 'page', id] as const,
  versions: (ws: string, id: string) => ['ws', ws, 'page', id, 'versions'] as const,
  version: (ws: string, id: string, vid: string) => ['ws', ws, 'page', id, 'versions', vid] as const,
  trash: (ws: string) => ['ws', ws, 'trash'] as const,
  search: (ws: string, q: string) => ['ws', ws, 'search', q] as const,
};

export const base = (ws: string) => `/api/workspaces/${ws}`;

export const treeQuery = (ws: string) =>
  queryOptions({ queryKey: ck.tree(ws), queryFn: () => api<Tree>(`${base(ws)}/tree`), staleTime: 30_000 });

export const pageQuery = (ws: string, id: string) =>
  queryOptions({
    queryKey: ck.page(ws, id),
    queryFn: async () => (await api<{ page: PageDetail }>(`${base(ws)}/pages/${id}`)).page,
    staleTime: Infinity, // the editor owns the live copy; the change feed refreshes it
  });

export const trashQuery = (ws: string) =>
  queryOptions({ queryKey: ck.trash(ws), queryFn: async () => (await api<{ items: TrashItem[] }>(`${base(ws)}/trash`)).items });

export const versionsQuery = (ws: string, id: string) =>
  queryOptions({
    queryKey: ck.versions(ws, id),
    queryFn: async () => (await api<{ versions: VersionSummary[] }>(`${base(ws)}/pages/${id}/versions`)).versions,
  });

export const versionQuery = (ws: string, id: string, vid: string) =>
  queryOptions({
    queryKey: ck.version(ws, id, vid),
    queryFn: async () => (await api<{ version: VersionDetail }>(`${base(ws)}/pages/${id}/versions/${vid}`)).version,
    staleTime: Infinity,
  });

export const searchQuery = (ws: string, q: string) =>
  queryOptions({
    queryKey: ck.search(ws, q),
    queryFn: async () => (await api<{ results: SearchHit[] }>(`${base(ws)}/search?q=${encodeURIComponent(q)}&limit=12`)).results,
    staleTime: 10_000,
  });

/** Patches the cached tree in place for optimistic updates. */
export function patchTree(qc: QueryClient, ws: string, fn: (t: Tree) => Tree) {
  const prev = qc.getQueryData<Tree>(ck.tree(ws));
  if (prev) qc.setQueryData(ck.tree(ws), fn(prev));
  return prev;
}

export function useContentMutations(ws: string) {
  const qc = useQueryClient();
  const refreshTree = () => qc.invalidateQueries({ queryKey: ck.tree(ws) });
  const refreshAll = () => qc.invalidateQueries({ queryKey: ck.ws(ws) });

  return {
    createProject: useMutation({
      mutationFn: (input: { name: string }) => api<{ project: ProjectNode }>(`${base(ws)}/projects`, { body: input }),
      onSuccess: refreshTree,
    }),
    createFolder: useMutation({
      mutationFn: (input: { projectId: string; parentId?: string | null; name: string }) =>
        api<{ folder: FolderNode }>(`${base(ws)}/folders`, { body: input }),
      onSuccess: refreshTree,
    }),
    createPage: useMutation({
      mutationFn: (input: { projectId: string; folderId?: string | null; title?: string; type?: PageType }) =>
        api<{ page: PageDetail }>(`${base(ws)}/pages`, { body: { type: 'doc', title: '', ...input } }),
      onSuccess: ({ page }) => {
        qc.setQueryData(ck.page(ws, page.id), page);
        void refreshTree();
      },
    }),
    rename: useMutation({
      mutationFn: ({ kind, id, name }: { kind: ItemKind; id: string; name: string }) =>
        kind === 'page'
          ? api(`${base(ws)}/pages/${id}`, { method: 'PATCH', body: { title: name } })
          : api(`${base(ws)}/${kind === 'project' ? 'projects' : 'folders'}/${id}`, { method: 'PATCH', body: { name } }),
      onMutate: ({ kind, id, name }) =>
        patchTree(qc, ws, (t) => ({
          projects: t.projects.map((p) => (kind === 'project' && p.id === id ? { ...p, name } : p)),
          folders: t.folders.map((f) => (kind === 'folder' && f.id === id ? { ...f, name } : f)),
          pages: t.pages.map((p) => (kind === 'page' && p.id === id ? { ...p, title: name } : p)),
        })),
      onError: (_e, _v, prev) => prev && qc.setQueryData(ck.tree(ws), prev),
      onSettled: (_d, _e, v) => {
        void refreshTree();
        if (v.kind === 'page') void qc.invalidateQueries({ queryKey: ck.page(ws, v.id), exact: true });
      },
    }),
    move: useMutation({
      mutationFn: (input: MoveInput) => api(`${base(ws)}/move`, { body: input }),
      onSettled: refreshTree,
    }),
    duplicate: useMutation({
      mutationFn: (id: string) => api<{ page: PageDetail }>(`${base(ws)}/pages/${id}/duplicate`, { body: {} }),
      onSuccess: refreshTree,
    }),
    trash: useMutation({
      mutationFn: (input: { kind: TrashKind; id: string }) => api(`${base(ws)}/trash`, { body: input }),
      onSuccess: refreshAll,
    }),
    restore: useMutation({
      mutationFn: (input: { kind: TrashKind; id: string }) => api(`${base(ws)}/trash/restore`, { body: input }),
      onSuccess: refreshAll,
    }),
    deleteForever: useMutation({
      mutationFn: (input: { kind: TrashKind; id: string }) => api(`${base(ws)}/trash/delete`, { body: input }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ck.trash(ws) }),
    }),
  };
}

// ── Tree helpers ────────────────────────────────────────────────────────────

export type NodeRef = { kind: ItemKind; id: string };

/** Folders first, then pages, each in their saved order (matches the server). */
export function childrenOf(tree: Tree, projectId: string, folderId: string | null) {
  return {
    folders: tree.folders.filter((f) => f.projectId === projectId && f.parentId === folderId),
    pages: tree.pages.filter((p) => p.projectId === projectId && p.folderId === folderId),
  };
}

/** Project and folder chain for a page, for breadcrumbs. */
export function pathOf(tree: Tree, page: Pick<PageNode, 'projectId' | 'folderId'>) {
  const project = tree.projects.find((p) => p.id === page.projectId);
  const folders: FolderNode[] = [];
  for (let id = page.folderId; id; ) {
    const f = tree.folders.find((x) => x.id === id);
    if (!f) break;
    folders.unshift(f);
    id = f.parentId;
  }
  return { project, folders };
}

export const pageTitle = (p: { title: string } | undefined) => (p?.title?.trim() ? p.title : 'Untitled');
