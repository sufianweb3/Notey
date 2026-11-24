import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router';
import { ClipboardCopy, CloudOff, Ellipsis, FileImage, History, ListTree, ScrollText, Star, TriangleAlert } from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PageDetail } from '@shared/schemas';
import type { CanvasHandle } from '@web/components/canvas/canvas-page';
import type { EditorHandle, SaveState } from '@web/components/editor/doc-editor';
import type { MindmapHandle } from '@web/components/mindmap/mindmap-page';
import { Dialog } from '@web/components/ui/dialog';
import { HistorySheet } from '@web/components/editor/history-sheet';
import { ItemDropdownContent, type ItemAction } from '@web/components/shell/item-menu';
import { MoveDialog } from '@web/components/shell/move-dialog';
import { SkeletonRows } from '@web/components/shell/route-states';
import { TopBar } from '@web/components/shell/top-bar';
import { Button } from '@web/components/ui/button';
import { api, ApiError, errorMessage } from '@web/lib/api';
import { base, ck, pageQuery, pageTitle, patchTree, pathOf, treeQuery, useContentMutations } from '@web/lib/content';
import { DocEditorSlot } from '@web/lib/editor-loader';
import { CanvasSlot, loadEngine, MindmapSlot } from '@web/lib/page-engines';
import { setPageTitles } from '@web/lib/page-titles';
import { isPinned, pinsQuery, usePins } from '@web/lib/tasks';
import { cn } from '@web/lib/cn';
import { modKey } from '@web/lib/workspace-memory';
import { workspacesQuery } from '@web/lib/queries';
import { PAGE_CHANGED, type PageChangedDetail } from '@web/lib/live';
import { editedByLabel, relativeTime } from '@web/lib/time';



export const Route = createFileRoute('/_app/w/$workspaceId/p/$pageId')({
  loader: async ({ context: { queryClient }, params }) => {
    try {
      // Load the page's engine with its data so typing never lands before it's ready.
      const page = await queryClient.ensureQueryData(pageQuery(params.workspaceId, params.pageId));
      await loadEngine(page.type);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw notFound();
      throw e;
    }
  },
  notFoundComponent: MissingPage,
  component: PageView,
});

