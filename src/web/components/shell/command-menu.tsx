import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { CircleCheck, FilePlus, FileText, FolderPlus, Home, Keyboard, ListPlus, PanelLeft, Search, SquareCheck, Star, SunMoon, Trash2 } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { Fragment, useDeferredValue, useEffect, useState, type ReactNode } from 'react';
import type { SearchHit, Workspace } from '@shared/schemas';
import { WorkspaceGlyph } from '@web/components/ui/glyph';
import { cn } from '@web/lib/cn';
import { pageTitle, searchQuery, treeQuery } from '@web/lib/content';
import { openTask } from '@web/lib/tasks';
import { modKey } from '@web/lib/workspace-memory';

export type CommandActions = {
  newPage: () => void;
  newProject: () => void;
  newTask: () => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
  showShortcuts: () => void;
};

// Animate the first open only; after that the menu appears instantly (DESIGN.md § Motion).
let openedBefore = false;

/** Renders a search snippet, bolding the \u0001…\u0002 marked matches. Never uses innerHTML. */
const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);

function Snippet({ text }: { text: string }) {
  // "a\u0001hit\u0002b" → ["a", "hit", "b"]: odd indexes are matches.
  const parts = text.split(OPEN).flatMap((chunk, i) => (i === 0 ? [chunk] : chunk.split(CLOSE)));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-accent-wash text-on-surface">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const itemClass = cn(
  'flex min-h-10 cursor-default items-center gap-3 rounded-md px-3 py-1.5 text-body text-on-surface outline-none select-none',
  'data-[selected=true]:bg-border/70 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:text-on-surface-muted',
);
const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:text-on-surface-subtle';

function Item({ onSelect, icon, children, hint, value }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: string; value: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={itemClass}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <kbd className="shrink-0 font-sans text-meta text-on-surface-subtle">{hint}</kbd>}
    </Command.Item>
  );
}

type MenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ws: string | undefined;
  workspaces: Workspace[];
  actions: CommandActions;
};

