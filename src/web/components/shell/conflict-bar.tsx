import { Info } from 'lucide-react';
import { Button } from '@web/components/ui/button';

/** "This page changed somewhere else": reload theirs or keep mine (theirs stays in history). */
export function ConflictBar({ by, onReload, onKeepMine }: { by: string; onReload: () => void; onKeepMine: () => void }) {
  return (
    <div role="status" className="mx-auto flex w-full max-w-doc flex-wrap items-center gap-3 rounded-lg bg-surface-raised px-4 py-3 shadow-2 ring-1 ring-border">
      <Info className="size-4 shrink-0 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
      <p className="min-w-0 flex-1 text-body">
        {by.startsWith('agent:') ? `${by.slice(6)} edited this page.` : 'This page changed in another tab or window.'}
      </p>
      <Button size="sm" onClick={onReload}>
        Reload
      </Button>
      <Button size="sm" variant="ghost" onClick={onKeepMine}>
        Keep mine
      </Button>
    </div>
  );
}