function MissingPage() {
  const { workspaceId } = Route.useParams();
  return (
    <div className="mx-auto flex max-w-doc flex-col gap-2 px-4 pt-16 medium:px-6">
      <h1 className="text-h2 font-semibold">This page isn't here</h1>
      <p className="text-body text-on-surface-muted">It may have been moved to Trash or deleted.</p>
      <p className="flex gap-4 pt-2">
        <Link to="/w/$workspaceId/trash" params={{ workspaceId }} className="text-label font-medium underline decoration-border-strong underline-offset-4">
          Open Trash
        </Link>
        <Link to="/w/$workspaceId" params={{ workspaceId }} className="text-label font-medium underline decoration-border-strong underline-offset-4">
          Go to Home
        </Link>
      </p>
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  // DESIGN.md: the indicator only appears on failure or while offline.
  if (state === 'error')
    return (
      <span role="status" className="flex items-center gap-1.5 text-meta text-error">
        <TriangleAlert className="size-3.5" strokeWidth={1.5} aria-hidden />
        <span className="hidden medium:inline">Couldn't save. Retrying…</span>
        <span className="medium:hidden">Not saved</span>
      </span>
    );
  if (state === 'offline')
    return (
      <span role="status" className="flex items-center gap-1.5 text-meta text-warning">
        <CloudOff className="size-3.5" strokeWidth={1.5} aria-hidden />
        <span className="hidden medium:inline">Offline. Changes save when you're back.</span>
        <span className="medium:hidden">Offline</span>
      </span>
    );
  return <span role="status" aria-live="polite" className="sr-only">{state === 'saving' ? 'Saving' : 'Saved'}</span>;
}

function PageView() {
  const { workspaceId: ws, pageId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const page = useQuery(pageQuery(ws, pageId));
  const tree = useQuery(treeQuery(ws));
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const m = useContentMutations(ws);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [history, setHistory] = useState(false);
  const [moving, setMoving] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const canvas = useRef<CanvasHandle>(null);
  const mindmap = useRef<MindmapHandle>(null);
  const [describe, setDescribe] = useState<{ summary: string; lines: string[] } | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const pinsApi = usePins(ws);
  const { data: pinList } = useQuery(pinsQuery(ws));
  const pinned = isPinned(pinList, 'page', pageId);
  const togglePin = () => pinsApi.toggle.mutate({ itemType: 'page', itemId: pageId, pinned });
  // Enter in the title before the editor chunk has loaded: focus it once it mounts.
  const pendingFocus = useRef(false);
  const focusEditor = () => {
    if (editor.current) editor.current.focusStart();
    else pendingFocus.current = true;
  };

  // Feed live titles to page-link chips inside the editor.
  useEffect(() => {
    if (tree.data) setPageTitles(new Map(tree.data.pages.map((p) => [p.id, pageTitle(p)])));
  }, [tree.data]);

  if (!page.data) return <SkeletonRows rows={6} />;
  const p = page.data;
  const node = tree.data?.pages.find((x) => x.id === pageId);
  const { project, folders } = tree.data ? pathOf(tree.data, node ?? p) : { project: undefined, folders: [] };
  const wsName = workspaces.find((w) => w.id === ws)?.name ?? 'Workspace';
  const title = node?.title ?? p.title;

  const onRemote = (latest: PageDetail) => {
    qc.setQueryData(ck.page(ws, pageId), latest);
    patchTree(qc, ws, (t) => ({ ...t, pages: t.pages.map((x) => (x.id === pageId ? { ...x, title: latest.title, icon: latest.icon, updatedBy: latest.updatedBy, updatedAt: latest.updatedAt } : x)) }));
  };
  const fullBleed = p.type === 'canvas' || p.type === 'mindmap';

  const extra =
    p.type === 'canvas'
      ? [
          { label: 'Export PNG', icon: <FileImage />, onSelect: () => void canvas.current?.exportImage('png') },
          { label: 'Export SVG', icon: <FileImage />, onSelect: () => void canvas.current?.exportImage('svg') },
          { label: 'Describe canvas', icon: <ScrollText />, onSelect: () => canvas.current && setDescribe(canvas.current.describe()) },
        ]
      : p.type === 'mindmap'
        ? [
            {
              label: 'Copy as outline',
              icon: <ClipboardCopy />,
              onSelect: () =>
                void navigator.clipboard.writeText(mindmap.current?.outline() ?? '').then(
                  () => toast('Outline copied', { description: 'Paste it into a doc or an AI chat.' }),
                  () => toast.error("Couldn't copy the outline."),
                ),
            },
            { label: 'Replace from outline…', icon: <ListTree />, onSelect: () => setOutlineOpen(true) },
          ]
        : undefined;

  function act(a: ItemAction) {
    switch (a) {
      case 'rename':
        return document.getElementById('page-title')?.focus();
      case 'duplicate':
        return m.duplicate.mutate(pageId, {
          onSuccess: ({ page: copy }) => void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId: ws, pageId: copy.id } }),
          onError: (e) => toast.error(errorMessage(e)),
        });
      case 'move':
        return setMoving(true);
      case 'pin':
        return togglePin();
      case 'copyLink':
        return void navigator.clipboard.writeText(location.href).then(() => toast('Link copied'), () => toast.error("Couldn't copy the link."));
      case 'markdown':
        return location.assign(`${base(ws)}/pages/${pageId}/markdown`);
      case 'delete':
        return m.trash.mutate(
          { kind: 'page', id: pageId },
          {
            onSuccess: () => {
              toast(`Moved ${pageTitle({ title })} to Trash`, {
                duration: 6000,
                action: { label: 'Undo', onClick: () => m.restore.mutate({ kind: 'page', id: pageId }) },
              });
              void navigate({ to: '/w/$workspaceId', params: { workspaceId: ws } });
            },
            onError: (e) => toast.error(errorMessage(e)),
          },
        );
    }
  }

  return (
    <div className={cn('flex flex-col', fullBleed ? 'h-full' : 'min-h-full')}>
      <TopBar
        crumbs={[{ label: wsName, to: { ws } }, ...(project ? [{ label: project.name }] : []), ...folders.map((f) => ({ label: f.name })), { label: pageTitle({ title }) }]}
        status={<SaveStatus state={saveState} />}
        actions={
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label={pinned ? 'Unpin page' : 'Pin page'}
              aria-pressed={pinned}
              title={`${pinned ? 'Unpin' : 'Pin'} (${modKey}⇧P)`}
              onClick={togglePin}
              className={pinned ? 'text-on-surface' : undefined}
            >
              <Star className={cn('size-4.5', pinned && 'fill-current')} strokeWidth={1.5} aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Page history" title="Page history" onClick={() => setHistory(true)}>
              <History className="size-4.5" strokeWidth={1.5} aria-hidden />
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button size="icon" variant="ghost" aria-label="More page actions">
                  <Ellipsis className="size-4.5" strokeWidth={1.5} aria-hidden />
                </Button>
              </DropdownMenu.Trigger>
              <ItemDropdownContent kind="page" onAction={act} pinned={pinned} extra={extra} />
            </DropdownMenu.Root>
          </>
        }
      />
      {fullBleed ? (
        <>
          <CompactTitle
            key={pageId}
            ws={ws}
            pageId={pageId}
            title={title}
            placeholder={p.type === 'canvas' ? 'Untitled canvas' : 'Untitled mindmap'}
            editedBy={editedByLabel(node?.updatedBy ?? p.updatedBy)}
            editedAt={node?.updatedAt ?? p.updatedAt}
          />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <Suspense fallback={<SkeletonRows rows={4} />}>
              {p.type === 'canvas' ? (
                <CanvasSlot key={pageId} ref={canvas} ws={ws} page={p} title={title} onSaveState={setSaveState} onRemote={onRemote} />
              ) : (
                <MindmapSlot
                  key={pageId}
                  ref={mindmap}
                  ws={ws}
                  page={p}
                  title={title}
                  onSaveState={setSaveState}
                  onRemote={onRemote}
                  onRootText={(t) => !title.trim() && savePageMeta(qc, ws, pageId, { title: t.slice(0, 200) })}
                />
              )}
            </Suspense>
          </div>
        </>
      ) : (
      <article className="mx-auto w-full max-w-[calc(var(--spacing-doc)+var(--spacing-gutter))] flex-1 px-4 pt-10 medium:px-6 expanded:pt-16">
        <TitleArea
          key={pageId}
          ws={ws}
          page={p}
          title={title}
          icon={node?.icon ?? p.icon}
          onEnter={focusEditor}
        />
        <Suspense fallback={<div className="pl-gutter"><SkeletonRows rows={5} /></div>}>
          <DocEditorSlot
            key={pageId}
            ref={editor}
            ws={ws}
            page={p}
            tree={tree.data}
            onSaveState={setSaveState}
            onReady={() => {
              if (pendingFocus.current) {
                pendingFocus.current = false;
                editor.current?.focusStart();
              }
            }}
            onExitTop={() => document.getElementById('page-title')?.focus()}
            onRemote={onRemote}
          />
        </Suspense>
      </article>
      )}
      <HistorySheet
        ws={ws}
        pageId={pageId}
        open={history}
        onOpenChange={setHistory}
        onRestored={(restored) => {
          qc.setQueryData(ck.page(ws, pageId), restored);
          if (p.type === 'doc') editor.current?.load(restored);
          // Canvas and mindmap pick up the restored rev like any remote edit.
          else window.dispatchEvent(new CustomEvent<PageChangedDetail>(PAGE_CHANGED, { detail: { ws, pageId, change: { seq: 0, entity: 'page', entityId: pageId, op: 'update', actor: '', at: '' } } }));
        }}
      />
      <Dialog open={!!describe} onOpenChange={(o) => !o && setDescribe(null)} title="Describe canvas" description={describe?.summary}>
        {describe?.lines.length ? (
          <ol className="flex max-h-[50dvh] list-decimal flex-col gap-1 overflow-y-auto pl-5 text-body">
            {describe.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        ) : null}
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setDescribe(null)}>
            Done
          </Button>
        </div>
      </Dialog>
      <OutlineDialog open={outlineOpen} onOpenChange={setOutlineOpen} onReplace={(md) => mindmap.current?.replaceFromOutline(md)} />
      <MoveDialog ws={ws} item={moving ? { kind: 'page', id: pageId, name: pageTitle({ title }) } : null} onOpenChange={(o) => !o && setMoving(false)} />
    </div>
  );
}

