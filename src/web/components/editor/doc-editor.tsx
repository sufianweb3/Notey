import '@blocknote/shadcn/style.css';
import './editor.css';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FileCaptionButton,
  FileReplaceButton,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  usePortalElement,
  useSelectedBlocks,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { useQueryClient } from '@tanstack/react-query';
import { ChartColumn, FileText, Info, ListChecks, Network, Palette, Shapes, Sigma, SquareFunction, Workflow } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Block } from '@shared/blocks';
import type { PageDetail, Tree } from '@shared/schemas';
import { looksLikeMarkdown, markdownToBlocks } from '../../../server/md/md-to-blocks';
import { Button } from '@web/components/ui/button';
import { Dialog } from '@web/components/ui/dialog';
import { api, ApiError } from '@web/lib/api';
import { base, ck, pageTitle } from '@web/lib/content';
import { PAGE_CHANGED, type PageChangedDetail } from '@web/lib/live';
import { useResolvedTheme } from '@web/lib/prefs';
import { upload } from '@web/lib/upload';
import { schema, type NoteyEditor, type NoteyPartialBlock } from './schema';

export type SaveState = 'saved' | 'saving' | 'error' | 'offline';
export type EditorHandle = { load: (page: PageDetail) => void; focusStart: () => void };

const DEBOUNCE_MS = 600;
const QUIET_MS = 2_500; // no typing for this long = safe to apply a remote edit in place

// ── Slash menu ──────────────────────────────────────────────────────────────

function slashItems(editor: NoteyEditor): DefaultReactSuggestionItem[] {
  const defaults = getDefaultReactSlashMenuItems(editor).filter((i) => !/video|audio|toggle heading/i.test(i.title));
  const custom: DefaultReactSuggestionItem[] = [
    {
      title: 'Task',
      subtext: 'A real task, also in Tasks (a checklist stays in the doc)',
      aliases: ['task', 'todo', 'to-do', 'action'],
      group: 'Basic blocks',
      icon: <ListChecks size={18} strokeWidth={1.5} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'task' }),
    },
    {
      title: 'Callout',
      subtext: 'Highlight a note, tip or warning',
      aliases: ['callout', 'note', 'tip', 'warning', 'alert', 'info'],
      group: 'Basic blocks',
      icon: <Info size={18} strokeWidth={1.5} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' }),
    },
    {
      title: 'Link to page',
      subtext: 'Mention another page',
      aliases: ['page', 'link', 'mention', '@', '[['],
      group: 'Basic blocks',
      icon: <FileText size={18} strokeWidth={1.5} />,
      onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu('@', { deleteTriggerCharacter: true }),
    },
    {
      title: 'Equation',
      subtext: 'A block of LaTeX math',
      aliases: ['math', 'latex', 'katex', 'equation', 'formula'],
      group: 'Advanced',
      icon: <Sigma size={18} strokeWidth={1.5} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'math' }),
    },
    {
      title: 'Inline equation',
      subtext: 'LaTeX inside a line of text',
      aliases: ['inline math', 'latex', '$'],
      group: 'Advanced',
      icon: <SquareFunction size={18} strokeWidth={1.5} />,
      onItemClick: () => {
        const latex = prompt('Equation (LaTeX)', 'E = mc^2');
        if (latex) editor.insertInlineContent([{ type: 'inlineMath', props: { latex } }, ' ']);
      },
    },
    {
      title: 'Mermaid diagram',
      subtext: 'Flowcharts and sequence diagrams from text',
      aliases: ['mermaid', 'diagram', 'flowchart', 'sequence'],
      group: 'Advanced',
      icon: <Network size={18} strokeWidth={1.5} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'mermaid' }),
    },
    {
      title: 'Chart',
      subtext: 'Bar, line, area or pie from a small table',
      aliases: ['chart', 'graph', 'bar', 'line', 'pie', 'area', 'plot'],
      group: 'Media',
      icon: <ChartColumn size={18} strokeWidth={1.5} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'chart' }),
    },
    {
      title: 'Canvas',
      subtext: 'Embed a whiteboard, new or existing',
      aliases: ['canvas', 'whiteboard', 'drawing', 'excalidraw', 'sketch', 'embed'],
      group: 'Media',
      icon: <Shapes size={18} strokeWidth={1.5} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'pageEmbed', props: { kind: 'canvas' } }),
    },
    {
      title: 'Mindmap',
      subtext: 'Embed a mindmap, new or existing',
      aliases: ['mindmap', 'mind map', 'ideas', 'tree', 'embed'],
      group: 'Media',
      icon: <Workflow size={18} strokeWidth={1.5} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'pageEmbed', props: { kind: 'mindmap' } }),
    },
  ];
  // Keep BlockNote's grouping; ours slot into Basic and Advanced.
  const all = [...defaults, ...custom];
  const order = ['Headings', 'Basic blocks', 'Media', 'Advanced', 'Others'];
  return all.sort((a, b) => order.indexOf(a.group ?? 'Others') - order.indexOf(b.group ?? 'Others'));
}

