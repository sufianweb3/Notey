import { chartFromMarkdown } from '../../shared/chart';
import { Marked, type TokenizerAndRendererExtension, type Token, type Tokens } from 'marked';
import {
  PAGE_LINK_SCHEME,
  type Block,
  type CalloutKind,
  type InlineContent,
  type StyledText,
  type Styles,
  type TableCell,
} from '../../shared/blocks';

/*
 * Markdown → block JSON. Used for AI-ready paste (PRD 6.4) on the client and
 * for agent writes (M4) on the server, so it's pure TS over `marked`'s lexer.
 * Handles GFM (tables, task lists, strikethrough), code fences, Mermaid,
 * LaTeX ($…$, $$…$$, \(…\), \[…\]) and GitHub alerts (> [!NOTE]) as callouts.
 */

type MathToken = { type: 'blockMath' | 'inlineMath'; raw: string; latex: string };

const blockMath: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start: (src) => src.match(/^ {0,3}(\$\$|\\\[)/m)?.index,
  tokenizer(src) {
    const m = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/.exec(src);
    if (m) return { type: 'blockMath', raw: m[0], latex: (m[1] ?? m[2] ?? '').trim() } satisfies MathToken;
  },
  renderer: () => '',
};

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => src.match(/\$|\\\(/)?.index,
  tokenizer(src) {
    // \( … \) as ChatGPT writes it, or $…$ that hugs its content and isn't a price ($5 and $10).
    const paren = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (paren) return { type: 'inlineMath', raw: paren[0], latex: paren[1]!.trim() } satisfies MathToken;
    const dollar = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
    if (dollar) return { type: 'inlineMath', raw: dollar[0], latex: dollar[1]! } satisfies MathToken;
  },
  renderer: () => '',
};

const marked = new Marked({ gfm: true, breaks: false, extensions: [blockMath, inlineMath] });

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rb: 'ruby',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  golang: 'go',
  plaintext: 'text',
  txt: 'text',
};

export function normalizeLanguage(lang: string | undefined): string {
  const l = (lang ?? '').trim().split(/\s+/)[0]!.toLowerCase();
  return l ? (LANG_ALIASES[l] ?? l) : 'text';
}

// ── Inline ──────────────────────────────────────────────────────────────────

function pushText(out: InlineContent[], text: string, styles: Styles) {
  if (!text) return;
  const last = out.at(-1);
  if (last?.type === 'text' && JSON.stringify(last.styles ?? {}) === JSON.stringify(styles)) {
    last.text += text;
    return;
  }
  out.push({ type: 'text', text, styles: { ...styles } });
}

function inline(tokens: Token[] | undefined, styles: Styles = {}, out: InlineContent[] = []): InlineContent[] {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'text':
      case 'escape': {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) inline(tt.tokens, styles, out);
        else pushText(out, decode(tt.text), styles);
        break;
      }
      case 'strong':
        inline((t as Tokens.Strong).tokens, { ...styles, bold: true }, out);
        break;
      case 'em':
        inline((t as Tokens.Em).tokens, { ...styles, italic: true }, out);
        break;
      case 'del':
        inline((t as Tokens.Del).tokens, { ...styles, strike: true }, out);
        break;
      case 'codespan':
        pushText(out, decode((t as Tokens.Codespan).text), { ...styles, code: true });
        break;
      case 'br':
        pushText(out, '\n', styles);
        break;
      case 'link': {
        const l = t as Tokens.Link;
        if (l.href.startsWith(PAGE_LINK_SCHEME)) {
          const title = inline(l.tokens).map((c) => (c.type === 'text' ? c.text : '')).join('');
          out.push({ type: 'pageLink', props: { pageId: l.href.slice(PAGE_LINK_SCHEME.length), title } });
          break;
        }
        const content = inline(l.tokens, styles).filter((c): c is StyledText => c.type === 'text');
        out.push({ type: 'link', href: l.href, content: content.length ? content : [{ type: 'text', text: l.href, styles }] });
        break;
      }
      case 'image': {
        // An image inside running text becomes a link to it.
        const img = t as Tokens.Image;
        out.push({ type: 'link', href: img.href, content: [{ type: 'text', text: img.text || img.href, styles }] });
        break;
      }
      case 'inlineMath':
        out.push({ type: 'inlineMath', props: { latex: (t as unknown as MathToken).latex } });
        break;
      case 'html': {
        const html = (t as Tokens.HTML).text;
        if (/^<br\s*\/?>$/i.test(html)) pushText(out, '\n', styles);
        // Other inline tags (<sub>, <kbd>, <span>) are dropped; their text tokens remain.
        break;
      }
      default: {
        const anyT = t as { tokens?: Token[]; text?: string };
        if (anyT.tokens) inline(anyT.tokens, styles, out);
        else if (anyT.text) pushText(out, decode(anyT.text), styles);
      }
    }
  }
  return out;
}

