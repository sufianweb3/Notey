import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChevronRight, Ellipsis, FileText, Folder, Layers, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { ItemKind, MoveInput, Tree } from '@shared/schemas';
import { Button } from '@web/components/ui/button';
import { errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { base, childrenOf, pageTitle, treeQuery, useContentMutations, type NodeRef } from '@web/lib/content';
import { PREF, setPref, usePref } from '@web/lib/prefs';
import { SkeletonRows } from './route-states';
import { ItemContextMenu, ItemDropdownContent, type ItemAction } from './item-menu';
import { MoveDialog } from './move-dialog';
import { NameDialog } from './name-dialog';

type Row = {
  ref: NodeRef;
  key: string;
  label: string;
  icon: string | null;
  depth: number;
  parent: string | null;
  projectId: string;
  /** Folder the item sits in (pages and folders), null at the project root. */
  containerId: string | null;
  expandable: boolean;
  expanded: boolean;
  posInSet: number;
  setSize: number;
};

const keyOf = (r: NodeRef) => `${r.kind}:${r.id}`;

function buildRows(tree: Tree, open: Set<string>): Row[] {
  const rows: Row[] = [];
  const addChildren = (projectId: string, folderId: string | null, depth: number, parent: string) => {
    const { folders, pages } = childrenOf(tree, projectId, folderId);
    const size = folders.length + pages.length;
    let pos = 0;
    for (const f of folders) {
      const ref: NodeRef = { kind: 'folder', id: f.id };
      const k = keyOf(ref);
      const hasKids = tree.folders.some((x) => x.parentId === f.id) || tree.pages.some((p) => p.folderId === f.id);
      rows.push({ ref, key: k, label: f.name, icon: null, depth, parent, projectId, containerId: folderId, expandable: hasKids, expanded: open.has(k), posInSet: ++pos, setSize: size });
      if (open.has(k)) addChildren(projectId, f.id, depth + 1, k);
    }
    for (const p of pages) {
      const ref: NodeRef = { kind: 'page', id: p.id };
      rows.push({ ref, key: keyOf(ref), label: pageTitle(p), icon: p.icon, depth, parent, projectId, containerId: folderId, expandable: false, expanded: false, posInSet: ++pos, setSize: size });
    }
  };
  tree.projects.forEach((p, i) => {
    const ref: NodeRef = { kind: 'project', id: p.id };
    const k = keyOf(ref);
    const expanded = !open.has(`closed:${k}`); // projects start open
    rows.push({ ref, key: k, label: p.name, icon: p.icon, depth: 0, parent: null, projectId: p.id, containerId: null, expandable: true, expanded, posInSet: i + 1, setSize: tree.projects.length });
    if (expanded) addChildren(p.id, null, 1, k);
  });
  return rows;
}

type Drop = { key: string; pos: 'before' | 'after' | 'inside' } | null;

/** Turns a drop indicator into a move request, or null if the drop makes no sense. */
function moveFor(tree: Tree, dragged: Row, target: Row, pos: 'before' | 'after' | 'inside'): MoveInput | null {
  if (dragged.key === target.key) return null;
  const d = dragged.ref;
  const t = target.ref;
  if (d.kind === 'project') {
    if (t.kind !== 'project' || pos === 'inside') return null;
    const ids = tree.projects.map((p) => p.id).filter((id) => id !== d.id);
    const i = ids.indexOf(t.id) + (pos === 'after' ? 1 : 0);
    return { kind: 'project', id: d.id, index: i };
  }
  // Container to drop into: a project or folder (inside), or the target's own container.
  let projectId: string;
  let parentId: string | null;
  if (pos === 'inside' || (t.kind === 'project' && pos === 'after')) {
    if (t.kind === 'page') return null;
    projectId = target.projectId;
    parentId = t.kind === 'folder' ? t.id : null;
    return { kind: d.kind, id: d.id, projectId, parentId, index: pos === 'inside' ? undefined : 0 };
  }
  if (t.kind === 'project') return null;
  projectId = target.projectId;
  parentId = target.containerId;
  if (d.kind === 'folder') {
    // No folder inside itself or its own descendants.
    for (let id: string | null = parentId; id; id = tree.folders.find((f) => f.id === id)?.parentId ?? null) {
      if (id === d.id) return null;
    }
  }
  const sib = childrenOf(tree, projectId, parentId);
  if (d.kind === 'folder') {
    const ids = sib.folders.map((f) => f.id).filter((id) => id !== d.id);
    const index = t.kind === 'folder' ? ids.indexOf(t.id) + (pos === 'after' ? 1 : 0) : ids.length;
    return { kind: 'folder', id: d.id, projectId, parentId, index };
  }
  const ids = sib.pages.map((p) => p.id).filter((id) => id !== d.id);
  const index = t.kind === 'page' ? ids.indexOf(t.id) + (pos === 'after' ? 1 : 0) : 0;
  return { kind: 'page', id: d.id, projectId, parentId, index };
}

export function ProjectTree({ ws, onNavigate }: { ws: string; onNavigate?: () => void }) {
  const tree = useQuery(treeQuery(ws));
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { pageId?: string };
  const m = useContentMutations(ws);

  const openRaw = usePref(PREF.expanded(ws), '[]');
  const open = useMemo(() => new Set<string>(JSON.parse(openRaw) as string[]), [openRaw]);
  const setOpen = useCallback(
    (key: string, value: boolean) => {
      const next = new Set(open);
      // Projects are open by default, so for them we store the closed state.
      const k = key.startsWith('project:') ? `closed:${key}` : key;
      const want = key.startsWith('project:') ? !value : value;
      if (want) next.add(k);
      else next.delete(k);
      setPref(PREF.expanded(ws), JSON.stringify([...next]));
    },
    [open, ws],
  );

  const rows = useMemo(() => (tree.data ? buildRows(tree.data, open) : []), [tree.data, open]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ kind: 'project' | 'folder'; projectId?: string; parentId?: string | null } | null>(null);
  const [moving, setMoving] = useState<(NodeRef & { name: string }) | null>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());

  // Keep the current page visible: open its project and folders.
  const currentKey = params.pageId ? `page:${params.pageId}` : null;
  useEffect(() => {
    const t = tree.data;
    const pg = params.pageId && t?.pages.find((p) => p.id === params.pageId);
    if (!t || !pg) return;
    const toOpen: string[] = [];
    for (let id = pg.folderId; id; id = t.folders.find((f) => f.id === id)?.parentId ?? null) toOpen.push(`folder:${id}`);
    const missing = toOpen.filter((k) => !open.has(k));
    if (missing.length || open.has(`closed:project:${pg.projectId}`)) {
      const next = new Set([...open, ...missing]);
      next.delete(`closed:project:${pg.projectId}`);
      setPref(PREF.expanded(ws), JSON.stringify([...next]));
    }
    // Only when the page changes; expanding is a one-off.
  }, [params.pageId, tree.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabKey = rows.some((r) => r.key === focusKey) ? focusKey : (rows.find((r) => r.key === currentKey)?.key ?? rows[0]?.key);

  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setFocusKey(key);
    rowEls.current.get(key)?.focus();
  };

  async function newPage(projectId: string, folderId: string | null) {
    try {
      const { page } = await m.createPage.mutateAsync({ projectId, folderId });
      if (folderId) setOpen(`folder:${folderId}`, true);
      void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId: ws, pageId: page.id } });
      onNavigate?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function trashRow(row: Row) {
    try {
      await m.trash.mutateAsync(row.ref);
      toast(`Moved ${row.label} to Trash`, {
        duration: 6000,
        action: { label: 'Undo', onClick: () => m.restore.mutate(row.ref, { onError: (e) => toast.error(errorMessage(e)) }) },
      });
      if (row.ref.kind === 'page' && row.ref.id === params.pageId) void navigate({ to: '/w/$workspaceId', params: { workspaceId: ws } });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function act(row: Row, action: ItemAction) {
    const containerFolder = row.ref.kind === 'folder' ? row.ref.id : null;
    switch (action) {
      case 'newPage':
        return void newPage(row.projectId, containerFolder);
      case 'newFolder':
        return setNaming({ kind: 'folder', projectId: row.projectId, parentId: containerFolder });
      case 'rename':
        return setRenaming(row.key);
      case 'duplicate':
        return m.duplicate.mutate(row.ref.id, { onError: (e) => toast.error(errorMessage(e)) });
      case 'move':
        return setMoving({ ...row.ref, name: row.label });
      case 'copyLink':
        return void navigator.clipboard
          .writeText(`${location.origin}/w/${ws}/p/${row.ref.id}`)
          .then(() => toast('Link copied'), () => toast.error("Couldn't copy the link."));
      case 'markdown':
        return void (location.href = `${base(ws)}/pages/${row.ref.id}/markdown`);
      case 'delete':
        return void trashRow(row);
    }
  }

  function activate(row: Row) {
    if (row.ref.kind === 'page') {
      void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId: ws, pageId: row.ref.id } });
      onNavigate?.();
    } else setOpen(row.key, !row.expanded);
  }

  function onKeyDown(e: ReactKeyboardEvent, row: Row) {
    if (renaming) return;
    const i = rows.findIndex((r) => r.key === row.key);
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        handled();
        return focusRow(rows[i + 1]?.key);
      case 'ArrowUp':
        handled();
        return focusRow(rows[i - 1]?.key);
      case 'Home':
        handled();
        return focusRow(rows[0]?.key);
      case 'End':
        handled();
        return focusRow(rows.at(-1)?.key);
      case 'ArrowRight':
        handled();
        if (row.expandable && !row.expanded) return setOpen(row.key, true);
        if (row.expanded) return focusRow(rows[i + 1]?.key);
        return;
      case 'ArrowLeft':
        handled();
        if (row.expanded) return setOpen(row.key, false);
        return focusRow(row.parent ?? undefined);
      case 'Enter':
      case ' ':
        handled();
        return activate(row);
      case 'F2':
        handled();
        return setRenaming(row.key);
      case 'Delete':
      case 'Backspace':
        if (e.key === 'Backspace' && !e.metaKey) return;
        handled();
        return void trashRow(row);
    }
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragging, setDragging] = useState<Row | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Where a drop would land for the current pointer, or null when it makes no sense. */
  function dropFor(e: DragMoveEvent | DragEndEvent): { drop: Drop; target: Row | undefined; dragged: Row | undefined } {
    const dragged = rows.find((r) => r.key === e.active.id);
    const over = e.over;
    const target = over ? rows.find((r) => r.key === over.id) : undefined;
    if (!over || !dragged || !target || !tree.data) return { drop: null, target, dragged };
    const y = (e.activatorEvent as PointerEvent).clientY + e.delta.y;
    const ratio = (y - over.rect.top) / over.rect.height;
    const canNest = target.ref.kind !== 'page' && dragged.ref.kind !== 'project';
    const pos = canNest ? (ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside') : ratio < 0.5 ? 'before' : 'after';
    const valid = moveFor(tree.data, dragged, target, pos);
    return { drop: valid ? { key: target.key, pos } : null, target, dragged };
  }

  function onDragMove(e: DragMoveEvent) {
    const { drop: next, target } = dropFor(e);
    if (next?.key !== drop?.key || next?.pos !== drop?.pos) {
      clearTimeout(hoverTimer.current);
      // Hovering "inside" a closed folder opens it.
      if (target && next?.pos === 'inside' && !target.expanded && target.expandable) {
        hoverTimer.current = setTimeout(() => setOpen(target.key, true), 600);
      }
      setDrop(next);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    clearTimeout(hoverTimer.current);
    // Recompute from the end event: a fast flick may end before any move event.
    const { drop: final, target, dragged } = dropFor(e);
    if (final && target && dragged && tree.data) {
      const input = moveFor(tree.data, dragged, target, final.pos);
      if (input) {
        m.move.mutate(input, { onError: (err) => toast.error(errorMessage(err)) });
        if (final.pos === 'inside') setOpen(target.key, true);
      }
    }
    setDragging(null);
    setDrop(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const header = (
    <div className="flex h-nav items-center justify-between pr-1 pl-2">
      <h2 id="projects-label" className="text-meta font-medium text-on-surface-subtle">
        Projects
      </h2>
      <Button variant="ghost" size="icon" className="size-6 text-on-surface-subtle" aria-label="New project" onClick={() => setNaming({ kind: 'project' })}>
        <Plus className="size-4" strokeWidth={1.5} aria-hidden />
      </Button>
    </div>
  );

  let body;
  if (tree.isPending) body = <SkeletonRows rows={4} />;
  else if (tree.isError)
    body = (
      <div role="alert" className="flex flex-col items-start gap-2 px-2 py-2">
        <p className="text-meta text-on-surface-muted">Couldn't load your pages.</p>
        <Button size="sm" onClick={() => void tree.refetch()}>
          Try again
        </Button>
      </div>
    );
  else if (rows.length === 0)
    body = (
      <div className="flex flex-col items-start gap-2 px-2 py-2">
        <p className="text-meta text-on-surface-muted">Projects hold your pages. Start with one per client or goal.</p>
        <Button size="sm" onClick={() => setNaming({ kind: 'project' })}>
          <Plus className="size-4" strokeWidth={1.5} aria-hidden />
          New project
        </Button>
      </div>
    );
  else
    body = (
      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setDragging(rows.find((r) => r.key === e.active.id) ?? null)}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(null);
          setDrop(null);
        }}
      >
        <div role="tree" aria-labelledby="projects-label" className="flex flex-col pb-2">
          {rows.map((row) => (
            <TreeRow
              key={row.key}
              row={row}
              ws={ws}
              selected={row.key === currentKey}
              tabbable={row.key === tabKey}
              renaming={renaming === row.key}
              drop={drop?.key === row.key ? drop.pos : null}
              dimmed={dragging?.key === row.key}
              register={(el) => (el ? rowEls.current.set(row.key, el) : rowEls.current.delete(row.key))}
              onFocus={() => setFocusKey(row.key)}
              onKeyDown={(e) => onKeyDown(e, row)}
              onActivate={() => activate(row)}
              onToggle={() => setOpen(row.key, !row.expanded)}
              onAction={(a) => act(row, a)}
              onRename={(name) => {
                setRenaming(null);
                rowEls.current.get(row.key)?.focus();
                if (name !== null && name !== row.label && (name.trim() || row.ref.kind === 'page')) {
                  m.rename.mutate({ ...row.ref, name: name.trim() }, { onError: (err) => toast.error(errorMessage(err)) });
                }
              }}
              onNewPage={() => void newPage(row.projectId, row.ref.kind === 'folder' ? row.ref.id : null)}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="inline-flex h-nav items-center gap-2 rounded-md bg-surface-overlay px-2 text-body shadow-2 ring-1 ring-border">
              <RowIcon row={dragging} />
              <span className="max-w-48 truncate">{dragging.label}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    );

  return (
    <section aria-labelledby="projects-label" className="flex min-h-0 flex-col">
      {header}
      {body}
      <NameDialog
        open={naming !== null}
        onOpenChange={(o) => !o && setNaming(null)}
        title={naming?.kind === 'folder' ? 'New folder' : 'New project'}
        description={naming?.kind === 'folder' ? undefined : 'A project holds the pages for one client, goal or deliverable.'}
        label="Name"
        placeholder={naming?.kind === 'folder' ? 'Drafts' : 'Website'}
        submitLabel={naming?.kind === 'folder' ? 'Create folder' : 'Create project'}
        onSubmit={async (name) => {
          if (naming?.kind === 'folder' && naming.projectId) {
            const { folder } = await m.createFolder.mutateAsync({ projectId: naming.projectId, parentId: naming.parentId ?? null, name });
            if (naming.parentId) setOpen(`folder:${naming.parentId}`, true);
            setFocusKey(`folder:${folder.id}`);
          } else {
            const { project } = await m.createProject.mutateAsync({ name });
            setFocusKey(`project:${project.id}`);
          }
        }}
      />
      <MoveDialog ws={ws} item={moving} onOpenChange={(o) => !o && setMoving(null)} />
    </section>
  );
}

function RowIcon({ row }: { row: Row }) {
  if (row.icon) return <span className="grid size-4 shrink-0 place-items-center text-meta leading-none">{row.icon}</span>;
  const Icon = row.ref.kind === 'project' ? Layers : row.ref.kind === 'folder' ? Folder : FileText;
  return <Icon className="size-4 shrink-0 opacity-80" strokeWidth={1.5} aria-hidden />;
}

function TreeRow({
  row,
  selected,
  tabbable,
  renaming,
  drop,
  dimmed,
  register,
  onFocus,
  onKeyDown,
  onActivate,
  onToggle,
  onAction,
  onRename,
  onNewPage,
}: {
  row: Row;
  ws: string;
  selected: boolean;
  tabbable: boolean;
  renaming: boolean;
  drop: 'before' | 'after' | 'inside' | null;
  dimmed: boolean;
  register: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  onActivate: () => void;
  onToggle: () => void;
  onAction: (a: ItemAction) => void;
  onRename: (name: string | null) => void;
  onNewPage: () => void;
}) {
  const drag = useDraggable({ id: row.key, disabled: renaming });
  const dropTarget = useDroppable({ id: row.key });
  const setRef = (el: HTMLDivElement | null) => {
    drag.setNodeRef(el);
    dropTarget.setNodeRef(el);
    register(el);
  };
  const kindLabel = row.ref.kind === 'page' ? 'Page' : row.ref.kind === 'folder' ? 'Folder' : 'Project';

  return (
    <ItemContextMenu kind={row.ref.kind as ItemKind} onAction={onAction}>
      <div
        ref={setRef}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-posinset={row.posInSet}
        aria-setsize={row.setSize}
        aria-expanded={row.expandable ? row.expanded : undefined}
        aria-selected={selected}
        aria-label={`${kindLabel}: ${row.label}`}
        tabIndex={tabbable ? 0 : -1}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          if (!renaming && e.detail === 1) onActivate();
        }}
        onDoubleClick={() => setTimeout(() => onAction('rename'))}
        {...drag.listeners}
        {...(({ role: _r, tabIndex: _t, ...rest }) => rest)(drag.attributes)}
        className={cn(
          'group relative flex h-nav cursor-default items-center gap-1.5 rounded-md pr-1 text-body outline-none select-none',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
          selected ? 'bg-primary text-on-primary' : 'text-on-surface pointer-hover:hover:bg-border/70',
          drop === 'inside' && 'bg-accent-wash text-on-surface',
          dimmed && 'opacity-40',
        )}
        style={{ paddingLeft: `calc(var(--spacing-2) + ${row.depth} * var(--spacing-3))` }}
      >
        {drop === 'before' && <span aria-hidden className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />}
        {drop === 'after' && <span aria-hidden className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" />}
        {row.ref.kind !== 'page' ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={cn('grid size-4 shrink-0 place-items-center rounded-sm opacity-70 hover:opacity-100', !row.expandable && 'invisible')}
          >
            <ChevronRight className={cn('size-3.5 transition-transform duration-(--duration-micro) ease-out', row.expanded && 'rotate-90')} strokeWidth={1.75} />
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <RowIcon row={row} />
        {renaming ? (
          <RenameInput initial={row.ref.kind === 'page' && row.label === 'Untitled' ? '' : row.label} onDone={onRename} />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate', row.ref.kind === 'project' && 'font-medium')} title={row.label}>
            {row.label}
          </span>
        )}
        {!renaming && (
          <span
            className={cn(
              'ml-auto flex shrink-0 items-center gap-0.5',
              'pointer-hover:invisible pointer-hover:group-hover:visible pointer-hover:group-focus-within:visible',
            )}
          >
            {row.ref.kind !== 'page' && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`New page in ${row.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onNewPage();
                }}
                className="grid size-6 place-items-center rounded-sm hover:bg-border"
              >
                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            )}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`More for ${row.label}`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="grid size-6 place-items-center rounded-sm hover:bg-border data-[state=open]:visible"
                >
                  <Ellipsis className="size-3.5" strokeWidth={1.75} aria-hidden />
                </button>
              </DropdownMenu.Trigger>
              <ItemDropdownContent kind={row.ref.kind as ItemKind} onAction={onAction} />
            </DropdownMenu.Root>
          </span>
        )}
      </div>
    </ItemContextMenu>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      aria-label="Name"
      value={value}
      maxLength={200}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(value)}
      className="h-6 min-w-0 flex-1 rounded-sm bg-surface-raised px-1 text-body text-on-surface ring-2 ring-primary outline-none"
    />
  );
}
