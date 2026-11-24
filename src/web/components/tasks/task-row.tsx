import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CircleDot, Ellipsis, PanelRight, Repeat, Star, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { describeRRule } from '@shared/recurrence';
import type { Task } from '@shared/schemas';
import { menuContentClass, menuItemClass } from '@web/components/shell/item-menu';
import { cn } from '@web/lib/cn';
import { treeQuery } from '@web/lib/content';
import { dueLabel, isPinned, openTask, pinsQuery, timeLabel, today, usePins, useTaskMutations } from '@web/lib/tasks';
import { TaskCheck } from './task-check';

/** Due date, time and repeat, as words and icons (never colour alone). */
export function TaskMeta({ task, showProject, ws }: { task: Task; showProject?: boolean; ws: string }) {
  const { data: tree } = useQuery({ ...treeQuery(ws), enabled: !!showProject && !!task.projectId });
  const day = today();
  const overdue = !!task.dueDate && task.dueDate < day && task.status !== 'done';
  const parts: ReactNode[] = [];
  if (task.status === 'doing')
    parts.push(
      <span key="doing" className="flex items-center gap-1 text-on-surface-muted">
        <CircleDot className="size-3" strokeWidth={1.75} aria-hidden />
        Doing
      </span>,
    );
  if (task.dueDate)
    parts.push(
      <span key="due" className={cn('tnum flex items-center gap-1', overdue ? 'text-error' : 'text-on-surface-subtle')}>
        {overdue && <CalendarClock className="size-3" strokeWidth={1.75} aria-label="Overdue" />}
        {dueLabel(task.dueDate, day)}
        {task.dueTime && ` ${timeLabel(task.dueTime)}`}
      </span>,
    );
  if (task.rrule)
    parts.push(
      <span key="repeat" className="flex items-center gap-1 text-on-surface-subtle">
        <Repeat className="size-3" strokeWidth={1.75} aria-hidden />
        {describeRRule(task.rrule)}
      </span>,
    );
  const project = showProject && task.projectId ? tree?.projects.find((p) => p.id === task.projectId) : undefined;
  if (project)
    parts.push(
      <span key="proj" className="hidden max-w-32 truncate text-on-surface-subtle medium:inline">
        {project.name}
      </span>,
    );
  if (!parts.length) return null;
  return <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta medium:shrink-0 medium:flex-nowrap">{parts}</span>;
}

export function TaskRow({
  ws,
  task,
  showProject,
  dragHandle,
}: {
  ws: string;
  task: Task;
  showProject?: boolean;
  dragHandle?: ReactNode;
}) {
  const m = useTaskMutations(ws);
  const pins = usePins(ws);
  const { data: pinList } = useQuery(pinsQuery(ws));
  const pinned = isPinned(pinList, 'task', task.id);
  // Checked locally at once; the list drops the row after it lingers (LEAVE_MS).
  const [checked, setChecked] = useState(task.status === 'done');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  function toggle() {
    if (checked) {
      setChecked(false);
      m.uncomplete.mutate(task.id);
    } else {
      setChecked(true);
      m.complete.mutate(task, { onError: () => setChecked(false) });
    }
  }

  function saveTitle() {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== task.title) m.update.mutate({ id: task.id, title: v });
    else setDraft(task.title);
  }

  return (
    <li
      className="group relative flex min-h-row items-center gap-2 border-b border-border pr-1 last:border-0"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-open]')) openTask(task.id);
      }}
    >
      {dragHandle}
      <TaskCheck checked={checked} title={task.title} onToggle={toggle} />
      {/* Title and meta share a line from 600 px; below that, meta wraps under the title. */}
      <div className="flex min-w-0 flex-1 flex-col py-1 medium:flex-row medium:items-center medium:py-0">
      {editing ? (
        <input
          autoFocus
          aria-label="Task title"
          value={draft}
          maxLength={300}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveTitle();
            if (e.key === 'Escape') {
              setDraft(task.title);
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-sm bg-surface-raised px-1.5 text-body ring-2 ring-primary outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={task.title}
          className={cn(
            'min-w-0 cursor-text rounded-sm text-left text-body [overflow-wrap:anywhere] line-clamp-2 transition-colors duration-(--duration-micro) medium:truncate medium:py-1',
            checked ? 'text-on-surface-subtle line-through decoration-on-surface-subtle' : 'text-on-surface',
          )}
        >
          {task.title}
        </button>
      )}
      {/* Empty space between title and meta opens the details sheet. */}
      <span data-open className="hidden h-row min-w-4 flex-1 cursor-pointer medium:block" aria-hidden />
      <span data-open className="cursor-pointer medium:contents">
        <TaskMeta task={task} showProject={showProject} ws={ws} />
      </span>
      </div>
      <span className="flex shrink-0 items-center gap-0.5 pointer-hover:invisible pointer-hover:group-hover:visible pointer-hover:group-focus-within:visible">
        <button
          type="button"
          aria-label={pinned ? `Unpin ${task.title}` : `Pin ${task.title}`}
          aria-pressed={pinned}
          onClick={() => pins.toggle.mutate({ itemType: 'task', itemId: task.id, pinned })}
          className={cn('hidden size-8 place-items-center rounded-md hover:bg-neutral medium:grid', pinned ? 'visible! text-on-surface' : 'text-on-surface-subtle')}
        >
          <Star className={cn('size-4', pinned && 'fill-current')} strokeWidth={1.5} aria-hidden />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label={`More for ${task.title}`} className="grid size-8 place-items-center rounded-md text-on-surface-subtle hover:bg-neutral">
              <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={8} className={menuContentClass}>
              <DropdownMenu.Item className={menuItemClass} onSelect={() => openTask(task.id)}>
                <PanelRight className="text-on-surface-muted" aria-hidden />
                Open details
              </DropdownMenu.Item>
              {task.status !== 'doing' && !checked && (
                <DropdownMenu.Item className={menuItemClass} onSelect={() => m.update.mutate({ id: task.id, status: 'doing' })}>
                  <CircleDot className="text-on-surface-muted" aria-hidden />
                  Mark as doing
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Separator className="my-1 h-hairline bg-border" />
              <DropdownMenu.Item className={cn(menuItemClass, 'text-error')} onSelect={() => m.trash.mutate(task)}>
                <Trash2 aria-hidden />
                Move to Trash
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </span>
    </li>
  );
}
