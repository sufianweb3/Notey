const KEY = 'notey:lastWorkspace';

/** Per-device memory of the last workspace opened. Storage can be unavailable; never throw. */
export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode or blocked storage */
  }
}

export function lastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl+';
