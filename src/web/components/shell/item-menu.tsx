import { ArrowRightLeft, Copy, Download, FilePlus, FolderPlus, Link2, Pencil, Shapes, Star, Trash2, Workflow } from 'lucide-react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import type { ItemKind } from '@shared/schemas';
import { cn } from '@web/lib/cn';
import { modKey } from '@web/lib/workspace-memory';

export type ItemAction = 'newPage' | 'newCanvas' | 'newMindmap' | 'newFolder' | 'rename' | 'duplicate' | 'move' | 'pin' | 'copyLink' | 'markdown' | 'delete';

const ACTIONS: Record<ItemKind, ItemAction[][]> = {
  project: [['newPage', 'newCanvas', 'newMindmap', 'newFolder'], ['rename', 'pin'], ['delete']],
  folder: [['newPage', 'newCanvas', 'newMindmap', 'newFolder'], ['rename', 'move', 'pin'], ['delete']],
  page: [['rename', 'duplicate', 'move', 'pin'], ['copyLink', 'markdown'], ['delete']],
};

const META: Record<ItemAction, { label: string; icon: ReactNode; hint?: string; danger?: boolean }> = {
  newPage: { label: 'New doc', icon: <FilePlus /> },
  newCanvas: { label: 'New canvas', icon: <Shapes /> },
  newMindmap: { label: 'New mindmap', icon: <Workflow /> },
  newFolder: { label: 'New folder', icon: <FolderPlus /> },
  rename: { label: 'Rename', icon: <Pencil />, hint: 'F2' },
  duplicate: { label: 'Duplicate', icon: <Copy /> },
  move: { label: 'Move to…', icon: <ArrowRightLeft /> },
  pin: { label: 'Pin', icon: <Star /> },
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
type MenuProps = { kind: ItemKind; onAction: (a: ItemAction) => void; pinned?: boolean };
type DropdownProps = MenuProps & {
  /** Items specific to this page type, shown first (export, describe, outline). */
  extra?: { label: string; icon: ReactNode; onSelect: () => void }[];
};

function Items({ P, kind, onAction, pinned }: MenuProps & { P: Prims }) {
  return ACTIONS[kind].map((group, gi) => (
    <div key={gi} role="none">
      {gi > 0 && <P.Separator className="my-1 h-hairline bg-border" />}
      {group.map((a) => {
        const m = META[a];
        const label = a === 'pin' && pinned ? 'Unpin' : m.label;
        const hint = a === 'pin' && kind === 'page' ? `${modKey}⇧P` : m.hint;
        return (
          <P.Item key={a} className={cn(menuItemClass, m.danger && 'text-error')} onSelect={() => onAction(a)}>
            <span className={m.danger ? '' : 'text-on-surface-muted'}>{a === 'pin' && pinned ? <Star className="fill-current" /> : m.icon}</span>
            <span className="flex-1">{label}</span>
            {hint && <kbd className="font-sans text-meta text-on-surface-subtle">{hint}</kbd>}
          </P.Item>
        );
      })}
    </div>
  ));
}

export function ItemContextMenu({ children, ...props }: MenuProps & { children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClass} collisionPadding={8}>
          <Items P={ContextMenu} {...props} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function ItemDropdownContent({ extra, ...props }: DropdownProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content className={menuContentClass} align="start" sideOffset={4} collisionPadding={8}>
        {extra?.length ? (
          <>
            {extra.map((x) => (
              <DropdownMenu.Item key={x.label} className={menuItemClass} onSelect={x.onSelect}>
                <span className="text-on-surface-muted">{x.icon}</span>
                <span className="flex-1">{x.label}</span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-hairline bg-border" />
          </>
        ) : null}
        <Items P={DropdownMenu} {...props} />
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
