import { Link } from '@tanstack/react-router';
import { Folder, Layers } from 'lucide-react';
import type { PinItem } from '@shared/schemas';
import { cn } from '@web/lib/cn';
import { relativeTime, editedByLabel } from '@web/lib/time';

import { PAGE_ICONS } from '@web/lib/page-icons';

function Glyph({ pin }: { pin: PinItem }) {
  if (pin.icon) return <span className="text-h3 leading-none">{pin.icon}</span>;
  const Icon = pin.itemType === 'project' ? Layers : pin.itemType === 'folder' ? Folder : PAGE_ICONS[pin.pageType ?? 'doc'];
  return <Icon className="size-4.5" strokeWidth={1.5} aria-hidden />;
}

/** "3 of 8 done" in words plus a lime bar: the one signal card DESIGN.md allows. */
export function Progress({ done, total, onDark }: { done: number; total: number; onDark?: boolean }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn('tnum text-meta', onDark ? 'opacity-80' : 'text-accent-ink')}>
        {done} of {total} done
      </span>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label="Tasks done"
        className={cn('h-1 overflow-hidden rounded-full', onDark ? 'bg-on-primary/20' : 'bg-border')}
      >
        <span className="block h-full rounded-full bg-accent transition-[width] duration-(--duration-popover) ease-out" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** A pinned page, folder or project (DESIGN.md § Card). `signal` = the charcoal progress card. */
export function PinCard({ ws, pin, signal, projectName }: { ws: string; pin: PinItem; signal?: boolean; projectName?: string }) {
  const by = pin.updatedBy ? editedByLabel(pin.updatedBy) : null;
  const meta =
    pin.itemType === 'page'
      ? [by, pin.updatedAt ? relativeTime(pin.updatedAt) : null, !by ? projectName : null].filter(Boolean).join(' · ')
      : pin.itemType === 'folder'
        ? (projectName ?? 'Folder')
        : null;
  const inner = (
    <>
      <span className={cn('grid size-6 place-items-center', signal ? 'text-on-primary' : 'text-on-surface-muted')}>
        <Glyph pin={pin} />
      </span>
      <span className="line-clamp-2 text-body font-medium [overflow-wrap:anywhere]">{pin.title || 'Untitled'}</span>
      {pin.itemType === 'project' && pin.progress && pin.progress.total > 0 ? (
        <Progress done={pin.progress.done} total={pin.progress.total} onDark={signal} />
      ) : meta ? (
        <span className={cn('truncate text-meta', signal ? 'opacity-80' : 'text-on-surface-subtle')}>{meta}</span>
      ) : null}
    </>
  );
  const cls = cn(
    'flex h-full min-h-28 flex-col gap-2 rounded-lg px-3.5 py-3 outline-none transition-[background-color,transform] duration-(--duration-micro) active:scale-[0.98]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    signal ? 'bg-primary text-on-primary' : 'bg-surface-raised text-on-surface ring-1 ring-border ring-inset pointer-hover:hover:bg-neutral',
  );
  if (pin.itemType === 'page')
    return (
      <Link to="/w/$workspaceId/p/$pageId" params={{ workspaceId: ws, pageId: pin.itemId }} className={cls}>
        {inner}
      </Link>
    );
  if (pin.itemType === 'project')
    return (
      <Link to="/w/$workspaceId/tasks" params={{ workspaceId: ws }} search={{ view: 'project', project: pin.itemId, layout: 'list' }} className={cls}>
        {inner}
      </Link>
    );
  // Folders have no page of their own yet; the card shows where they live.
  return <div className={cls}>{inner}</div>;
}
