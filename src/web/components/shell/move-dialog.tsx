import { useQuery } from '@tanstack/react-query';
import { Folder, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Tree } from '@shared/schemas';
import { Button } from '@web/components/ui/button';
import { Dialog, DialogClose } from '@web/components/ui/dialog';
import { errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { treeQuery, useContentMutations, type NodeRef } from '@web/lib/content';

type Dest = { projectId: string; parentId: string | null; label: string; depth: number; key: string };

function destinations(tree: Tree, moving: NodeRef): Dest[] {
  // A folder can't move into itself or anything below it.
  const blocked = new Set<string>();
  if (moving.kind === 'folder') {
    blocked.add(moving.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of tree.folders) {
        if (f.parentId && blocked.has(f.parentId) && !blocked.has(f.id)) {
          blocked.add(f.id);
          grew = true;
        }
      }
    }
  }
  const out: Dest[] = [];
  const walk = (projectId: string, parentId: string | null, depth: number) => {
    for (const f of tree.folders.filter((x) => x.projectId === projectId && x.parentId === parentId)) {
      if (blocked.has(f.id)) continue;
      out.push({ projectId, parentId: f.id, label: f.name, depth, key: f.id });
      walk(projectId, f.id, depth + 1);
    }
  };
  for (const p of tree.projects) {
    out.push({ projectId: p.id, parentId: null, label: p.name, depth: 0, key: p.id });
    walk(p.id, null, 1);
  }
  return out;
}

/** Keyboard-friendly alternative to dragging in the tree. */
export function MoveDialog({
  ws,
  item,
  onOpenChange,
}: {
  ws: string;
  item: (NodeRef & { name: string }) | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: tree } = useQuery(treeQuery(ws));
  const { move } = useContentMutations(ws);
  const [selected, setSelected] = useState<string | null>(null);
  const options = useMemo(() => (tree && item ? destinations(tree, item) : []), [tree, item]);
  const target = options.find((o) => o.key === selected);

  async function submit(key: string | null = selected) {
    const target = options.find((o) => o.key === key);
    if (!item || !target) return;
    try {
      await move.mutateAsync({ kind: item.kind as 'folder' | 'page', id: item.id, projectId: target.projectId, parentId: target.parentId });
      toast(`Moved ${item.name || 'Untitled'} to ${target.label}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => {
        if (!o) setSelected(null);
        onOpenChange(o);
      }}
      title={`Move ${item?.name || 'Untitled'}`}
      description="Pick a project or folder."
    >
      <div role="listbox" aria-label="Destination" className="-mx-2 max-h-[45dvh] overflow-y-auto">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="option"
            aria-selected={selected === o.key}
            onClick={() => setSelected(o.key)}
            onDoubleClick={() => {
              setSelected(o.key);
              void submit(o.key);
            }}
            className={cn(
              'flex h-nav w-full items-center gap-2 rounded-md px-2 text-left text-body',
              'hover:bg-border/70 aria-selected:bg-primary aria-selected:text-on-primary',
            )}
            style={{ paddingLeft: `calc(var(--spacing-2) + ${o.depth} * var(--spacing-4))` }}
          >
            {o.parentId ? <Folder className="size-4 shrink-0" strokeWidth={1.5} aria-hidden /> : <Layers className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />}
            <span className="truncate">{o.label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button variant="primary" disabled={!target} loading={move.isPending} onClick={() => void submit()} title={target ? undefined : 'Pick a destination first'}>
          Move here
        </Button>
      </div>
    </Dialog>
  );
}
