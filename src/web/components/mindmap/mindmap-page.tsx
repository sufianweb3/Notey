import '@xyflow/react/dist/base.css';
import './mindmap.css';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { ChevronRight, CornerDownRight, Maximize, Network, Orbit, Plus, Trash2 } from 'lucide-react';
import { createContext, forwardRef, memo, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  emptyMindmap,
  findNode,
  findParent,
  insertNode,
  mapNode,
  mindNode,
  moveNode,
  removeNode,
  visibleNodes,
  type MindmapContent,
  type MindmapLayout,
  type MindNode,
} from '@shared/mindmap';
import type { PageDetail } from '@shared/schemas';
import { looksLikeOutline, mindmapToOutline, outlineToMindmap } from '../../../server/md/outline';
import { ConflictBar } from '@web/components/shell/conflict-bar';
import { cn } from '@web/lib/cn';
import { usePageSync, type SaveState } from '@web/lib/page-sync';
import { layoutMindmap, type Placed } from './layout';

export type MindmapHandle = {
  outline: () => string;
  replaceFromOutline: (md: string) => void;
};

type Props = {
  ws: string;
  page: PageDetail;
  title: string;
  onSaveState: (s: SaveState) => void;
  onRemote: (page: PageDetail) => void;
  /** The central idea was renamed (the page uses it as its title while it has none). */
  onRootText?: (text: string) => void;
};

type NodeData = Placed & { layout: MindmapLayout; selected: boolean; editing: boolean; dropTarget: boolean; caretEnd: boolean };
type MindFlowNode = Node<NodeData, 'mind'>;

type Actions = {
  select: (id: string) => void;
  edit: (id: string) => void;
  commitText: (id: string, text: string, then?: 'child' | 'sibling') => void;
  /** Esc: keeps what was typed, except after typing over an idea, which puts the old text back. */
  cancelEdit: (id: string, draft: string) => void;
  toggle: (id: string) => void;
};
const ActionsContext = createContext<Actions | null>(null);

const MAX_HISTORY = 100;

// ── Node ────────────────────────────────────────────────────────────────────

const MindNodeView = memo(function MindNodeView({ data }: NodeProps<MindFlowNode>) {
  const act = useContext(ActionsContext)!;
  const { node, depth, layout, selected, editing, hidden, dropTarget } = data;
  const root = depth === 0;
  const handleStyle = layout === 'radial' ? { left: '50%', top: '50%', right: 'auto' } : undefined;
  const kids = node.children.length;

  return (
    <div
      className="notey-mind-node"
      data-root={root || undefined}
      data-depth={Math.min(depth, 2)}
      data-selected={selected || undefined}
      data-drop={dropTarget || undefined}
      style={{ width: data.width, minHeight: data.height }}
      onClick={() => act.select(node.id)}
      onDoubleClick={() => act.edit(node.id)}
    >
      <Handle type="target" position={layout === 'radial' ? Position.Top : Position.Left} style={handleStyle} isConnectable={false} />
      <span className={cn('notey-mind-text', !node.text && 'notey-mind-placeholder', editing && 'invisible')}>{node.text || (root ? 'Central idea' : 'New idea')}</span>
      {kids > 0 && (
        <button
          type="button"
          className="nodrag notey-mind-fold"
          data-collapsed={node.collapsed || undefined}
          aria-label={node.collapsed ? `Show ${hidden} hidden ${hidden === 1 ? 'idea' : 'ideas'}` : 'Fold branch'}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            act.toggle(node.id);
          }}
        >
          {node.collapsed ? hidden : <ChevronRight aria-hidden strokeWidth={2} />}
        </button>
      )}
      <Handle type="source" position={layout === 'radial' ? Position.Bottom : Position.Right} style={handleStyle} isConnectable={false} />
    </div>
  );
});

/**
 * The text field for the idea being edited, drawn over its node in screen
 * space. Nodes inside React Flow can't take focus until they're measured,
 * which loses the first keys typed after Tab or Enter.
 */
