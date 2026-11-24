import './preview.css';
import { useEffect, useRef, useState } from 'react';
import type { CanvasContent } from '@shared/canvas';
import type { MindmapContent } from '@shared/mindmap';
import type { PageType } from '@shared/schemas';
import { loadExcalidraw } from '@web/lib/excalidraw';
import { useResolvedTheme } from '@web/lib/prefs';
import { bounds, layoutMindmap } from '@web/components/mindmap/layout';

/** Read-only picture of a canvas or mindmap: doc embeds and page history. */
export default function ContentPreview({ type, content, className }: { type: PageType; content: unknown; className?: string }) {
  if (type === 'canvas') return <CanvasPreview content={content as CanvasContent | null} className={className} />;
  if (type === 'mindmap') return <MindmapPreview content={content as MindmapContent | null} className={className} />;
  return null;
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-meta text-on-surface-subtle">{label}</p>;
}

export function CanvasPreview({ content, className }: { content: CanvasContent | null; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();
  const live = content?.elements.filter((e) => !e.isDeleted) ?? [];
  const key = `${theme}:${JSON.stringify(live.map((e) => [e.id, e.version]))}`;
  // The drawn result belongs to one scene version; anything else is still loading.
  const [result, setResult] = useState<{ key: string; ok: boolean } | null>(null);
  const state = !live.length ? 'empty' : result?.key !== key ? 'loading' : result.ok ? 'ready' : 'error';

  useEffect(() => {
    if (!live.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const x = await loadExcalidraw();
        // Images: fetch each workspace file once into a data URL.
        const files: Record<string, { id: string; mimeType: string; dataURL: string; created: number }> = {};
        await Promise.all(
          Object.entries(content!.files ?? {}).map(async ([id, f]) => {
            const res = await fetch(f.url, { credentials: 'same-origin' });
            if (!res.ok) return;
            const blob = await res.blob();
            const dataURL = await new Promise<string>((ok) => {
              const r = new FileReader();
              r.onload = () => ok(String(r.result));
              r.readAsDataURL(blob);
            });
            files[id] = { id, mimeType: f.mimeType, dataURL, created: Date.now() };
          }),
        );
        const svg = await x.exportToSvg({
          elements: x.restoreElements(live as never, null),
          appState: { exportBackground: false, exportWithDarkMode: theme === 'dark', viewBackgroundColor: 'transparent' },
          files: files as never,
          exportPadding: 16,
        });
        if (cancelled || !host.current) return;
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.width = '100%';
        svg.style.height = '100%';
        host.current.replaceChildren(svg);
        setResult({ key, ok: true });
      } catch {
        if (!cancelled) setResult({ key, ok: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className}>
      {state === 'empty' && <Empty label="Empty canvas" />}
      {state === 'error' && <Empty label="Couldn't draw this preview." />}
      {state === 'loading' && <div className="h-full min-h-32 animate-pulse rounded-md bg-neutral" aria-label="Loading preview" />}
      <div ref={host} className={state === 'ready' ? 'h-full' : 'hidden'} />
    </div>
  );
}

export function MindmapPreview({ content, className }: { content: MindmapContent | null; className?: string }) {
  if (!content) return <Empty label="Empty mindmap" />;
  const placed = layoutMindmap(content.root, content.layout);
  const b = bounds(placed);
  const pad = 16;
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  return (
    <div className={className}>
      <svg
        viewBox={`${b.minX - pad} ${b.minY - pad} ${b.width + pad * 2} ${b.height + pad * 2}`}
        className="notey-mind-preview h-full w-full"
        role="img"
        aria-label={`Mindmap: ${content.root.text || 'Central idea'}`}
      >
        {placed
          .filter((p) => p.parentId)
          .map((p) => {
            const parent = byId.get(p.parentId!)!;
            if (content.layout === 'radial') {
              return <line key={`e${p.node.id}`} x1={parent.x + parent.width / 2} y1={parent.y + parent.height / 2} x2={p.x + p.width / 2} y2={p.y + p.height / 2} />;
            }
            const x1 = parent.x + parent.width;
            const y1 = parent.y + parent.height / 2;
            const x2 = p.x;
            const y2 = p.y + p.height / 2;
            const mx = (x1 + x2) / 2;
            return <path key={`e${p.node.id}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
          })}
        {placed.map((p) => (
          <g key={p.node.id} data-depth={Math.min(p.depth, 2)}>
            <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={p.depth === 0 ? 12 : 8} />
            <foreignObject x={p.x} y={p.y} width={p.width} height={p.height}>
              <div className="notey-mind-preview-text">{p.node.text || (p.depth === 0 ? 'Central idea' : 'New idea')}</div>
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  );
}