export function CommandMenu({ open, onOpenChange, ws, workspaces, actions }: MenuProps) {
  // Read when the menu renders open; the first open animates, later ones are instant.
  const animate = !openedBefore;
  useEffect(() => {
    if (open) openedBefore = true;
  }, [open]);

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={cn('fixed inset-0 z-40 bg-scrim', animate && 'animate-scrim')} />
        <D.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-[12dvh] left-1/2 z-50 w-[min(640px,calc(100vw-var(--spacing-6)))] -translate-x-1/2',
            'overflow-hidden rounded-xl bg-surface-raised shadow-3 ring-1 ring-border',
            animate && 'animate-dialog',
          )}
        >
          {/* Mounted only while open, so the query starts empty every time. */}
          <MenuBody close={() => onOpenChange(false)} ws={ws} workspaces={workspaces} actions={actions} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function MenuBody({ close, ws, workspaces, actions }: Omit<MenuProps, 'open' | 'onOpenChange'> & { close: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const search = useQuery({ ...searchQuery(ws ?? '', query), enabled: !!ws });
  const { data: tree } = useQuery({ ...treeQuery(ws ?? ''), enabled: !!ws });

  const run = (fn: () => void) => {
    close();
    fn();
  };
  const openPage = (hit: SearchHit, newTab: boolean) => {
    if (!ws) return;
    if (hit.kind === 'task') return run(() => openTask(hit.id));
    if (newTab) window.open(`/w/${ws}/p/${hit.id}`, '_blank', 'noopener');
    else run(() => void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId: ws, pageId: hit.id } }));
  };
  const projectName = (id: string | null) => (id ? (tree?.projects.find((p) => p.id === id)?.name ?? '') : 'Inbox');

  const commands: { value: string; label: string; icon: ReactNode; hint?: string; fn: () => void }[] = [
    { value: 'new doc page', label: 'New doc', icon: <FilePlus />, hint: `${modKey}N`, fn: actions.newPage },
    { value: 'new task todo', label: 'New task', icon: <ListPlus />, hint: 'T', fn: actions.newTask },
    { value: 'new project', label: 'New project', icon: <FolderPlus />, fn: actions.newProject },
    ...(ws
      ? [
          { value: 'go home', label: 'Go to Home', icon: <Home />, fn: () => void navigate({ to: '/w/$workspaceId', params: { workspaceId: ws } }) },
          {
            value: 'go tasks today inbox upcoming',
            label: 'Go to Tasks',
            icon: <SquareCheck />,
            fn: () => void navigate({ to: '/w/$workspaceId/tasks', params: { workspaceId: ws }, search: { view: 'today', layout: 'list' } }),
          },
          { value: 'go important pins pinned', label: 'Go to Important', icon: <Star />, fn: () => void navigate({ to: '/w/$workspaceId/important', params: { workspaceId: ws } }) },
          { value: 'go trash deleted', label: 'Go to Trash', icon: <Trash2 />, fn: () => void navigate({ to: '/w/$workspaceId/trash', params: { workspaceId: ws } }) },
        ]
      : []),
    { value: 'toggle sidebar', label: 'Toggle sidebar', icon: <PanelLeft />, hint: `${modKey}\\`, fn: actions.toggleSidebar },
    { value: 'toggle theme appearance dark light', label: 'Toggle theme', icon: <SunMoon />, fn: actions.toggleTheme },
    { value: 'keyboard shortcuts help', label: 'Keyboard shortcuts', icon: <Keyboard />, hint: '?', fn: actions.showShortcuts },
  ];

  const lower = query.toLowerCase();
  const shownCommands = commands.filter((c) => !lower || c.value.includes(lower) || c.label.toLowerCase().includes(lower));
  const shownWorkspaces = workspaces.filter((w) => w.id !== ws && (!lower || w.name.toLowerCase().includes(lower) || 'switch workspace'.includes(lower)));

  return (
    <>
      <D.Title className="sr-only">Search and commands</D.Title>
      <Command label="Search and commands" shouldFilter={false} loop className="flex max-h-[min(70dvh,560px)] flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-on-surface-subtle" strokeWidth={1.5} aria-hidden />
          <Command.Input
            value={q}
            onValueChange={setQ}
            placeholder="Search pages or type a command"
            className="h-14 min-w-0 flex-1 bg-transparent text-body-doc text-on-surface outline-none placeholder:text-on-surface-subtle"
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter opens the highlighted page in a new tab.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                const id = document.querySelector('[cmdk-item][data-selected="true"]')?.getAttribute('data-page-id');
                const hit = search.data?.find((h) => h.id === id);
                if (hit) {
                  e.preventDefault();
                  openPage(hit, true);
                }
              }
            }}
          />
        </div>
        <Command.List className="overflow-y-auto p-2">
          {!ws ? null : search.isError ? (
            <p className="px-3 py-6 text-center text-body text-on-surface-muted">Couldn't search. Check your connection and try again.</p>
          ) : (
            <Command.Group heading={query ? 'Pages and tasks' : 'Recent pages'} className={groupClass}>
              {search.data?.map((hit) => (
                <Command.Item
                  key={hit.id}
                  value={`page:${hit.id}`}
                  data-page-id={hit.id}
                  onSelect={() => openPage(hit, false)}
                  className={itemClass}
                >
                  {hit.kind === 'task' ? hit.status === 'done' ? <CircleCheck /> : <SquareCheck /> : <FileText />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={hit.status === 'done' ? 'truncate text-on-surface-subtle line-through' : 'truncate'}>
                      {hit.kind === 'task' ? hit.title : pageTitle(hit)}
                    </span>
                    {query && hit.snippet ? (
                      <span className="truncate text-meta text-on-surface-muted">
                        <Snippet text={hit.snippet} />
                      </span>
                    ) : (
                      <span className="truncate text-meta text-on-surface-subtle">{projectName(hit.projectId)}</span>
                    )}
                  </span>
                </Command.Item>
              ))}
              {query && search.isSuccess && search.data.length === 0 && (
                <p className="px-3 py-2 text-body text-on-surface-muted">Nothing matches “{query}”.</p>
              )}
            </Command.Group>
          )}
          {(shownCommands.length > 0 || shownWorkspaces.length > 0) && (
          <Command.Group heading="Commands" className={groupClass}>
            {shownCommands
              .map((c) => (
                <Item key={c.value} value={c.value} icon={c.icon} hint={c.hint} onSelect={() => run(c.fn)}>
                  {c.label}
                </Item>
              ))}
            {shownWorkspaces
              .map((w) => (
                <Item
                  key={w.id}
                  value={`ws:${w.id}`}
                  icon={<WorkspaceGlyph name={w.name} icon={w.icon} />}
                  hint={`${modKey}${workspaces.indexOf(w) + 1}`}
                  onSelect={() => run(() => void navigate({ to: '/w/$workspaceId', params: { workspaceId: w.id } }))}
                >
                  Switch to {w.name}
                </Item>
              ))}
          </Command.Group>
          )}
        </Command.List>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-meta text-on-surface-subtle">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="hidden medium:inline">{modKey}↵ new tab</span>
          <span className="ml-auto">Esc to close</span>
        </div>
      </Command>
    </>
  );
}
