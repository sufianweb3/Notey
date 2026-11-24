import { lazy, type ComponentProps } from 'react';
import type * as CanvasModule from '@web/components/canvas/canvas-page';
import type * as MindmapModule from '@web/components/mindmap/mindmap-page';
import type { PageType } from '@shared/schemas';
import { loadEditor } from './editor-loader';
import { loadExcalidraw } from './excalidraw';

/*
 * Each page type's engine is its own chunk (PRD §10): BlockNote for docs,
 * Excalidraw for canvases, React Flow for mindmaps. The page loader waits
 * for the right one, then the page renders it directly (see editor-loader).
 */
let canvas: typeof CanvasModule | undefined;
let mindmap: typeof MindmapModule | undefined;

export const loadCanvas = () =>
  loadExcalidraw()
    .then(() => import('@web/components/canvas/canvas-page'))
    .then((m) => (canvas = m));
export const loadMindmap = () => import('@web/components/mindmap/mindmap-page').then((m) => (mindmap = m));

export function loadEngine(type: PageType): Promise<unknown> {
  if (type === 'canvas') return loadCanvas();
  if (type === 'mindmap') return loadMindmap();
  return loadEditor();
}

const LazyCanvas = lazy(loadCanvas);
const LazyMindmap = lazy(loadMindmap);

export function CanvasSlot(props: ComponentProps<typeof CanvasModule.default>) {
  const Loaded = canvas?.default;
  return Loaded ? <Loaded {...props} /> : <LazyCanvas {...props} />;
}

export function MindmapSlot(props: ComponentProps<typeof MindmapModule.default>) {
  const Loaded = mindmap?.default;
  return Loaded ? <Loaded {...props} /> : <LazyMindmap {...props} />;
}
