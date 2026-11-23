import type { ReactNode } from 'react';
import { BrandMark } from '@web/components/ui/glyph';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-start justify-center bg-neutral px-4 pt-[12dvh] pb-12 medium:items-center medium:pt-12">
      <div className="flex w-full max-w-auth flex-col gap-6">
        <div className="flex flex-col gap-4">
          <BrandMark className="size-10" />
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 font-semibold">{title}</h1>
            <p className="text-body text-on-surface-muted">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

/** Form-level error: icon plus words, never colour alone. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-error/8 px-3 py-2 text-body text-error ring-1 ring-error/25 ring-inset">
      {message}
    </p>
  );
}
