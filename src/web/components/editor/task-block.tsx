import { createReactBlockSpec } from '@blocknote/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelRight, SquareCheck } from 'lucide-react';
import { useState } from 'react';
import type { Tree } from '@shared/schemas';
import { TaskCheck } from '@web/components/tasks/task-check';
import { TaskMeta } from '@web/components/tasks/task-row';
import { ApiError, errorMessage } from '@web/lib/api';
import { ck } from '@web/lib/content';
import { openTask, taskQuery, useTaskMutations } from '@web/lib/tasks';

/** Workspace and page come from the URL: /w/:ws/p/:page. */
function useLocationIds() {
  const [, , ws = '', , pageId = ''] = location.pathname.split('/');
  return { ws, pageId };
}

function NewTask({ onCreate, onCancel }: { onCreate: (title: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex w-full flex-col gap-1 py-0.5">
      <div className="flex items-center gap-2">
        <SquareCheck className="size-4 shrink-0 text-on-surface-subtle" strokeWidth={1.5} aria-hidden />
        <input
          autoFocus
          aria-label="New task title"
          value={title}
          disabled={busy}
          placeholder="Task title, then Enter"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={async (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && title.trim()) {
              e.preventDefault();
              setBusy(true);
              try {
                await onCreate(title.trim());
              } catch (err) {
                setError(errorMessage(err));
                setBusy(false);
              }
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-body-doc text-on-surface outline-none placeholder:text-on-surface-subtle"
        />
      </div>
      <p className={error ? 'text-meta text-error' : 'text-meta text-on-surface-subtle'}>
        {error ?? 'Creates a real task in this page’s project. Esc cancels.'}
      </p>
    </div>
  );
}

function LiveTask({ ws, taskId, onRemove }: { ws: string; taskId: string; onRemove: () => void }) {
  const q = useQuery(taskQuery(ws, taskId));
  const m = useTaskMutations(ws);
  if (q.isPending) return <div className="h-7 w-48 animate-pulse rounded-sm bg-border" aria-label="Loading task" />;
  if (q.isError || !q.data) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="flex items-center gap-3 py-0.5 text-body text-on-surface-subtle">
        <SquareCheck className="size-4" strokeWidth={1.5} aria-hidden />
        <span>{gone ? 'This task is in Trash or was deleted.' : "Couldn't load this task."}</span>
        <button type="button" onClick={gone ? onRemove : () => void q.refetch()} className="text-label underline underline-offset-4">
          {gone ? 'Remove block' : 'Try again'}
        </button>
      </div>
    );
  }
  const t = q.data;
  const done = t.status === 'done';
  return (
    <div className="group/task flex w-full items-center gap-1.5 py-0.5">
      <TaskCheck checked={done} title={t.title} className="-ml-1" onToggle={() => (done ? m.uncomplete.mutate(t.id) : m.complete.mutate(t))} />
      <button
        type="button"
        onClick={() => openTask(t.id)}
        className={done ? 'min-w-0 truncate text-left text-body-doc text-on-surface-subtle line-through' : 'min-w-0 truncate text-left text-body-doc text-on-surface'}
        title="Open task details"
      >
        {t.title}
      </button>
      <span className="flex-1" />
      <TaskMeta task={t} ws={ws} />
      <button
        type="button"
        aria-label={`Open details for ${t.title}`}
        onClick={() => openTask(t.id)}
        className="grid size-7 place-items-center rounded-md text-on-surface-subtle pointer-hover:opacity-0 pointer-hover:group-hover/task:opacity-100 hover:bg-neutral focus-visible:opacity-100"
      >
        <PanelRight className="size-4" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

/** A live task inside a doc (PRD 6.5): the same task as in Tasks, in two places. */
export const TaskBlock = createReactBlockSpec(
  { type: 'task', propSchema: { taskId: { default: '' } }, content: 'none' },
  {
    render: function Render({ block, editor }) {
      const { ws, pageId } = useLocationIds();
      const qc = useQueryClient();
      const m = useTaskMutations(ws);
      const remove = () => editor.removeBlocks([block]);
      return (
        <div contentEditable={false} className="w-full">
          {block.props.taskId ? (
            <LiveTask ws={ws} taskId={block.props.taskId} onRemove={remove} />
          ) : (
            <NewTask
              onCancel={remove}
              onCreate={async (title) => {
                const tree = qc.getQueryData<Tree>(ck.tree(ws));
                const projectId = tree?.pages.find((p) => p.id === pageId)?.projectId ?? null;
                const { task } = await m.create.mutateAsync({ title, projectId, pageId: projectId ? pageId : null });
                editor.updateBlock(block, { props: { taskId: task.id } });
              }}
            />
          )}
        </div>
      );
    },
  },
);
