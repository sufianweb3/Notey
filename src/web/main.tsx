import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouteError, RoutePending } from './components/shell/route-states';
import { ApiError } from './lib/api';
import { setNavigator } from './lib/page-titles';
import { applyTheme, PREF, type ThemePref } from './lib/prefs';
import { routeTree } from './routeTree.gen';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  // Skeletons only after 300 ms (DESIGN.md § Components).
  defaultPendingMs: 300,
  defaultPendingMinMs: 200,
  defaultPendingComponent: RoutePending,
  defaultErrorComponent: RouteError,
  scrollRestoration: true,
});

// Theme before first paint; links inside the editor navigate through the router.
try {
  applyTheme((localStorage.getItem(PREF.theme) as ThemePref | null) ?? 'system');
} catch {
  /* storage blocked: follow the system */
}
setNavigator((href) => void router.navigate({ href }));

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
