import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { cn } from '@web/lib/cn';

export type Crumb = { label: string; to?: { ws: string } };

/**
 * 44 px bar at the top of the content pane: breadcrumb on the left, page
 * actions on the right. Middle crumbs truncate first; on narrow screens only
 * the last two show.
 */
export function TopBar({ crumbs, actions, status }: { crumbs: Crumb[]; actions?: ReactNode; status?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 flex h-topbar shrink-0 items-center gap-2 bg-surface px-3 medium:rounded-t-lg medium:px-4">
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-body text-on-surface-muted">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            const hiddenOnCompact = i < crumbs.length - 2;
            return (
              <Fragment key={i}>
                {i > 0 && (
                  <li aria-hidden className={cn('shrink-0 text-on-surface-subtle', i <= crumbs.length - 2 && 'hidden medium:block')}>
                    <ChevronRight className="size-3.5" strokeWidth={1.5} />
                  </li>
                )}
                <li
                  className={cn('min-w-0 truncate', last ? 'shrink text-on-surface' : 'max-w-40 shrink-[2]', hiddenOnCompact && 'hidden medium:block')}
                  title={c.label}
                  aria-current={last ? 'page' : undefined}
                >
                  {c.to ? (
                    <Link to="/w/$workspaceId" params={{ workspaceId: c.to.ws }} className="rounded-sm hover:text-on-surface">
                      {c.label}
                    </Link>
                  ) : (
                    c.label
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
      {status}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
