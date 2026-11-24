import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleAlert, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PinItem, PinType } from '@shared/schemas';
import { PinCard } from '@web/components/pins/pin-card';
import { SkeletonRows } from '@web/components/shell/route-states';
import { TopBar } from '@web/components/shell/top-bar';
import { TaskRow } from '@web/components/tasks/task-row';
import { Button } from '@web/components/ui/button';
import { errorMessage } from '@web/lib/api';
import { treeQuery } from '@web/lib/content';
import { workspacesQuery } from '@web/lib/queries';
import { pinsQuery, usePins } from '@web/lib/tasks';

export const Route = createFileRoute('/_app/w/$workspaceId/important')({
  component: ImportantView,
});

const SECTIONS: { type: PinType; label: string }[] = [
  { type: 'page', label: 'Pages' },
  { type: 'task', label: 'Tasks' },
  { type: 'folder', label: 'Folders' },
  { type: 'project', label: 'Projects' },
];

function Sortable({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={isDragging ? 'relative z-10 opacity-80' : undefined}
    >
      {children}
    </div>
  );
}

/** Important (PRD 6.6): every pin in this workspace, grouped by type, in an order you can drag. */
function ImportantView() {
  const { workspaceId: ws } = Route.useParams();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const { data: tree } = useQuery(treeQuery(ws));
  const q = useQuery(pinsQuery(ws));
  const { reorder } = usePins(ws);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const wsName = workspaces.find((w) => w.id === ws)?.name ?? 'Workspace';
  const projectName = (id?: string | null) => tree?.projects.find((p) => p.id === id)?.name;

  /** Reorders inside one section, keeping the other sections' places in the overall order. */
  function onDragEnd(section: PinItem[], e: DragEndEvent) {
    if (!q.data || !e.over || e.active.id === e.over.id) return;
    const ids = section.map((p) => p.id);
    const moved = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    let i = 0;
    reorder.mutate(q.data.map((p) => (ids.includes(p.id) ? moved[i++]! : p.id)));
  }

  return (
    <>
      <TopBar crumbs={[{ label: wsName, to: { ws } }, { label: 'Important' }]} />
      <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 pt-6 pb-16 medium:px-6 expanded:px-10 expanded:pt-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold">Important</h1>
          <p className="text-body text-on-surface-muted">Everything you've pinned in {wsName}. Drag to reorder.</p>
        </header>
        {q.isPending ? (
          <SkeletonRows rows={4} />
        ) : q.isError ? (
          <div role="alert" className="flex items-center gap-3">
            <CircleAlert className="size-4 shrink-0 text-error" strokeWidth={1.5} aria-hidden />
            <p className="flex-1 text-body">{errorMessage(q.error)}</p>
            <Button size="sm" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : q.data.length === 0 ? (
          <div className="flex flex-col items-start gap-1 py-4">
            <Star className="mb-2 size-6 text-on-surface-subtle" strokeWidth={1.5} aria-hidden />
            <p className="text-body text-on-surface">Nothing pinned yet.</p>
            <p className="text-body text-on-surface-muted">Pin anything with ☆ to keep it here: pages from their top bar, tasks from their row, projects and folders from the sidebar.</p>
          </div>
        ) : (
          SECTIONS.map(({ type, label }) => {
            const items = q.data.filter((p) => p.itemType === type);
            if (!items.length) return null;
            return (
              <section key={type} aria-labelledby={`pins-${type}`} className="flex flex-col gap-2">
                <h2 id={`pins-${type}`} className="flex items-center gap-2 text-label font-medium text-on-surface-muted">
                  {label}
                  <span className="tnum text-meta text-on-surface-subtle">{items.length}</span>
                </h2>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(items, e)}>
                  <SortableContext items={items.map((p) => p.id)} strategy={rectSortingStrategy}>
                    {type === 'task' ? (
                      <ul className="flex flex-col">
                        {items.map((p) => (
                          <Sortable key={p.id} id={p.id}>
                            {p.task && <TaskRow ws={ws} task={p.task} showProject />}
                          </Sortable>
                        ))}
                      </ul>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 medium:grid-cols-3 large:grid-cols-4">
                        {items.map((p) => (
                          <Sortable key={p.id} id={p.id}>
                            <PinCard ws={ws} pin={p} projectName={projectName(p.projectId)} />
                          </Sortable>
                        ))}
                      </div>
                    )}
                  </SortableContext>
                </DndContext>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
