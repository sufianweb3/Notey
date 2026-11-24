import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { FilePlus, FileText, FolderPlus, ListPlus, Plug } from 'lucide-react';
import { useShell } from '@web/components/shell/app-shell';
import { PinCard } from '@web/components/pins/pin-card';
import { SkeletonRows } from '@web/components/shell/route-states';
import { TopBar } from '@web/components/shell/top-bar';
import { TaskRow } from '@web/components/tasks/task-row';
import { Button } from '@web/components/ui/button';
import { pageTitle, searchQuery, treeQuery } from '@web/lib/content';
import { workspacesQuery } from '@web/lib/queries';
import { pinsQuery, tasksQuery, today } from '@web/lib/tasks';
import { editedByLabel, relativeTime } from '@web/lib/time';
import { Route as AppRoute } from '../_app';

export const Route = createFileRoute('/_app/w/$workspaceId/')({
  component: WorkspaceHome,
});

function greeting(d: Date) {
  const h = d.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function SectionHead({ id, title, aside }: { id: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-label font-medium text-on-surface-muted">
        {title}
      </h2>
      {aside}
    </div>
  );
}

/** Home (PRD 6.7): greeting, Pinned (up to 6), Today's tasks, Recent pages. */
function WorkspaceHome() {
  const { workspaceId: ws } = Route.useParams();
  const { me } = AppRoute.useRouteContext();
  const shell = useShell();
  const day = today();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const recent = useQuery(searchQuery(ws, ''));
  const tree = useQuery(treeQuery(ws));
  const pins = useQuery(pinsQuery(ws));
  const todayTasks = useQuery(tasksQuery(ws, 'today', day));
  const now = new Date();
  const first = me.name.split(/\s+/)[0];
  const wsName = workspaces.find((w) => w.id === ws)?.name ?? 'Workspace';
  const recentPages = recent.data?.slice(0, 8) ?? [];
  const pinned = pins.data?.filter((p) => p.itemType !== 'task').slice(0, 6) ?? [];
  // One signal card at most: the first pinned project that has tasks.
  const signalId = pinned.find((p) => p.itemType === 'project' && (p.progress?.total ?? 0) > 0)?.id;
  const projectName = (id?: string | null) => tree.data?.projects.find((p) => p.id === id)?.name;

  const loading = recent.isPending || tree.isPending || todayTasks.isPending || pins.isPending;
  const nothingYet = !loading && !recentPages.length && !todayTasks.data?.length && !pinned.length;

  return (
    <>
      <TopBar crumbs={[{ label: wsName }, { label: 'Home' }]} />
      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-4 pt-8 pb-16 medium:px-6 expanded:px-10 expanded:pt-12">
        <header className="flex flex-col gap-1">
          <p className="text-meta text-on-surface-muted">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="text-display font-semibold">
            {greeting(now)}
            {first ? `, ${first}` : ''}
          </h1>
        </header>

        {loading ? (
          <SkeletonRows rows={5} />
        ) : nothingYet ? (
          <section aria-labelledby="start" className="flex flex-col gap-3">
            <h2 id="start" className="text-h3 font-semibold">
              Start with one of these
            </h2>
            <p className="text-body text-on-surface-muted">
              {tree.data?.projects.length ? 'Write a page or capture a task.' : 'Pages live in projects. Your first doc creates one.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => shell.newPage('doc')}>
                <FilePlus className="size-4" strokeWidth={1.5} aria-hidden />
                New doc
              </Button>
              <Button onClick={shell.newTask}>
                <ListPlus className="size-4" strokeWidth={1.5} aria-hidden />
                New task
              </Button>
              <Link
                to="/settings/ai-access"
                className="inline-flex h-control items-center gap-2 rounded-md px-btn-x text-label font-medium text-on-surface-muted hover:bg-border/70 hover:text-on-surface"
              >
                <Plug className="size-4" strokeWidth={1.5} aria-hidden />
                Connect an AI
              </Link>
              {!tree.data?.projects.length && (
                <Button variant="ghost" onClick={shell.newProject}>
                  <FolderPlus className="size-4" strokeWidth={1.5} aria-hidden />
                  New project
                </Button>
              )}
            </div>
          </section>
        ) : (
          <>
            {pinned.length > 0 && (
              <section aria-labelledby="pinned" className="flex flex-col gap-2">
                <SectionHead
                  id="pinned"
                  title="Pinned"
                  aside={
                    <Link to="/w/$workspaceId/important" params={{ workspaceId: ws }} className="text-meta text-on-surface-muted underline decoration-border-strong underline-offset-4 hover:text-on-surface">
                      See all
                    </Link>
                  }
                />
                <div className="grid grid-cols-2 gap-3 medium:grid-cols-3">
                  {pinned.map((p) => (
                    <PinCard key={p.id} ws={ws} pin={p} signal={p.id === signalId} projectName={projectName(p.projectId)} />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="today" className="flex flex-col gap-1">
              <SectionHead
                id="today"
                title="Today"
                aside={
                  todayTasks.data?.length ? (
                    <span className="tnum text-meta text-on-surface-subtle">{todayTasks.data.length} left</span>
                  ) : undefined
                }
              />
              {todayTasks.isError ? (
                <p role="alert" className="py-2 text-body text-on-surface-muted">
                  Couldn't load today's tasks.{' '}
                  <button type="button" className="underline underline-offset-4" onClick={() => void todayTasks.refetch()}>
                    Try again
                  </button>
                </p>
              ) : todayTasks.data?.length ? (
                <ul className="flex flex-col">
                  {todayTasks.data.slice(0, 8).map((t) => (
                    <TaskRow key={t.id} ws={ws} task={t} showProject />
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-body text-on-surface-muted">Nothing due today. Add a task with T.</p>
              )}
              {(todayTasks.data?.length ?? 0) > 8 && (
                <Link to="/w/$workspaceId/tasks" params={{ workspaceId: ws }} search={{ view: 'today', layout: 'list' }} className="pt-2 text-meta text-on-surface-muted underline decoration-border-strong underline-offset-4">
                  All {todayTasks.data!.length} for today
                </Link>
              )}
            </section>

            <section aria-labelledby="recent" className="flex flex-col gap-1">
              <SectionHead id="recent" title="Recent" />
              {recent.isError ? (
                <p role="alert" className="py-2 text-body text-on-surface-muted">
                  Couldn't load recent pages.{' '}
                  <button type="button" className="underline underline-offset-4" onClick={() => void recent.refetch()}>
                    Try again
                  </button>
                </p>
              ) : recentPages.length === 0 ? (
                <p className="py-2 text-body text-on-surface-muted">No pages yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {recentPages.map((p) => {
                    const node = tree.data?.pages.find((x) => x.id === p.id);
                    const by = node ? editedByLabel(node.updatedBy) : null;
                    return (
                      <li key={p.id} className="border-b border-border last:border-0">
                        <Link
                          to="/w/$workspaceId/p/$pageId"
                          params={{ workspaceId: ws, pageId: p.id }}
                          className="flex min-h-row items-center gap-3 rounded-md px-1 py-1.5 pointer-hover:hover:bg-neutral"
                        >
                          <FileText className="size-4 shrink-0 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-body text-on-surface">{pageTitle(p)}</span>
                          <span className="hidden max-w-48 truncate text-meta text-on-surface-subtle medium:block">{projectName(p.projectId)}</span>
                          <span className="tnum shrink-0 text-meta text-on-surface-subtle">
                            {by ? `${by} · ` : ''}
                            {relativeTime(p.updatedAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
