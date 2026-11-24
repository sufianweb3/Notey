import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartData, type ChartSpec } from '@shared/chart';

/*
 * DESIGN.md § Charts: charcoal, on-surface-muted and border-strong, with
 * lime for the highlighted series. Pie: charcoal shades plus lime for one
 * slice. Colours are CSS variables, so dark mode follows on its own.
 */
const NEUTRALS = ['var(--color-on-surface)', 'var(--color-on-surface-muted)', 'var(--color-border-strong)'];
const LIME = 'var(--color-accent)';
const PIE_SHADES = [
  'var(--color-on-surface)',
  'color-mix(in oklab, var(--color-on-surface) 72%, var(--color-surface))',
  'color-mix(in oklab, var(--color-on-surface) 52%, var(--color-surface))',
  'color-mix(in oklab, var(--color-on-surface) 34%, var(--color-surface))',
  'color-mix(in oklab, var(--color-on-surface) 20%, var(--color-surface))',
];

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function seriesColors(series: string[], highlight: string): string[] {
  let n = 0;
  const hasHighlight = series.includes(highlight);
  return series.map((s) => {
    if (s === highlight) return LIME;
    const c = NEUTRALS[n++];
    // Without a highlight, a fourth series takes the lime.
    return c ?? (hasHighlight ? NEUTRALS[2]! : LIME);
  });
}

const axis = { stroke: 'var(--color-border)', tick: { fill: 'var(--color-on-surface-muted)', fontSize: 12 }, tickLine: false } as const;
const tooltipStyle = {
  contentStyle: {
    background: 'var(--color-surface-overlay)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    color: 'var(--color-on-surface)',
    fontSize: 13,
    boxShadow: 'var(--shadow-2)',
  },
  itemStyle: { color: 'var(--color-on-surface)' },
  labelStyle: { color: 'var(--color-on-surface-muted)' },
  cursor: { fill: 'var(--color-neutral)', stroke: 'var(--color-border)' },
  formatter: (v: unknown) => (typeof v === 'number' ? full.format(v) : String(v ?? '')),
};
const legend = { iconType: 'circle' as const, iconSize: 8, wrapperStyle: { fontSize: 12, color: 'var(--color-on-surface-muted)' } };

export default function ChartView({ spec }: { spec: ChartSpec }) {
  const { categoryKey, series, rows } = chartData(spec.data);
  if (!rows.length || !series.length) {
    return <p className="py-10 text-center text-meta text-on-surface-subtle">Add a row of numbers to draw the chart.</p>;
  }
  const colors = seriesColors(series, spec.highlight);
  const many = series.length > 1;

  let chart: React.ReactElement;
  if (spec.kind === 'pie') {
    const s = series[0]!;
    const slices = rows.map((r) => ({ name: String(r[categoryKey]), value: Math.max(0, Number(r[s]) || 0) }));
    const top = slices.reduce((a, b) => (b.value > a.value ? b : a), slices[0]!).name;
    const lit = slices.some((x) => x.name === spec.highlight) ? spec.highlight : top;
    let shade = 0;
    chart = (
      <PieChart>
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="80%" paddingAngle={1} stroke="var(--color-surface)" strokeWidth={2} isAnimationActive={false}>
          {slices.map((x) => (
            <Cell key={x.name} fill={x.name === lit ? LIME : PIE_SHADES[shade++ % PIE_SHADES.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend {...legend} />
      </PieChart>
    );
  } else {
    const common = { data: rows, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
    const x = <XAxis dataKey={categoryKey} {...axis} />;
    const y = <YAxis {...axis} axisLine={false} width={44} tickFormatter={(v: number) => compact.format(v)} />;
    const grid = <CartesianGrid vertical={false} stroke="var(--color-border)" />;
    if (spec.kind === 'line')
      chart = (
        <LineChart {...common}>
          {grid}
          {x}
          {y}
          <Tooltip {...tooltipStyle} />
          {many && <Legend {...legend} />}
          {series.map((s, i) => (
            <Line key={s} type="monotone" dataKey={s} stroke={colors[i]} strokeWidth={s === spec.highlight ? 3 : 2} dot={false} isAnimationActive={false} connectNulls />
          ))}
        </LineChart>
      );
    else if (spec.kind === 'area')
      chart = (
        <AreaChart {...common}>
          {grid}
          {x}
          {y}
          <Tooltip {...tooltipStyle} />
          {many && <Legend {...legend} />}
          {series.map((s, i) => (
            <Area key={s} type="monotone" dataKey={s} stroke={colors[i]} fill={colors[i]} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} connectNulls />
          ))}
        </AreaChart>
      );
    else
      chart = (
        <BarChart {...common} barCategoryGap="24%">
          {grid}
          {x}
          {y}
          <Tooltip {...tooltipStyle} />
          {many && <Legend {...legend} />}
          {series.map((s, i) => (
            <Bar key={s} dataKey={s} fill={colors[i]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      );
  }

  const label = `${spec.title || 'Chart'}: ${spec.kind} chart of ${series.join(', ')} by ${categoryKey}, ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  return (
    <figure className="m-0">
      <div role="img" aria-label={label} className="h-64 w-full tnum">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
      {/* The numbers, for screen readers. */}
      <div className="sr-only">
      <table>
        <caption>{spec.title || 'Chart data'}</caption>
        <thead>
          <tr>
            <th scope="col">{categoryKey}</th>
            {series.map((s) => (
              <th key={s} scope="col">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row">{String(r[categoryKey])}</th>
              {series.map((s) => (
                <td key={s}>{r[s] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
