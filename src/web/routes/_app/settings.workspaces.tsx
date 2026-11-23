import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, CircleAlert, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu as M } from 'radix-ui';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Workspace } from '@shared/schemas';
import { SkeletonRows } from '@web/components/shell/route-states';
import { DeleteWorkspaceDialog, WorkspaceFormDialog } from '@web/components/shell/workspace-dialogs';
import { Button } from '@web/components/ui/button';
import { WorkspaceGlyph } from '@web/components/ui/glyph';
import { errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { trashQuery, useReorderWorkspaces, useRestoreWorkspace, workspacesQuery } from '@web/lib/queries';
import { lastWorkspace } from '@web/lib/workspace-memory';

export const Route = createFileRoute('/_app/settings/workspaces')({
  component: WorkspaceSettings,
});

const PURGE_DAYS = 30;
const itemClass =
  'flex h-nav cursor-default items-center gap-2 rounded-md px-2 text-body outline-none select-none data-highlighted:bg-border/70 data-disabled:opacity-55';

function WorkspaceSettings() {
  const workspaces = useQuery(workspacesQuery);
  const trash = useQuery(trashQuery);
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-doc flex-col gap-10 px-4 pt-8 pb-16 medium:px-6 expanded:pt-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-meta text-on-surface-muted">Settings</p>
          <h1 className="text-h1 font-semibold">Workspaces</h1>
          <p className="text-body text-on-surface-muted">
            Each workspace is sealed. Tokens and AI only ever see one at a time.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" strokeWidth={1.5} aria-hidden />
          New workspace
        </Button>
      </header>

      <section aria-labelledby="ws-list">
        <h2 id="ws-list" className="sr-only">
          Your workspaces
        </h2>
        {workspaces.isPending ? (
          <SkeletonRows rows={3} />
        ) : workspaces.isError ? (
          <InlineError message={errorMessage(workspaces.error)} onRetry={() => void workspaces.refetch()} />
        ) : workspaces.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-6">
            <p className="text-body text-on-surface-muted">No workspaces yet. Create one to get started.</p>
          </div>
        ) : (
          <WorkspaceList workspaces={workspaces.data} />
        )}
      </section>

      {trash.isSuccess && trash.data.length > 0 && (
        <section aria-labelledby="ws-trash" className="flex flex-col gap-2">
          <h2 id="ws-trash" className="text-label font-medium text-on-surface-muted">
            Recently deleted
          </h2>
          <ul className="flex flex-col">
            {trash.data.map((w) => (
              <TrashRow key={w.id} workspace={w} />
            ))}
          </ul>
        </section>
      )}
      {trash.isError && <InlineError message="Couldn't load deleted workspaces." onRetry={() => void trash.refetch()} />}

      <WorkspaceFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function WorkspaceList({ workspaces }: { workspaces: Workspace[] }) {
  const reorder = useReorderWorkspaces();
  const params = useParams({ strict: false }) as { workspaceId?: string };
  const currentId = params.workspaceId ?? lastWorkspace();

  function move(index: number, by: -1 | 1) {
    const ids = workspaces.map((w) => w.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    reorder.mutate(ids, { onError: (err) => toast.error(errorMessage(err)) });
  }

  return (
    <ul className="flex flex-col">
      {workspaces.map((w, i) => (
        <WorkspaceRow
          key={w.id}
          workspace={w}
          current={w.id === currentId}
          isLast={workspaces.length === 1}
          onMoveUp={i > 0 ? () => move(i, -1) : undefined}
          onMoveDown={i < workspaces.length - 1 ? () => move(i, 1) : undefined}
        />
      ))}
    </ul>
  );
}

function WorkspaceRow({
  workspace,
  current,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  workspace: Workspace;
  current: boolean;
  isLast: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <li className="group flex min-h-row items-center gap-3 border-b border-border py-1 last:border-0">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left"
        onClick={() => void navigate({ to: '/w/$workspaceId', params: { workspaceId: workspace.id } })}
      >
        <WorkspaceGlyph name={workspace.name} icon={workspace.icon} />
        <span className="min-w-0 truncate text-body text-on-surface" title={workspace.name}>
          {workspace.name}
        </span>
        {current && <span className="shrink-0 text-meta text-on-surface-subtle">Current</span>}
      </button>
      <M.Root>
        <M.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More for ${workspace.name}`} className="size-11 expanded:size-control-sm">
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="end"
            sideOffset={4}
            collisionPadding={12}
            className="animate-popover z-50 w-menu rounded-lg bg-surface-overlay p-1 text-on-surface shadow-2 ring-1 ring-border"
          >
            <M.Item className={itemClass} onSelect={() => setEditing(true)}>
              <Pencil className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
              Edit name and icon
            </M.Item>
            <M.Item className={itemClass} disabled={!onMoveUp} onSelect={onMoveUp}>
              <ArrowUp className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
              Move up
            </M.Item>
            <M.Item className={itemClass} disabled={!onMoveDown} onSelect={onMoveDown}>
              <ArrowDown className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
              Move down
            </M.Item>
            <M.Separator className="my-1 h-hairline bg-border" />
            <M.Item className={cn(itemClass, 'text-error')} onSelect={() => setDeleting(true)}>
              <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
              Delete…
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
      <WorkspaceFormDialog open={editing} onOpenChange={setEditing} workspace={workspace} />
      <DeleteWorkspaceDialog open={deleting} onOpenChange={setDeleting} workspace={workspace} isLast={isLast} />
    </li>
  );
}

function TrashRow({ workspace }: { workspace: Workspace }) {
  const restore = useRestoreWorkspace();
  const purgeOn = new Date(new Date(workspace.deletedAt!).getTime() + PURGE_DAYS * 86_400_000);
  return (
    <li className="flex min-h-row items-center gap-3 border-b border-border py-1 last:border-0">
      <WorkspaceGlyph name={workspace.name} icon={workspace.icon} className="opacity-70" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-on-surface-muted" title={workspace.name}>
          {workspace.name}
        </span>
        <span className="text-meta text-on-surface-subtle">
          Deleted for good on {purgeOn.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
        </span>
      </div>
      <Button
        size="sm"
        loading={restore.isPending}
        onClick={() =>
          restore.mutate(workspace.id, {
            onSuccess: () => toast(`Restored ${workspace.name}`),
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      >
        Restore
      </Button>
    </li>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-4">
      <CircleAlert className="size-4 shrink-0 text-error" strokeWidth={1.5} aria-hidden />
      <p className="flex-1 text-body text-on-surface">{message}</p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
