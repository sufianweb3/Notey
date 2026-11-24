import { Link } from '@tanstack/react-router';
import { cn } from '@web/lib/cn';

const TABS = [
  { to: '/settings/workspaces', label: 'Workspaces' },
  { to: '/settings/ai-access', label: 'AI access' },
] as const;

/** Tabs across Settings pages. */
export function SettingsNav() {
  return (
    <nav aria-label="Settings" className="-mb-4 flex gap-1 border-b border-border">
      {TABS.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className={cn('-mb-px border-b-2 border-transparent px-2 pb-2 text-label font-medium text-on-surface-muted hover:text-on-surface')}
          activeProps={{ className: 'border-primary! text-on-surface!', 'aria-current': 'page' }}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
