import { useQuery } from '@tanstack/react-query';
import { Star, Trash2, X } from 'lucide-react';
import { Dialog as D, ToggleGroup } from 'radix-ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { describeRRule, formatRRule, isValidRRule, parseRRule, weekday, type Rule } from '@shared/recurrence';
import type { Task, TaskStatus, UpdateTaskInput } from '@shared/schemas';
import { SkeletonRows } from '@web/components/shell/route-states';
import { Button } from '@web/components/ui/button';
import { inputClass } from '@web/components/ui/field';
import { errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { treeQuery } from '@web/lib/content';
import { isPinned, openTask, pinsQuery, taskQuery, today, useOpenTask, usePins, useTaskMutations } from '@web/lib/tasks';
import { relativeTime, editedByLabel } from '@web/lib/time';
import { TaskCheck } from './task-check';

type Preset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

function presetOf(rrule: string | null): { preset: Preset; days: number[] } {
  if (!rrule) return { preset: 'none', days: [] };
  let r: Rule;
  try {
    r = parseRRule(rrule);
  } catch {
    return { preset: 'custom', days: [] };
  }
  const days = r.byDay?.filter((d) => d.n === undefined).map((d) => d.day) ?? [];
  if (r.count || r.until || r.interval !== 1) return { preset: 'custom', days };
  if (r.freq === 'DAILY') return { preset: 'daily', days };
  if (r.freq === 'WEEKLY' && [...days].sort().join() === '1,2,3,4,5') return { preset: 'weekdays', days };
  if (r.freq === 'WEEKLY') return { preset: 'weekly', days };
  if (r.freq === 'MONTHLY' && r.byMonthDay?.length === 1 && !r.byDay) return { preset: 'monthly', days };
  if (r.freq === 'YEARLY') return { preset: 'yearly', days };
  return { preset: 'custom', days };
}

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-3 py-2">
      <label htmlFor={htmlFor} className="pt-2 text-label font-medium text-on-surface-muted">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** One sheet for the whole app; open it with openTask(id). */
export function TaskSheet({ ws }: { ws: string | undefined }) {
  const id = useOpenTask();
  const open = !!id && !!ws;
  return (
    <D.Root open={open} onOpenChange={(o) => !o && openTask(null)}>
      <D.Portal>
        <D.Overlay className="animate-scrim fixed inset-0 z-40 bg-scrim" />
        <D.Content
          aria-describedby={undefined}
          className={cn(
            'fixed z-50 flex flex-col bg-surface-raised shadow-3 ring-1 ring-border',
            'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)] sheet-bottom',
            'medium:inset-y-0 medium:right-0 medium:left-auto medium:max-h-none medium:w-[min(420px,100vw)] medium:rounded-none medium:sheet-right',
          )}
        >
          {open && <SheetBody key={id} ws={ws} id={id} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function SheetBody({ ws, id }: { ws: string; id: string }) {
  const q = useQuery(taskQuery(ws, id));
  if (q.isPending)
    return (
      <div className="p-6">
        <D.Title className="sr-only">Task</D.Title>
        <SkeletonRows rows={5} />
      </div>
    );
  if (q.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <D.Title className="text-h3 font-semibold">This task isn't available</D.Title>
        <p className="text-body text-on-surface-muted">{errorMessage(q.error)}</p>
        <Button onClick={() => openTask(null)}>Close</Button>
      </div>
    );
  return <TaskForm ws={ws} task={q.data} />;
}

function TaskForm({ ws, task }: { ws: string; task: Task }) {
  const m = useTaskMutations(ws);
  const pinsApi = usePins(ws);
  const { data: tree } = useQuery(treeQuery(ws));
  const { data: pins } = useQuery(pinsQuery(ws));
  const pinned = isPinned(pins, 'task', task.id);
  const ids = { date: useId(), time: useId(), repeat: useId(), project: useId(), notes: useId(), custom: useId() };

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notesMd);
  const [error, setError] = useState<string | null>(null);
  const initial = presetOf(task.rrule);
  const [preset, setPreset] = useState<Preset>(initial.preset);
  const [custom, setCustom] = useState(task.rrule ?? '');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(notesTimer.current), []);

  const save = (patch: UpdateTaskInput) => {
    setError(null);
    m.update.mutate({ id: task.id, ...patch }, { onError: (e) => setError(errorMessage(e)) });
  };

  function setStatus(s: TaskStatus) {
    if (s === task.status) return;
    if (s === 'done') m.complete.mutate(task);
    else if (task.status === 'done') m.uncomplete.mutate(task.id, { onSuccess: () => s === 'doing' && save({ status: 'doing' }) });
    else save({ status: s });
  }

  function applyRepeat(p: Preset, days?: number[]) {
    setPreset(p);
    if (p === 'custom') return;
    const due = task.dueDate ?? today();
    const rules: Record<Exclude<Preset, 'custom' | 'none'>, Rule> = {
      daily: { freq: 'DAILY', interval: 1 },
      weekdays: { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5].map((day) => ({ day })) },
      weekly: { freq: 'WEEKLY', interval: 1, byDay: (days?.length ? days : [weekday(due)]).map((day) => ({ day })) },
      monthly: { freq: 'MONTHLY', interval: 1, byMonthDay: [Number(due.slice(8, 10))] },
      yearly: { freq: 'YEARLY', interval: 1 },
    };
    if (p === 'none') save({ rrule: null });
    else save({ rrule: formatRRule(rules[p]), dueDate: due });
  }

  const weekDays = presetOf(task.rrule).days;
  const customValid = !custom.trim() || isValidRRule(custom);
  const projects = tree?.projects ?? [];
  const meta = [`Created ${relativeTime(task.createdAt)}`, editedByLabel(task.updatedBy)].filter(Boolean).join(' · ');

  return (
    <>
      <div className="flex items-start gap-2 border-b border-border px-4 pt-4 pb-3">
        <TaskCheck
          className="mt-1"
          checked={task.status === 'done'}
          title={task.title}
          onToggle={() => (task.status === 'done' ? m.uncomplete.mutate(task.id) : m.complete.mutate(task))}
        />
        <D.Title asChild>
          <textarea
            aria-label="Task title"
            value={title}
            rows={1}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
            onBlur={() => title.trim() && title.trim() !== task.title && save({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            className="field-sizing-content min-w-0 flex-1 resize-none bg-transparent py-1 text-h3 font-semibold text-on-surface outline-none"
          />
        </D.Title>
        <D.Close asChild>
          <Button size="icon" variant="ghost" aria-label="Close" className="size-11 medium:size-control-sm">
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        </D.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {error && (
          <p role="alert" className="my-2 rounded-md bg-error/8 px-3 py-2 text-body text-error ring-1 ring-error/25 ring-inset">
            {error}
          </p>
        )}
        <Row label="Status">
          <ToggleGroup.Root
            type="single"
            value={task.status}
            onValueChange={(v) => v && setStatus(v as TaskStatus)}
            aria-label="Status"
            className="inline-flex rounded-md bg-neutral p-0.5"
          >
            {(['todo', 'doing', 'done'] as const).map((s) => (
              <ToggleGroup.Item
                key={s}
                value={s}
                className="h-8 rounded-[calc(var(--radius-md)-2px)] px-3 text-label text-on-surface-muted transition-colors duration-(--duration-micro) data-[state=on]:bg-surface-raised data-[state=on]:text-on-surface data-[state=on]:shadow-2"
              >
                {s === 'todo' ? 'To do' : s === 'doing' ? 'Doing' : 'Done'}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </Row>

        <Row label="Due" htmlFor={ids.date}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={ids.date}
              type="date"
              value={task.dueDate ?? ''}
              onChange={(e) => save({ dueDate: e.target.value || null, ...(e.target.value ? {} : { rrule: null, dueTime: null }) })}
              className={cn(inputClass, 'w-auto')}
            />
            {task.dueDate && (
              <input
                id={ids.time}
                aria-label="Time"
                type="time"
                value={task.dueTime ?? ''}
                onChange={(e) => save({ dueTime: e.target.value || null })}
                className={cn(inputClass, 'w-auto')}
              />
            )}
            {task.dueDate && (
              <Button size="sm" variant="ghost" onClick={() => save({ dueDate: null, dueTime: null, rrule: null })}>
                Clear
              </Button>
            )}
          </div>
        </Row>

        <Row label="Repeat" htmlFor={ids.repeat}>
          <div className="flex flex-col gap-2">
            <select id={ids.repeat} value={preset} onChange={(e) => applyRepeat(e.target.value as Preset)} className={inputClass}>
              <option value="none">Doesn't repeat</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly on chosen days</option>
              <option value="monthly">Monthly on day {Number((task.dueDate ?? today()).slice(8, 10))}</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom (RRULE)</option>
            </select>
            {preset === 'weekly' && (
              <ToggleGroup.Root
                type="multiple"
                aria-label="Repeat on"
                value={weekDays.map(String)}
                onValueChange={(v) => v.length && applyRepeat('weekly', v.map(Number))}
                className="flex flex-wrap gap-1"
              >
                {DAY_LABELS.map((label, i) => (
                  <ToggleGroup.Item
                    key={label}
                    value={String(DAY_INDEX[i])}
                    className="size-9 rounded-full text-label text-on-surface-muted ring-1 ring-border ring-inset data-[state=on]:bg-primary data-[state=on]:text-on-primary data-[state=on]:ring-transparent"
                  >
                    {label}
                  </ToggleGroup.Item>
                ))}
              </ToggleGroup.Root>
            )}
            {preset === 'custom' && (
              <>
                <input
                  id={ids.custom}
                  aria-label="Custom repeat rule"
                  value={custom}
                  placeholder="FREQ=MONTHLY;BYDAY=-1FR"
                  aria-invalid={!customValid || undefined}
                  onChange={(e) => setCustom(e.target.value)}
                  onBlur={() => customValid && custom.trim() && save({ rrule: custom.trim(), dueDate: task.dueDate ?? today() })}
                  className={cn(inputClass, 'font-mono text-mono')}
                />
                <p className={cn('text-meta', customValid ? 'text-on-surface-subtle' : 'text-error')}>
                  {customValid ? (custom.trim() ? describeRRule(custom) : 'Daily, weekly, monthly or yearly rules.') : "That rule isn't supported. Try FREQ=WEEKLY;BYDAY=MO,TH."}
                </p>
              </>
            )}
            {task.rrule && preset !== 'custom' && <p className="text-meta text-on-surface-subtle">{describeRRule(task.rrule)}</p>}
          </div>
        </Row>

        <Row label="Project" htmlFor={ids.project}>
          <select id={ids.project} value={task.projectId ?? ''} onChange={(e) => save({ projectId: e.target.value || null, pageId: null })} className={inputClass}>
            <option value="">Inbox</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Notes" htmlFor={ids.notes}>
          <textarea
            id={ids.notes}
            value={notes}
            rows={5}
            maxLength={20_000}
            placeholder="Details, links, Markdown welcome"
            onChange={(e) => {
              const v = e.target.value;
              setNotes(v);
              clearTimeout(notesTimer.current);
              notesTimer.current = setTimeout(() => save({ notesMd: v }), 600);
            }}
            className={cn(inputClass, 'h-auto min-h-28 py-2')}
          />
        </Row>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Button size="sm" variant="ghost" aria-pressed={pinned} onClick={() => pinsApi.toggle.mutate({ itemType: 'task', itemId: task.id, pinned })}>
          <Star className={cn('size-4', pinned && 'fill-current')} strokeWidth={1.5} aria-hidden />
          {pinned ? 'Pinned' : 'Pin'}
        </Button>
        <span className="min-w-0 flex-1 truncate text-center text-meta text-on-surface-subtle">{meta}</span>
        <Button
          size="sm"
          variant="ghost"
          className="text-error"
          onClick={() => {
            m.trash.mutate(task);
            openTask(null);
          }}
        >
          <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
          Delete
        </Button>
      </div>
    </>
  );
}
