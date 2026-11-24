import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { lazy, Suspense, useState } from 'react';
import { toast } from 'sonner';
import type { Block } from '@shared/blocks';
import type { PageDetail, VersionSummary } from '@shared/schemas';
import { SkeletonRows } from '@web/components/shell/route-states';
import { Button } from '@web/components/ui/button';
import { api, errorMessage } from '@web/lib/api';
import { base, ck, versionQuery, versionsQuery } from '@web/lib/content';
import { relativeTime } from '@web/lib/time';

const DocPreview = lazy(() => import('./doc-editor').then((m) => ({ default: m.DocPreview })));
const ContentPreview = lazy(() => import('@web/components/embeds/content-preview'));

const REASONS: Record<string, string> = {
  autosave: 'Autosaved',
  manual: 'Saved by you',
  'before restore': 'Before a restore',
  'before agent edit': 'Before an agent edit',
};

function who(author: string) {
  return author.startsWith('agent:') ? author.slice(6) : 'You';
}

/** Right sheet listing versions; pick one to preview and restore (PRD 6.12). */
export function HistorySheet({
  ws,
  pageId,
  open,
  onOpenChange,
  onRestored,
}: {
  ws: string;
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (page: PageDetail) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({ ...versionsQuery(ws, pageId), enabled: open });
  const [selected, setSelected] = useState<VersionSummary | null>(null);
  const detail = useQuery({ ...versionQuery(ws, pageId, selected?.id ?? ''), enabled: !!selected });

  const snapshot = useMutation({
    mutationFn: () => api(`${base(ws)}/pages/${pageId}/versions`, { body: {} }),
    onSuccess: () => {
      toast('Version saved');
      void qc.invalidateQueries({ queryKey: ck.versions(ws, pageId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: (vid: string) => api<{ page: PageDetail }>(`${base(ws)}/pages/${pageId}/versions/${vid}/restore`, { body: {} }),
    onSuccess: ({ page }) => {
      onRestored(page);
      void qc.invalidateQueries({ queryKey: ck.versions(ws, pageId) });
      void qc.invalidateQueries({ queryKey: ck.tree(ws) });
      toast('Version restored', { description: 'The version you replaced is saved in history too.' });
      setSelected(null);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <D.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) setSelected(null);
        onOpenChange(o);
      }}
    >
      <D.Portal>
        <D.Overlay className="animate-scrim fixed inset-0 z-40 bg-scrim" />
        <D.Content
          aria-describedby={undefined}
          className="sheet-right fixed inset-y-0 right-0 z-50 flex w-[min(420px,100vw)] flex-col bg-surface-raised shadow-3 ring-1 ring-border"
        >
          <div className="flex h-topbar shrink-0 items-center gap-2 border-b border-border px-4">
            <History className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
            <D.Title className="flex-1 text-label font-medium">Page history</D.Title>
            <Button size="sm" loading={snapshot.isPending} onClick={() => snapshot.mutate()}>
              Save a version
            </Button>
            <D.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Close history">
                <X className="size-4" strokeWidth={1.5} aria-hidden />
              </Button>
            </D.Close>
          </div>

          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                  ← All versions
                </Button>
                <span className="tnum flex-1 truncate text-meta text-on-surface-subtle">{new Date(selected.createdAt).toLocaleString()}</span>
                <Button size="sm" variant="primary" loading={restore.isPending} onClick={() => restore.mutate(selected.id)}>
                  Restore
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <h3 className="mb-3 text-h2 font-semibold">{selected.title || 'Untitled'}</h3>
                {detail.isPending ? (
                  <SkeletonRows rows={4} />
                ) : detail.isError ? (
                  <p role="alert" className="text-body text-error">
                    {errorMessage(detail.error)}
                  </p>
                ) : detail.data.type !== 'doc' && detail.data.content ? (
                  <Suspense fallback={<SkeletonRows rows={4} />}>
                    <ContentPreview type={detail.data.type} content={detail.data.content} />
                  </Suspense>
                ) : Array.isArray(detail.data.content) && detail.data.content.length ? (
                  <Suspense fallback={<SkeletonRows rows={4} />}>
                    <DocPreview content={detail.data.content as Block[]} />
                  </Suspense>
                ) : (
                  <p className="text-body text-on-surface-muted">This version was empty.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {list.isPending ? (
                <SkeletonRows rows={5} />
              ) : list.isError ? (
                <div role="alert" className="flex items-center gap-3 p-2">
                  <p className="flex-1 text-body text-on-surface-muted">Couldn't load history.</p>
                  <Button size="sm" onClick={() => void list.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : list.data.length === 0 ? (
                <p className="p-3 text-body text-on-surface-muted">
                  No versions yet. Notey saves one every 5 minutes while you edit, before any agent edit, and when you choose Save a version.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {list.data.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(v)}
                        className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left pointer-hover:hover:bg-neutral"
                      >
                        <span className="text-body text-on-surface">
                          <span className="tnum">{relativeTime(v.createdAt)}</span> · {who(v.author)}
                        </span>
                        <span className="text-meta text-on-surface-subtle">{REASONS[v.reason] ?? v.reason}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
