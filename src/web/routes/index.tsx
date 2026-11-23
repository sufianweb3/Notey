import { createFileRoute, redirect } from '@tanstack/react-router';
import { meQuery, setupQuery, workspacesQuery } from '@web/lib/queries';
import { lastWorkspace } from '@web/lib/workspace-memory';

/** `/` routes to setup, sign-in, or the last workspace opened on this device. */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context: { queryClient } }) => {
    if ((await queryClient.ensureQueryData(setupQuery)).needsSetup) throw redirect({ to: '/setup' });
    if (!(await queryClient.ensureQueryData(meQuery))) throw redirect({ to: '/login' });
    const workspaces = await queryClient.ensureQueryData(workspacesQuery);
    const last = lastWorkspace();
    const target = workspaces.find((w) => w.id === last) ?? workspaces[0];
    if (!target) throw redirect({ to: '/settings/workspaces' });
    throw redirect({ to: '/w/$workspaceId', params: { workspaceId: target.id } });
  },
});