function EditOverlay({ p, zoom, x, y, caretEnd }: { p: Placed; zoom: number; x: number; y: number; caretEnd: boolean }) {
  return (
    <div
      className="notey-mind-node notey-mind-editor"
      data-root={p.depth === 0 || undefined}
      data-depth={Math.min(p.depth, 2)}
      data-selected
      style={{ left: p.x * zoom + x, top: p.y * zoom + y, width: p.width, minHeight: p.height, transform: `scale(${zoom})` }}
    >
      <NodeInput key={p.node.id} id={p.node.id} text={p.node.text} caretEnd={caretEnd} />
    </div>
  );
}

/** Mounted only while editing, so its draft starts from the node's text. */
function NodeInput({ id, text, caretEnd }: { id: string; text: string; caretEnd: boolean }) {
  const act = useContext(ActionsContext)!;
  const [draft, setDraft] = useState(text);
  const input = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  // The overlay is ordinary DOM, so it can take focus as soon as it mounts.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // Started by typing a character: keep it and type on. Otherwise select all.
    if (caretEnd) el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
  }, [caretEnd]);

  const finish = (fn: () => void) => {
    done.current = true;
    fn();
  };

  return (
    <textarea
      ref={input}
      aria-label="Idea text"
      value={draft}
      rows={1}
      maxLength={2000}
      className="nodrag nopan notey-mind-input"
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(() => act.commitText(id, draft, e.metaKey || e.ctrlKey ? undefined : 'sibling'));
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(() => act.commitText(id, draft, 'child'));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(() => act.cancelEdit(id, draft));
        }
      }}
      onBlur={() => {
        if (!done.current) act.commitText(id, draft);
      }}
    />
  );
}

const nodeTypes = { mind: MindNodeView };

// ── Page ────────────────────────────────────────────────────────────────────

