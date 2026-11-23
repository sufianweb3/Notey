import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleAlert, FileText, Folder, Layers, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { TrashItem } from '@shared/schemas';
import { SkeletonRows } from '@web/components/shell/route-states';
import { TopBar } from '@web/components/shell/top-bar';
import { Button } from '@web/components/ui/button';
import { Dialog, DialogClose } from '@web/components/ui/dialog';
import { errorMessage } from '@web/lib/api';
import { trashQuery, useContentMutations } from '@web/lib/content';
import { workspacesQuery } from '@web/lib/queries';
import { relativeTime } from '@web/lib/time';

export const Route = createFileRoute('/_app/w/$workspaceId/trash')({
  component: TrashView,
});

const ICON = { project: Layers, folder: Folder, page: FileText };
const PURGE_DAYS = 30;

function TrashView() {
  const { workspaceId: ws } = Route.useParams();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const items = useQuery(trashQuery(ws));
  const [forever, setForever] = useState<TrashItem | null>(null);
  const name = workspaces.find((w) => w.id === ws)?.name ?? 'Workspace';

  return (
    <>
      <TopBar crumbs={[{ label: name, to: { ws } }, { label: 'Trash' }]} />
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 pt-8 pb-16 medium:px-6 expanded:px-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold">Trash</h1>
          <p className="text-body text-on-surface-muted">Deleted items stay here for {PURGE_DAYS} days. Restoring a folder or project brings back what was deleted with it.</p>
        </header>
        {items.isPending ? (
          <SkeletonRows rows={3} />
        ) : items.isError ? (
          <div role="alert" className="flex items-center gap-3 py-2">
            <CircleAlert className="size-4 shrink-0 text-error" strokeWidth={1.5} aria-hidden />
            <p className="flex-1 text-body">{errorMessage(items.error)}</p>
            <Button size="sm" onClick={() => void items.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.data.length === 0 ? (
          <div className="flex flex-col items-start gap-1 py-6">
            <Trash2 className="mb-2 size-6 text-on-surface-subtle" strokeWidth={1.5} aria-hidden />
            <p className="text-body text-on-surface">Trash is empty.</p>
            <p className="text-body text-on-surface-muted">Anything you delete lands here first, so you can change your mind.</p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {items.data.map((item) => (
              <TrashRow key={`${item.kind}:${item.id}`} ws={ws} item={item} onDeleteForever={() => setForever(item)} />
            ))}
          </ul>
        )}
      </div>
      {forever && <DeleteForeverDialog ws={ws} item={forever} onClose={() => setForever(null)} />}
    </>
  );
}

function TrashRow({ ws, item, onDeleteForever }: { ws: string; item: TrashItem; onDeleteForever: () => void }) {
  const { restore } = useContentMutations(ws);
  const Icon = ICON[item.kind];
  const purgeOn = new Date(Date.parse(item.deletedAt) + PURGE_DAYS * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const label = item.name || 'Untitled';
  const meta = [
    item.location || null,
    item.contains ? `${item.contains} ${item.contains === 1 ? 'item' : 'items'} inside` : null,
    `Deleted ${relativeTime(item.deletedAt)}`,
  ].filter(Boolean);

  return (
    <li className="flex min-h-row items-center gap-3 border-b border-border py-2 last:border-0">
      <Icon className="size-4 shrink-0 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-on-surface" title={label}>
          {label}
        </span>
        <span className="truncate text-meta text-on-surface-subtle" title={`Deleted for good on ${purgeOn}`}>
          {meta.join(' · ')}
        </span>
      </div>
      <Button
        size="sm"
        loading={restore.isPending}
        onClick={() =>
          restore.mutate(
            { kind: item.kind, id: item.id },
            { onSuccess: () => toast(`Restored ${label}`), onError: (e) => toast.error(errorMessage(e)) },
          )
        }
      >
        Restore
      </Button>
      <Button size="sm" variant="ghost" onClick={onDeleteForever} aria-label={`Delete ${label} forever`}>
        <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
        <span className="hidden medium:inline">Delete forever</span>
      </Button>
    </li>
  );
}

function DeleteForeverDialog({ ws, item, onClose }: { ws: string; item: TrashItem; onClose: () => void }) {
  const { deleteForever } = useContentMutations(ws);
  const label = item.name || 'Untitled';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${label} forever?`}
      description={
        item.contains
          ? `This also deletes the ${item.contains} ${item.contains === 1 ? 'item' : 'items'} inside it and their history. It can't be undone.`
          : "This deletes it and its history. It can't be undone."
      }
    >
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button variant="secondary" autoFocus>
            Cancel
          </Button>
        </DialogClose>
        <Button
          variant="destructive"
          loading={deleteForever.isPending}
          onClick={() =>
            deleteForever.mutate(
              { kind: item.kind, id: item.id },
              {
                onSuccess: () => {
                  toast(`Deleted ${label} forever`);
                  onClose();
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        >
          Delete forever
        </Button>
      </div>
    </Dialog>
  );
}
