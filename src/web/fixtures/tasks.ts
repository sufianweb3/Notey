import { addDays, localDate } from '@shared/recurrence';
import type { Task, TaskView } from '@shared/schemas';

/*
 * Dev-only task fixtures: append `?fixture=ideal|worst|empty|loading|error` to
 * the Tasks view in `pnpm dev`. Stripped from production builds.
 */

const today = localDate();
let n = 0;
function t(title: string, extra: Partial<Task> = {}): Task {
  n++;
  const now = new Date().toISOString();
  return {
    id: `fx-t${n}`,
    projectId: null,
    pageId: null,
    title,
    notesMd: '',
    status: 'todo',
    kind: extra.rrule ? 'repeat' : extra.dueDate ? 'dated' : 'once',
    dueDate: null,
    dueTime: null,
    rrule: null,
    sort: n,
    completedAt: null,
    createdBy: 'user:fx',
    updatedBy: 'user:fx',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

const ideal = [
  t('Invoice CRG Attire', { dueDate: addDays(today, -1) }),
  t('Call Rafi about the lookbook', { dueDate: today, dueTime: '15:00' }),
  t('Review bot logs', { dueDate: today, rrule: 'FREQ=DAILY' }),
  t('Send Fevgo homepage draft', { dueDate: today, dueTime: '10:00', status: 'doing' }),
  t('Book Mei for the December shoot', { dueDate: addDays(today, 2) }),
  t('Renew notey.app domain', { dueDate: addDays(today, 9), rrule: 'FREQ=YEARLY' }),
];

const worst = [
  t('Ünïcödé — 名前 — مهمة طويلة جدًا with a very long title that keeps going past any reasonable width to test truncation', { dueDate: addDays(today, -40) }),
  t('A', { dueDate: today, dueTime: '23:59', rrule: 'FREQ=MONTHLY;BYDAY=-1FR' }),
  t('supercalifragilisticexpialidocious-unbreakable-task-name-with-no-spaces-at-all-anywhere', { dueDate: today }),
  ...Array.from({ length: 40 }, (_, i) => t(`Follow up with lead #${i + 1}`, { dueDate: addDays(today, i % 14) })),
];

export async function fixtureTasks(view: TaskView): Promise<Task[] | null> {
  if (!import.meta.env.DEV) return null;
  const name = new URLSearchParams(location.search).get('fixture');
  if (!name) return null;
  if (name === 'loading') return new Promise(() => {});
  if (name === 'error') throw new Error('Fixture: simulated failure');
  if (name === 'empty') return [];
  const set = name === 'worst' ? worst : ideal;
  if (view === 'today') return set.filter((x) => x.dueDate && x.dueDate <= today);
  if (view === 'upcoming') return set.filter((x) => x.dueDate && x.dueDate > today);
  return set;
}
