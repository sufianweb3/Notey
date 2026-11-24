import { Dialog } from '@web/components/ui/dialog';
import { modKey } from '@web/lib/workspace-memory';

const ROWS: [string, string][] = [
  [`${modKey}K`, 'Search and commands'],
  [`${modKey}N`, 'New page'],
  ['T', 'Quick add a task'],
  [`${modKey}⇧P`, 'Pin or unpin the open page'],
  [`${modKey}\\`, 'Collapse or expand the sidebar'],
  [`${modKey}1 – ${modKey}9`, 'Switch workspace'],
  ['↑ ↓ ← →', 'Move around the page tree'],
  ['F2', 'Rename the focused item'],
  ['Delete', 'Move the focused item to Trash'],
  ['/', 'Insert a block in a doc'],
  ['@ or [[', 'Link to another page'],
  [`${modKey}⇧V`, 'Paste as plain text'],
  ['?', 'Show these shortcuts'],
];

export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
        {ROWS.map(([keys, what]) => (
          <div key={keys} className="contents">
            <dt>
              <kbd className="tnum rounded-sm bg-neutral px-1.5 py-0.5 font-sans text-meta text-on-surface ring-1 ring-border">{keys}</kbd>
            </dt>
            <dd className="text-on-surface-muted">{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
