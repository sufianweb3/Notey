import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { localDate } from '@shared/recurrence';
import type { CreateTaskInput, PinItem, PinType, Task, TaskCounts, TaskView, UpdateTaskInput } from '@shared/schemas';
import { api, errorMessage } from './api';
import { base } from './content';
import { fixtureTasks } from '../fixtures/tasks';

export const tk = {
  all: (ws: string) => ['ws', ws, 'tasks'] as const,
  list: (ws: string, view: TaskView, today: string, projectId?: string, includeDone?: boolean) =>
    ['ws', ws, 'tasks', view, projectId ?? null, !!includeDone, today] as const,
  counts: (ws: string, today: string) => ['ws', ws, 'tasks', 'counts', today] as const,
  one: (ws: string, id: string) => ['ws', ws, 'task', id] as const,
  pins: (ws: string) => ['ws', ws, 'pins'] as const,
};

/** The owner's local date. "Today" and "overdue" are always the device's calendar day. */
export const today = () => localDate();

export const tasksQuery = (ws: string, view: TaskView, day: string, projectId?: string, includeDone?: boolean) =>
  queryOptions({
    queryKey: tk.list(ws, view, day, projectId, includeDone),
    queryFn: async () => {
      const fx = await fixtureTasks(view);
      if (fx) return fx;
      const q = new URLSearchParams({ view, today: day, ...(projectId ? { projectId } : {}), ...(includeDone ? { includeDone: '1' } : {}) });
      return (await api<{ tasks: Task[] }>(`${base(ws)}/tasks?${q}`)).tasks;
    },
    enabled: view !== 'project' || !!projectId,
  });

export const taskQuery = (ws: string, id: string) =>
  queryOptions({ queryKey: tk.one(ws, id), queryFn: async () => (await api<{ task: Task }>(`${base(ws)}/tasks/${id}`)).task });

export const countsQuery = (ws: string, day: string) =>
  queryOptions({ queryKey: tk.counts(ws, day), queryFn: () => api<TaskCounts>(`${base(ws)}/tasks/counts?today=${day}`), staleTime: 30_000 });

export const pinsQuery = (ws: string) =>
  queryOptions({ queryKey: tk.pins(ws), queryFn: async () => (await api<{ pins: PinItem[] }>(`${base(ws)}/pins`)).pins, staleTime: 30_000 });

/** Writes the fresh task into every cached view and the single-task cache. */
function refreshTask(qc: QueryClient, ws: string, t?: Task) {
  if (t) qc.setQueryData(tk.one(ws, t.id), t);
  void qc.invalidateQueries({ queryKey: tk.all(ws) });
  void qc.invalidateQueries({ queryKey: tk.pins(ws) });
}

/** How long a completed row stays, checked, before it leaves the list (DESIGN.md § Checkbox). */
export const LEAVE_MS = 1200;