const MindmapInner = forwardRef<MindmapHandle, Props>(function MindmapInner({ ws, page, title, onSaveState, onRemote, onRootText }, ref) {
  const flow = useReactFlow();
  const viewport = useViewport();
  const wrapper = useRef<HTMLDivElement>(null);
  const isNew = page.content == null;
  const [doc, setDoc] = useState<MindmapContent>(() => (page.content as MindmapContent | null) ?? emptyMindmap(title));
  const docRef = useRef(doc);
  const [selected, setSelected] = useState(doc.root.id);
  const [editing, setEditing] = useState<string | null>(isNew && !title ? doc.root.id : null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const fresh = useRef<string | null>(null);
  const undo = useRef<MindmapContent[]>([]);
  const redo = useRef<MindmapContent[]>([]);
  const [announce, setAnnounce] = useState('');
  const typed = useRef<string | null>(null);

  const sync = usePageSync({
    ws,
    page,
    onSaveState,
    onRemote,
    read: () => docRef.current,
    apply: (next) => {
      const c = (next.content as MindmapContent | null) ?? emptyMindmap();
      docRef.current = c;
      setDoc(c);
      setEditing(null);
      if (!findNode(c.root, selected)) setSelected(c.root.id);
    },
  });

  function commit(next: MindmapContent, record = true) {
    if (record) {
      undo.current = [...undo.current.slice(-MAX_HISTORY + 1), docRef.current];
      redo.current = [];
    }
    docRef.current = next;
    setDoc(next);
    sync.markDirty();
  }
  const setRoot = (root: MindNode, record = true) => commit({ ...docRef.current, root }, record);

  const placed = useMemo(() => layoutMindmap(doc.root, doc.layout), [doc.root, doc.layout]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  const nodes: MindFlowNode[] = placed.map((p) => ({
    id: p.node.id,
    type: 'mind',
    position: drag?.id === p.node.id ? { x: drag.x, y: drag.y } : { x: p.x, y: p.y },
    width: p.width,
    height: p.height,
    draggable: p.depth > 0 && editing !== p.node.id,
    selectable: false,
    data: { ...p, layout: doc.layout, selected: selected === p.node.id, editing: editing === p.node.id, dropTarget: drag?.over === p.node.id, caretEnd: typed.current === p.node.id },
  }));
  const edges: Edge[] = placed
    .filter((p) => p.parentId)
    .map((p) => ({ id: `${p.parentId}>${p.node.id}`, source: p.parentId!, target: p.node.id, type: doc.layout === 'radial' ? 'straight' : 'default', selectable: false, focusable: false }));

  // Fit on open and when the layout changes.
  useEffect(() => {
    const t = setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1.1, duration: 0 }), 30);
    return () => clearTimeout(t);
  }, [doc.layout]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pans just enough to bring a node into view. */
  function reveal(id: string) {
    requestAnimationFrame(() => {
      const p = layoutMindmap(docRef.current.root, docRef.current.layout).find((x) => x.node.id === id);
      const el = wrapper.current;
      if (!p || !el) return;
      const { x, y, zoom } = flow.getViewport();
      const sx = p.x * zoom + x;
      const sy = p.y * zoom + y;
      const margin = 48;
      const inside = sx > margin && sy > margin && sx + p.width * zoom < el.clientWidth - margin && sy + p.height * zoom < el.clientHeight - margin - 64;
      if (!inside) void flow.setCenter(p.x + p.width / 2, p.y + p.height / 2, { zoom, duration: 200 });
    });
  }

  function select(id: string) {
    setSelected(id);
    if (!editing) wrapper.current?.focus({ preventScroll: true });
    const p = byId.get(id);
    const n = findNode(docRef.current.root, id);
    if (n) {
      const parts = [n.text || 'Untitled idea', p ? `level ${p.depth + 1}` : ''];
      if (n.children.length) parts.push(`${n.children.length} ${n.children.length === 1 ? 'idea' : 'ideas'} inside${n.collapsed ? ', folded' : ''}`);
      setAnnounce(parts.filter(Boolean).join(', '));
    }
    reveal(id);
  }

  function addChild(parentId: string, text = '') {
    const n = mindNode(text);
    setRoot(insertNode(docRef.current.root, parentId, n));
    fresh.current = n.id;
    setSelected(n.id);
    setEditing(n.id);
    reveal(n.id);
  }

  function addSibling(id: string) {
    const parent = findParent(docRef.current.root, id);
    if (!parent) return addChild(id);
    const n = mindNode('');
    setRoot(insertNode(docRef.current.root, parent.id, n, parent.children.findIndex((c) => c.id === id) + 1));
    fresh.current = n.id;
    setSelected(n.id);
    setEditing(n.id);
    reveal(n.id);
  }

  function remove(id: string) {
    const root = docRef.current.root;
    if (id === root.id) return void toast('The central idea stays. Rename it instead.');
    const parent = findParent(root, id)!;
    const i = parent.children.findIndex((c) => c.id === id);
    const next = parent.children[i + 1] ?? parent.children[i - 1] ?? parent;
    const removed = findNode(root, id)!;
    setRoot(removeNode(root, id));
    select(next.id);
    if (removed.children.length) toast(`Removed ${removed.text || 'idea'} and what was inside`, { action: { label: 'Undo', onClick: undoOnce } });
  }

  function toggle(id: string) {
    const n = findNode(docRef.current.root, id);
    if (!n?.children.length) return;
    setRoot(mapNode(docRef.current.root, id, (x) => ({ ...x, collapsed: !x.collapsed })));
  }

  function undoOnce() {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(docRef.current);
    commit(prev, false);
    if (!findNode(prev.root, selected)) setSelected(prev.root.id);
  }
  function redoOnce() {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(docRef.current);
    commit(next, false);
  }

  const actions: Actions = {
    select,
    edit: (id) => {
      typed.current = null;
      setSelected(id);
      setEditing(id);
    },
    commitText: (id, text, then) => {
      const t = text.trim();
      const current = findNode(docRef.current.root, id);
      setEditing(null);
      if (!current) return;
      if (!t && fresh.current === id && id !== docRef.current.root.id) {
        // An idea left empty right after adding it goes away.
        fresh.current = null;
        const parent = findParent(docRef.current.root, id);
        commit({ ...docRef.current, root: removeNode(docRef.current.root, id) }, false);
        undo.current.pop();
        if (parent) setSelected(parent.id);
        wrapper.current?.focus();
        return;
      }
      fresh.current = null;
      if (t !== current.text) setRoot(mapNode(docRef.current.root, id, (n) => ({ ...n, text: t })));
      if (id === docRef.current.root.id && t) onRootText?.(t);
      if (then === 'child') addChild(id);
      else if (then === 'sibling') addSibling(id);
      else wrapper.current?.focus();
    },
    cancelEdit: (id, draft) => {
      if (typed.current !== id) return actions.commitText(id, draft);
      typed.current = null;
      setEditing(null);
      undoOnce();
      wrapper.current?.focus();
    },
    toggle,
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || e.target !== wrapper.current) return;
    const root = docRef.current.root;
    const mod = e.metaKey || e.ctrlKey;
    const vis = visibleNodes(root);
    const here = vis.find((v) => v.node.id === selected) ?? vis[0]!;
    const siblings = here.parent ? here.parent.children : [root];
    const idx = siblings.findIndex((c) => c.id === here.node.id);
    const key = e.key;
    let handled = true;
    if (mod && key.toLowerCase() === 'z') {
      if (e.shiftKey) redoOnce();
      else undoOnce();
    }
    else if (mod && key.toLowerCase() === 'y') redoOnce();
    else if (mod) handled = false;
    else if (key === 'Tab' && !e.shiftKey) addChild(here.node.id);
    else if (key === 'Tab' && e.shiftKey && here.parent) select(here.parent.id);
    else if (key === 'Enter') addSibling(here.node.id);
    else if (key === 'F2') actions.edit(here.node.id);
    else if (key === 'Delete' || key === 'Backspace') remove(here.node.id);
    else if (key === ' ') toggle(here.node.id);
    else if (key === 'ArrowLeft' && here.parent) select(here.parent.id);
    else if (key === 'ArrowRight' && here.node.children.length) {
      if (here.node.collapsed) toggle(here.node.id);
      select(here.node.children[0]!.id);
    } else if (key === 'ArrowUp' && idx > 0) select(siblings[idx - 1]!.id);
    else if (key === 'ArrowDown' && idx < siblings.length - 1) select(siblings[idx + 1]!.id);
    else if (key === 'Home') select(root.id);
    else if (key.length === 1 && !e.altKey) {
      // Typing over a selected idea replaces its text, like a spreadsheet cell.
      typed.current = here.node.id;
      setRoot(mapNode(root, here.node.id, (n) => ({ ...n, text: key })));
      setEditing(here.node.id);
    } else handled = false;
    if (handled) e.preventDefault();
  }

  function onPaste(e: React.ClipboardEvent) {
    if (editing) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    e.preventDefault();
    if (!looksLikeOutline(text)) return addChild(selected, text.trim().slice(0, 2000));
    const sub = outlineToMindmap(text).root;
    // One top item: paste it as a branch. Several: paste them all.
    const branches = sub.text ? [sub] : sub.children;
    let root = docRef.current.root;
    for (const b of branches) root = insertNode(root, selected, b);
    setRoot(root);
    toast(`Added ${branches.length === 1 ? 'a branch' : `${branches.length} branches`} from the clipboard`);
  }

  // ── Drag to re-parent ─────────────────────────────────────────────────────
  function onNodesChange(changes: NodeChange<MindFlowNode>[]) {
    for (const c of changes) {
      if (c.type !== 'position' || !c.position) continue;
      if (c.dragging) {
        const me = byId.get(c.id)!;
        const cx = c.position.x + me.width / 2;
        const cy = c.position.y + me.height / 2;
        const own = findNode(docRef.current.root, c.id)!;
        const over = placed.find((p) => p.node.id !== c.id && !findNode(own, p.node.id) && cx > p.x && cx < p.x + p.width && cy > p.y - 8 && cy < p.y + p.height + 8);
        setDrag({ id: c.id, x: c.position.x, y: c.position.y, over: over?.node.id ?? null });
      }
    }
  }
  function onNodeDragStop() {
    if (drag?.over) {
      const target = findNode(docRef.current.root, drag.over);
      setRoot(moveNode(docRef.current.root, drag.id, drag.over));
      toast(`Moved under ${target?.text || 'that idea'}`, { action: { label: 'Undo', onClick: undoOnce } });
    }
    setDrag(null);
  }

  useImperativeHandle(ref, () => ({
    outline: () => mindmapToOutline(docRef.current),
    replaceFromOutline: (md) => {
      const next = outlineToMindmap(md, title, docRef.current.layout);
      commit(next);
      setSelected(next.root.id);
      setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1.1, duration: 200 }), 30);
    },
  }));

  const setLayout = (layout: MindmapLayout) => layout !== doc.layout && commit({ ...docRef.current, layout });

  return (
    <ActionsContext.Provider value={actions}>
      <div
        ref={wrapper}
        className="notey-mindmap absolute inset-0 outline-none"
        tabIndex={0}
        role="application"
        aria-roledescription="mindmap"
        aria-label={`Mindmap: ${doc.root.text || 'Central idea'}`}
        aria-describedby="mindmap-help"
        data-own-keys
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      >
        <p id="mindmap-help" className="sr-only">
          Arrow keys move between ideas. Tab adds an idea inside, Enter adds one next to it, F2 or typing edits, Space folds a branch, Delete removes.
        </p>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
        {sync.conflict && (
          <div className="absolute inset-x-0 top-4 z-10 px-4">
            <ConflictBar by={sync.conflict.by} onReload={() => void sync.reload()} onKeepMine={() => void sync.keepMine()} />
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => wrapper.current?.focus()}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          disableKeyboardA11y
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.25} color="var(--color-border)" />
        </ReactFlow>
        {editing && byId.get(editing) && <EditOverlay p={byId.get(editing)!} zoom={viewport.zoom} x={viewport.x} y={viewport.y} caretEnd={typed.current === editing} />}
        <div className="notey-mind-toolbar" role="toolbar" aria-label="Mindmap tools">
          <ToolButton label="Add idea inside (Tab)" onClick={() => addChild(selected)}>
            <Plus aria-hidden strokeWidth={1.5} />
          </ToolButton>
          <ToolButton label="Add idea next to it (Enter)" onClick={() => addSibling(selected)}>
            <CornerDownRight aria-hidden strokeWidth={1.5} />
          </ToolButton>
          <ToolButton label="Remove idea (Delete)" onClick={() => remove(selected)} disabled={selected === doc.root.id}>
            <Trash2 aria-hidden strokeWidth={1.5} />
          </ToolButton>
          <span className="notey-mind-sep" aria-hidden />
          <div role="radiogroup" aria-label="Layout" className="notey-mind-segment">
            {(['right', 'radial'] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={doc.layout === l} onClick={() => setLayout(l)}>
                {l === 'right' ? 'Left to right' : 'Radial'}
              </button>
            ))}
          </div>
          <span className="notey-mind-compact">
            <ToolButton
              label={doc.layout === 'right' ? 'Switch to radial layout' : 'Switch to left-to-right layout'}
              onClick={() => setLayout(doc.layout === 'right' ? 'radial' : 'right')}
            >
              {doc.layout === 'right' ? <Orbit aria-hidden strokeWidth={1.5} /> : <Network aria-hidden strokeWidth={1.5} />}
            </ToolButton>
          </span>
          <span className="notey-mind-sep" aria-hidden />
          <ToolButton label="Fit to screen" onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1.1, duration: 200 })}>
            <Maximize aria-hidden strokeWidth={1.5} />
          </ToolButton>
        </div>
      </div>
    </ActionsContext.Provider>
  );
});

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="notey-mind-tool">
      {children}
    </button>
  );
}

const MindmapPage = forwardRef<MindmapHandle, Props>(function MindmapPage(props, ref) {
  return (
    <ReactFlowProvider>
      <MindmapInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});

export default MindmapPage;
