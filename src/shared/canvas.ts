/*
 * A canvas page stores Excalidraw's scene in page.content_json. The server
 * never draws it; it only needs the elements' text to derive Markdown for
 * search and AI, and the file references to keep them inside the workspace.
 */

export type CanvasElement = {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  /** Text elements. */
  text?: string;
  /** A text element bound inside a shape or arrow (its label). */
  containerId?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  /** Frames. */
  name?: string | null;
  link?: string | null;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Images live in workspace file storage; the scene keeps only their URL. */
export type CanvasFile = { mimeType: string; url: string };

export type CanvasContent = {
  kind: 'canvas';
  elements: CanvasElement[];
  files: Record<string, CanvasFile>;
};

export const emptyCanvas = (): CanvasContent => ({ kind: 'canvas', elements: [], files: {} });

/** Marks the rectangle preset that Notey calls a sticky note. */
export const STICKY = 'sticky';

const SHAPES: Record<string, string> = {
  rectangle: 'Rectangle',
  diamond: 'Diamond',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  line: 'Line',
  image: 'Image',
  frame: 'Frame',
  magicframe: 'Frame',
  embeddable: 'Embedded link',
  iframe: 'Embedded link',
};

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * A text alternative for a canvas, in reading order (top to bottom, then
 * left to right). Used by "Describe canvas" and by content_md.
 */
export function describeCanvas(content: CanvasContent): { summary: string; lines: string[] } {
  const live = content.elements.filter((e) => !e.isDeleted && e.type !== 'selection');
  const labels = new Map<string, string>();
  for (const e of live) if (e.type === 'text' && e.containerId && e.text) labels.set(e.containerId, oneLine(e.text));
  const byId = new Map(live.map((e) => [e.id, e]));
  const nameOf = (id: string | undefined) => {
    const e = id ? byId.get(id) : undefined;
    if (!e) return null;
    const label = labels.get(e.id) ?? (e.type === 'text' && e.text ? oneLine(e.text) : null);
    return label ? `“${label}”` : `a ${(SHAPES[e.type] ?? e.type).toLowerCase()}`;
  };

  const sorted = [...live].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const lines: string[] = [];
  let freehand = 0;
  for (const e of sorted) {
    const label = labels.get(e.id);
    switch (e.type) {
      case 'text':
        if (!e.containerId && e.text?.trim()) lines.push(`Text: “${oneLine(e.text)}”`);
        break;
      case 'freedraw':
        freehand++;
        break;
      case 'arrow':
      case 'line': {
        const from = nameOf(e.startBinding?.elementId);
        const to = nameOf(e.endBinding?.elementId);
        let s = SHAPES[e.type]!;
        if (from && to) s += ` from ${from} to ${to}`;
        else if (from) s += ` from ${from}`;
        else if (to) s += ` to ${to}`;
        if (label) s += `, labelled “${label}”`;
        lines.push(s);
        break;
      }
      case 'frame':
      case 'magicframe':
        lines.push(`Frame${e.name ? `: “${oneLine(e.name)}”` : ''}`);
        break;
      case 'embeddable':
      case 'iframe':
        lines.push(`Embedded link${e.link ? `: ${e.link}` : ''}`);
        break;
      default: {
        const kind = e.customData?.notey === STICKY ? 'Sticky note' : (SHAPES[e.type] ?? e.type);
        lines.push(label ? `${kind}: “${label}”` : kind);
      }
    }
  }
  if (freehand) lines.push(freehand === 1 ? '1 freehand drawing' : `${freehand} freehand drawings`);
  const n = live.filter((e) => !(e.type === 'text' && e.containerId)).length;
  const summary = n === 0 ? 'Empty canvas.' : `Canvas with ${n} ${n === 1 ? 'element' : 'elements'}.`;
  return { summary, lines };
}

/** content_md for a canvas page: a summary line, then one bullet per element. */
export function canvasToMarkdown(content: CanvasContent): string {
  const { summary, lines } = describeCanvas(content);
  if (!lines.length) return `${summary}\n`;
  return `${summary}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
}
