import { CalendarDays, Plus, Repeat } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { describeRRule } from '@shared/recurrence';
import type { QuickAdd as Parsed } from '@shared/quick-add';
import type * as QuickAddModule from '@shared/quick-add';
import { errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { dueLabel, timeLabel, useTaskMutations } from '@web/lib/tasks';

// The parser (with chrono-node) loads on first focus, not with the app.
let parserPromise: Promise<typeof QuickAddModule> | null = null;
const loadParser = () => (parserPromise ??= import('@shared/quick-add'));

/**
 * "+ Add a task" with natural language: "Call Rafi tomorrow 3pm",
 * "Pay rent every month on 1st". Shows what it understood before you press Enter.
 */
export function QuickAdd({
  ws,
  projectId = null,
  pageId = null,
  defaultDue = null,
  autoFocus,
  placeholder = 'Add a task, e.g. "Call Rafi tomorrow 3pm"',
  onCreated,
  className,
}: {
  ws: string;
  projectId?: string | null;
  pageId?: string | null;
  /** Due date when the text names none (the Today view uses today). */
  defaultDue?: string | null;
  autoFocus?: boolean;
  placeholder?: string;
  onCreated?: (id: string) => void;
  className?: string;
}) {
  const m = useTaskMutations(ws);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const parse = useRef<((s: string) => Parsed) | null>(null);

  const ensureParser = () =>
    void loadParser().then((mod) => {
      parse.current = (s) => mod.parseQuickAdd(s);
      if (text) setParsed(parse.current(text));
    });

  function onChange(v: string) {
    setText(v);
    setParsed(v.trim() && parse.current ? parse.current(v) : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const p = parse.current ? parse.current(text) : { title: text.trim(), dueDate: null, dueTime: null, rrule: null };
    try {
      const { task } = await m.create.mutateAsync({
        title: p.title,
        dueDate: p.dueDate ?? defaultDue,
        dueTime: p.dueTime,
        rrule: p.rrule,
        projectId,
        pageId,
      });
      setText('');
      setParsed(null);
      onCreated?.(task.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const due = parsed?.dueDate ?? (parsed ? defaultDue : null);
  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-1', className)}>
      <label className="flex h-input items-center gap-2 rounded-md bg-surface-raised px-3 ring-1 ring-border ring-inset focus-within:ring-2 focus-within:ring-primary">
        <Plus className="size-4 shrink-0 text-on-surface-subtle" strokeWidth={1.5} aria-hidden />
        <span className="sr-only">Add a task</span>
        <input
          value={text}
          autoFocus={autoFocus}
          onFocus={ensureParser}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={300}
          enterKeyHint="done"
          className="h-full min-w-0 flex-1 bg-transparent text-body-doc text-on-surface outline-none placeholder:text-on-surface-subtle sm:text-body"
        />
        {m.create.isPending && <span className="text-meta text-on-surface-subtle">Adding…</span>}
      </label>
      {parsed && (due || parsed.rrule) && (
        <p aria-live="polite" className="flex flex-wrap items-center gap-3 px-1 text-meta text-on-surface-muted">
          <span className="truncate">“{parsed.title}”</span>
          {due && (
            <span className="tnum flex items-center gap-1">
              <CalendarDays className="size-3" strokeWidth={1.75} aria-hidden />
              {dueLabel(due)}
              {parsed.dueTime && ` ${timeLabel(parsed.dueTime)}`}
            </span>
          )}
          {parsed.rrule && (
            <span className="flex items-center gap-1">
              <Repeat className="size-3" strokeWidth={1.75} aria-hidden />
              {describeRRule(parsed.rrule)}
            </span>
          )}
        </p>
      )}
    </form>
  );
}