function trimInline(content: InlineContent[]): InlineContent[] {
  const first = content[0];
  if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '');
  const last = content.at(-1);
  if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
  return content.filter((c) => c.type !== 'text' || c.text !== '');
}

// ── Blocks ──────────────────────────────────────────────────────────────────

const ALERTS: Record<string, CalloutKind> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'important',
  WARNING: 'warning',
  CAUTION: 'caution',
};

function paragraphBlocks(tokens: Token[] | undefined): Block[] {
  // A paragraph that is only an image becomes an image block.
  const meaningful = (tokens ?? []).filter((t) => !(t.type === 'text' && !(t as Tokens.Text).text.trim()));
  if (meaningful.length === 1 && meaningful[0]!.type === 'image') {
    const img = meaningful[0] as Tokens.Image;
    if (img.href.startsWith(PAGE_LINK_SCHEME)) return [{ type: 'pageEmbed', props: { pageId: img.href.slice(PAGE_LINK_SCHEME.length) } }];
    return [{ type: 'image', props: { url: img.href, caption: img.text ?? '', name: img.text ?? '' } }];
  }
  const content = trimInline(inline(tokens));
  return [{ type: 'paragraph', content }];
}

function listItemBlocks(list: Tokens.List): Block[] {
  let n = Number(list.start) || 1;
  return list.items.map((item) => {
    const own: Token[] = [];
    const children: Block[] = [];
    let seenText = false;
    for (const t of item.tokens) {
      if (t.type === 'checkbox') continue;
      if (!seenText && (t.type === 'text' || t.type === 'paragraph')) {
        own.push(...((t as Tokens.Text).tokens ?? [t]));
        seenText = true;
      } else {
        children.push(...tokenToBlocks(t));
      }
    }
    const content = trimInline(inline(own));
    const block: Block = item.task
      ? { type: 'checkListItem', props: { checked: !!item.checked }, content }
      : list.ordered
        ? { type: 'numberedListItem', props: n === Number(list.start) && n !== 1 ? { start: n } : {}, content }
        : { type: 'bulletListItem', content };
    n++;
    if (children.length) block.children = children;
    return block;
  });
}

function quoteBlocks(q: Tokens.Blockquote): Block[] {
  const inner = q.tokens;
  const firstPara = inner[0]?.type === 'paragraph' ? (inner[0] as Tokens.Paragraph) : undefined;
  const alert = firstPara && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(firstPara.text);
  const parts: InlineContent[][] = [];
  const children: Block[] = [];
  inner.forEach((t, i) => {
    if (t.type === 'paragraph' || t.type === 'text') {
      let content = trimInline(inline((t as Tokens.Paragraph).tokens));
      if (i === 0 && alert) {
        // Drop the "[!NOTE]" marker from the first text run.
        const first = content[0];
        if (first?.type === 'text') first.text = first.text.replace(/^\[!\w+\]\s*/, '');
        content = trimInline(content);
      }
      if (content.length) parts.push(content);
    } else if (t.type !== 'space') {
      children.push(...tokenToBlocks(t));
    }
  });
  const content: InlineContent[] = [];
  parts.forEach((p, i) => {
    if (i > 0) content.push({ type: 'text', text: '\n', styles: {} });
    content.push(...p);
  });
  const block: Block = alert
    ? { type: 'callout', props: { kind: ALERTS[alert[1]!.toUpperCase()]! }, content }
    : { type: 'quote', content };
  return children.length ? [block, ...children] : [block];
}

