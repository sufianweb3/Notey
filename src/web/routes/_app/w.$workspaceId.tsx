import { createFileRoute, Link, notFound, Outlet } from '@tanstack/react-router';
import { treeQuery } from '@web/lib/content';
import { workspacesQuery } from '@web/lib/queries';

/** One workspace. Children: Home (index), a page, Trash. */
export const Route = createFileRoute('/_app/w/$workspaceId')({
  loader: async ({ context: { queryClient }, params }) => {
    const all = await queryClient.ensureQueryData(workspacesQuery);
    if (!all.some((w) => w.id === params.workspaceId)) throw notFound();
    // Warm the tree; the sidebar renders its own loading state if this is slow.
    void queryClient.prefetchQuery(treeQuery(params.workspaceId));
  },
  notFoundComponent: MissingWorkspace,
  component: Outlet,
});

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
