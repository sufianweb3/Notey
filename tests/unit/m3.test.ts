import { describe, expect, it } from 'vitest';
import { blocksToMarkdown } from '../../src/server/md/blocks-to-md';
import { markdownToBlocks } from '../../src/server/md/md-to-blocks';
import { looksLikeOutline, mindmapToOutline, outlineToMindmap } from '../../src/server/md/outline';
import { canvasToMarkdown, describeCanvas, type CanvasContent } from '../../src/shared/canvas';
import { chartData, chartFromMarkdown, chartToMarkdown, parseCsv, toCsv, toNumber } from '../../src/shared/chart';
import { countNodes, insertNode, mindNode, moveNode, removeNode, type MindNode } from '../../src/shared/mindmap';

const texts = (n: MindNode): unknown => [n.text, ...n.children.map(texts)];

describe('mindmap ↔ outline', () => {
  it('round-trips a tree through Markdown', () => {
    const root = mindNode('Launch', [mindNode('Website', [mindNode('Hero copy'), mindNode('Pricing *page*')]), mindNode('Press')]);
    const md = mindmapToOutline({ kind: 'mindmap', layout: 'right', root });
    expect(md).toBe('# Launch\n\n- Website\n  - Hero copy\n  - Pricing \\*page\\*\n- Press\n');
    const back = outlineToMindmap(md);
    expect(texts(back.root)).toEqual(texts(root));
  });

  it('nests headings and bullets together, as AI chats write them', () => {
    const md = '# Q1 plan\n\n## Growth\n- SEO audit\n  - Fix titles\n- Newsletter\n\n## Hiring\nTwo designers\n';
    const m = outlineToMindmap(md);
    expect(texts(m.root)).toEqual(['Q1 plan', ['Growth', ['SEO audit', ['Fix titles']], ['Newsletter']], ['Hiring', ['Two designers']]]);
  });

  it('names the root after the page when the outline has several top items', () => {
    const m = outlineToMindmap('- Rafi\n- Nadia\n  - Design\n- Mei', 'Team');
    expect(texts(m.root)).toEqual(['Team', ['Rafi'], ['Nadia', ['Design']], ['Mei']]);
  });

  it('strips inline Markdown, checkboxes and numbering', () => {
    const m = outlineToMindmap('# **Launch**\n1. [Site](https://x.dev)\n2. [ ] `deploy`\n');
    expect(texts(m.root)).toEqual(['Launch', ['Site'], ['deploy']]);
  });

  it('ignores code fences and rules', () => {
    const m = outlineToMindmap('# A\n```\n- not a node\n```\n---\n- B');
    expect(texts(m.root)).toEqual(['A', ['B']]);
  });

  it('detects multi-line paste as an outline', () => {
    expect(looksLikeOutline('one line')).toBe(false);
    expect(looksLikeOutline('a\n  b')).toBe(true);
  });
});

describe('mindmap tree edits', () => {
  const tree = () => mindNode('Root', [mindNode('A', [mindNode('A1')]), mindNode('B')]);

  it('inserts, removes and counts', () => {
    const r = tree();
    const x = mindNode('X');
    const withX = insertNode(r, r.children[1]!.id, x);
    expect(countNodes(withX)).toBe(5);
    expect(countNodes(removeNode(withX, r.children[0]!.id))).toBe(3);
  });

  it('refuses to move a node into its own branch', () => {
    const r = tree();
    const a = r.children[0]!;
    expect(moveNode(r, a.id, a.children[0]!.id)).toBe(r);
    expect(moveNode(r, r.id, a.id)).toBe(r);
    const moved = moveNode(r, a.children[0]!.id, r.children[1]!.id);
    expect(texts(moved)).toEqual(['Root', ['A'], ['B', ['A1']]]);
  });
});

