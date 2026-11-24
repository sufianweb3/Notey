import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleAlert, Columns3, List } from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import { z } from 'zod';
import { SkeletonRows } from '@web/components/shell/route-states';
import { TopBar } from '@web/components/shell/top-bar';
import { QuickAdd } from '@web/components/tasks/quick-add';
import { TaskBoard } from '@web/components/tasks/task-board';
import { TaskList } from '@web/components/tasks/task-list';
import { Button } from '@web/components/ui/button';
import { inputClass } from '@web/components/ui/field';
import { errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { treeQuery } from '@web/lib/content';
import { workspacesQuery } from '@web/lib/queries';
import { tasksQuery, today } from '@web/lib/tasks';

const search = z.object({
  view: z.enum(['inbox', 'today', 'upcoming', 'project']).catch('today'),
  project: z.string().optional().catch(undefined),
  layout: z.enum(['list', 'board']).catch('list'),
});

export const Route = createFileRoute('/_app/w/$workspaceId/tasks')({
  validateSearch: search,
  component: TasksView,
});

const TABS = [
  { view: 'inbox', label: 'Inbox' },
  { view: 'today', label: 'Today' },
  { view: 'upcoming', label: 'Upcoming' },
] as const;

const EMPTY: Record<string, string> = {
  inbox: 'Inbox is clear. Tasks without a project land here. Add one with T.',
  today: 'No tasks for today. Add one with T.',
  upcoming: 'Nothing due in the next 14 days.',
  project: 'No open tasks in this project yet.',
};

function TasksView() {
  const { workspaceId: ws } = Route.useParams();
  const { view, project, layout } = Route.useSearch();
  const navigate = Route.useNavigate();
  const day = today();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const { data: tree } = useQuery(treeQuery(ws));
  const projectId = view === 'project' ? (project ?? tree?.projects[0]?.id) : undefined;
  const board = layout === 'board';
  const q = useQuery(tasksQuery(ws, view, day, projectId, board));
  const wsName = workspaces.find((w) => w.id === ws)?.name ?? 'Workspace';
  const projects = tree?.projects ?? [];

  const tabClass = (on: boolean) =>
    cn(
      'inline-flex h-control-sm items-center rounded-md px-3 text-label transition-colors duration-(--duration-micro)',
      on ? 'bg-primary text-on-primary' : 'text-on-surface-muted pointer-hover:hover:bg-neutral pointer-hover:hover:text-on-surface',
    );

  return (
    <>
      <TopBar crumbs={[{ label: wsName, to: { ws } }, { label: 'Tasks' }]} />
      <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 pt-6 pb-16 medium:px-6 expanded:px-10 expanded:pt-10">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-h1 font-semibold">Tasks</h1>
          <nav aria-label="Task views" className="flex flex-wrap items-center gap-1">
            {TABS.map((t) => (
              <Link key={t.view} to="." search={(s) => ({ ...s, view: t.view, project: undefined })} className={tabClass(view === t.view)} aria-current={view === t.view ? 'page' : undefined}>
                {t.label}
              </Link>
            ))}
            {projects.length > 0 && (
              <select
                aria-label="Project"
                value={view === 'project' ? (projectId ?? '') : ''}
                onChange={(e) => e.target.value && void navigate({ search: (s) => ({ ...s, view: 'project', project: e.target.value }) })}
                className={cn(inputClass, 'h-control-sm w-auto max-w-48 py-0', view === 'project' && 'ring-2 ring-primary')}
              >
                <option value="" disabled>
                  Project…
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </nav>
          <ToggleGroup.Root
            type="single"
            value={layout}
            onValueChange={(v) => v && void navigate({ search: (s) => ({ ...s, layout: v as 'list' | 'board' }) })}
            aria-label="Layout"
            className="ml-auto inline-flex rounded-md bg-neutral p-0.5"
          >
            {(
              [
                ['list', 'List', List],
                ['board', 'Board', Columns3],
              ] as const
            ).map(([v, label, Icon]) => (
              <ToggleGroup.Item
                key={v}
                value={v}
                className="inline-flex h-7 items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2.5 text-label text-on-surface-muted data-[state=on]:bg-surface-raised data-[state=on]:text-on-surface data-[state=on]:shadow-2"
              >
                <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
                {label}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </header>

        <QuickAdd
          key={`${view}:${projectId}`}
          ws={ws}
          projectId={projectId ?? null}
          defaultDue={view === 'today' ? day : null}
          placeholder={view === 'today' ? 'Add a task for today' : 'Add a task, e.g. "Pay rent every month on 1st"'}
        />

        {view === 'project' && !projectId ? (
          <p className="py-6 text-body text-on-surface-muted">Create a project to give tasks a home.</p>
        ) : q.isPending ? (
          <SkeletonRows rows={5} />
        ) : q.isError ? (
          <div role="alert" className="flex items-center gap-3 py-4">
            <CircleAlert className="size-4 shrink-0 text-error" strokeWidth={1.5} aria-hidden />
            <p className="flex-1 text-body">{errorMessage(q.error)}</p>
            <Button size="sm" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : board ? (
          <TaskBoard ws={ws} tasks={q.data} />
        ) : q.data.length === 0 ? (
          <p className="py-6 text-body text-on-surface-muted">{EMPTY[view]}</p>
        ) : (
          <TaskList ws={ws} view={view} tasks={q.data} />
        )}
      </div>
    </>
  );
}