function tableBlock(t: Tokens.Table): Block {
  const cell = (c: Tokens.TableCell, i: number): TableCell => ({
    type: 'tableCell',
    props: { textAlignment: (t.align[i] ?? 'left') as 'left' | 'center' | 'right' },
    content: trimInline(inline(c.tokens)),
  });
  return {
    type: 'table',
    content: {
      type: 'tableContent',
      headerRows: 1,
      columnWidths: t.header.map(() => undefined),
      rows: [{ cells: t.header.map(cell) }, ...t.rows.map((r) => ({ cells: r.map(cell) }))],
    },
  };
}

function tokenToBlocks(t: Token): Block[] {
  switch (t.type) {
    case 'space':
    case 'def':
      return [];
    case 'heading': {
      const h = t as Tokens.Heading;
      return [{ type: 'heading', props: { level: Math.min(h.depth, 3) }, content: trimInline(inline(h.tokens)) }];
    }
    case 'paragraph':
      return paragraphBlocks((t as Tokens.Paragraph).tokens);
    case 'text': {
      const tt = t as Tokens.Text;
      return paragraphBlocks(tt.tokens ?? [tt]);
    }
    case 'list':
      return listItemBlocks(t as Tokens.List);
    case 'blockquote':
      return quoteBlocks(t as Tokens.Blockquote);
    case 'code': {
      const c = t as Tokens.Code;
      const lang = normalizeLanguage(c.lang);
      if (lang === 'mermaid') return [{ type: 'mermaid', props: { code: c.text } }];
      if (lang === 'chart') return [{ type: 'chart', props: chartFromMarkdown(c.text) }];
      if (lang === 'math' || lang === 'latex' || lang === 'tex' || lang === 'katex') {
        return [{ type: 'math', props: { latex: c.text.trim() } }];
      }
      return [{ type: 'codeBlock', props: { language: lang }, content: [{ type: 'text', text: c.text, styles: {} }] }];
    }
    case 'blockMath':
      return [{ type: 'math', props: { latex: (t as unknown as MathToken).latex } }];
    case 'hr':
      return [{ type: 'divider' }];
    case 'table':
      return [tableBlock(t as Tokens.Table)];
    case 'html': {
      const text = decode((t as Tokens.HTML).text.replace(/<[^>]*>/g, '')).trim();
      return text ? [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] : [];
    }
    default: {
      const anyT = t as { tokens?: Token[]; text?: string };
      if (anyT.tokens) return paragraphBlocks(anyT.tokens);
      return anyT.text ? [{ type: 'paragraph', content: [{ type: 'text', text: anyT.text, styles: {} }] }] : [];
    }
  }
}

export function markdownToBlocks(md: string): Block[] {
  const normalized = md.replace(/\r\n?/g, '\n');
  return marked.lexer(normalized).flatMap(tokenToBlocks);
}

/**
 * Heuristic for paste: does plain text look like Markdown worth converting?
 * Plain prose stays plain so a pasted sentence doesn't grow formatting.
 */
export function looksLikeMarkdown(text: string): boolean {
  const patterns = [
    /^#{1,6}\s+\S/m, // heading
    /^\s*[-*+]\s+\S/m, // bullet
    /^\s*\d+[.)]\s+\S/m, // numbered
    /^\s*[-*]\s+\[[ xX]\]\s/m, // task
    /^```/m, // fence
    /^\s*>\s?\S/m, // quote
    /^\|.+\|\s*$/m, // table row
    /\*\*[^*\n]+\*\*/, // bold
    /(^|\s)_[^_\n]+_(\s|$)/, // italic
    /`[^`\n]+`/, // inline code
    /\[[^\]\n]+\]\([^)\s]+\)/, // link
    /^\s*(-{3,}|\*{3,})\s*$/m, // rule
    /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\(.+?\\\)/, // math
  ];
  return patterns.some((p) => p.test(text));
}
