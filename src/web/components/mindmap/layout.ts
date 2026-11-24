import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import type { MindmapLayout, MindNode } from '@shared/mindmap';

/*
 * Auto layout for mindmaps. Left to right: a tidy tree whose columns follow
 * each parent's actual width. Radial: rings around the root. Sizes come from
 * measuring the text, so long nodes wrap instead of overlapping.
 */

export const NODE = {
  maxWidth: 240,
  minWidth: 56,
  padX: 12,
  rootPadX: 14,
  padY: 8,
  line: 20,
  rootScale: 1.15,
  gapX: 56,
  gapY: 14,
  ring: 200,
} as const;

export type Placed = {
  node: MindNode;
  parentId: string | null;
  depth: number;
  /** Top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Children hidden by a collapsed branch. */
  hidden: number;
};

let ctx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, root: boolean): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 7.5;
  const family = getComputedStyle(document.body).fontFamily || 'system-ui';
  ctx.font = `${root ? 600 : 500} ${root ? 16 : 14}px ${family}`;
  return ctx.measureText(text).width;
}

export function measure(text: string, root = false): { width: number; height: number } {
  const t = text || (root ? 'Central idea' : 'New idea');
  const scale = root ? NODE.rootScale : 1;
  const padX = root ? NODE.rootPadX : NODE.padX;
  const inner = NODE.maxWidth - padX * 2;
  const w = textWidth(t, root);
  // Rough wrap: words don't split, so add a little slack per line.
  const lines = Math.max(1, Math.ceil(w / (inner * 0.92)));
  const width = lines > 1 ? NODE.maxWidth : Math.max(NODE.minWidth, Math.ceil(w) + padX * 2 + 4);
  return { width: Math.round(width), height: Math.round((lines * NODE.line + NODE.padY * 2) * scale) };
}

const count = (n: MindNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0);

export function layoutMindmap(root: MindNode, mode: MindmapLayout): Placed[] {
  const h = hierarchy(root, (n) => (n.collapsed ? [] : n.children));
  const sizes = new Map<string, { width: number; height: number }>();
  h.each((d) => sizes.set(d.data.id, measure(d.data.text, d.depth === 0)));
  const size = (d: { data: MindNode }) => sizes.get(d.data.id)!;

  const placed: Placed[] = [];
  const push = (d: HierarchyPointNode<MindNode>, cx: number, cy: number) => {
    const s = size(d);
    placed.push({
      node: d.data,
      parentId: d.parent?.data.id ?? null,
      depth: d.depth,
      x: cx - s.width / 2,
      y: cy - s.height / 2,
      width: s.width,
      height: s.height,
      hidden: d.data.collapsed ? count(d.data) : 0,
    });
  };

  if (mode === 'radial') {
    const leaves = h.leaves().length;
    const radius = Math.max(NODE.ring, (leaves * 44) / (2 * Math.PI));
    const t = tree<MindNode>()
      .size([2 * Math.PI, radius * h.height])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.4) / Math.max(1, a.depth));
    const r = t(h);
    r.each((d) => push(d, Math.cos(d.x - Math.PI / 2) * d.y, Math.sin(d.x - Math.PI / 2) * d.y));
    return placed;
  }

  // Left to right: d3 gives the vertical order; columns follow parent widths.
  const rowH = Math.max(...[...sizes.values()].map((s) => s.height)) + NODE.gapY;
  const r = tree<MindNode>()
    .nodeSize([rowH, 1])
    .separation((a, b) => {
      const ha = size(a).height + NODE.gapY;
      const hb = size(b).height + NODE.gapY;
      return ((ha + hb) / 2 / rowH) * (a.parent === b.parent ? 1 : 1.25);
    })(h);
  const left = new Map<string, number>();
  r.each((d) => {
    const x = d.parent ? left.get(d.parent.data.id)! + size(d.parent).width + NODE.gapX : 0;
    left.set(d.data.id, x);
    const s = size(d);
    push(d, x + s.width / 2, d.x);
  });
  return placed;
}

export function bounds(placed: Placed[]) {
  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  const maxX = Math.max(...placed.map((p) => p.x + p.width));
  const maxY = Math.max(...placed.map((p) => p.y + p.height));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}