// ── Formatting toolbar: bold, italic, strike, code, link, four muted colours ─

const TEXT_COLORS = [
  { value: 'default', label: 'Default' },
  { value: 'gray', label: 'Gray' },
  { value: 'green', label: 'Olive' },
  { value: 'orange', label: 'Amber' },
  { value: 'red', label: 'Red' },
] as const;
const HIGHLIGHTS = [
  { value: 'default', label: 'No highlight' },
  { value: 'yellow', label: 'Lime highlight' },
  { value: 'gray', label: 'Gray highlight' },
] as const;

function ColorMenu() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const selected = useSelectedBlocks(editor);
  // Colours apply to text; hide the button when only embeds (diagram, equation, image) are selected.
  if (!selected.some((b) => Array.isArray(b.content))) return null;
  const apply = (style: 'textColor' | 'backgroundColor', value: string) => {
    if (value === 'default') editor.removeStyles({ [style]: '' } as never);
    else editor.addStyles({ [style]: value } as never);
    editor.focus();
  };
  return (
    <Components.Generic.Menu.Root portalElement={portalElement}>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button className="bn-button" label="Text colour" mainTooltip="Text colour and highlight" icon={<Palette size={16} strokeWidth={1.5} />} />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        <Components.Generic.Menu.Label>Text</Components.Generic.Menu.Label>
        {TEXT_COLORS.map((c) => (
          <Components.Generic.Menu.Item key={`t-${c.value}`} onClick={() => apply('textColor', c.value)} icon={<span className="notey-swatch" data-text-color={c.value}>A</span>}>
            {c.label}
          </Components.Generic.Menu.Item>
        ))}
        <Components.Generic.Menu.Divider />
        <Components.Generic.Menu.Label>Highlight</Components.Generic.Menu.Label>
        {HIGHLIGHTS.map((c) => (
          <Components.Generic.Menu.Item key={`b-${c.value}`} onClick={() => apply('backgroundColor', c.value)} icon={<span className="notey-swatch" data-background-color={c.value}>A</span>}>
            {c.label}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

function Toolbar() {
  return (
    <FormattingToolbar>
      <BlockTypeSelect key="type" />
      <FileCaptionButton key="caption" />
      <FileReplaceButton key="replace" />
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />
      <CreateLinkButton key="link" />
      <ColorMenu key="color" />
    </FormattingToolbar>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

type Props = {
  ws: string;
  page: PageDetail;
  tree: Tree | undefined;
  onSaveState: (s: SaveState) => void;
  /** The server's rev moved on (another tab or an agent): let the page update its title. */
  onRemote: (page: PageDetail) => void;
  onExitTop?: () => void;
  /** Called once the editor is mounted and can take focus. */
  onReady?: () => void;
};

const DocEditor = forwardRef<EditorHandle, Props>(function DocEditor({ ws, page, tree, onSaveState, onRemote, onExitTop, onReady }, ref) {
  const qc = useQueryClient();
  const theme = useResolvedTheme();
  const plainPaste = useRef(false);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const editor = useCreateBlockNote(
    {
      schema,
      initialContent: Array.isArray(page.content) && page.content.length ? (page.content as NoteyPartialBlock[]) : undefined,
      uploadFile: (file) => upload(ws, file),
      pasteHandler: ({ event, editor, defaultPasteHandler }) => {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (plainPaste.current) {
          // ⌘⇧V: plain text, no Markdown conversion.
          plainPaste.current = false;
          editor.insertInlineContent(text);
          return true;
        }
        // AI chats put Markdown on the clipboard: turn it into native blocks (PRD 6.4).
        if (text && looksLikeMarkdown(text)) {
          const blocks = markdownToBlocks(text) as NoteyPartialBlock[];
          if (blocks.length) {
            const at = editor.getTextCursorPosition().block;
            const empty = at.type === 'paragraph' && Array.isArray(at.content) && at.content.length === 0;
            if (empty) editor.replaceBlocks([at], blocks);
            else editor.insertBlocks(blocks, at, 'after');
            return true;
          }
        }
        return defaultPasteHandler({ prioritizeMarkdownOverHTML: false, plainTextAsMarkdown: false });
      },
    },
    [page.id],
  );

  // ── Autosave with rev check ─────────────────────────────────────────────
  const rev = useRef(page.rev);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const lastEdit = useRef(0);
  const applyingRemote = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryDelay = useRef(2_000);
  const [conflict, setConflict] = useState<{ by: string } | null>(null);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;

  const schedule = (ms = DEBOUNCE_MS) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), ms);
  };

  async function save() {
    if (inFlight.current || !dirty.current || conflictRef.current) return;
    dirty.current = false;
    inFlight.current = true;
    onSaveState('saving');
    try {
      const res = await api<{ rev: number; updatedAt: string; contentMd: string }>(`${base(ws)}/pages/${page.id}/content`, {
        method: 'PUT',
        body: { rev: rev.current, content: editor.document },
      });
      rev.current = res.rev;
      retryDelay.current = 2_000;
      qc.setQueryData<PageDetail>(ck.page(ws, page.id), (old) =>
        old ? { ...old, rev: res.rev, updatedAt: res.updatedAt, contentMd: res.contentMd, content: editor.document as unknown[] } : old,
      );
      onSaveState(dirty.current ? 'saving' : 'saved');
    } catch (e) {
      dirty.current = true;
      if (e instanceof ApiError && e.status === 409) {
        setConflict({ by: String(e.details?.updatedBy ?? '') });
        onSaveState('error');
      } else {
        onSaveState(e instanceof ApiError && e.status === 0 ? 'offline' : 'error');
        schedule(retryDelay.current);
        retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
      }
    } finally {
      inFlight.current = false;
      if (dirty.current && !conflictRef.current) schedule();
    }
  }

  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      if (applyingRemote.current) return;
      dirty.current = true;
      lastEdit.current = Date.now();
      schedule();
    });
    const onOnline = () => dirty.current && void save();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unsubscribe?.();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', beforeUnload);
      clearTimeout(timer.current);
      // Leaving the page: flush what's pending.
      if (dirty.current) void save();
    };
    // save/schedule read refs only.
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  function load(next: PageDetail) {
    applyingRemote.current = true;
    try {
      const blocks = (Array.isArray(next.content) && next.content.length ? next.content : [{ type: 'paragraph' }]) as NoteyPartialBlock[];
      editor.replaceBlocks(editor.document, blocks);
    } finally {
      applyingRemote.current = false;
    }
    rev.current = next.rev;
    dirty.current = false;
    setConflict(null);
    onSaveState('saved');
  }

  useImperativeHandle(ref, () => ({
    load,
    focusStart: () => {
      // The ProseMirror view can attach a frame after mount: retry until it takes focus.
      let tries = 0;
      const attempt = () => {
        const view = editor.prosemirrorView;
        if (view?.dom.isConnected) {
          const first = editor.document[0];
          if (first) editor.setTextCursorPosition(first, 'start');
          editor.focus();
          if (view.hasFocus()) return;
        }
        if (++tries < 20) requestAnimationFrame(attempt);
      };
      attempt();
    },
  }));

  useEffect(() => {
    onReady?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live refresh: edits from another tab or an agent ─────────────────────
  useEffect(() => {
    async function onChanged(e: Event) {
      const { ws: w, pageId } = (e as CustomEvent<PageChangedDetail>).detail;
      if (w !== ws || pageId !== page.id) return;
      let latest: PageDetail;
      try {
        latest = (await api<{ page: PageDetail }>(`${base(ws)}/pages/${page.id}`)).page;
      } catch {
        return;
      }
      onRemote(latest);
      if (latest.rev <= rev.current) return; // our own save
      const typing = dirty.current || inFlight.current || Date.now() - lastEdit.current < QUIET_MS;
      if (typing) setConflict({ by: latest.updatedBy });
      else load(latest);
    }
    window.addEventListener(PAGE_CHANGED, onChanged);
    return () => window.removeEventListener(PAGE_CHANGED, onChanged);
  }, [ws, page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reload() {
    try {
      load((await api<{ page: PageDetail }>(`${base(ws)}/pages/${page.id}`)).page);
    } catch {
      toast.error("Couldn't load the latest version. Try again.");
    }
  }

  async function keepMine() {
    try {
      const latest = (await api<{ page: PageDetail }>(`${base(ws)}/pages/${page.id}`)).page;
      rev.current = latest.rev;
      setConflict(null);
      conflictRef.current = null;
      dirty.current = true;
      await save();
      toast('Kept your version', { description: 'The other version is in page history.' });
    } catch {
      toast.error("Couldn't save your version. Try again.");
    }
  }

  // ── [[ opens the page-link menu, ⌘⇧V pastes plain text ──────────────────
  function onKeyDownCapture(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainPaste.current = true;
    if (e.key === 'ArrowUp' && onExitTop) {
      const view = editor.prosemirrorView;
      if (view && view.state.selection.from <= 2 && view.state.selection.empty) {
        e.preventDefault();
        onExitTop();
      }
    }
    if (e.key === '[' && !e.metaKey && !e.ctrlKey) {
      const view = editor.prosemirrorView;
      if (!view) return;
      const { $from, empty } = view.state.selection;
      if (empty && $from.parentOffset > 0 && $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset) === '[') {
        e.preventDefault();
        view.dispatch(view.state.tr.delete($from.pos - 1, $from.pos));
        editor.getExtension(SuggestionMenu)?.openSuggestionMenu('@', { deleteTriggerCharacter: true });
      }
    }
  }

  const [zoom, setZoom] = useState<string | null>(null);

  return (
    <>
      {conflict && (
        <div role="status" className="mx-auto mb-4 flex w-full max-w-doc flex-wrap items-center gap-3 rounded-lg bg-surface-raised px-4 py-3 ring-1 ring-border">
          <Info className="size-4 shrink-0 text-on-surface-muted" strokeWidth={1.5} aria-hidden />
          <p className="min-w-0 flex-1 text-body">
            {conflict.by.startsWith('agent:') ? `${conflict.by.slice(6)} edited this page.` : 'This page changed in another tab or window.'}
          </p>
          <Button size="sm" onClick={() => void reload()}>
            Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void keepMine()}>
            Keep mine
          </Button>
        </div>
      )}
      <div
        onKeyDownCapture={onKeyDownCapture}
        onDoubleClick={(e) => {
          const img = (e.target as HTMLElement).closest('img');
          if (img && img.closest('.bn-visual-media')) setZoom(img.getAttribute('src'));
        }}
      >
        <BlockNoteView editor={editor} theme={theme} formattingToolbar={false} slashMenu={false} className="notey-editor">
          <FormattingToolbarController formattingToolbar={Toolbar} />
          <SuggestionMenuController triggerCharacter="/" getItems={async (q) => filterSuggestionItems(slashItems(editor), q)} />
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (q) => {
              const pages = (treeRef.current?.pages ?? []).filter((p) => p.id !== page.id && p.type === 'doc');
              const needle = q.toLowerCase();
              return pages
                .filter((p) => pageTitle(p).toLowerCase().includes(needle))
                .slice(0, 8)
                .map((p) => ({
                  title: pageTitle(p),
                  subtext: treeRef.current?.projects.find((x) => x.id === p.projectId)?.name,
                  icon: <FileText size={16} strokeWidth={1.5} />,
                  onItemClick: () => editor.insertInlineContent([{ type: 'pageLink', props: { pageId: p.id, title: pageTitle(p) } }, ' ']),
                }));
            }}
          />
        </BlockNoteView>
      </div>
      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)} title="Image" className="sm:w-[min(1100px,calc(100vw-var(--spacing-8)))]">
        {zoom && <img src={zoom} alt="" className="max-h-[75dvh] w-full rounded-md object-contain" />}
      </Dialog>
    </>
  );
});

export default DocEditor;

/** Read-only render of a stored version, for page history. */
export function DocPreview({ content }: { content: Block[] | null }) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({ schema, initialContent: content?.length ? (content as NoteyPartialBlock[]) : undefined }, [content]);
  return <BlockNoteView editor={editor} theme={theme} editable={false} className="notey-editor notey-preview" />;
}
