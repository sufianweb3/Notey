import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '@web/components/shell/app-shell';
import { meQuery, setupQuery, workspacesQuery } from '@web/lib/queries';

/** Everything behind the owner session. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context: { queryClient }, location }) => {
    if ((await queryClient.ensureQueryData(setupQuery)).needsSetup) throw redirect({ to: '/setup' });
    const me = await queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: '/login', search: { next: location.href } });
    return { me };
  },
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(workspacesQuery),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
