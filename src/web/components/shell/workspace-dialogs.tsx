import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { Workspace } from '@shared/schemas';
import { Button } from '@web/components/ui/button';
import { Dialog, DialogClose } from '@web/components/ui/dialog';
import { Field } from '@web/components/ui/field';
import { WorkspaceGlyph } from '@web/components/ui/glyph';
import { errorMessage } from '@web/lib/api';
import { useCreateWorkspace, useDeleteWorkspace, useUpdateWorkspace } from '@web/lib/queries';

const ICON_HINT = 'One emoji or up to 2 letters. Leave empty to use the first letter.';

function glyphCount(v: string) {
  return [...new Intl.Segmenter().segment(v.trim())].length;
}

/*
 * The forms live in their own components: Radix unmounts dialog content when
 * closed, so every open starts from fresh state with no reset effect.
 */

/** Create (no workspace) or edit (with workspace) the name and icon. */
export function WorkspaceFormDialog({
  open,
  onOpenChange,
  workspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace?: Workspace;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={workspace ? 'Edit workspace' : 'New workspace'}
      description={
        workspace ? undefined : 'A sealed space for one client or area of life. Agents and AI only ever see one workspace.'
      }
    >
      <WorkspaceForm workspace={workspace} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function WorkspaceForm({ workspace, onDone }: { workspace?: Workspace; onDone: () => void }) {
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const update = useUpdateWorkspace();
  const [name, setName] = useState(workspace?.name ?? '');
  const [icon, setIcon] = useState(workspace?.icon ?? '');
  const [error, setError] = useState<string | null>(null);
  const pending = workspace ? update.isPending : create.isPending;
  const iconError = glyphCount(icon) > 2 ? 'Use one emoji or up to 2 letters.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the workspace a name.');
    if (iconError) return;
    setError(null);
    try {
      if (workspace) {
        await update.mutateAsync({ id: workspace.id, name: name.trim(), icon: icon.trim() || null });
        toast('Workspace updated');
      } else {
        const res = await create.mutateAsync({ name: name.trim(), ...(icon.trim() ? { icon: icon.trim() } : {}) });
        toast(`Created ${res.workspace.name}`);
        void navigate({ to: '/w/$workspaceId', params: { workspaceId: res.workspace.id } });
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex items-end gap-3">
        <WorkspaceGlyph name={name || 'W'} icon={icon.trim() || null} className="mb-2 size-8 text-body" />
        <Field
          className="flex-1"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Fevgo"
          autoFocus
          autoComplete="off"
          error={error}
        />
      </div>
      <Field
        label="Icon"
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        placeholder="🏡"
        autoComplete="off"
        hint={ICON_HINT}
        error={iconError}
      />
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending}>
          {workspace ? 'Save changes' : 'Create workspace'}
        </Button>
      </div>
    </form>
  );
}

/** Delete needs the exact name typed (PRD 6.1). It goes to trash for 30 days. */
export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  isLast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  isLast: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${workspace.name}?`}
      description="The workspace and everything in it move to Trash. You can restore it for 30 days, then it's deleted for good."
    >
      <DeleteForm workspace={workspace} isLast={isLast} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function DeleteForm({ workspace, isLast, onDone }: { workspace: Workspace; isLast: boolean; onDone: () => void }) {
  const del = useDeleteWorkspace();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === workspace.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches || isLast) return;
    try {
      await del.mutateAsync({ id: workspace.id, confirmName: typed });
      toast(`Moved ${workspace.name} to Trash`, { description: 'You can restore it for 30 days.' });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {isLast ? (
        <p className="text-body text-on-surface-muted">
          This is your only workspace. Create another one first, then delete this one.
        </p>
      ) : (
        <Field
          label={`Type ${workspace.name} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          error={error}
          hint={matches ? 'Name matches.' : 'The name must match exactly, including capitals.'}
        />
      )}
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="destructive" disabled={!matches || isLast} loading={del.isPending}>
          Delete workspace
        </Button>
      </div>
    </form>
  );
}
