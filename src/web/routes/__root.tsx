import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

function Root() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-label text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Outlet />
      <Toaster
        position="bottom-center"
        duration={4000}
        toastOptions={{
          className: '!bg-surface-overlay !text-on-surface !ring-1 !ring-border !shadow-2 !border-0 !rounded-lg !font-sans',
        }}
      />
    </>
  );
}
