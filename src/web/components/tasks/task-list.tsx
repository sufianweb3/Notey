import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import { useState } from 'react';
import type { Task, TaskView } from '@shared/schemas';
import { dueLabel, today, useTaskMutations } from '@web/lib/tasks';
import { TaskRow } from './task-row';

function SortableRow({ ws, task, showProject }: { ws: string; task: Task; showProject?: boolean }) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={isDragging ? 'relative z-10 bg-surface-raised shadow-2' : undefined}
    >
      <TaskRow
        ws={ws}
        task={task}
        showProject={showProject}
        dragHandle={
          <button
            type="button"
            aria-label={`Reorder ${task.title}`}
            {...attributes}
            {...listeners}
            className="-ml-1 grid h-8 w-4 shrink-0 cursor-grab place-items-center text-on-surface-subtle pointer-hover:opacity-0 pointer-hover:group-hover:opacity-100 focus-visible:opacity-100"
          >
            <GripVertical className="size-3.5" strokeWidth={1.5} aria-hidden />
          </button>
        }
      />
    </div>
  );
}

/** Inbox and project lists: manual order, drag (or keyboard: space, arrows, space) to reorder. */
function SortableList({ ws, tasks, showProject }: { ws: string; tasks: Task[]; showProject?: boolean }) {
  const m = useTaskMutations(ws);
  const [order, setOrder] = useState<string[] | null>(null);
  const ids = order && order.length === tasks.length && order.every((id) => tasks.some((t) => t.id === id)) ? order : tasks.map((t) => t.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    m.reorder.mutate(next);
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col">
          {ids.map((id) => {
            const t = byId.get(id);
            return t ? <SortableRow key={id} ws={ws} task={t} showProject={showProject} /> : null;
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function Group({ label, count, children, tone }: { label: string; count: number; children: React.ReactNode; tone?: 'error' }) {
  return (
    <section className="flex flex-col">
      <h3 className="flex items-center gap-2 pt-4 pb-1 text-label font-medium">
        <span className={tone === 'error' ? 'text-error' : 'text-on-surface'}>{label}</span>
        <span className="tnum text-meta text-on-surface-subtle">{count}</span>
      </h3>
      {children}
    </section>
  );
}

export function TaskList({ ws, view, tasks }: { ws: string; view: TaskView; tasks: Task[] }) {
  const day = today();
  const showProject = view !== 'project';
  if (view === 'today') {
    const overdue = tasks.filter((t) => t.dueDate && t.dueDate < day);
    const due = tasks.filter((t) => !t.dueDate || t.dueDate >= day);
    return (
      <div className="flex flex-col">
        {overdue.length > 0 && (
          <Group label="Overdue" count={overdue.length} tone="error">
            <ul className="flex flex-col">
              {overdue.map((t) => (
                <TaskRow key={t.id} ws={ws} task={t} showProject />
              ))}
            </ul>
          </Group>
        )}
        {due.length > 0 && (
          <Group label="Today" count={due.length}>
            <ul className="flex flex-col">
              {due.map((t) => (
                <TaskRow key={t.id} ws={ws} task={t} showProject />
              ))}
            </ul>
          </Group>
        )}
      </div>
    );
  }
  if (view === 'upcoming') {
    const days = [...new Set(tasks.map((t) => t.dueDate!))].sort();
    return (
      <div className="flex flex-col">
        {days.map((d) => {
          const list = tasks.filter((t) => t.dueDate === d);
          const long = new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
          const rel = dueLabel(d, day);
          return (
            <Group key={d} label={rel === 'Tomorrow' ? `Tomorrow · ${long}` : long} count={list.length}>
              <ul className="flex flex-col">
                {list.map((t) => (
                  <TaskRow key={t.id} ws={ws} task={t} showProject />
                ))}
              </ul>
            </Group>
          );
        })}
      </div>
    );
  }
  return <SortableList ws={ws} tasks={tasks} showProject={showProject} />;
}