export function useTaskMutations(ws: string) {
  const qc = useQueryClient();
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const uncomplete = useMutation({
    mutationFn: (id: string) => api<{ task: Task }>(`${base(ws)}/tasks/${id}/uncomplete`, { body: {} }),
    onSuccess: ({ task }) => refreshTask(qc, ws, task),
    onError,
  });

  return {
    create: useMutation({
      mutationFn: (input: CreateTaskInput) => api<{ task: Task }>(`${base(ws)}/tasks`, { body: input }),
      onSuccess: ({ task }) => refreshTask(qc, ws, task),
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
        api<{ task: Task }>(`${base(ws)}/tasks/${id}`, { method: 'PATCH', body: input }),
      onMutate: ({ id, ...input }) => {
        const prev = qc.getQueryData<Task>(tk.one(ws, id));
        if (prev) qc.setQueryData(tk.one(ws, id), { ...prev, ...input });
        return { prev };
      },
      onError: (e, v, c) => {
        if (c?.prev) qc.setQueryData(tk.one(ws, v.id), c.prev);
        onError(e);
      },
      onSuccess: ({ task }) => refreshTask(qc, ws, task),
    }),
    /** Completes now; lists refresh after LEAVE_MS so the checked row can linger, with Undo. */
    complete: useMutation({
      mutationFn: (t: Task) => api<{ task: Task }>(`${base(ws)}/tasks/${t.id}/complete`, { body: { today: today() } }),
      onSuccess: ({ task }, t) => {
        qc.setQueryData(tk.one(ws, task.id), task);
        setTimeout(() => refreshTask(qc, ws), LEAVE_MS);
        const rolled = task.status !== 'done' && task.dueDate !== t.dueDate;
        toast(rolled && task.dueDate ? `Done. Next: ${dueLabel(task.dueDate)}` : `Completed ${t.title}`, {
          duration: 6000,
          action: { label: 'Undo', onClick: () => uncomplete.mutate(t.id) },
        });
      },
      onError,
    }),
    uncomplete,
    reorder: useMutation({
      mutationFn: (ids: string[]) => api(`${base(ws)}/tasks/reorder`, { body: { ids } }),
      onSettled: () => qc.invalidateQueries({ queryKey: tk.all(ws) }),
      onError,
    }),
    trash: useMutation({
      mutationFn: (t: Task) => api(`${base(ws)}/trash`, { body: { kind: 'task', id: t.id } }),
      onSuccess: (_d, t) => {
        refreshTask(qc, ws);
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'trash'] });
        toast(`Moved ${t.title} to Trash`, {
          duration: 6000,
          action: {
            label: 'Undo',
            onClick: () =>
              void api(`${base(ws)}/trash/restore`, { body: { kind: 'task', id: t.id } }).then(() => refreshTask(qc, ws), onError),
          },
        });
      },
      onError,
    }),
  };
}

export function usePins(ws: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: tk.pins(ws) });
  const toggle = useMutation({
    mutationFn: ({ itemType, itemId, pinned }: { itemType: PinType; itemId: string; pinned: boolean }) =>
      api(`${base(ws)}/pins${pinned ? '/remove' : ''}`, { body: { itemType, itemId } }),
    onMutate: ({ itemType, itemId, pinned }) => {
      const prev = qc.getQueryData<PinItem[]>(tk.pins(ws));
      if (prev && pinned) qc.setQueryData(tk.pins(ws), prev.filter((p) => !(p.itemType === itemType && p.itemId === itemId)));
      return { prev };
    },
    onSuccess: (_d, v) => toast(v.pinned ? 'Unpinned' : 'Pinned to Important'),
    onError: (e, _v, c) => {
      if (c?.prev) qc.setQueryData(tk.pins(ws), c.prev);
      toast.error(errorMessage(e));
    },
    onSettled: refresh,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api(`${base(ws)}/pins/reorder`, { body: { ids } }),
    onMutate: (ids) => {
      const prev = qc.getQueryData<PinItem[]>(tk.pins(ws));
      if (prev) {
        const byId = new Map(prev.map((p) => [p.id, p]));
        const moved = ids.map((id) => byId.get(id)!).filter(Boolean);
        qc.setQueryData(tk.pins(ws), [...moved, ...prev.filter((p) => !ids.includes(p.id))]);
      }
      return { prev };
    },
    onError: (e, _v, c) => {
      if (c?.prev) qc.setQueryData(tk.pins(ws), c.prev);
      toast.error(errorMessage(e));
    },
    onSettled: refresh,
  });
  return { toggle, reorder };
}

export function isPinned(pins: PinItem[] | undefined, itemType: PinType, itemId: string) {
  return !!pins?.some((p) => p.itemType === itemType && p.itemId === itemId);
}

// ── Task sheet store: open a task's details from anywhere ───────────────────

let openId: string | null = null;
const listeners = new Set<() => void>();
export function openTask(id: string | null) {
  openId = id;
  listeners.forEach((l) => l());
}
export function useOpenTask(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => openId,
  );
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** "Today", "Tomorrow", "Yesterday", "Thursday", "3 Dec", "3 Dec 2027". */
export function dueLabel(date: string, day: string = today()): string {
  const d = new Date(`${date}T00:00:00`);
  const diff = Math.round((d.getTime() - new Date(`${day}T00:00:00`).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = date.slice(0, 4) === day.slice(0, 4);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** 15:00 → "3:00 PM" or "15:00", following the device's locale. */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
