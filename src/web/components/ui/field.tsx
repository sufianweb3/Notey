import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@web/lib/cn';

export const inputClass = cn(
  'h-input w-full rounded-md bg-surface-raised px-3 text-body-doc text-on-surface sm:text-body',
  'ring-1 ring-inset ring-border-strong/45 placeholder:text-on-surface-subtle',
  'transition-shadow duration-(--duration-micro) ease-out',
  'hover:ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
  'aria-invalid:ring-2 aria-invalid:ring-error disabled:opacity-55',
);

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
};

/** Label, input, then either the error or the hint. Error is announced and linked. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-label font-medium text-on-surface">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        className={inputClass}
        {...rest}
      />
      {error ? (
        <p id={noteId} role="alert" className="text-meta text-error">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-meta text-on-surface-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
