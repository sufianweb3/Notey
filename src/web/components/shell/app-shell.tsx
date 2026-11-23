import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { House, Settings } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@web/lib/cn';
import { workspacesQuery } from '@web/lib/queries';
import { lastWorkspace, rememberWorkspace } from '@web/lib/workspace-memory';
import { WorkspaceSwitcher } from './workspace-switcher';

const navClass = cn(
  'flex h-nav items-center gap-2 rounded-md px-2 text-body text-on-surface',
  'transition-colors duration-(--duration-micro) ease-out hover:bg-border/70',
  'aria-[current=page]:bg-primary aria-[current=page]:text-on-primary',
);

/**
 * M0 shell: sidebar at expanded widths, a top bar below 840 px. The icon rail,
 * collapse, tree and bottom tab bar arrive with M1 and M6.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const params = useParams({ strict: false }) as { workspaceId?: string };
  const navigate = useNavigate();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const currentId = params.workspaceId ?? lastWorkspace();
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  const knownId = workspaces.some((w) => w.id === params.workspaceId) ? params.workspaceId : undefined;
  useEffect(() => {
    if (knownId) rememberWorkspace(knownId);
  }, [knownId]);

  // ⌘1–⌘9 (Ctrl on Windows and Linux) jumps to a workspace.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const target = workspaces[n - 1];
      if (!target) return;
      e.preventDefault();
      void navigate({ to: '/w/$workspaceId', params: { workspaceId: target.id } });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspaces, navigate]);

  return (
    <div className="flex min-h-dvh bg-neutral">
      <aside
        aria-label="Sidebar"
        className="sticky top-0 hidden h-dvh w-sidebar shrink-0 flex-col gap-4 px-2 py-3 expanded:flex"
      >
        <WorkspaceSwitcher workspaces={workspaces} current={current} className="w-full" />
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {current && (
            <Link to="/w/$workspaceId" params={{ workspaceId: current.id }} className={navClass}>
              <House className="size-4" strokeWidth={1.5} aria-hidden />
              Home
            </Link>
          )}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <Link to="/settings/workspaces" className={navClass}>
            <Settings className="size-4" strokeWidth={1.5} aria-hidden />
            Settings
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-topbar items-center gap-2 bg-neutral px-2 pt-[env(safe-area-inset-top)] expanded:hidden">
          <WorkspaceSwitcher workspaces={workspaces} current={current} className="max-w-[70%]" />
          <Link
            to="/settings/workspaces"
            className="ml-auto grid size-11 place-items-center rounded-md text-on-surface-muted hover:bg-border/70 aria-[current=page]:text-on-surface"
            aria-label="Settings"
          >
            <Settings className="size-4.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </header>
        <main
          id="main"
          className="min-h-0 flex-1 bg-surface expanded:my-2 expanded:mr-2 expanded:rounded-lg expanded:ring-1 expanded:ring-border"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