describe('canvas description', () => {
  const scene: CanvasContent = {
    kind: 'canvas',
    files: {},
    elements: [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 },
      { id: 't1', type: 'text', x: 10, y: 10, text: 'Idea', containerId: 'r1' },
      { id: 'r2', type: 'ellipse', x: 300, y: 0 },
      { id: 't2', type: 'text', x: 310, y: 10, text: 'Ship', containerId: 'r2' },
      { id: 'a1', type: 'arrow', x: 100, y: 30, startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' } },
      { id: 's1', type: 'rectangle', x: 0, y: 200, customData: { notey: 'sticky' } },
      { id: 't3', type: 'text', x: 5, y: 205, text: 'Call Rafi\nabout copy', containerId: 's1' },
      { id: 'f1', type: 'freedraw', x: 0, y: 400 },
      { id: 'f2', type: 'freedraw', x: 0, y: 500 },
      { id: 'gone', type: 'text', x: 0, y: 600, text: 'deleted', isDeleted: true },
      { id: 'free', type: 'text', x: 0, y: 300, text: 'Loose note' },
    ],
  };

  it('lists elements in reading order with labels and arrow ends', () => {
    const { summary, lines } = describeCanvas(scene);
    expect(summary).toBe('Canvas with 7 elements.');
    expect(lines).toEqual([
      'Rectangle: “Idea”',
      'Ellipse: “Ship”',
      'Arrow from “Idea” to “Ship”',
      'Sticky note: “Call Rafi about copy”',
      'Text: “Loose note”',
      '2 freehand drawings',
    ]);
  });

  it('writes searchable Markdown and says when a canvas is empty', () => {
    expect(canvasToMarkdown(scene)).toContain('- Sticky note: “Call Rafi about copy”');
    expect(canvasToMarkdown({ kind: 'canvas', elements: [], files: {} })).toBe('Empty canvas.\n');
  });
});

describe('charts', () => {
  it('parses CSV, TSV and quoted cells', () => {
    expect(parseCsv('a,b\n"x, y",2\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', '2'],
    ]);
    expect(parseCsv('Month\tSignups\nJan\t12')).toEqual([
      ['Month', 'Signups'],
      ['Jan', '12'],
    ]);
    expect(toCsv([['a, b', 'say "hi"']])).toBe('"a, b","say ""hi"""');
  });

  it('reads numbers people type', () => {
    expect(toNumber('1,200')).toBe(1200);
    expect(toNumber('$12.50')).toBe(12.5);
    expect(toNumber('45%')).toBe(45);
    expect(toNumber('n/a')).toBeNull();
  });

  it('caps series at four and keeps categories as text', () => {
    const d = chartData('M,a,b,c,d,e\nJan,1,2,3,4,5');
    expect(d.series).toEqual(['a', 'b', 'c', 'd']);
    expect(d.rows[0]).toEqual({ M: 'Jan', a: 1, b: 2, c: 3, d: 4 });
  });

  it('round-trips a chart block through a ```chart fence', () => {
    const block = { type: 'chart', props: { kind: 'line', title: 'Signups', highlight: '2026', data: 'Month,2025,2026\nJan,120,180' } };
    const md = blocksToMarkdown([block]);
    expect(md).toBe('```chart\ntype: line\ntitle: Signups\nhighlight: 2026\n\nMonth,2025,2026\nJan,120,180\n```\n');
    expect(markdownToBlocks(md)).toEqual([block]);
    expect(chartFromMarkdown(chartToMarkdown(block.props as never))).toEqual(block.props);
  });

  it('treats a fence without a header as bar data', () => {
    expect(markdownToBlocks('```chart\nA,B\nx,1\n```')).toEqual([{ type: 'chart', props: { kind: 'bar', title: '', highlight: '', data: 'A,B\nx,1' } }]);
  });
});

describe('page embeds in Markdown', () => {
  it('writes an embed as image syntax with the live title, and reads it back as an embed', () => {
    const md = blocksToMarkdown([{ type: 'pageEmbed', props: { pageId: 'p1', kind: 'canvas' } }], { pages: new Map([['p1', 'Launch [flow]']]) });
    expect(md).toBe('![Launch flow](notey://page/p1)\n');
    expect(markdownToBlocks(md)).toEqual([{ type: 'pageEmbed', props: { pageId: 'p1' } }]);
  });

  it('drops an embed that has not picked a page yet', () => {
    expect(blocksToMarkdown([{ type: 'pageEmbed', props: { pageId: '' } }]).trim()).toBe('');
  });
});
