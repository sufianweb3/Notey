import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { BookOpen, PencilLine } from 'lucide-react';
import { useState } from 'react';
import type { TokenScope } from '@shared/schemas';
import { AuthLayout, FormError } from '@web/components/shell/auth-layout';
import { Button } from '@web/components/ui/button';
import { WorkspaceGlyph } from '@web/components/ui/glyph';
import { api, errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { meQuery, setupQuery, workspacesQuery } from '@web/lib/queries';
import { lastWorkspace } from '@web/lib/workspace-memory';

/*
 * OAuth consent (PRD 6.13). /oauth/authorize sends the browser here with the
 * app's request; the owner picks one workspace and what the app may do.
 */
export const Route = createFileRoute('/connect')({
  beforeLoad: async ({ context: { queryClient }, location }) => {
    if ((await queryClient.ensureQueryData(setupQuery)).needsSetup) throw redirect({ to: '/setup' });
    if (!(await queryClient.ensureQueryData(meQuery))) throw redirect({ to: '/login', search: { next: location.href } });
  },
  component: Connect,
});

type RequestInfo = { client: { name: string }; redirectHost: string; scope: TokenScope };

function Connect() {
  const params = location.search;
  const request = Object.fromEntries(new URLSearchParams(params));
  const info = useQuery({
    queryKey: ['oauth-request', params],
    queryFn: () => api<RequestInfo>(`/api/oauth/request${params}`),
    retry: false,
  });
  const workspaces = useQuery(workspacesQuery);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [scope, setScope] = useState<TokenScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null);

  if (info.isError) {
    return (
      <AuthLayout title="This connection link doesn’t work" subtitle={errorMessage(info.error)}>
        <p className="text-body text-on-surface-muted">Start the connection again from the app you were using.</p>
      </AuthLayout>
    );
  }
  if (info.isPending || workspaces.isPending) {
    return (
      <AuthLayout title="Connect an app" subtitle="Checking the request…">
        <div className="h-40 animate-pulse rounded-lg bg-border/60" aria-label="Loading" />
      </AuthLayout>
    );
  }

  const app = info.data.client.name;
  const list = workspaces.data ?? [];
  const chosenWs = workspaceId ?? (list.find((w) => w.id === lastWorkspace()) ?? list[0])?.id ?? null;
  const chosenScope = scope ?? info.data.scope;

  async function decide(kind: 'allow' | 'deny') {
    if (kind === 'allow' && !chosenWs) return setError('Pick a workspace.');
    setError(null);
    setPending(kind);
    try {
      const res = await api<{ redirect: string }>(`/api/oauth/${kind === 'allow' ? 'approve' : 'deny'}`, {
        body: kind === 'allow' ? { request, workspaceId: chosenWs, scope: chosenScope } : { request },
      });
      location.assign(res.redirect);
    } catch (e) {
      setPending(null);
      setError(errorMessage(e));
    }
  }

  return (
    <AuthLayout
      title={`Connect ${app} to Notey`}
      subtitle={
        <>
          {app} will see <strong className="font-medium text-on-surface">one workspace</strong>, and nothing else in Notey. You’ll return to{' '}
          <span className="font-medium text-on-surface">{info.data.redirectHost}</span>.
        </>
      }
    >
      <FormError message={error} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label font-medium">Workspace</legend>
        <div role="radiogroup" aria-label="Workspace" className="flex flex-col gap-1.5">
          {list.map((w) => (
            <label
              key={w.id}
              className={cn(
                'flex min-h-row cursor-pointer items-center gap-3 rounded-md bg-surface-raised px-3 ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-primary',
                chosenWs === w.id && 'ring-2 ring-primary',
              )}
            >
              <input type="radio" name="workspace" className="sr-only" checked={chosenWs === w.id} onChange={() => setWorkspaceId(w.id)} />
              <WorkspaceGlyph name={w.name} icon={w.icon} />
              <span className="min-w-0 flex-1 truncate text-body">{w.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label font-medium">{app} may</legend>
        <div role="radiogroup" aria-label="Access" className="flex flex-col gap-1.5">
          {(
            [
              ['read', 'Read', 'Pages, tasks and search.', BookOpen],
              ['write', 'Read and write', 'Also create and edit pages and tasks. Every edit is saved in page history.', PencilLine],
            ] as const
          ).map(([value, label, hint, Icon]) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md bg-surface-raised px-3 py-2.5 ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-primary',
                chosenScope === value && 'ring-2 ring-primary',
              )}
            >
              <input type="radio" name="scope" className="sr-only" checked={chosenScope === value} onChange={() => setScope(value)} />
              <Icon className="mt-0.5 size-4 shrink-0 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
              <span className="flex flex-col">
                <span className="text-body font-medium">{label}</span>
                <span className="text-meta text-on-surface-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-meta text-on-surface-muted">Apps can never delete anything permanently. You can disconnect {app} any time in Settings › AI access.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" loading={pending === 'deny'} disabled={!!pending} onClick={() => void decide('deny')}>
          Deny
        </Button>
        <Button variant="primary" loading={pending === 'allow'} disabled={!!pending || !chosenWs} onClick={() => void decide('allow')}>
          Allow
        </Button>
      </div>
    </AuthLayout>
  );
}
