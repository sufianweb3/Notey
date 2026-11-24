/*
 * Recurrence for repeating tasks (PRD 6.5): a small, strict subset of RFC 5545
 * RRULE. The `rrule` package is BSD-3-Clause, outside the allowed licences, so
 * Notey ships its own. Dates are calendar dates ("YYYY-MM-DD"), no time zones.
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY; INTERVAL; BYDAY (weekly: MO,TH;
 * monthly: 1MO, -1FR); BYMONTHDAY (1–31 or -1 for the last day); COUNT; UNTIL.
 */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type WeekdayRule = { day: number; n?: number }; // day: 0 = Sunday … 6 = Saturday
export type Rule = {
  freq: Freq;
  interval: number;
  byDay?: WeekdayRule[];
  byMonthDay?: number[];
  count?: number;
  until?: string;
};

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_SCAN_DAYS = 366 * 30; // a 30-year horizon covers any yearly rule with an interval

export class RRuleError extends Error {}

// ── Calendar-date helpers (UTC arithmetic, so DST never shifts a day) ───────

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toUtc = (s: string) => new Date(`${s}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export const weekday = (date: string) => toUtc(date).getUTCDay();
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const parts = (date: string) => {
  const d = toUtc(date);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};

/** Local calendar date for a JS Date, as the owner's device sees it. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Parse and format ────────────────────────────────────────────────────────

export function parseRRule(input: string): Rule {
  const fields = new Map<string, string>();
  for (const part of input.trim().replace(/^RRULE:/i, '').split(';')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (!k || v === undefined) throw new RRuleError(`Bad part "${part}"`);
    fields.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = fields.get('FREQ') as Freq | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw new RRuleError('FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY');
  for (const k of fields.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST'].includes(k)) throw new RRuleError(`${k} is not supported`);
  }
  const interval = Number(fields.get('INTERVAL') ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) throw new RRuleError('INTERVAL must be 1–999');
  const rule: Rule = { freq, interval };

  const byDay = fields.get('BYDAY');
  if (byDay) {
    rule.byDay = byDay.split(',').map((tok) => {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok);
      if (!m) throw new RRuleError(`Bad BYDAY "${tok}"`);
      const n = m[1] ? Number(m[1]) : undefined;
      if (n !== undefined && (n === 0 || Math.abs(n) > 5 || freq !== 'MONTHLY')) throw new RRuleError(`"${tok}" needs FREQ=MONTHLY and a position from -5 to 5`);
      return n === undefined ? { day: DAYS.indexOf(m[2] as (typeof DAYS)[number]) } : { day: DAYS.indexOf(m[2] as (typeof DAYS)[number]), n };
    });
    if (freq === 'DAILY' || freq === 'YEARLY') throw new RRuleError('BYDAY works with WEEKLY or MONTHLY');
  }
  const byMonthDay = fields.get('BYMONTHDAY');
  if (byMonthDay) {
    if (freq !== 'MONTHLY') throw new RRuleError('BYMONTHDAY needs FREQ=MONTHLY');
    rule.byMonthDay = byMonthDay.split(',').map((v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n === 0 || n < -1 || n > 31) throw new RRuleError(`Bad BYMONTHDAY "${v}"`);
      return n;
    });
  }
  if (fields.has('COUNT')) {
    const c = Number(fields.get('COUNT'));
    if (!Number.isInteger(c) || c < 1) throw new RRuleError('COUNT must be a positive number');
    rule.count = c;
  }
  const until = fields.get('UNTIL');
  if (until) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(until);
    if (!m) throw new RRuleError('UNTIL must look like 20261231');
    rule.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return rule;
}

export function formatRRule(rule: Rule): string {
  const out = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) out.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) out.push(`BYDAY=${rule.byDay.map((d) => `${d.n ?? ''}${DAYS[d.day]}`).join(',')}`);
  if (rule.byMonthDay?.length) out.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.count) out.push(`COUNT=${rule.count}`);
  if (rule.until) out.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  return out.join(';');
}

export function isValidRRule(s: string): boolean {
  try {
    parseRRule(s);
    return true;
  } catch {
    return false;
  }
}

// ── Matching ────────────────────────────────────────────────────────────────

function nthWeekdayMatches(date: string, w: WeekdayRule): boolean {
  if (weekday(date) !== w.day) return false;
  if (w.n === undefined) return true;
  const { y, m, d } = parts(date);
  if (w.n > 0) return Math.ceil(d / 7) === w.n;
  return Math.ceil((daysInMonth(y, m) - d + 1) / 7) === -w.n;
}

/** Does `date` fall on the rule's pattern, with `anchor` as the series start? */
export function matches(rule: Rule, anchor: string, date: string): boolean {
  if (date < anchor) return false;
  if (rule.until && date > rule.until) return false;
  const a = parts(anchor);
  const t = parts(date);
  switch (rule.freq) {
    case 'DAILY':
      return diffDays(anchor, date) % rule.interval === 0;
    case 'WEEKLY': {
      // Weeks start on Monday (RRULE's default WKST).
      const monday = (s: string) => addDays(s, -((weekday(s) + 6) % 7));
      const weeks = diffDays(monday(anchor), monday(date)) / 7;
      if (weeks % rule.interval !== 0) return false;
      const days = rule.byDay?.length ? rule.byDay.map((b) => b.day) : [weekday(anchor)];
      return days.includes(weekday(date));
    }
    case 'MONTHLY': {
      const months = (t.y - a.y) * 12 + (t.m - a.m);
      if (months % rule.interval !== 0) return false;
      if (rule.byDay?.length) return rule.byDay.some((w) => nthWeekdayMatches(date, w));
      const dim = daysInMonth(t.y, t.m);
      const wanted = rule.byMonthDay?.length ? rule.byMonthDay : [a.d];
      // "On the 31st" lands on the last day of shorter months; -1 is always the last day.
      return wanted.some((n) => (n === -1 ? t.d === dim : t.d === Math.min(n, dim)));
    }
    case 'YEARLY': {
      if ((t.y - a.y) % rule.interval !== 0 || t.m !== a.m) return false;
      return t.d === Math.min(a.d, daysInMonth(t.y, t.m)); // 29 Feb → 28 Feb in common years
    }
  }
}

/**
 * First occurrence strictly after `after`, or null when the series has ended
 * (COUNT reached, UNTIL passed, or nothing within 30 years).
 */
export function nextOccurrence(rule: Rule, anchor: string, after: string): string | null {
  let seen = 0;
  // COUNT needs the occurrences before `after` counted from the start.
  let date = rule.count ? anchor : addDays(after < anchor ? addDays(anchor, -1) : after, 1);
  for (let i = 0; i < MAX_SCAN_DAYS; i++, date = addDays(date, 1)) {
    if (rule.until && date > rule.until) return null;
    if (!matches(rule, anchor, date)) continue;
    seen++;
    if (rule.count && seen > rule.count) return null;
    if (date > after) return date;
  }
  return null;
}

/** First occurrence on or after `from` (used to place a new repeating task). */
export function firstOnOrAfter(rule: Rule, anchor: string, from: string): string | null {
  return nextOccurrence(rule, anchor, addDays(from, -1));
}

// ── Human labels ────────────────────────────────────────────────────────────

const ordinal = (n: number) => {
  if (n === -1) return 'last day';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const POS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last', [-2]: 'second-to-last' } as Record<number, string>;
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Daily", "Weekdays", "Every 2 weeks on Mon, Thu", "Monthly on the 1st", "Monthly on the last Friday". */
export function describeRule(rule: Rule): string {
  const every = (unit: string, plural: string) => (rule.interval === 1 ? unit : `Every ${rule.interval} ${plural}`);
  let text: string;
  switch (rule.freq) {
    case 'DAILY':
      text = every('Daily', 'days');
      break;
    case 'WEEKLY': {
      const days = rule.byDay?.map((d) => d.day).sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)) ?? [];
      if (rule.interval === 1 && days.join() === '1,2,3,4,5') text = 'Weekdays';
      else if (rule.interval === 1 && days.join() === '6,0') text = 'Weekends';
      else text = `${every('Weekly', 'weeks')}${days.length ? ` on ${days.map((d) => DAY_NAMES[d]).join(', ')}` : ''}`;
      break;
    }
    case 'MONTHLY': {
      const base = every('Monthly', 'months');
      if (rule.byDay?.length) {
        text = `${base} on the ${rule.byDay.map((d) => `${POS[d.n ?? 1] ?? ordinal(d.n ?? 1)} ${FULL_DAYS[d.day]}`).join(', ')}`;
      } else if (rule.byMonthDay?.length) {
        text = `${base} on the ${rule.byMonthDay.map(ordinal).join(', ')}`;
      } else text = base;
      break;
    }
    case 'YEARLY':
      text = every('Yearly', 'years');
      break;
  }
  if (rule.count) text += `, ${rule.count} times`;
  if (rule.until) text += `, until ${rule.until}`;
  return text;
}

export function describeRRule(s: string | null | undefined): string | null {
  if (!s) return null;
  try {
    return describeRule(parseRRule(s));
  } catch {
    return 'Custom';
  }
}
