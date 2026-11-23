import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react';
import { CircleAlert, FileText, Info, Lightbulb, MessageSquareWarning, OctagonAlert } from 'lucide-react';
import type Katex from 'katex';
import type { Mermaid } from 'mermaid';
import { useEffect, useId, useRef, useState } from 'react';
import type { CalloutKind } from '@shared/blocks';
import { cn } from '@web/lib/cn';
import { navigate, usePageTitle } from '@web/lib/page-titles';
import { useResolvedTheme } from '@web/lib/prefs';

// ── Callout ─────────────────────────────────────────────────────────────────

const KINDS: { kind: CalloutKind; label: string; Icon: typeof Info }[] = [
  { kind: 'note', label: 'Note', Icon: Info },
  { kind: 'tip', label: 'Tip', Icon: Lightbulb },
  { kind: 'important', label: 'Important', Icon: MessageSquareWarning },
  { kind: 'warning', label: 'Warning', Icon: CircleAlert },
  { kind: 'caution', label: 'Caution', Icon: OctagonAlert },
];

export const Callout = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: { kind: { default: 'note' as CalloutKind, values: ['note', 'tip', 'important', 'warning', 'caution'] as const } },
    content: 'inline',
  },
  {
    render: ({ block, editor, contentRef }) => {
      const i = Math.max(0, KINDS.findIndex((k) => k.kind === block.props.kind));
      const { Icon, label } = KINDS[i]!;
      const next = KINDS[(i + 1) % KINDS.length]!;
      return (
        <div className="notey-callout" data-kind={block.props.kind}>
          <button
            type="button"
            contentEditable={false}
            className="notey-callout-icon"
            aria-label={`${label} callout. Change to ${next.label}`}
            title={`${label} · click to change`}
            onClick={() => editor.updateBlock(block, { props: { kind: next.kind } })}
          >
            <Icon aria-hidden strokeWidth={1.5} />
          </button>
          <div ref={contentRef} className="min-w-0 flex-1" />
        </div>
      );
    },
  },
);

// ── Math (KaTeX, loaded on first use) ───────────────────────────────────────

let katexPromise: Promise<typeof Katex> | null = null;
const loadKatex = () => {
  katexPromise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => k.default);
  return katexPromise;
};

function useKatex(latex: string, displayMode: boolean) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadKatex().then((k) => {
      if (!live) return;
      // trust: false (the default) keeps \href and \htmlId out; output is KaTeX's own markup.
      setHtml(k.renderToString(latex || '\\square', { displayMode, throwOnError: false, output: 'htmlAndMathml' }));
    });
    return () => {
      live = false;
    };
  }, [latex, displayMode]);
  return html;
}

function SourceEditor({
  value,
  onChange,
  onDone,
  label,
  mono = true,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  onDone: () => void;
  label: string;
  mono?: boolean;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      rows={Math.max(rows, value.split('\n').length)}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          onDone();
        }
      }}
      className={cn(
        'mt-2 w-full resize-none rounded-md bg-neutral px-3 py-2 text-on-surface ring-1 ring-border outline-none focus:ring-2 focus:ring-primary',
        mono ? 'font-mono text-mono' : 'text-body',
      )}
    />
  );
}

export const MathBlock = createReactBlockSpec(
  { type: 'math', propSchema: { latex: { default: '' } }, content: 'none' },
  {
    render: function Render({ block, editor }) {
      const [editing, setEditing] = useState(!block.props.latex);
      const [draft, setDraft] = useState(block.props.latex);
      const html = useKatex(editing ? draft : block.props.latex, true);
      const commit = () => {
        setEditing(false);
        if (draft !== block.props.latex) editor.updateBlock(block, { props: { latex: draft } });
      };
      return (
        <div className="notey-embed w-full" contentEditable={false}>
          <button type="button" className="block w-full overflow-x-auto py-2 text-left" onClick={() => setEditing(true)} aria-label="Edit equation">
            {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="text-meta text-on-surface-subtle">Loading equation…</span>}
          </button>
          {editing && <SourceEditor label="LaTeX" value={draft} onChange={setDraft} onDone={commit} />}
        </div>
      );
    },
  },
);

