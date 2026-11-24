/*
 * Chart blocks keep their data as CSV text in a block prop: the first row
 * names the columns, the first column names the categories, and each other
 * column is a series. In Markdown a chart is a fenced block:
 *
 *   ```chart
 *   type: bar
 *   title: Signups by month
 *   highlight: 2026
 *
 *   Month,2025,2026
 *   Jan,120,180
 *   ```
 */

export const chartKinds = ['bar', 'line', 'area', 'pie'] as const;
export type ChartKind = (typeof chartKinds)[number];
export type ChartSpec = { kind: ChartKind; title: string; highlight: string; data: string };

/** DESIGN.md: at most 4 series. */
export const MAX_SERIES = 4;
export const MAX_ROWS = 200;

function delimiter(text: string): string {
  const first = text.split('\n', 1)[0] ?? '';
  if (first.includes('\t')) return '\t';
  if (!first.includes(',') && first.includes(';')) return ';';
  return ',';
}

/** RFC 4180-ish CSV (or TSV from a spreadsheet paste) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const d = delimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

/** "1,200", "$12", "45%" → numbers; anything else is null. */
export function toNumber(s: string): number | null {
  const t = s.replace(/[\s,$€£¥%]/g, '');
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  return Number(t);
}

export type ChartData = {
  categoryKey: string;
  series: string[];
  rows: Record<string, string | number | null>[];
};

export function chartData(csv: string): ChartData {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const categoryKey = header[0] || 'Category';
  const series = header.slice(1, 1 + MAX_SERIES).map((s, i) => s || `Series ${i + 1}`);
  return {
    categoryKey,
    series,
    rows: rows.slice(1, 1 + MAX_ROWS).map((r) => {
      const o: Record<string, string | number | null> = { [categoryKey]: r[0] ?? '' };
      series.forEach((s, i) => (o[s] = toNumber(r[i + 1] ?? '')));
      return o;
    }),
  };
}

export function chartToMarkdown(spec: ChartSpec): string {
  const head = [`type: ${spec.kind}`];
  if (spec.title.trim()) head.push(`title: ${spec.title.trim()}`);
  if (spec.highlight.trim()) head.push(`highlight: ${spec.highlight.trim()}`);
  return `${head.join('\n')}\n\n${spec.data.trim()}`;
}

export function chartFromMarkdown(body: string): ChartSpec {
  const spec: ChartSpec = { kind: 'bar', title: '', highlight: '', data: '' };
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^\s*(type|title|highlight)\s*:\s*(.*)$/i.exec(lines[i]!);
    if (!m) break;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'type') spec.kind = (chartKinds as readonly string[]).includes(value.toLowerCase()) ? (value.toLowerCase() as ChartKind) : 'bar';
    else if (key === 'title') spec.title = value;
    else spec.highlight = value;
  }
  spec.data = lines.slice(i).join('\n').trim();
  return spec;
}
