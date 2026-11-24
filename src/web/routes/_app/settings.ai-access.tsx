import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Bot, Check, Copy, KeyRound, Plug, Plus, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { TokenInfo, TokenScope, Workspace } from '@shared/schemas';
import { SkeletonRows } from '@web/components/shell/route-states';
import { SettingsNav } from '@web/components/shell/settings-nav';
import { Button } from '@web/components/ui/button';
import { Dialog } from '@web/components/ui/dialog';
import { Field } from '@web/components/ui/field';
import { api, errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { workspacesQuery } from '@web/lib/queries';
import { relativeTime } from '@web/lib/time';
import { lastWorkspace } from '@web/lib/workspace-memory';

export const Route = createFileRoute('/_app/settings/ai-access')({
  component: AiAccess,
});

const tokensKey = (ws: string) => ['ws', ws, 'tokens'] as const;
const SCOPE_LABEL: Record<TokenScope, string> = { read: 'Read', write: 'Read and write' };

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Copy ${label}`}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => toast.error("Couldn't copy. Select the text and copy it instead."),
        )
      }
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

function CodeLine({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-neutral py-1 pr-1 pl-3 ring-1 ring-border">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-mono whitespace-nowrap text-on-surface">{value}</code>
      <CopyButton value={value} label={label} />
    </div>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <span className="text-on-surface-muted [&_svg]:size-4">{icon}</span>
        <h3 className="text-body font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function AiAccess() {
  const workspaces = useQuery(workspacesQuery);
  const list = workspaces.data ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const ws = picked ?? (list.find((w) => w.id === lastWorkspace()) ?? list[0])?.id ?? null;
  const origin = location.origin;
  const mcpUrl = `${origin}/mcp`;

  return (
    <div className="mx-auto flex w-full max-w-doc flex-col gap-10 px-4 pt-8 pb-16 medium:px-6 expanded:pt-16">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-meta text-on-surface-muted">Settings</p>
          <h1 className="text-h1 font-semibold">AI access</h1>
          <p className="text-body text-on-surface-muted">
            Let Claude, ChatGPT or your own scripts work in one workspace. Every edit they make is saved in page history, and they can never delete anything
            permanently.
          </p>
        </div>
        <SettingsNav />
      </header>

      <section aria-labelledby="connect" className="flex flex-col gap-3">
        <h2 id="connect" className="text-h3 font-semibold">
          Connect
        </h2>
        <div className="grid gap-3 medium:grid-cols-2">
          <Card icon={<Plug />} title="Claude.ai or ChatGPT">
            <p className="text-body text-on-surface-muted">Add a custom connector with this URL. You’ll pick the workspace when you approve it.</p>
            <CodeLine value={mcpUrl} label="connector URL" />
          </Card>
          <Card icon={<KeyRound />} title="Claude Code, Codex or a script">
            <p className="text-body text-on-surface-muted">Create a token below. It works for MCP at the same URL and for the REST API.</p>
            <a
              href="/api/v1/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="text-label font-medium underline decoration-border-strong underline-offset-4"
            >
              REST API reference (OpenAPI)
            </a>
          </Card>
        </div>
      </section>

      {workspaces.isPending ? (
        <SkeletonRows rows={3} />
      ) : workspaces.isError ? (
        <p role="alert" className="text-body text-error">
          {errorMessage(workspaces.error)}
        </p>
      ) : ws ? (
        <TokensSection workspaces={list} ws={ws} onPick={setPicked} mcpUrl={mcpUrl} />
      ) : (
        <p className="text-body text-on-surface-muted">Create a workspace first.</p>
      )}
    </div>
  );
}

function TokensSection({ workspaces, ws, onPick, mcpUrl }: { workspaces: Workspace[]; ws: string; onPick: (id: string) => void; mcpUrl: string }) {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: tokensKey(ws), queryFn: async () => (await api<{ tokens: TokenInfo[] }>(`/api/workspaces/${ws}/tokens`)).tokens });
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ token: TokenInfo; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<TokenInfo | null>(null);
  const wsName = workspaces.find((w) => w.id === ws)?.name ?? 'this workspace';

  const revoke = useMutation({
    mutationFn: (t: TokenInfo) => api(`/api/workspaces/${ws}/tokens/${t.id}/revoke`, { body: {} }),
    onSuccess: (_d, t) => {
      setRevoking(null);
      toast(`${t.source === 'oauth' ? 'Disconnected' : 'Revoked'} ${t.name}`);
      void qc.invalidateQueries({ queryKey: tokensKey(ws) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section aria-labelledby="tokens" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="tokens" className="text-h3 font-semibold">
            Tokens and connected apps
          </h2>
          {workspaces.length > 1 ? (
            <label className="flex items-center gap-2 text-body text-on-surface-muted">
              Workspace
              <select
                value={ws}
                onChange={(e) => onPick(e.target.value)}
                className="h-control-sm rounded-md bg-surface-raised px-2 text-body text-on-surface ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-body text-on-surface-muted">For {wsName}.</p>
          )}
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" strokeWidth={1.5} aria-hidden />
          New token
        </Button>
      </div>

      {tokens.isPending ? (
        <SkeletonRows rows={2} />
      ) : tokens.isError ? (
        <div role="alert" className="flex items-center gap-3 text-body text-error">
          <TriangleAlert className="size-4" aria-hidden /> {errorMessage(tokens.error)}
          <Button size="sm" variant="ghost" onClick={() => void tokens.refetch()}>
            Try again
          </Button>
        </div>
      ) : tokens.data.length === 0 ? (
        <p className="rounded-lg px-4 py-6 text-center text-body text-on-surface-muted ring-1 ring-border ring-dashed">
          Nothing connected to {wsName} yet. Create a token, or connect Claude.ai with the URL above.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg bg-surface-raised ring-1 ring-border">
          {tokens.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="text-on-surface-muted">{t.source === 'oauth' ? <Bot className="size-4" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}</span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium [overflow-wrap:anywhere]">{t.name}</span>
                <span className="text-meta text-on-surface-muted">
                  {t.source === 'oauth' ? 'Connected app' : 'Token'} · {SCOPE_LABEL[t.scope]} · {t.lastUsedAt ? `Used ${relativeTime(t.lastUsedAt)}` : 'Never used'} · Created{' '}
                  {relativeTime(t.createdAt)}
                </span>
              </div>
              <Button size="sm" variant="ghost" className="text-error" onClick={() => setRevoking(t)}>
                {t.source === 'oauth' ? 'Disconnect' : 'Revoke'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        ws={ws}
        wsName={wsName}
        onCreated={(r) => {
          setCreating(false);
          setRevealed(r);
          void qc.invalidateQueries({ queryKey: tokensKey(ws) });
        }}
      />
      <Dialog open={!!revealed} onOpenChange={(o) => !o && setRevealed(null)} title={`Token for ${revealed?.token.name ?? ''}`} description="Copy it now. Notey keeps only a fingerprint, so it can’t show it again.">
        {revealed && (
          <div className="flex flex-col gap-4">
            <CodeLine value={revealed.secret} label="token" />
            <div className="flex flex-col gap-1.5">
              <p className="text-label font-medium">Claude Code</p>
              <CodeLine value={`claude mcp add --transport http notey ${mcpUrl} --header "Authorization: Bearer ${revealed.secret}"`} label="Claude Code command" />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-label font-medium">REST API</p>
              <CodeLine value={`curl -H "Authorization: Bearer ${revealed.secret}" ${location.origin}/api/v1/tree`} label="curl command" />
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setRevealed(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking?.source === 'oauth' ? `Disconnect ${revoking?.name}?` : `Revoke ${revoking?.name}?`}
        description="Anything using it stops working right away. Its past edits stay in page history."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)}>
            {revoking?.source === 'oauth' ? 'Disconnect' : 'Revoke token'}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function CreateTokenDialog({
  open,
  onOpenChange,
  ws,
  wsName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ws: string;
  wsName: string;
  onCreated: (r: { token: TokenInfo; secret: string }) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('write');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ token: TokenInfo; secret: string }>(`/api/workspaces/${ws}/tokens`, { body: { name: name.trim(), scope } }),
    onSuccess: (r) => {
      setName('');
      setError(null);
      onCreated(r);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New token" description={`For ${wsName} only. Name it after what will use it.`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError('Give the token a name, e.g. Claude Code.');
          create.mutate();
        }}
      >
        {error && (
          <p role="alert" className="text-body text-error">
            {error}
          </p>
        )}
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Code" maxLength={60} autoFocus />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label font-medium">It may</legend>
          {(['read', 'write'] as const).map((s) => (
            <label
              key={s}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-primary',
                scope === s && 'ring-2 ring-primary',
              )}
            >
              <input type="radio" name="token-scope" className="sr-only" checked={scope === s} onChange={() => setScope(s)} />
              <span className="flex flex-col">
                <span className="text-body font-medium">{SCOPE_LABEL[s]}</span>
                <span className="text-meta text-on-surface-muted">{s === 'read' ? 'Read pages and tasks, and search.' : 'Also create and edit pages and tasks.'}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create token
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
