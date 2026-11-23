import { ArrowRightLeft, Copy, Download, FilePlus, FolderPlus, Link2, Pencil, Trash2 } from 'lucide-react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import type { ItemKind } from '@shared/schemas';
import { cn } from '@web/lib/cn';
import { modKey } from '@web/lib/workspace-memory';

export type ItemAction = 'newPage' | 'newFolder' | 'rename' | 'duplicate' | 'move' | 'copyLink' | 'markdown' | 'delete';

const ACTIONS: Record<ItemKind, ItemAction[][]> = {
  project: [['newPage', 'newFolder'], ['rename'], ['delete']],
  folder: [['newPage', 'newFolder'], ['rename', 'move'], ['delete']],
  page: [['rename', 'duplicate', 'move'], ['copyLink', 'markdown'], ['delete']],
};

const META: Record<ItemAction, { label: string; icon: ReactNode; hint?: string; danger?: boolean }> = {
  newPage: { label: 'New page', icon: <FilePlus /> },
  newFolder: { label: 'New folder', icon: <FolderPlus /> },
  rename: { label: 'Rename', icon: <Pencil />, hint: 'F2' },
  duplicate: { label: 'Duplicate', icon: <Copy /> },
  move: { label: 'Move to…', icon: <ArrowRightLeft /> },
  copyLink: { label: 'Copy link', icon: <Link2 /> },
  markdown: { label: 'Download Markdown', icon: <Download /> },
  delete: { label: 'Move to Trash', icon: <Trash2 />, hint: 'Del', danger: true },
};

export const menuContentClass =
  'animate-popover z-50 min-w-52 rounded-lg bg-surface-overlay p-1 text-on-surface shadow-2 ring-1 ring-border';
export const menuItemClass = cn(
  'flex h-nav cursor-default items-center gap-2 rounded-md px-2 text-body outline-none select-none',
  'data-highlighted:bg-border/70 data-disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]',
);

type Prims = typeof ContextMenu | typeof DropdownMenu;

function Items({ P, kind, onAction }: { P: Prims; kind: ItemKind; onAction: (a: ItemAction) => void }) {
  return ACTIONS[kind].map((group, gi) => (
    <div key={gi} role="none">
      {gi > 0 && <P.Separator className="my-1 h-hairline bg-border" />}
      {group.map((a) => {
        const m = META[a];
        return (
          <P.Item key={a} className={cn(menuItemClass, m.danger && 'text-error')} onSelect={() => onAction(a)}>
            <span className={m.danger ? '' : 'text-on-surface-muted'}>{m.icon}</span>
            <span className="flex-1">{m.label}</span>
            {m.hint && <kbd className="font-sans text-meta text-on-surface-subtle">{m.hint === 'mod' ? modKey : m.hint}</kbd>}
          </P.Item>
        );
      })}
    </div>
  ));
}

export function ItemContextMenu({
  kind,
  onAction,
  children,
}: {
  kind: ItemKind;
  onAction: (a: ItemAction) => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClass} collisionPadding={8}>
          <Items P={ContextMenu} kind={kind} onAction={onAction} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function ItemDropdownContent({ kind, onAction }: { kind: ItemKind; onAction: (a: ItemAction) => void }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content className={menuContentClass} align="start" sideOffset={4} collisionPadding={8}>
        <Items P={DropdownMenu} kind={kind} onAction={onAction} />
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
