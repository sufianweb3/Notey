import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useState } from 'react';
import type { Task, TaskStatus } from '@shared/schemas';
import { cn } from '@web/lib/cn';
import { openTask, useTaskMutations } from '@web/lib/tasks';
import { TaskCheck } from './task-check';
import { TaskMeta } from './task-row';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'doing', label: 'Doing' },
  { status: 'done', label: 'Done' },
];

function Card({ ws, task, overlay }: { ws: string; task: Task; overlay?: boolean }) {
  const m = useTaskMutations(ws);
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id, disabled: overlay });
  const done = task.status === 'done';
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}. Open details`}
      onClick={() => openTask(task.id)}
      onKeyDown={(e) => e.key === 'Enter' && openTask(task.id)}
      className={cn(
        'flex cursor-grab flex-col gap-2 rounded-lg bg-surface-raised px-3 py-2.5 ring-1 ring-border ring-inset outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        isDragging && 'opacity-40',
        overlay && 'shadow-2',
      )}
    >
      <div className="flex items-start gap-1.5">
        <TaskCheck
          checked={done}
          title={task.title}
          className="-mt-0.5 -ml-1"
          onToggle={() => (done ? m.uncomplete.mutate(task.id) : m.complete.mutate(task))}
        />
        <span className={cn('min-w-0 flex-1 text-body [overflow-wrap:anywhere]', done ? 'text-on-surface-subtle line-through' : 'text-on-surface')}>
          {task.title}
        </span>
      </div>
      <TaskMeta task={task} ws={ws} showProject />
    </div>
  );
}

function Column({ ws, status, label, tasks }: { ws: string; status: TaskStatus; label: string; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${tasks.length}`}
      className={cn(
        'flex min-h-40 min-w-[min(15rem,80vw)] flex-1 flex-col gap-2 rounded-lg bg-neutral p-2 transition-colors duration-(--duration-micro)',
        isOver && 'bg-accent-wash',
      )}
    >
      <h3 className="flex items-center gap-2 px-1 pt-1 text-label font-medium">
        {label}
        <span className="tnum text-meta text-on-surface-subtle">{tasks.length}</span>
      </h3>
      {tasks.map((t) => (
        <Card key={t.id} ws={ws} task={t} />
      ))}
      {tasks.length === 0 && <p className="px-1 py-2 text-meta text-on-surface-subtle">Drop tasks here.</p>}
    </section>
  );
}

/** To do / Doing / Done. Drag between columns to change status; Done lists the last 14 days. */
export function TaskBoard({ ws, tasks }: { ws: string; tasks: Task[] }) {
  const m = useTaskMutations(ws);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [active, setActive] = useState<Task | null>(null);

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const t = tasks.find((x) => x.id === e.active.id);
    const to = e.over?.id as TaskStatus | undefined;
    if (!t || !to || t.status === to) return;
    if (to === 'done') m.complete.mutate(t);
    else if (t.status === 'done') m.uncomplete.mutate(t.id, { onSuccess: () => to === 'doing' && m.update.mutate({ id: t.id, status: 'doing' }) });
    else m.update.mutate({ id: t.id, status: to });
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActive(tasks.find((x) => x.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 medium:mx-0 medium:px-0">
        {COLUMNS.map((c) => (
          <Column key={c.status} ws={ws} status={c.status} label={c.label} tasks={tasks.filter((t) => t.status === c.status)} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active && <Card ws={ws} task={active} overlay />}</DragOverlay>
    </DndContext>
  );
}
