import { uuidv7 } from './ids';

/*
 * A mindmap page stores one tree in page.content_json. Its Markdown form is
 * an outline (see server/md/outline.ts), which is also how agents create one.
 */

export type MindNode = { id: string; text: string; collapsed?: boolean; children: MindNode[] };
export type MindmapLayout = 'right' | 'radial';
export type MindmapContent = { kind: 'mindmap'; layout: MindmapLayout; root: MindNode };

/** Hard limits so one save can't make a tree the browser can't lay out. */
export const MINDMAP_MAX_NODES = 5_000;
export const MINDMAP_MAX_DEPTH = 40;

export const mindNode = (text = '', children: MindNode[] = []): MindNode => ({ id: uuidv7(), text, children });
export const emptyMindmap = (rootText = ''): MindmapContent => ({ kind: 'mindmap', layout: 'right', root: mindNode(rootText) });

export function countNodes(n: MindNode): number {
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}

export function depthOf(n: MindNode): number {
  return 1 + Math.max(0, ...n.children.map(depthOf));
}

export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function findParent(root: MindNode, id: string): MindNode | null {
  for (const c of root.children) {
    if (c.id === id) return root;
    const hit = findParent(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Returns a copy of the tree with `fn` applied to the node with `id`. */
export function mapNode(root: MindNode, id: string, fn: (n: MindNode) => MindNode): MindNode {
  if (root.id === id) return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const next = mapNode(c, id, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

export function removeNode(root: MindNode, id: string): MindNode {
  const parent = findParent(root, id);
  if (!parent) return root;
  return mapNode(root, parent.id, (p) => ({ ...p, children: p.children.filter((c) => c.id !== id) }));
}

/** Adds `node` under `parentId`, at `index` (end when omitted). */
export function insertNode(root: MindNode, parentId: string, node: MindNode, index?: number): MindNode {
  return mapNode(root, parentId, (p) => {
    const children = [...p.children];
    children.splice(index ?? children.length, 0, node);
    return { ...p, children, collapsed: false };
  });
}

/** Moves a node under a new parent. Refuses moves into itself or its own branch. */
export function moveNode(root: MindNode, id: string, toParentId: string, index?: number): MindNode {
  const node = findNode(root, id);
  if (!node || id === root.id || findNode(node, toParentId)) return root;
  return insertNode(removeNode(root, id), toParentId, node, index);
}

/** Visible nodes in depth-first order (collapsed branches hide their children). */
export function visibleNodes(root: MindNode): { node: MindNode; parent: MindNode | null; depth: number }[] {
  const out: { node: MindNode; parent: MindNode | null; depth: number }[] = [];
  const walk = (n: MindNode, parent: MindNode | null, depth: number) => {
    out.push({ node: n, parent, depth });
    if (!n.collapsed) for (const c of n.children) walk(c, n, depth + 1);
  };
  walk(root, null, 0);
  return out;
}
