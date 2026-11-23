import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { workspacesQuery } from '@web/lib/queries';
import { Route as AppRoute } from '../_app';

export const Route = createFileRoute('/_app/w/$workspaceId')({
  loader: async ({ context: { queryClient }, params }) => {
    const all = await queryClient.ensureQueryData(workspacesQuery);
    if (!all.some((w) => w.id === params.workspaceId)) throw notFound();
  },
  notFoundComponent: MissingWorkspace,
  component: WorkspaceHome,
});

function greeting(d: Date) {
  const h = d.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function WorkspaceHome() {
  const { workspaceId } = Route.useParams();
  const { me } = AppRoute.useRouteContext();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const ws = workspaces.find((w) => w.id === workspaceId);
  const now = new Date();
  const first = me.name.split(/\s+/)[0];

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-4 pt-10 pb-16 medium:px-6 expanded:px-10 expanded:pt-16">
      <header className="flex flex-col gap-1">
        <p className="text-meta text-on-surface-muted">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="text-display font-semibold">
          {greeting(now)}
          {first ? `, ${first}` : ''}
        </h1>
      </header>

      <section aria-labelledby="empty-title" className="flex max-w-doc flex-col gap-2">
        <h2 id="empty-title" className="text-h3 font-semibold">
          {ws?.name} is ready
        </h2>
        <p className="text-body text-on-surface-muted">
          Docs, tasks and pins land here next. For now you can rename this workspace, give it an icon, or add one for each
          client.
        </p>
        <p className="pt-2">
          <Link
            to="/settings/workspaces"
            className="text-label font-medium text-on-surface underline decoration-border-strong underline-offset-4 hover:decoration-2"
          >
            Manage workspaces
          </Link>
        </p>
      </section>
    </div>
  );
}

function MissingWorkspace() {
  return (
    <div className="mx-auto flex max-w-doc flex-col gap-2 px-4 pt-16 medium:px-6">
      <h1 className="text-h2 font-semibold">This workspace isn't here</h1>
      <p className="text-body text-on-surface-muted">It may have been deleted or moved to Trash.</p>
      <p className="pt-2">
        <Link to="/settings/workspaces" className="text-label font-medium underline decoration-border-strong underline-offset-4">
          See all workspaces
        </Link>
      </p>
    </div>
  );
}
