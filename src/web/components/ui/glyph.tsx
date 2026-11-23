import { cn } from '@web/lib/cn';

/** The brand mark: charcoal rounded square, lime N (DESIGN.md Known Gaps: starting point). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} role="img" aria-label="Notey">
      {/* on-accent is charcoal in both themes; primary turns lime in dark mode. */}
      <rect width="64" height="64" rx="15" className="fill-on-accent" />
      <path d="M20 46V18h5.2l13.6 19V18H44v28h-5.2L25.2 27v19z" className="fill-accent" />
    </svg>
  );
}

/** A workspace's icon: its emoji or letters, else the first letter of its name. */
export function WorkspaceGlyph({
  name,
  icon,
  className,
  selected = false,
}: {
  name: string;
  icon: string | null;
  className?: string;
  selected?: boolean;
}) {
  const text = icon || [...name.trim()][0]?.toUpperCase() || '·';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid size-glyph shrink-0 place-items-center rounded-sm text-meta font-semibold leading-none',
        selected ? 'bg-primary text-on-primary' : 'bg-border text-on-surface-muted',
        className,
      )}
    >
      {text}
    </span>
  );
}
