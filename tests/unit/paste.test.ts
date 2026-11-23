import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Block, InlineContent } from '../../src/shared/blocks';
import { blocksToMarkdown } from '../../src/server/md/blocks-to-md';
import { looksLikeMarkdown, markdownToBlocks } from '../../src/server/md/md-to-blocks';

const dir = join(import.meta.dirname, '../fixtures/paste');
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');

/** Every piece of visible prose in a document, excluding code and LaTeX. */
function proseRuns(blocks: Block[]): string[] {
  const out: string[] = [];
  const fromInline = (content: InlineContent[]) => {
    for (const c of content) {
      if (c.type === 'text' && !c.styles?.code) out.push(c.text);
      if (c.type === 'link') out.push(...c.content.filter((t) => !t.styles?.code).map((t) => t.text));
    }
  };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.type === 'codeBlock') continue;
      if (Array.isArray(b.content)) fromInline(b.content);
      else if (b.content?.type === 'tableContent') {
        for (const row of b.content.rows) for (const cell of row.cells) fromInline(Array.isArray(cell) ? cell : cell.content);
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

const RAW = [
  { name: 'bold markers', re: /\*\*|__/ },
  { name: 'heading marker', re: /^\s*#{1,6}\s/m },
  { name: 'list marker', re: /^\s*([-*+]|\d+[.)])\s/m },
  { name: 'task box', re: /\[[ xX]\]/ },
  { name: 'code fence', re: /```/ },
  { name: 'table row', re: /^\s*\|.*\|\s*$/m },
  { name: 'display math', re: /\$\$|\\\[|\\\]/ },
  { name: 'inline math delimiters', re: /\\\(|\\\)/ },
  { name: 'link syntax', re: /\]\(/ },
  { name: 'quote marker', re: /^\s*>\s/m },
  { name: 'strike markers', re: /~~/ },
  { name: 'html entity', re: /&(amp|lt|gt|quot|#\d+);/ },
  { name: 'rule', re: /^\s*(-{3,}|\*{3,})\s*$/m },
  { name: 'alert marker', re: /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/ },
];

function stripIds(blocks: Block[]): Block[] {
  return JSON.parse(JSON.stringify(blocks, (k, v) => (k === 'id' ? undefined : v)));
}

function types(blocks: Block[], acc: string[] = []): string[] {
  for (const b of blocks) {
    acc.push(b.type);
    if (b.children) types(b.children, acc);
  }
  return acc;
}

describe('AI paste fixtures (PRD 6.4)', () => {
  it('has 20 fixtures', () => {
    expect(fixtures).toHaveLength(20);
  });

  describe.each(fixtures)('%s', (file) => {
    const md = readFileSync(join(dir, file), 'utf8');
    const blocks = markdownToBlocks(md);

    it('is detected as Markdown', () => {
      expect(looksLikeMarkdown(md)).toBe(true);
    });

    it('leaves no raw Markdown symbols in the text', () => {
      expect(blocks.length).toBeGreaterThan(0);
      const runs = proseRuns(blocks);
      for (const { name, re } of RAW) {
        const hit = runs.find((r) => re.test(r));
        expect(hit, `${name} left in: ${JSON.stringify(hit)}`).toBeUndefined();
      }
    });

    it('survives a round trip through Markdown unchanged', () => {
      const again = markdownToBlocks(blocksToMarkdown(blocks));
      expect(stripIds(again)).toEqual(stripIds(blocks));
    });
  });
});

describe('conversion details', () => {
  const load = (f: string) => markdownToBlocks(readFileSync(join(dir, f), 'utf8'));

  it('maps ChatGPT LaTeX to math blocks and inline math', () => {
    const blocks = load('chatgpt-math.md');
    expect(blocks.filter((b) => b.type === 'math')).toHaveLength(1);
    const inlineMath = blocks.flatMap((b) => (Array.isArray(b.content) ? b.content : [])).filter((c) => c.type === 'inlineMath');
    expect(inlineMath.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps prices as text, not math', () => {
    const last = load('gemini-math-inline.md').at(-1)!;
    const text = (last.content as InlineContent[]).map((c) => (c.type === 'text' ? c.text : `[math]`)).join('');
    expect(text).toContain('Prices like $5 and $10 should stay as text.');
  });

  it('turns mermaid fences into Mermaid blocks and keeps code languages', () => {
    expect(types(load('claude-mermaid.md'))).toContain('mermaid');
    const code = load('chatgpt-code-python.md').find((b) => b.type === 'codeBlock')!;
    expect(code.props).toEqual({ language: 'python' });
    expect(load('claude-code-ts.md').find((b) => b.type === 'codeBlock')!.props).toEqual({ language: 'typescript' });
  });

  it('turns GitHub alerts into callouts and keeps plain quotes', () => {
    const blocks = load('claude-callouts.md');
    expect(blocks.filter((b) => b.type === 'callout').map((b) => b.props?.kind)).toEqual(['warning', 'tip']);
    expect(blocks.some((b) => b.type === 'quote')).toBe(true);
  });

  it('nests lists and keeps task state', () => {
    const blocks = load('chatgpt-nested-lists.md');
    const interviews = blocks.find((b) => b.type === 'bulletListItem')!;
    expect(interviews.children?.[0]?.children?.[0]?.type).toBe('bulletListItem');
    const survey = blocks[2]!;
    expect(survey.children?.map((c) => c.type)).toEqual(['numberedListItem', 'numberedListItem', 'numberedListItem']);
    const tasks = load('claude-meeting-notes.md').filter((b) => b.type === 'checkListItem');
    expect(tasks.map((t) => t.props?.checked)).toEqual([false, false, true]);
  });

  it('keeps table alignment', () => {
    const table = load('chatgpt-table.md').find((b) => b.type === 'table')!;
    const header = (table.content as { rows: { cells: { props: { textAlignment: string } }[] }[] }).rows[0]!.cells;
    expect(header.map((c) => c.props.textAlignment)).toEqual(['left', 'right', 'center', 'left']);
  });

  it('caps headings at H3', () => {
    const levels = load('chatgpt-headings-mixed.md')
      .filter((b) => b.type === 'heading')
      .map((b) => b.props?.level);
    expect(Math.max(...(levels as number[]))).toBe(3);
  });

  it('does not treat plain prose as Markdown', () => {
    expect(looksLikeMarkdown('Call Rafi tomorrow at 3pm about the invoice.')).toBe(false);
    expect(looksLikeMarkdown('It costs $5 - or maybe $6.')).toBe(false);
  });

  it('round-trips page links', () => {
    const blocks = markdownToBlocks('See [Homepage brief](notey://page/01abc) for details.');
    expect(blocks[0]!.content).toContainEqual({ type: 'pageLink', props: { pageId: '01abc', title: 'Homepage brief' } });
    expect(blocksToMarkdown(blocks)).toBe('See [Homepage brief](notey://page/01abc) for details.\n');
  });
});

describe('serializer edge cases', () => {
  it('separates a numbered list from a following bullet or task list', () => {
    const md = blocksToMarkdown([
      { type: 'numberedListItem', content: [{ type: 'text', text: 'One', styles: {} }] },
      { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'Task', styles: {} }] },
    ]);
    expect(md).toBe('1. One\n\n- [ ] Task\n');
    expect(markdownToBlocks(md).map((b) => b.type)).toEqual(['numberedListItem', 'checkListItem']);
  });

  it('writes inline math as $…$', () => {
    const md = blocksToMarkdown([
      { type: 'paragraph', content: [{ type: 'text', text: 'Area ', styles: {} }, { type: 'inlineMath', props: { latex: String.raw`\pi r^2` } }] },
    ]);
    expect(md).toBe(String.raw`Area $\pi r^2$` + '\n');
  });
});
