import type * as ExcalidrawModule from '@excalidraw/excalidraw';

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

let promise: Promise<typeof ExcalidrawModule> | null = null;

/**
 * Excalidraw (about 1 MB) loads only when a canvas or canvas embed needs it.
 * Its fonts come from this origin (see vite.config.ts), never a CDN.
 */
export function loadExcalidraw(): Promise<typeof ExcalidrawModule> {
  window.EXCALIDRAW_ASSET_PATH = `${location.origin}/excalidraw-assets/`;
  promise ??= Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')]).then(([m]) => m);
  return promise;
}

/**
 * Colours stored inside canvas scenes. These are document data, not UI
 * styles: Excalidraw keeps literal colours per element and inverts the whole
 * scene in dark mode. Values mirror DESIGN.md's light tokens.
 */
export const SCENE = {
  paper: '#fafaf7', // surface
  ink: '#1c1c1e', // on-surface
  lime: '#c6f135', // accent
  wash: '#eef8c8', // accent-wash: sticky notes
} as const;
