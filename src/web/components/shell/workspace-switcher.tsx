import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, LogOut, Plus, Settings2 } from 'lucide-react';
import { DropdownMenu as M } from 'radix-ui';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Workspace } from '@shared/schemas';
import { WorkspaceGlyph } from '@web/components/ui/glyph';
import { api, errorMessage } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { meQuery } from '@web/lib/queries';
import { modKey } from '@web/lib/workspace-memory';
import { WorkspaceFormDialog } from './workspace-dialogs';

const itemClass = cn(
  'flex h-nav cursor-default items-center gap-2 rounded-md px-2 text-body text-on-surface outline-none select-none',
  'data-highlighted:bg-border/70 data-disabled:opacity-55',
);

export function WorkspaceSwitcher({
  workspaces,
  current,
  className,
  glyphOnly = false,
}: {
  workspaces: Workspace[];
  current: Workspace | undefined;
  className?: string;
  /** Rail variant: only the workspace mark. */
  glyphOnly?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const [creating, setCreating] = useState(false);

  async function signOut() {
    try {
      await api('/api/auth/sign-out', { body: {} });
      qc.clear();
      void navigate({ to: '/login' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <M.Root>
        <M.Trigger
          className={cn(
            'flex h-input min-w-0 items-center gap-2 rounded-md px-2 text-left text-body font-medium text-on-surface',
            'transition-colors duration-(--duration-micro) ease-out hover:bg-border/70 data-[state=open]:bg-border/70',
            className,
          )}
          aria-label={`Workspace: ${current?.name ?? 'none'}. Switch workspace`}
        >
          {current && <WorkspaceGlyph name={current.name} icon={current.icon} selected className={glyphOnly ? 'size-7 text-label' : undefined} />}
          {!glyphOnly && (
            <>
              <span className="min-w-0 flex-1 truncate">{current?.name ?? 'Choose a workspace'}</span>
              <ChevronsUpDown className="size-4 shrink-0 text-on-surface-subtle" strokeWidth={1.5} aria-hidden />
            </>
          )}
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="animate-popover z-50 flex w-menu max-w-[calc(100vw-var(--spacing-6))] flex-col rounded-lg bg-surface-overlay p-1 shadow-2 ring-1 ring-border"
          >
            <M.Label className="px-2 pt-1.5 pb-1 text-meta text-on-surface-subtle">Workspaces</M.Label>
            <div className="max-h-[50dvh] overflow-y-auto">
              {workspaces.map((w, i) => (
                <M.Item
                  key={w.id}
                  className={itemClass}
                  onSelect={() => void navigate({ to: '/w/$workspaceId', params: { workspaceId: w.id } })}
                >
                  <WorkspaceGlyph name={w.name} icon={w.icon} />
                  <span className="min-w-0 flex-1 truncate" title={w.name}>
                    {w.name}
                  </span>
                  {w.id === current?.id ? (
                    <Check className="size-4 shrink-0" strokeWidth={1.5} aria-label="Current" />
                  ) : i < 9 ? (
                    <kbd className="tnum shrink-0 font-sans text-meta text-on-surface-subtle">
                      {modKey}
                      {i + 1}
                    </kbd>
                  ) : null}
                </M.Item>
              ))}
            </div>
            <M.Separator className="my-1 h-hairline bg-border" />
            <M.Item className={itemClass} onSelect={() => setCreating(true)}>
              <Plus className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
              New workspace
            </M.Item>
            <M.Item className={itemClass} onSelect={() => void navigate({ to: '/settings/workspaces' })}>
              <Settings2 className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
              Manage workspaces
            </M.Item>
            <M.Separator className="my-1 h-hairline bg-border" />
            {me && (
              <p className="truncate px-2 pt-1 pb-0.5 text-meta text-on-surface-subtle" title={me.email}>
                {me.email}
              </p>
            )}
            <M.Item className={itemClass} onSelect={() => void signOut()}>
              <LogOut className="size-4 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
              Sign out
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
      <WorkspaceFormDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