/** Title (page-title type), optional emoji icon, and "Edited by" after agent edits. */
function TitleArea({ ws, page, title, icon, onEnter }: { ws: string; page: PageDetail; title: string; icon: string | null; onEnter: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(title);
  const [iconDraft, setIconDraft] = useState(icon ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  const editedBy = editedByLabel(page.updatedBy);

  // A rename elsewhere (tree, another tab) updates the field when it isn't focused.
  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(title);
  }, [title]);

  // New, empty pages start with the cursor in the title.
  useEffect(() => {
    if (!page.title && !page.content) ref.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  const save = (patch: { title?: string; icon?: string | null }) => savePageMeta(qc, ws, page.id, patch);

  return (
    <header className="mb-4 pl-gutter max-[599px]:pl-6">
      <div className="group/icon mb-2 flex min-h-8 items-end gap-2">
        <Popover.Root>
          <Popover.Trigger asChild>
            {icon ? (
              <button type="button" className="rounded-md text-display leading-none pointer-hover:hover:bg-neutral" aria-label="Change page icon">
                {icon}
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 text-meta text-on-surface-subtle pointer-hover:opacity-0 pointer-hover:group-hover/icon:opacity-100 pointer-hover:focus-visible:opacity-100 hover:bg-neutral"
              >
                Add icon
              </button>
            )}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={6} className="animate-popover z-50 flex w-64 flex-col gap-2 rounded-lg bg-surface-overlay p-3 shadow-2 ring-1 ring-border">
              <label htmlFor="page-icon" className="text-label font-medium">
                Page icon
              </label>
              <input
                id="page-icon"
                autoFocus
                value={iconDraft}
                placeholder="📄"
                maxLength={16}
                onChange={(e) => setIconDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save({ icon: iconDraft.trim() || null });
                }}
                className="h-input rounded-md bg-surface-raised px-3 text-body-doc ring-1 ring-border-strong/45 outline-none focus:ring-2 focus:ring-primary sm:text-body"
              />
              <p className="text-meta text-on-surface-subtle">One emoji. Press Enter to set it.</p>
              <div className="flex justify-end gap-2">
                {icon && (
                  <Popover.Close asChild>
                    <Button size="sm" variant="ghost" onClick={() => save({ icon: null })}>
                      Remove
                    </Button>
                  </Popover.Close>
                )}
                <Popover.Close asChild>
                  <Button size="sm" variant="primary" onClick={() => save({ icon: iconDraft.trim() || null })}>
                    Set icon
                  </Button>
                </Popover.Close>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <textarea
        id="page-title"
        ref={ref}
        rows={1}
        value={value}
        placeholder="Untitled"
        aria-label="Page title"
        maxLength={200}
        onChange={(e) => {
          const v = e.target.value.replace(/\n/g, '');
          setValue(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save({ title: v.trim() }), 600);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === value.length)) {
            e.preventDefault();
            onEnter();
          }
        }}
        onBlur={() => {
          clearTimeout(timer.current);
          if (value.trim() !== title.trim()) save({ title: value.trim() });
        }}
        className="block w-full resize-none overflow-hidden bg-transparent text-page-title font-semibold text-on-surface outline-none placeholder:text-on-surface-subtle"
      />
      {editedBy && (
        <p className="mt-1 text-meta text-on-surface-subtle">
          {editedBy} · {relativeTime(page.updatedAt)}
        </p>
      )}
    </header>
  );
}

