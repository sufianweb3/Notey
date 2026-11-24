import { mindNode, type MindmapContent, type MindmapLayout, type MindNode } from '../../shared/mindmap';

/*
 * Mindmap ↔ Markdown outline. The outline is the mindmap's content_md and
 * the way agents (and paste) create one:
 *
 *   # Launch
 *   - Website
 *     - Hero copy
 *   - Press
 *
 * Headings and nested bullets both nest. One top-level item becomes the
 * root; several get a root named after the page.
 */

/** Plain text of one line of inline Markdown. */
function plain(s: string): string {
  // Escaped characters are literal: park them so the emphasis rules skip them.
  const parked: string[] = [];
  return s
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~$])/g, (_, c: string) => `${parked.push(c) - 1}`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\d+)/g, (_, i: string) => parked[Number(i)]!)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escapes what would start Markdown syntax when a node's text is written back. */
function escape(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]])/g, '\\$1')
    .replace(/^([#>+-])/, '\\$1')
    .replace(/^(\d+)\./, '$1\\.');
}

export function mindmapToOutline(m: MindmapContent): string {
  const lines = [`# ${escape(m.root.text) || 'Central idea'}`];
  const walk = (n: MindNode, depth: number) => {
    for (const c of n.children) {
      lines.push(`${'  '.repeat(depth)}- ${escape(c.text)}`);
      walk(c, depth + 1);
    }
  };
  if (m.root.children.length) lines.push('');
  walk(m.root, 0);
  return lines.join('\n') + '\n';
}

type Item = { depth: number; text: string };

function outlineItems(md: string): Item[] {
  const items: Item[] = [];
  let headingDepth = -1; // depth of the most recent heading
  const headingLevels: number[] = []; // heading levels seen, to rank them
  const bulletIndents: number[] = []; // indent columns of open bullet levels
  let inFence = false;

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !raw.trim()) continue;
    const line = raw.replace(/\t/g, '    ');

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      while (headingLevels.length && headingLevels.at(-1)! >= level) headingLevels.pop();
      headingLevels.push(level);
      headingDepth = headingLevels.length - 1;
      bulletIndents.length = 0;
      items.push({ depth: headingDepth, text: plain(h[2]!) });
      continue;
    }

    const b = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    const indent = b ? b[1]!.length : line.length - line.trimStart().length;
    const text = plain(b ? b[2]! : line);
    if (!text || /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) continue;
    if (b) {
      while (bulletIndents.length && bulletIndents.at(-1)! > indent) bulletIndents.pop();
      if (!bulletIndents.length || bulletIndents.at(-1)! < indent) bulletIndents.push(indent);
      items.push({ depth: headingDepth + bulletIndents.length, text });
    } else {
      // A plain line belongs to the current heading, like a bullet would.
      bulletIndents.length = 0;
      items.push({ depth: headingDepth + 1, text });
    }
  }
  return items;
}

/**
 * Builds a mindmap from an outline. `fallbackRoot` names the root when the
 * outline has several top-level items (usually the page title).
 */
export function outlineToMindmap(md: string, fallbackRoot = '', layout: MindmapLayout = 'right'): MindmapContent {
  const items = outlineItems(md);
  const top = Math.min(...items.map((i) => i.depth));
  const tops = items.filter((i) => i.depth === top).length;
  const singleRoot = items.length > 0 && tops === 1 && items[0]!.depth === top;

  const root = singleRoot ? mindNode(items[0]!.text) : mindNode(fallbackRoot);
  const stack: { node: MindNode; depth: number }[] = [{ node: root, depth: singleRoot ? top : top - 1 }];
  for (const item of singleRoot ? items.slice(1) : items) {
    while (stack.length > 1 && stack.at(-1)!.depth >= item.depth) stack.pop();
    const node = mindNode(item.text);
    stack.at(-1)!.node.children.push(node);
    stack.push({ node, depth: item.depth });
  }
  return { kind: 'mindmap', layout, root };
}

/** True when pasted text has more than one line, so it reads as an outline. */
export function looksLikeOutline(text: string): boolean {
  return text.trim().split('\n').filter((l) => l.trim()).length > 1;
}
