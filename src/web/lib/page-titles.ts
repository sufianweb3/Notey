import { useSyncExternalStore } from 'react';

/*
 * Live page titles for page-link chips inside the editor, which render outside
 * the router and query context. The doc page feeds it from the tree.
 */
let titles = new Map<string, string>();
const listeners = new Set<() => void>();

export function setPageTitles(next: Map<string, string>) {
  titles = next;
  listeners.forEach((l) => l());
}

export function usePageTitle(id: string): string | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => titles.get(id),
  );
}

/** In-app navigation for links rendered inside the editor. Set once by main.tsx. */
let navigateTo: (href: string) => void = (href) => location.assign(href);
export function setNavigator(fn: (href: string) => void) {
  navigateTo = fn;
}
export function navigate(href: string) {
  navigateTo(href);
}
