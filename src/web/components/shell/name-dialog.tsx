import { useState, type FormEvent } from 'react';
import { Button } from '@web/components/ui/button';
import { Dialog, DialogClose } from '@web/components/ui/dialog';
import { Field } from '@web/components/ui/field';
import { errorMessage } from '@web/lib/api';

/** One-field dialog for naming a new project or folder. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <NameForm label={label} placeholder={placeholder} submitLabel={submitLabel} onSubmit={onSubmit} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function NameForm({
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onDone,
}: {
  label: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(`Enter a ${label.toLowerCase()}.`);
    setPending(true);
    try {
      await onSubmit(name.trim());
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={label} value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={80} autoFocus autoComplete="off" error={error} />
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
