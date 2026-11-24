import { createReactBlockSpec } from '@blocknote/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Plus } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { PageDetail, Tree } from '@shared/schemas';
import { Button } from '@web/components/ui/button';
import { api, ApiError, errorMessage } from '@web/lib/api';
import { base, ck, pageQuery, pageTitle, treeQuery } from '@web/lib/content';
import { PAGE_CHANGED, type PageChangedDetail } from '@web/lib/live';
import { PAGE_ICONS } from '@web/lib/page-icons';
import { navigate } from '@web/lib/page-titles';

const ContentPreview = lazy(() => import('@web/components/embeds/content-preview'));

type Kind = 'canvas' | 'mindmap';
const NOUN: Record<Kind, string> = { canvas: 'canvas', mindmap: 'mindmap' };

function useLocationIds() {
  const [, , ws = '', , pageId = ''] = location.pathname.split('/');
  return { ws, pageId };
}

function Picker({ ws, hostId, kind, onPick, onRemove }: { ws: string; hostId: string; kind: Kind; onPick: (id: string) => void; onRemove: () => void }) {
  const qc = useQueryClient();
  const tree = useQuery(treeQuery(ws));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = PAGE_ICONS[kind];
  const pages = (tree.data?.pages ?? []).filter((p) => p.type === kind).slice(0, 8);

  async function create() {
    const host = qc.getQueryData<Tree>(ck.tree(ws))?.pages.find((p) => p.id === hostId);
    if (!host) return setError("Couldn't find this page's project. Reload and try again.");
    setBusy(true);
    try {
      const { page } = await api<{ page: PageDetail }>(`${base(ws)}/pages`, { body: { type: kind, title: '', projectId: host.projectId, folderId: host.folderId } });
      qc.setQueryData(ck.page(ws, page.id), page);
      void qc.invalidateQueries({ queryKey: ck.tree(ws) });
      onPick(page.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-surface-raised p-3 ring-1 ring-border" onKeyDown={(e) => e.key === 'Escape' && onRemove()}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
        <p className="flex-1 text-label font-medium">Embed a {NOUN[kind]}</p>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Cancel
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void create()} autoFocus>
          <Plus className="size-3.5" aria-hidden />
          New {NOUN[kind]}
        </Button>
        {pages.map((p) => (
          <Button key={p.id} size="sm" onClick={() => onPick(p.id)}>
            {pageTitle(p)}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-meta text-error">
          {error}
        </p>
      )}
    </div>
  );
}

function LiveEmbed({ ws, pageId, onRemove }: { ws: string; pageId: string; onRemove: () => void }) {
  const qc = useQueryClient();
  const q = useQuery(pageQuery(ws, pageId));

  // Stay current when the embedded page changes (another tab, or after editing it).
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<PageChangedDetail>).detail;
      if (d.ws === ws && d.pageId === pageId) void qc.invalidateQueries({ queryKey: ck.page(ws, pageId) });
    };
    window.addEventListener(PAGE_CHANGED, on);
    return () => window.removeEventListener(PAGE_CHANGED, on);
  }, [ws, pageId, qc]);

  if (q.isPending) return <div className="h-48 w-full animate-pulse rounded-lg bg-neutral" aria-label="Loading embed" />;
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="flex w-full items-center gap-3 rounded-lg bg-surface-raised px-3 py-3 text-body text-on-surface-subtle ring-1 ring-border">
        <span className="flex-1">{gone ? 'This page is in Trash or was deleted.' : "Couldn't load this embed."}</span>
        <Button size="sm" variant="ghost" onClick={gone ? onRemove : () => void q.refetch()}>
          {gone ? 'Remove block' : 'Try again'}
        </Button>
      </div>
    );
  }
  const p = q.data;
  const kind = p.type === 'mindmap' ? 'mindmap' : 'canvas';
  const Icon = PAGE_ICONS[p.type];
  const href = `/w/${ws}/p/${p.id}`;
  const open = () => navigate(href);
  return (
    <div className="group/embed flex w-full flex-col overflow-hidden rounded-lg bg-surface-raised ring-1 ring-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-label font-medium">{pageTitle(p)}</span>
        <a
          href={href}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            open();
          }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-label text-on-surface-muted hover:bg-neutral hover:text-on-surface"
        >
          Open {NOUN[kind]}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      </div>
      <button type="button" onClick={open} aria-label={`Open ${NOUN[kind]} ${pageTitle(p)}`} className="block h-72 w-full cursor-pointer bg-surface p-2">
        <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-neutral" />}>
          <ContentPreview type={p.type} content={p.content} className="h-full" />
        </Suspense>
      </button>
    </div>
  );
}

/** A canvas or mindmap shown live inside a doc (PRD 6.8). Clicking opens the full page. */
export const PageEmbedBlock = createReactBlockSpec(
  {
    type: 'pageEmbed',
    propSchema: { pageId: { default: '' }, kind: { default: 'canvas' as Kind, values: ['canvas', 'mindmap'] as const } },
    content: 'none',
  },
  {
    render: function Render({ block, editor }) {
      const { ws, pageId: hostId } = useLocationIds();
      const remove = () => editor.removeBlocks([block]);
      return (
        <div contentEditable={false} className="w-full py-1">
          {block.props.pageId ? (
            <LiveEmbed ws={ws} pageId={block.props.pageId} onRemove={remove} />
          ) : (
            <Picker ws={ws} hostId={hostId} kind={block.props.kind} onRemove={remove} onPick={(id) => editor.updateBlock(block, { props: { pageId: id } })} />
          )}
        </div>
      );
    },
  },
);
