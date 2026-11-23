import { useSyncExternalStore } from 'react';

/*
 * Per-device preferences in localStorage (sidebar state and width, expanded
 * tree nodes, theme). Storage may be unavailable: every access is guarded and
 * the app works with defaults.
 */

const listeners = new Set<() => void>();
const cache = new Map<string, string | null>();

function read(key: string): string | null {
  if (cache.has(key)) return cache.get(key)!;
  let v: string | null;
  try {
    v = localStorage.getItem(key);
  } catch {
    v = null;
  }
  cache.set(key, v);
  return v;
}

export function setPref(key: string, value: string | null) {
  cache.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

export function usePref(key: string, fallback: string): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(key) ?? fallback,
  );
}

export const PREF = {
  sidebar: 'notey:sidebar', // 'expanded' | 'collapsed'
  sidebarWidth: 'notey:sidebarWidth',
  theme: 'notey:theme', // 'system' | 'light' | 'dark'
  expanded: (ws: string) => `notey:expanded:${ws}`,
};

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 248;

// ── Theme ───────────────────────────────────────────────────────────────────

export type ThemePref = 'system' | 'light' | 'dark';

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function useResolvedTheme(): 'light' | 'dark' {
  const pref = usePref(PREF.theme, 'system') as ThemePref;
  const systemDark = useSyncExternalStore(
    (cb) => {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

export function cycleTheme(): ThemePref {
  const order: ThemePref[] = ['system', 'light', 'dark'];
  const current = (read(PREF.theme) ?? 'system') as ThemePref;
  const next = order[(order.indexOf(current) + 1) % order.length]!;
  setPref(PREF.theme, next);
  applyTheme(next);
  return next;
}