function savePageMeta(qc: ReturnType<typeof useQueryClient>, ws: string, pageId: string, patch: { title?: string; icon?: string | null }) {
  patchTree(qc, ws, (t) => ({ ...t, pages: t.pages.map((x) => (x.id === pageId ? ({ ...x, ...patch } as typeof x) : x)) }));
  api(`${base(ws)}/pages/${pageId}`, { method: 'PATCH', body: patch }).catch((e) => toast.error(errorMessage(e)));
}

/** Title row for full-bleed pages (canvas, mindmap): one line, saves as you type. */
function CompactTitle({
  ws,
  pageId,
  title,
  placeholder,
  editedBy,
  editedAt,
}: {
  ws: string;
  pageId: string;
  title: string;
  placeholder: string;
  /** "Edited by Claude" after an agent edit (PRD 6.13). */
  editedBy: string | null;
  editedAt: string;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(title);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(title);
  }, [title]);
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-border bg-surface px-4">
      <input
        id="page-title"
        ref={ref}
        value={value}
        placeholder={placeholder}
        aria-label="Page title"
        maxLength={200}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => savePageMeta(qc, ws, pageId, { title: v.trim() }), 600);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
        onBlur={() => {
          clearTimeout(timer.current);
          if (value.trim() !== title.trim()) savePageMeta(qc, ws, pageId, { title: value.trim() });
        }}
        className="min-w-0 flex-1 bg-transparent text-h3 font-semibold text-on-surface outline-none placeholder:text-on-surface-subtle"
      />
      {editedBy && (
        <span className="hidden shrink-0 text-meta text-on-surface-subtle sm:inline">
          {editedBy} · {relativeTime(editedAt)}
        </span>
      )}
    </div>
  );
}

const OUTLINE_EXAMPLE = '# Launch\n- Website\n  - Hero copy\n- Press';

/** Builds the mindmap from a Markdown outline (headings or nested bullets). */
function OutlineDialog({ open, onOpenChange, onReplace }: { open: boolean; onOpenChange: (o: boolean) => void; onReplace: (md: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Replace from outline"
      description="Paste a Markdown outline. Headings and nested bullets become branches. Undo puts the current mindmap back."
    >
      <textarea
        aria-label="Outline"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={OUTLINE_EXAMPLE}
        className="w-full resize-y rounded-md bg-surface px-3 py-2 font-mono text-mono text-on-surface ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!text.trim()}
          onClick={() => {
            onReplace(text);
            setText('');
            onOpenChange(false);
          }}
        >
          Replace mindmap
        </Button>
      </div>
    </Dialog>
  );
}
