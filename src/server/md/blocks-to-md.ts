import { PAGE_LINK_SCHEME, type Block, type InlineContent, type StyledText, type TableContent } from '../../shared/blocks';

/*
 * Block JSON → Markdown. Runs on every save (page.content_md) and is what
 * search, export, MCP and the AI read. Pure TS so it runs on every host.
 * Lossy only where Markdown has no equivalent (text colour, underline).
 */

type Mark = 'bold' | 'italic' | 'strike' | 'code';
const MARKS: [Mark, string][] = [
  ['code', '`'],
  ['bold', '**'],
  ['italic', '_'],
  ['strike', '~~'],
];

/** Escapes characters that would otherwise start Markdown syntax inside text. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/([*`[\]$<])/g, '\\$1')
    .replace(/~~/g, '\\~\\~')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'));
}

/** A paragraph line that would parse as a heading, list, quote or rule gets escaped. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+-])(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s)/, '$1$2\\$3$4')
    .replace(/^(\s*)(={3,}|-{3,})\s*$/, '$1\\$2');
}

function textOf(run: InlineContent): string {
  if (run.type === 'text') return run.text;
  if (run.type === 'link') return run.content.map((c) => c.text).join('');
  if (run.type === 'inlineMath') return run.props.latex;
  if (run.type === 'pageLink') return run.props.title;
  return '';
}

export function plainText(content: InlineContent[] | undefined): string {
  return (content ?? []).map(textOf).join('');
}

function styledRuns(runs: StyledText[]): string {
  // Merge neighbours with identical marks so bold runs don't become **a****b**.
  const merged: { text: string; marks: Mark[] }[] = [];
  for (const r of runs) {
    const marks = MARKS.map(([m]) => m).filter((m) => r.styles?.[m]);
    const last = merged.at(-1);
    if (last && last.marks.join() === marks.join()) last.text += r.text;
    else merged.push({ text: r.text, marks });
  }
  return merged
    .map(({ text, marks }) => {
      if (!text) return '';
      if (marks.includes('code')) {
        const ticks = text.includes('`') ? '``' : '`';
        const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
        // Other marks wrap the code span: **`rev`**.
        const outer = marks.filter((m) => m !== 'code').map((m) => MARKS.find(([k]) => k === m)![1]);
        return `${outer.join('')}${ticks}${pad}${text}${pad}${ticks}${[...outer].reverse().join('')}`;
      }
      // Emphasis can't start or end with whitespace: keep it outside the markers.
      const lead = /^\s*/.exec(text)![0];
      const trail = /\s*$/.exec(text)![0];
      const core = text.slice(lead.length, text.length - trail.length);
      if (!core) return text;
      const open = marks.map((m) => MARKS.find(([k]) => k === m)![1]).join('');
      const close = [...marks].reverse().map((m) => MARKS.find(([k]) => k === m)![1]).join('');
      return `${lead}${open}${escapeText(core)}${close}${trail}`;
    })
    .join('');
}

export function inlineToMd(content: InlineContent[] | undefined): string {
  const out: string[] = [];
  let buffer: StyledText[] = [];
  const flush = () => {
    if (buffer.length) out.push(styledRuns(buffer));
    buffer = [];
  };
  for (const run of content ?? []) {
    if (run.type === 'text') {
      buffer.push(run);
      continue;
    }
    flush();
    if (run.type === 'link') out.push(`[${styledRuns(run.content)}](${run.href.replace(/[()\s]/g, encodeURIComponent)})`);
    else if (run.type === 'inlineMath') out.push(`$${run.props.latex}$`);
    else if (run.type === 'pageLink') out.push(`[${escapeText(run.props.title || 'Untitled')}](${PAGE_LINK_SCHEME}${run.props.pageId})`);
  }
  flush();
  // Hard line breaks inside a paragraph: two trailing spaces is fragile, use a backslash.
  return out.join('').replace(/\n/g, '\\\n');
}

