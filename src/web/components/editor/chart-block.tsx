import { createReactBlockSpec } from '@blocknote/react';
import { Minus, Plus } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { chartData, chartKinds, MAX_SERIES, parseCsv, toCsv, type ChartKind, type ChartSpec } from '@shared/chart';
import { Button } from '@web/components/ui/button';
import { cn } from '@web/lib/cn';

const ChartView = lazy(() => import('./chart-view'));

const KIND_LABEL: Record<ChartKind, string> = { bar: 'Bar', line: 'Line', area: 'Area', pie: 'Pie' };

/** A starting point that reads like real work, so the chart shows something at once. */
export const SAMPLE_CHART = 'Month,Plan,Actual\nJul,40,38\nAug,45,47\nSep,50,52\nOct,55,61\nNov,60,66';

const inputClass =
  'h-control-sm min-w-0 rounded-sm bg-surface-raised px-2 text-label text-on-surface ring-1 ring-border outline-none focus:ring-2 focus:ring-primary';

function Grid({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const width = Math.max(2, ...rows.map((r) => r.length));
  const norm = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
  const set = (ri: number, ci: number, v: string) => onChange(norm.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)));

  // Pasting cells from a spreadsheet (or CSV) fills the grid from that cell.
  const paste = (ri: number, ci: number, e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n,;]/.test(text.trim())) return;
    e.preventDefault();
    const block = parseCsv(text);
    const next = norm.map((r) => [...r]);
    block.forEach((br, i) => {
      const row = (next[ri + i] ??= Array(width).fill(''));
      br.slice(0, 1 + MAX_SERIES - ci).forEach((v, j) => (row[ci + j] = v));
    });
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <tbody>
            {norm.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>
                    <input
                      value={c}
                      aria-label={ri === 0 ? (ci === 0 ? 'Category column name' : `Series ${ci} name`) : `Row ${ri}, ${norm[0]![ci] || `column ${ci + 1}`}`}
                      onChange={(e) => set(ri, ci, e.target.value)}
                      onPaste={(e) => paste(ri, ci, e)}
                      className={cn(inputClass, 'w-24', ri === 0 && 'font-medium', ci > 0 && ri > 0 && 'tnum text-right')}
                    />
                  </td>
                ))}
                <td>
                  {ri > 0 && (
                    <button
                      type="button"
                      aria-label={`Remove row ${ri}`}
                      onClick={() => onChange(norm.filter((_, i) => i !== ri))}
                      className="grid size-7 place-items-center rounded-md text-on-surface-subtle hover:bg-neutral"
                    >
                      <Minus className="size-3.5" aria-hidden />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => onChange([...norm, Array(width).fill('')])}>
          <Plus className="size-3.5" aria-hidden /> Row
        </Button>
        <Button size="sm" variant="ghost" disabled={width >= 1 + MAX_SERIES} onClick={() => onChange(norm.map((r, i) => [...r, i === 0 ? `Series ${width}` : '']))}>
          <Plus className="size-3.5" aria-hidden /> Series
        </Button>
        {width > 2 && (
          <Button size="sm" variant="ghost" onClick={() => onChange(norm.map((r) => r.slice(0, -1)))}>
            <Minus className="size-3.5" aria-hidden /> Last series
          </Button>
        )}
      </div>
      <p className="text-meta text-on-surface-subtle">Paste cells from a spreadsheet or CSV into any box. Up to {MAX_SERIES} series.</p>
    </div>
  );
}

function ChartEditor({ spec, onChange, onDone }: { spec: ChartSpec; onChange: (s: ChartSpec) => void; onDone: () => void }) {
  const rows = parseCsv(spec.data);
  const { series, rows: data, categoryKey } = chartData(spec.data);
  const options = spec.kind === 'pie' ? data.map((r) => String(r[categoryKey])) : series;
  return (
    <div
      className="mt-2 flex flex-col gap-3 rounded-md bg-neutral p-3"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Chart type" className="flex gap-0.5 rounded-md bg-surface p-0.5 ring-1 ring-border">
          {chartKinds.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={spec.kind === k}
              onClick={() => onChange({ ...spec, kind: k })}
              className={cn('h-control-sm rounded-sm px-3 text-label', spec.kind === k ? 'bg-primary font-medium text-on-primary' : 'text-on-surface-muted hover:bg-neutral')}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-label text-on-surface-muted">
          Title
          <input value={spec.title} maxLength={120} onChange={(e) => onChange({ ...spec, title: e.target.value })} placeholder="Signups by month" className={cn(inputClass, 'flex-1')} />
        </label>
        <label className="flex items-center gap-2 text-label text-on-surface-muted">
          Highlight
          <select value={options.includes(spec.highlight) ? spec.highlight : ''} onChange={(e) => onChange({ ...spec, highlight: e.target.value })} className={inputClass}>
            <option value="">{spec.kind === 'pie' ? 'Largest slice' : 'None'}</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Grid rows={rows.length ? rows : [['Category', 'Value']]} onChange={(r) => onChange({ ...spec, data: toCsv(r.filter((row, i) => i === 0 || row.some((c) => c.trim()))) })} />
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** PRD 6.10: bar, line, area or pie from a small grid or pasted CSV. Markdown: a ```chart fence. */
export const ChartBlock = createReactBlockSpec(
  {
    type: 'chart',
    propSchema: {
      kind: { default: 'bar' as ChartKind, values: chartKinds },
      title: { default: '' },
      highlight: { default: 'Actual' },
      data: { default: SAMPLE_CHART },
    },
    content: 'none',
  },
  {
    render: function Render({ block, editor }) {
      const saved: ChartSpec = { kind: block.props.kind, title: block.props.title, highlight: block.props.highlight, data: block.props.data };
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState(saved);
      const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
      const spec = editing ? draft : saved;

      // Edits save shortly after you stop, so the doc's autosave picks them up.
      const change = (next: ChartSpec) => {
        setDraft(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => editor.updateBlock(block, { props: next }), 400);
      };
      const done = () => {
        clearTimeout(timer.current);
        editor.updateBlock(block, { props: draft });
        setEditing(false);
      };
      useEffect(() => () => clearTimeout(timer.current), []);

      return (
        <div className="notey-embed w-full" contentEditable={false} data-editing={editing || undefined}>
          <div className="flex items-center gap-2 pb-1">
            <p className="min-w-0 flex-1 truncate text-label font-medium text-on-surface">{spec.title}</p>
            {!editing && editor.isEditable && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(saved);
                  setEditing(true);
                }}
              >
                Edit data
              </Button>
            )}
          </div>
          <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-neutral" aria-label="Loading chart" />}>
            <ChartView spec={spec} />
          </Suspense>
          {editing && <ChartEditor spec={draft} onChange={change} onDone={done} />}
        </div>
      );
    },
  },
);
