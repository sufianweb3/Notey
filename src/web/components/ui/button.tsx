import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@web/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'md' | 'sm' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface-raised text-on-surface ring-1 ring-inset ring-border hover:bg-neutral',
  ghost: 'text-on-surface-muted hover:bg-border/70 hover:text-on-surface',
  destructive: 'bg-error text-on-error hover:bg-error/90',
};

const sizes: Record<Size, string> = {
  md: 'h-control px-btn-x',
  sm: 'h-control-sm px-3',
  icon: 'size-control-sm justify-center',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Keeps the button's width and shows a spinner in place of the label. */
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center gap-2 rounded-md text-label font-medium whitespace-nowrap select-none',
        'transition-[background-color,color,transform,box-shadow] duration-(--duration-micro) ease-out',
        'active:scale-[0.97] active:duration-(--duration-press)',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" aria-hidden>
          <Spinner />
        </span>
      )}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