function tableToMd(table: TableContent): string {
  const rows = table.rows.map((r) =>
    r.cells.map((cell) => {
      const content = Array.isArray(cell) ? cell : cell.content;
      return inlineToMd(content).replace(/\|/g, '\\|').replace(/\\\n/g, '<br>') || ' ';
    }),
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill(' ')];
  const firstCells = table.rows[0]!.cells;
  const align = Array.from({ length: width }, (_, i) => {
    const c = firstCells[i];
    const a = c && !Array.isArray(c) ? c.props?.textAlignment : undefined;
    return a === 'center' ? ':---:' : a === 'right' ? '---:' : '---';
  });
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(pad(rows[0]!)), line(align), ...rows.slice(1).map((r) => line(pad(r)))].join('\n');
}

function fence(code: string, lang: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map((l) => (l ? by + l : l))
    .join('\n');
}

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']);

function blockToMd(block: Block, ordinal: number): string {
  const p = block.props ?? {};
  const inline = Array.isArray(block.content) ? (block.content as InlineContent[]) : undefined;
  const body = inlineToMd(inline);
  const lines = (s: string) => s.split('\n').map(escapeLineStart).join('\n');

  switch (block.type) {
    case 'paragraph':
      return lines(body);
    case 'heading': {
      const level = Math.min(Math.max(Number(p.level) || 1, 1), 6);
      return `${'#'.repeat(level)} ${body.replace(/\\\n/g, ' ')}`;
    }
    case 'bulletListItem':
    case 'toggleListItem':
      return `- ${body}`;
    case 'numberedListItem':
      return `${ordinal}. ${body}`;
    case 'checkListItem':
      return `- [${p.checked ? 'x' : ' '}] ${body}`;
    case 'quote':
      return body
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n');
    case 'callout': {
      const kind = String(p.kind ?? 'note').toUpperCase();
      return [`> [!${kind}]`, ...body.split('\n').map((l) => `> ${l}`.trimEnd())].join('\n');
    }
    case 'codeBlock': {
      const lang = typeof p.language === 'string' && p.language !== 'text' ? p.language : '';
      return fence(plainText(inline), lang);
    }
    case 'mermaid':
      return fence(String(p.code ?? ''), 'mermaid');
    case 'math':
      return `$$\n${String(p.latex ?? '')}\n$$`;
    case 'divider':
      return '---';
    case 'table':
      return block.content && !Array.isArray(block.content) ? tableToMd(block.content) : '';
    case 'image': {
      const alt = String(p.caption || p.name || '').replace(/[[\]]/g, '');
      return p.url ? `![${alt}](${String(p.url)})` : '';
    }
    case 'file':
    case 'video':
    case 'audio':
      return p.url ? `[${String(p.name || p.url).replace(/[[\]]/g, '')}](${String(p.url)})` : '';
    case 'pageBreak':
      return '---';
    default:
      // Unknown or future block types (canvas embed, chart, task): keep their text.
      return body ? lines(body) : '';
  }
}

function blocksToLines(blocks: Block[], depth: number): string[] {
  const out: string[] = [];
  let ordinal = 0;
  let prev: string | null = null;
  for (const block of blocks) {
    ordinal = block.type === 'numberedListItem' ? (prev === 'numberedListItem' ? ordinal + 1 : Number(block.props?.start) || 1) : 0;
    let md = blockToMd(block, ordinal);
    const isList = LIST_TYPES.has(block.type);
    if (block.children?.length) {
      const childMd = blocksToLines(block.children, depth + 1).join('\n');
      // List children nest under the marker; other blocks' children follow as an indented group.
      md = md ? `${md}\n${indent(childMd, isList ? '   ' : '')}` : childMd;
    }
    // Tight lists: no blank line between consecutive items of the same list. A
    // switch between "1." and "-" items starts a new list, so it gets one.
    const ordered = (t: string) => t === 'numberedListItem';
    const sameList = isList && prev !== null && LIST_TYPES.has(prev) && ordered(prev) === ordered(block.type);
    if (out.length && !sameList) out.push('');
    out.push(md);
    prev = block.type;
  }
  return out;
}

export function blocksToMarkdown(blocks: Block[] | null | undefined): string {
  if (!blocks?.length) return '';
  return (
    blocksToLines(blocks, 0)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
