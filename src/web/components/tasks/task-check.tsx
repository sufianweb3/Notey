import { cn } from '@web/lib/cn';

/**
 * The lime check, Notey's signature moment (DESIGN.md § Components): a 16 px
 * circle with a 1.5 px ring; checking fills it with lime and draws a charcoal
 * tick over 220 ms. The hit area is 24 px (44 px on touch). Under reduced
 * motion the fill and tick appear at once.
 */
export function TaskCheck({
  checked,
  title,
  onToggle,
  disabled,
  className,
}: {
  checked: boolean;
  title: string;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${checked ? 'Reopen' : 'Complete'}: ${title || 'Untitled task'}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'group/check relative grid size-6 shrink-0 place-items-center rounded-full outline-none',
        'before:absolute before:-inset-2.5 before:content-[""] pointer-hover:before:inset-0',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-55',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-4 place-items-center rounded-full ring-[1.5px] ring-inset transition-[background-color,box-shadow] duration-(--duration-check) ease-out',
          checked ? 'bg-accent ring-transparent' : 'ring-border-strong pointer-hover:group-hover/check:ring-on-surface-muted',
        )}
      >
        <svg viewBox="0 0 16 16" className="size-3" fill="none">
          <path
            d="M4 8.5l2.5 2.5L12 5.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className={cn(
              'text-on-accent [stroke-dasharray:1] transition-[stroke-dashoffset] delay-60 duration-(--duration-check) ease-out',
              checked ? '[stroke-dashoffset:0]' : '[stroke-dashoffset:1]',
            )}
          />
        </svg>
      </span>
    </button>
  );
}
