import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { FilePlus, FileText, FolderPlus } from 'lucide-react';
import { SkeletonRows } from '@web/components/shell/route-states';
import { TopBar } from '@web/components/shell/top-bar';
import { Button } from '@web/components/ui/button';
import { pageTitle, searchQuery, treeQuery } from '@web/lib/content';
import { workspacesQuery } from '@web/lib/queries';
import { relativeTime, editedByLabel } from '@web/lib/time';
import { useShell } from '@web/components/shell/app-shell';
import { Route as AppRoute } from '../_app';

export const Route = createFileRoute('/_app/w/$workspaceId/')({
  component: WorkspaceHome,
});

function greeting(d: Date) {
  const h = d.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** M1 Home: greeting and recent pages. Pinned and Today join in M2. */
function WorkspaceHome() {
  const { workspaceId } = Route.useParams();
  const { me } = AppRoute.useRouteContext();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const ws = workspaces.find((w) => w.id === workspaceId);
  const recent = useQuery(searchQuery(workspaceId, ''));
  const tree = useQuery(treeQuery(workspaceId));
  const now = new Date();
  const first = me.name.split(/\s+/)[0];
  const recentPages = recent.data?.slice(0, 8) ?? [];

  const shell = useShell();

  return (
    <>
      <TopBar crumbs={[{ label: ws?.name ?? 'Workspace' }, { label: 'Home' }]} />
      <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-4 pt-8 pb-16 medium:px-6 expanded:px-10 expanded:pt-12">
        <header className="flex flex-col gap-1">
          <p className="text-meta text-on-surface-muted">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="text-display font-semibold">
            {greeting(now)}
            {first ? `, ${first}` : ''}
          </h1>
        </header>

        <section aria-labelledby="recent" className="flex flex-col gap-2">
          <h2 id="recent" className="text-label font-medium text-on-surface-muted">
            Recent
          </h2>
          {recent.isPending || tree.isPending ? (
            <SkeletonRows rows={4} />
          ) : recent.isError ? (
            <div role="alert" className="flex items-center gap-3 py-2">
              <p className="flex-1 text-body text-on-surface-muted">Couldn't load recent pages.</p>
              <Button size="sm" onClick={() => void recent.refetch()}>
                Try again
              </Button>
            </div>
          ) : recentPages.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-body text-on-surface-muted">
                {tree.data?.projects.length ? 'No pages yet. Write the first one.' : 'Nothing here yet. Start with a project, then add pages to it.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={shell.newPage}>
                  <FilePlus className="size-4" strokeWidth={1.5} aria-hidden />
                  New doc
                </Button>
                <Button onClick={shell.newProject}>
                  <FolderPlus className="size-4" strokeWidth={1.5} aria-hidden />
                  New project
                </Button>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col">
              {recentPages.map((p) => {
                const project = tree.data?.projects.find((x) => x.id === p.projectId);
                const node = tree.data?.pages.find((x) => x.id === p.id);
                const by = node ? editedByLabel(node.updatedBy) : null;
                return (
                  <li key={p.id} className="border-b border-border last:border-0">
                    <Link
                      to="/w/$workspaceId/p/$pageId"
                      params={{ workspaceId, pageId: p.id }}
                      className="flex min-h-row items-center gap-3 rounded-md px-1 py-1.5 pointer-hover:hover:bg-neutral"
                    >
                      <FileText className="size-4 shrink-0 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-body text-on-surface">{pageTitle(p)}</span>
                      <span className="hidden max-w-48 truncate text-meta text-on-surface-subtle medium:block">{project?.name}</span>
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
      </div>
    </>
  );
}
