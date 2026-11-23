import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@web/lib/cn';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Level 3: ring + shadow-3 + scrim. Bottom-aligned sheet on compact screens. */
export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="animate-scrim fixed inset-0 z-40 bg-scrim" />
        <D.Content
          className={cn(
            'animate-dialog fixed z-50 flex flex-col gap-4 bg-surface-raised text-on-surface shadow-3 ring-1 ring-border',
            'inset-x-0 bottom-0 rounded-t-xl p-6 pb-[max(var(--spacing-6),env(safe-area-inset-bottom))]',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-dialog sm:max-w-[calc(100vw-var(--spacing-8))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-6',
            'focus-visible:outline-none',
            className,
          )}
        >
          <div className="flex flex-col gap-1.5">
            <D.Title className="text-h3 font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="text-body text-on-surface-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const DialogClose = D.Close;
