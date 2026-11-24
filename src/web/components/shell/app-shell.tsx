import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { House, Layers, PanelLeft, PanelLeftClose, Search, Settings, SquareCheck, Star, Trash2 } from 'lucide-react';
import { Dialog as D, Tooltip } from 'radix-ui';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { PageType, Workspace } from '@shared/schemas';
import { errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { treeQuery, useContentMutations } from '@web/lib/content';
import { useLiveRefresh } from '@web/lib/live';
import { cycleTheme, PREF, setPref, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, usePref } from '@web/lib/prefs';
import { workspacesQuery } from '@web/lib/queries';
import { useShortcuts } from '@web/lib/shortcuts';
import { countsQuery, isPinned, pinsQuery, today, usePins } from '@web/lib/tasks';
import { QuickAdd } from '@web/components/tasks/quick-add';
import { TaskSheet } from '@web/components/tasks/task-sheet';
import { Dialog } from '@web/components/ui/dialog';
import { lastWorkspace, modKey, rememberWorkspace } from '@web/lib/workspace-memory';
import { CommandMenu } from './command-menu';
import { NameDialog } from './name-dialog';
import { ProjectTree } from './project-tree';
import { ShortcutSheet } from './shortcut-sheet';
import { WorkspaceSwitcher } from './workspace-switcher';

type ShellActions = { openSearch: () => void; newPage: (type?: PageType) => void; newProject: () => void; newTask: () => void };
const ShellContext = createContext<ShellActions>({ openSearch: () => {}, newPage: () => {}, newProject: () => {}, newTask: () => {} });
/** Shell-level actions (search, new page, new project, new task) for screens inside the shell. */
export const useShell = () => useContext(ShellContext);

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
  );
}

const navClass = cn(
  'flex h-nav items-center gap-2 rounded-md px-2 text-body text-on-surface',
  'transition-colors duration-(--duration-micro) ease-out pointer-hover:hover:bg-border/70',
  'aria-[current=page]:bg-primary aria-[current=page]:text-on-primary',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]',
);

const railButton = cn(
  'grid size-9 place-items-center rounded-md text-on-surface-muted transition-colors duration-(--duration-micro)',
  'pointer-hover:hover:bg-border/70 pointer-hover:hover:text-on-surface aria-[current=page]:bg-primary aria-[current=page]:text-on-primary',
  'data-[state=open]:bg-border/70 [&_svg]:size-4.5 [&_svg]:stroke-[1.5]',
);

function RailTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={400}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={8} className="z-50 rounded-sm bg-on-surface px-2 py-1 text-meta text-surface">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Tasks due today or overdue: the one count that gets the lime badge (DESIGN.md § Nav item). */
function TodayBadge({ ws, rail }: { ws: string; rail?: boolean }) {
  const { data } = useQuery(countsQuery(ws, today()));
  const n = data?.today ?? 0;
  if (!n) return null;
  return (
    <span
      aria-label={`${n} due today`}
      className={cn(
        'tnum grid min-w-5 place-items-center rounded-sm bg-accent px-1.5 text-meta font-medium text-on-accent',
        rail && 'absolute -top-1 -right-1 min-w-4 px-1 text-[length:var(--text-meta)] leading-4',
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** The sidebar body, shared by the full sidebar, the rail's peek panel and the compact sheet. */
function SidebarBody({
  ws,
  workspaces,
  current,
  onSearch,
  onNavigate,
  footer,
}: {
  ws: string | undefined;
  workspaces: Workspace[];
  current: Workspace | undefined;
  onSearch: () => void;
  onNavigate?: () => void;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-2 py-3">
      <WorkspaceSwitcher workspaces={workspaces} current={current} className="w-full" />
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <button type="button" className={cn(navClass, 'text-on-surface-muted')} onClick={onSearch}>
          <Search aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <kbd className="font-sans text-meta text-on-surface-subtle">{modKey}K</kbd>
        </button>
        {ws && (
          <>
            <Link to="/w/$workspaceId" params={{ workspaceId: ws }} activeOptions={{ exact: true }} className={navClass} onClick={onNavigate}>
              <House aria-hidden />
              Home
            </Link>
            <Link to="/w/$workspaceId/important" params={{ workspaceId: ws }} className={navClass} onClick={onNavigate}>
              <Star aria-hidden />
              Important
            </Link>
            <Link to="/w/$workspaceId/tasks" params={{ workspaceId: ws }} search={{ view: 'today', layout: 'list' }} className={cn(navClass, 'group')} onClick={onNavigate}>
              <SquareCheck aria-hidden />
              <span className="flex-1">Tasks</span>
              <TodayBadge ws={ws} />
            </Link>
          </>
        )}
      </nav>
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">{ws && <ProjectTree ws={ws} onNavigate={onNavigate} />}</div>
      <div className="flex flex-col gap-0.5">
        {ws && (
          <Link to="/w/$workspaceId/trash" params={{ workspaceId: ws }} className={navClass} onClick={onNavigate}>
            <Trash2 aria-hidden />
            Trash
          </Link>
        )}
        <div className="flex items-center gap-0.5">
          <Link to="/settings/workspaces" className={cn(navClass, 'flex-1')} onClick={onNavigate}>
            <Settings aria-hidden />
            Settings
          </Link>
          {footer}
        </div>
      </div>
    </div>
  );
}

/**
 * App shell (DESIGN.md § Layout): full sidebar from 840 px (collapsible to a
 * 52 px rail with a peek panel, resizable 200–360 px), the rail at 600–839 px,
 * and a top bar with a sheet below 600 px.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const params = useParams({ strict: false }) as { workspaceId?: string; pageId?: string };
  const navigate = useNavigate();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const currentId = params.workspaceId ?? lastWorkspace();
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];
  const ws = current?.id;
  const { data: tree } = useQuery({ ...treeQuery(ws ?? ''), enabled: !!ws });
  const m = useContentMutations(ws ?? '');

  const wide = useMedia('(min-width: 840px)');
  const medium = useMedia('(min-width: 600px)');
  const pref = usePref(PREF.sidebar, 'expanded');
  const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(usePref(PREF.sidebarWidth, String(SIDEBAR_DEFAULT))) || SIDEBAR_DEFAULT));
  const mode = wide ? (pref === 'collapsed' ? 'rail' : 'full') : medium ? 'rail' : 'compact';

  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [newProjectThenPage, setNewProjectThenPage] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const knownId = workspaces.some((w) => w.id === params.workspaceId) ? params.workspaceId : undefined;
  useEffect(() => {
    if (knownId) rememberWorkspace(knownId);
  }, [knownId]);
  // The peek panel and the compact sheet close whenever the route changes: their
  // open state is tied to the route they were opened on.
  const routeKey = `${params.workspaceId}/${params.pageId}`;
  if (openedAt !== routeKey && (peekOpen || sheetOpen)) {
    setPeekOpen(false);
    setSheetOpen(false);
  }
  const peek = peekOpen && openedAt === routeKey;
  const sheet = sheetOpen && openedAt === routeKey;
  const setPeek = (v: boolean | ((p: boolean) => boolean)) => {
    setOpenedAt(routeKey);
    setPeekOpen(typeof v === 'function' ? v(peek) : v);
  };
  const setSheet = (v: boolean | ((p: boolean) => boolean)) => {
    setOpenedAt(routeKey);
    setSheetOpen(typeof v === 'function' ? v(sheet) : v);
  };

  useLiveRefresh(ws);

  // Warm the editor chunk once the app is idle, so opening a doc is instant.
  useEffect(() => {
    const id = window.setTimeout(() => void import('@web/components/editor/doc-editor'), 1500);
    return () => window.clearTimeout(id);
  }, []);

  const toggleSidebar = () => {
    if (!wide) return setSheet((s) => !s);
    setPref(PREF.sidebar, pref === 'collapsed' ? 'expanded' : 'collapsed');
    setPeek(false);
  };

  async function newPage(type: PageType = 'doc') {
    if (!ws) return;
    const currentPage = tree?.pages.find((p) => p.id === params.pageId);
    const projectId = currentPage?.projectId ?? tree?.projects[0]?.id;
    if (!projectId) return setNewProjectThenPage(true);
    try {
      const { page } = await m.createPage.mutateAsync({ projectId, folderId: currentPage?.folderId ?? null, type });
      void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId: ws, pageId: page.id } });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // Quick add (T): into the open page's project, else the Inbox.
  const [quickAdd, setQuickAdd] = useState(false);
  const pageProject = tree?.pages.find((p) => p.id === params.pageId)?.projectId ?? null;
  const pinsApi = usePins(ws ?? '');
  const { data: pins } = useQuery({ ...pinsQuery(ws ?? ''), enabled: !!ws });
  const togglePagePin = () => {
    if (!ws || !params.pageId) return;
    pinsApi.toggle.mutate({ itemType: 'page', itemId: params.pageId, pinned: isPinned(pins, 'page', params.pageId) });
  };

  useShortcuts([
    { combo: 'mod+k', handler: () => setCmdOpen((o) => !o) },
    { combo: 'mod+n', handler: () => void newPage() },
    { combo: 'mod+\\', handler: toggleSidebar },
    { combo: '?', handler: () => setShortcutsOpen(true) },
    { combo: 't', handler: () => ws && setQuickAdd(true) },
    { combo: 'mod+shift+p', handler: togglePagePin },
    ...workspaces.slice(0, 9).map((w, i) => ({
      combo: `mod+${i + 1}`,
      handler: () => void navigate({ to: '/w/$workspaceId', params: { workspaceId: w.id } }),
    })),
  ]);

  const body = (onNavigate?: () => void, footer?: ReactNode) => (
    <SidebarBody ws={ws} workspaces={workspaces} current={current} onSearch={() => setCmdOpen(true)} onNavigate={onNavigate} footer={footer} />
  );

  const collapseButton = wide && (
    <button type="button" onClick={toggleSidebar} aria-label="Collapse sidebar" title={`Collapse sidebar (${modKey}\\)`} className={cn(railButton, 'size-nav')}>
      <PanelLeftClose aria-hidden />
    </button>
  );

  return (
    <ShellContext.Provider
      value={{ openSearch: () => setCmdOpen(true), newPage: (type) => void newPage(type), newProject: () => setNewProjectThenPage(true), newTask: () => setQuickAdd(true) }}
    >
    <Tooltip.Provider>
      <div className="flex h-dvh overflow-hidden bg-neutral">
        {mode === 'full' && (
          <aside aria-label="Sidebar" className="relative shrink-0" style={{ width }}>
            {body(undefined, collapseButton)}
            <ResizeHandle width={width} />
          </aside>
        )}

        {mode === 'rail' && (
          <aside
            aria-label="Sidebar"
            className="relative z-30 flex w-13 shrink-0 flex-col items-center gap-1 py-3"
            onPointerEnter={(e) => {
              if (e.pointerType !== 'mouse') return;
              clearTimeout(peekTimer.current);
              peekTimer.current = setTimeout(() => setPeek(true), 300);
            }}
            onPointerLeave={() => {
              clearTimeout(peekTimer.current);
              peekTimer.current = setTimeout(() => setPeek(false), 200);
            }}
          >
            <WorkspaceSwitcher workspaces={workspaces} current={current} glyphOnly className="mb-2 size-9 justify-center px-0" />
            <RailTip label={`Search (${modKey}K)`}>
              <button type="button" className={railButton} aria-label="Search" onClick={() => setCmdOpen(true)}>
                <Search aria-hidden />
              </button>
            </RailTip>
            {ws && (
              <>
                <RailTip label="Home">
                  <Link to="/w/$workspaceId" params={{ workspaceId: ws }} activeOptions={{ exact: true }} className={railButton} aria-label="Home">
                    <House aria-hidden />
                  </Link>
                </RailTip>
                <RailTip label="Important">
                  <Link to="/w/$workspaceId/important" params={{ workspaceId: ws }} className={railButton} aria-label="Important">
                    <Star aria-hidden />
                  </Link>
                </RailTip>
                <RailTip label="Tasks">
                  <Link to="/w/$workspaceId/tasks" params={{ workspaceId: ws }} search={{ view: 'today', layout: 'list' }} className={cn(railButton, 'relative')} aria-label="Tasks">
                    <SquareCheck aria-hidden />
                    <TodayBadge ws={ws} rail />
                  </Link>
                </RailTip>
              </>
            )}
            <RailTip label="Projects">
              <button type="button" className={railButton} aria-label="Projects" aria-expanded={peek} onClick={() => setPeek((p) => !p)}>
                <Layers aria-hidden />
              </button>
            </RailTip>
            <div className="mt-auto flex flex-col items-center gap-1">
              {ws && (
                <RailTip label="Trash">
                  <Link to="/w/$workspaceId/trash" params={{ workspaceId: ws }} className={railButton} aria-label="Trash">
                    <Trash2 aria-hidden />
                  </Link>
                </RailTip>
              )}
              <RailTip label="Settings">
                <Link to="/settings/workspaces" className={railButton} aria-label="Settings">
                  <Settings aria-hidden />
                </Link>
              </RailTip>
              {wide && (
                <RailTip label={`Expand sidebar (${modKey}\\)`}>
                  <button type="button" className={railButton} aria-label="Expand sidebar" onClick={toggleSidebar}>
                    <PanelLeft aria-hidden />
                  </button>
                </RailTip>
              )}
            </div>
            {peek && (
              <div
                role="dialog"
                aria-label="Pages"
                onKeyDown={(e) => e.key === 'Escape' && setPeek(false)}
                className="peek-panel absolute top-2 bottom-2 left-full ml-1 w-sidebar rounded-lg shadow-2 ring-1 ring-border"
              >
                {body(() => setPeek(false))}
              </div>
            )}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {mode === 'compact' && (
            <header className="flex h-topbar shrink-0 items-center gap-1 bg-neutral px-2 pt-[env(safe-area-inset-top)]">
              <button type="button" className={cn(railButton, 'size-11')} aria-label="Open sidebar" onClick={() => setSheet(true)}>
                <PanelLeft aria-hidden />
              </button>
              <WorkspaceSwitcher workspaces={workspaces} current={current} className="min-w-0 flex-1" />
              <button type="button" className={cn(railButton, 'size-11')} aria-label="Search" onClick={() => setCmdOpen(true)}>
                <Search aria-hidden />
              </button>
            </header>
          )}
          <main id="main" className="min-h-0 flex-1 overflow-y-auto bg-surface medium:my-2 medium:mr-2 medium:rounded-lg medium:ring-1 medium:ring-border">
            {children}
          </main>
        </div>
      </div>

      <D.Root open={sheet} onOpenChange={setSheet}>
        <D.Portal>
          <D.Overlay className="animate-scrim fixed inset-0 z-40 bg-scrim" />
          <D.Content aria-describedby={undefined} className="sheet-left fixed inset-y-0 left-0 z-50 w-[min(var(--spacing-sidebar),85vw)] bg-neutral pt-[env(safe-area-inset-top)] shadow-3">
            <D.Title className="sr-only">Sidebar</D.Title>
            {body(() => setSheet(false))}
          </D.Content>
        </D.Portal>
      </D.Root>

      <CommandMenu
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        ws={ws}
        workspaces={workspaces}
        actions={{
          newPage: (type) => void newPage(type),
          newTask: () => setQuickAdd(true),
          newProject: () => setNewProjectThenPage(true),
          toggleSidebar,
          toggleTheme: () => {
            const t = cycleTheme();
            toast(`Theme: ${t === 'system' ? 'match system' : t}`);
          },
          showShortcuts: () => setShortcutsOpen(true),
        }}
      />
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <TaskSheet ws={ws} />
      {ws && (
        <Dialog
          open={quickAdd}
          onOpenChange={setQuickAdd}
          title="New task"
          description={pageProject ? `Adds to ${tree?.projects.find((p) => p.id === pageProject)?.name ?? 'this project'}.` : 'Adds to the Inbox. Dates and repeats in plain words work.'}
        >
          <QuickAdd
            ws={ws}
            projectId={pageProject}
            autoFocus
            onCreated={() => {
              setQuickAdd(false);
              toast('Task added');
            }}
          />
        </Dialog>
      )}
      <NameDialog
        open={newProjectThenPage}
        onOpenChange={setNewProjectThenPage}
        title="New project"
        description="A project holds the pages for one client, goal or deliverable."
        label="Name"
        placeholder="Website"
        submitLabel="Create project"
        onSubmit={async (name) => {
          const { project } = await m.createProject.mutateAsync({ name });
          const { page } = await m.createPage.mutateAsync({ projectId: project.id });
          if (ws) void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId: ws, pageId: page.id } });
        }}
      />
    </Tooltip.Provider>
    </ShellContext.Provider>
  );
}

/** Drag or use arrow keys to set the sidebar width (200–360 px). Double-click resets. */
function ResizeHandle({ width }: { width: number }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const set = (w: number) => setPref(PREF.sidebarWidth, String(Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => start.current && set(start.current.w + e.clientX - start.current.x)}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={() => set(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') set(width - 8);
        if (e.key === 'ArrowRight') set(width + 8);
      }}
      className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none"
    >
      <span className="absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-primary opacity-0 transition-opacity duration-(--duration-micro) group-hover:opacity-40 group-focus-visible:opacity-100 group-active:opacity-60" />
    </div>
  );
}
