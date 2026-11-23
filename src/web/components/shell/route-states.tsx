import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import { errorMessage } from '@web/lib/api';

export function RoutePending() {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface" role="status" aria-live="polite">
      <span className="text-meta text-on-surface-subtle">Loading…</span>
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-4">
      <div role="alert" className="flex max-w-auth flex-col items-center gap-3 text-center">
        <CircleAlert className="size-6 text-error" strokeWidth={1.5} aria-hidden />
        <h1 className="text-h3 font-semibold">This page didn't load</h1>
        <p className="text-body text-on-surface-muted">{errorMessage(error)}</p>
        <Button
          variant="primary"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}

/** Rows of placeholder bars, used by data views while loading. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-row items-center gap-3 border-b border-border px-1 last:border-0">
          <span className="size-glyph animate-pulse rounded-sm bg-border" />
          <span className="h-3 animate-pulse rounded-sm bg-border" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
        </div>
      ))}
    </div>
  );
}
