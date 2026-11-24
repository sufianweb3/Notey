import '@excalidraw/excalidraw/index.css';
import './canvas.css';
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  hashElementsVersion,
  MainMenu,
  reconcileElements,
  restoreElements,
} from '@excalidraw/excalidraw';
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { StickyNote } from 'lucide-react';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { toast } from 'sonner';
import { describeCanvas, emptyCanvas, STICKY, type CanvasContent, type CanvasElement, type CanvasFile } from '@shared/canvas';
import type { PageDetail } from '@shared/schemas';
import { ConflictBar } from '@web/components/shell/conflict-bar';
import { SCENE } from '@web/lib/excalidraw';
import { usePageSync, type SaveState } from '@web/lib/page-sync';
import { useResolvedTheme } from '@web/lib/prefs';
import { upload } from '@web/lib/upload';

export type CanvasHandle = {
  exportImage: (format: 'png' | 'svg') => Promise<void>;
  describe: () => { summary: string; lines: string[] };
};

type Props = {
  ws: string;
  page: PageDetail;
  title: string;
  onSaveState: (s: SaveState) => void;
  onRemote: (page: PageDetail) => void;
};

/** Deleted elements are kept a day so a merge with another tab can't bring them back. */
const KEEP_DELETED_MS = 24 * 60 * 60_000;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const CanvasPage = forwardRef<CanvasHandle, Props>(function CanvasPage({ ws, page, title, onSaveState, onRemote }, ref) {
  const theme = useResolvedTheme();
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const initial = useRef<CanvasContent>((page.content as CanvasContent | null) ?? emptyCanvas());
  const files = useRef<Record<string, CanvasFile>>({ ...initial.current.files });
  const loadedFiles = useRef(new Set<string>());
  const uploading = useRef(new Set<string>());
  const version = useRef(hashElementsVersion(initial.current.elements as unknown as ExcalidrawElement[]));
  const applying = useRef(false);

  function read(): CanvasContent {
    const now = Date.now();
    const all = api.current?.getSceneElementsIncludingDeleted() ?? [];
    const elements = all.filter((e) => !e.isDeleted || now - (e.updated ?? 0) < KEEP_DELETED_MS) as unknown as CanvasElement[];
    const used = new Set(all.filter((e) => !e.isDeleted && e.type === 'image').map((e) => (e as { fileId?: string }).fileId));
    return {
      kind: 'canvas',
      elements,
      files: Object.fromEntries(Object.entries(files.current).filter(([id]) => used.has(id))),
    };
  }

  /** Images are stored as workspace files; the scene loads them back as data URLs. */
  async function loadFiles(map: Record<string, CanvasFile>) {
    const missing = Object.entries(map).filter(([id]) => !loadedFiles.current.has(id));
    if (!missing.length) return;
    const out: BinaryFileData[] = [];
    await Promise.all(
      missing.map(async ([id, f]) => {
        try {
          const res = await fetch(f.url, { credentials: 'same-origin' });
          if (!res.ok) return;
          out.push({ id: id as BinaryFileData['id'], mimeType: f.mimeType as BinaryFileData['mimeType'], dataURL: (await blobToDataUrl(await res.blob())) as BinaryFileData['dataURL'], created: Date.now() });
          loadedFiles.current.add(id);
        } catch {
          /* shows as a broken image; the next load tries again */
        }
      }),
    );
    if (out.length) api.current?.addFiles(out);
  }

  async function uploadNew(binary: BinaryFiles) {
    for (const [id, f] of Object.entries(binary)) {
      if (files.current[id] || uploading.current.has(id)) continue;
      uploading.current.add(id);
      try {
        const blob = await (await fetch(f.dataURL)).blob();
        const ext = f.mimeType.split('/')[1]?.replace('svg+xml', 'svg') ?? 'png';
        const url = await upload(ws, blob, `canvas-image.${ext}`);
        files.current[id] = { mimeType: f.mimeType, url };
        loadedFiles.current.add(id);
        sync.markDirty();
      } catch {
        /* upload() already showed why */
      } finally {
        uploading.current.delete(id);
      }
    }
  }

  function setScene(elements: readonly ExcalidrawElement[]) {
    applying.current = true;
    api.current?.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    version.current = hashElementsVersion(elements);
    applying.current = false;
  }

  const sync = usePageSync({
    ws,
    page,
    read,
    onSaveState,
    onRemote,
    apply: (next) => {
      const c = (next.content as CanvasContent | null) ?? emptyCanvas();
      Object.assign(files.current, c.files);
      setScene(restoreElements(c.elements as unknown as ExcalidrawElement[], null));
      void loadFiles(c.files);
    },
    // Two tabs drawing at once: keep both sides, element by element (newest version wins).
    merge: (remote) => {
      const c = (remote.content as CanvasContent | null) ?? emptyCanvas();
      Object.assign(files.current, c.files);
      const local = api.current?.getSceneElementsIncludingDeleted() ?? [];
      const merged = reconcileElements(
        local,
        restoreElements(c.elements as unknown as ExcalidrawElement[], null) as unknown as Parameters<typeof reconcileElements>[1],
        api.current!.getAppState(),
      );
      setScene(merged);
      void loadFiles(c.files);
      return read();
    },
  });

  function onChange(elements: readonly OrderedExcalidrawElement[], _state: AppState, binary: BinaryFiles) {
    if (applying.current) return;
    const v = hashElementsVersion(elements);
    if (v !== version.current) {
      version.current = v;
      sync.markDirty();
    }
    if (Object.keys(binary).some((id) => !files.current[id])) void uploadNew(binary);
  }

  function addSticky() {
    const x = api.current;
    if (!x) return;
    const { scrollX, scrollY, zoom, width, height } = x.getAppState();
    let cx = -scrollX + width / 2 / zoom.value;
    let cy = -scrollY + height / 2 / zoom.value;
    // Step aside from anything already at the centre, so the note doesn't hide it.
    const boxes = x.getSceneElements().map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }));
    const hits = () => boxes.some((b) => cx - 100 < b.x + b.w && cx + 100 > b.x && cy - 80 < b.y + b.h && cy + 80 > b.y);
    for (let i = 0; i < 12 && hits(); i++) {
      cx += 40;
      cy += 40;
    }
    const created = convertToExcalidrawElements([
      {
        type: 'rectangle',
        x: cx - 100,
        y: cy - 80,
        width: 200,
        height: 160,
        backgroundColor: SCENE.wash,
        fillStyle: 'solid',
        strokeColor: 'transparent',
        roughness: 0,
        roundness: { type: 3 },
        customData: { notey: STICKY },
        // The note has no outline; its text still needs ink.
        label: { text: ' ', fontSize: 20, textAlign: 'left', verticalAlign: 'top', strokeColor: SCENE.ink },
      },
    ]);
    const rect = created[0]!;
    x.updateScene({
      elements: [...x.getSceneElementsIncludingDeleted(), ...created],
      appState: { selectedElementIds: { [rect.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    toast('Sticky note added', { description: 'Press Enter to write on it.' });
  }

  useImperativeHandle(ref, () => ({
    describe: () => describeCanvas(read()),
    exportImage: async (format) => {
      const x = api.current;
      if (!x) return;
      const elements = x.getSceneElements();
      if (!elements.length) return void toast('Nothing to export yet. Draw something first.');
      const appState = { ...x.getAppState(), exportBackground: true, viewBackgroundColor: SCENE.paper, exportWithDarkMode: false };
      const name = (title || 'Canvas').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Canvas';
      try {
        if (format === 'png') download(await exportToBlob({ elements, appState, files: x.getFiles(), mimeType: 'image/png', exportPadding: 24 }), `${name}.png`);
        else {
          const svg = await exportToSvg({ elements, appState, files: x.getFiles(), exportPadding: 24 });
          download(new Blob([svg.outerHTML], { type: 'image/svg+xml' }), `${name}.svg`);
        }
      } catch {
        toast.error("Couldn't export the canvas. Try again.");
      }
    },
  }));

  return (
    <div className="notey-canvas absolute inset-0 flex flex-col" data-own-keys>
      {sync.conflict && (
        <div className="absolute inset-x-0 top-16 z-10 px-4">
          <ConflictBar by={sync.conflict.by} onReload={() => void sync.reload()} onKeepMine={() => void sync.keepMine()} />
        </div>
      )}
      <Excalidraw
        excalidrawAPI={(a) => {
          const first = !api.current;
          api.current = a;
          if (first) void loadFiles(initial.current.files);
        }}
        initialData={{
          elements: restoreElements(initial.current.elements as unknown as ExcalidrawElement[], null),
          appState: { viewBackgroundColor: SCENE.paper, currentItemStrokeColor: SCENE.ink, currentItemRoughness: 1 },
          scrollToContent: true,
        }}
        onChange={onChange}
        theme={theme}
        name={title || 'Canvas'}
        langCode="en"
        aiEnabled={false}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: null, changeViewBackgroundColor: false, export: false, saveAsImage: true, clearCanvas: true },
          tools: { image: true },
        }}
        renderTopRightUI={() => (
          <button type="button" className="notey-canvas-sticky" onClick={addSticky} aria-label="Add sticky note" title="Sticky note">
            <StickyNote aria-hidden strokeWidth={1.5} />
          </button>
        )}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  );
});

export default CanvasPage;