export const InlineMath = createReactInlineContentSpec(
  { type: 'inlineMath', propSchema: { latex: { default: '' } }, content: 'none' },
  {
    render: function Render({ inlineContent, updateInlineContent }) {
      const html = useKatex(inlineContent.props.latex, false);
      return (
        <button
          type="button"
          className="notey-inline-math"
          title="Edit equation"
          onClick={() => {
            const next = prompt('Equation (LaTeX)', inlineContent.props.latex);
            if (next !== null) updateInlineContent({ type: 'inlineMath', props: { latex: next } });
          }}
        >
          {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : inlineContent.props.latex}
        </button>
      );
    },
  },
);

// ── Mermaid (loaded on first use) ───────────────────────────────────────────

let mermaidPromise: Promise<Mermaid> | null = null;
let mermaidTheme: string | null = null;
async function loadMermaid(theme: 'light' | 'dark') {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  if (mermaidTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral', fontFamily: 'inherit' });
    mermaidTheme = theme;
  }
  return mermaid;
}

export const MermaidBlock = createReactBlockSpec(
  { type: 'mermaid', propSchema: { code: { default: '' } }, content: 'none' },
  {
    render: function Render({ block, editor }) {
      const theme = useResolvedTheme();
      const [editing, setEditing] = useState(!block.props.code);
      const [draft, setDraft] = useState(block.props.code);
      const [svg, setSvg] = useState<string | null>(null);
      const [error, setError] = useState<string | null>(null);
      const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
      const code = editing ? draft : block.props.code;

      useEffect(() => {
        let live = true;
        if (!code.trim()) {
          setSvg(null);
          return;
        }
        const t = setTimeout(async () => {
          try {
            const mermaid = await loadMermaid(theme);
            const out = await mermaid.render(id, code);
            if (live) {
              setSvg(out.svg);
              setError(null);
            }
          } catch (e) {
            if (live) setError(e instanceof Error ? e.message.split('\n')[0]! : "Couldn't draw this diagram.");
          }
        }, 250);
        return () => {
          live = false;
          clearTimeout(t);
        };
      }, [code, theme, id]);

      const commit = () => {
        setEditing(false);
        if (draft !== block.props.code) editor.updateBlock(block, { props: { code: draft } });
      };
      return (
        <div className="notey-embed w-full" contentEditable={false}>
          <button type="button" className="block w-full overflow-x-auto py-2 text-left" onClick={() => setEditing(true)} aria-label="Edit diagram">
            {svg ? (
              // securityLevel 'strict' sanitizes Mermaid's SVG output.
              <span className="notey-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <span className="text-meta text-on-surface-subtle">{code.trim() ? 'Drawing diagram…' : 'Empty diagram. Click to write Mermaid.'}</span>
            )}
          </button>
          {error && (
            <p role="alert" className="text-meta text-error">
              {error}
            </p>
          )}
          {editing && <SourceEditor label="Mermaid" value={draft} onChange={setDraft} onDone={commit} rows={4} />}
        </div>
      );
    },
  },
);

// ── Page link ───────────────────────────────────────────────────────────────

export const PageLink = createReactInlineContentSpec(
  { type: 'pageLink', propSchema: { pageId: { default: '' }, title: { default: '' } }, content: 'none' },
  {
    render: function Render({ inlineContent }) {
      const live = usePageTitle(inlineContent.props.pageId);
      const title = live ?? inlineContent.props.title ?? 'Untitled';
      const ws = location.pathname.split('/')[2];
      const href = `/w/${ws}/p/${inlineContent.props.pageId}`;
      return (
        <a
          href={href}
          className="notey-page-link"
          data-missing={live === undefined || undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            navigate(href);
          }}
        >
          <FileText aria-hidden strokeWidth={1.5} />
          {title || 'Untitled'}
        </a>
      );
    },
  },
);
