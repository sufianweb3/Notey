import * as chrono from 'chrono-node';
import { firstOnOrAfter, formatRRule, localDate, parseRRule, type Rule, type WeekdayRule } from './recurrence';

/*
 * Quick add (PRD 6.5): "Call Rafi tomorrow 3pm", "Review logs every day",
 * "Pay rent every month on 1st". Repeat phrases are matched here; dates and
 * times come from chrono-node (MIT). Pure JS, so agents can use it later too.
 */

export type QuickAdd = { title: string; dueDate: string | null; dueTime: string | null; rrule: string | null };

const DAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const DAY_RE = Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length).join('|');
const NUM_WORDS: Record<string, number> = { other: 2, two: 2, three: 3, four: 4, five: 5, six: 6 };
const POSITIONS: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, last: -1 };

type RepeatMatch = { rule: Rule; start: number; end: number };

function matchRepeat(text: string): RepeatMatch | null {
  const t = text.toLowerCase();
  const tries: [RegExp, (m: RegExpExecArray) => Rule | null][] = [
    // every weekday / weekdays
    [/\b(?:every\s+weekday|on\s+weekdays|weekdays)\b/, () => ({ freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5].map((day) => ({ day })) })],
    [/\b(?:every\s+weekend|on\s+weekends|weekends)\b/, () => ({ freq: 'WEEKLY', interval: 1, byDay: [6, 0].map((day) => ({ day })) })],
    // every last friday (of the month) / every first monday
    [
      new RegExp(`\\bevery\\s+(first|1st|second|2nd|third|3rd|fourth|4th|last)\\s+(${DAY_RE})(?:\\s+of\\s+(?:the|every)\\s+month)?\\b`),
      (m) => ({ freq: 'MONTHLY', interval: 1, byDay: [{ day: DAY_WORDS[m[2]!]!, n: POSITIONS[m[1]!]! }] }),
    ],
    // every monday and thursday / every mon, wed, fri / every other monday
    [
      new RegExp(`\\bevery\\s+(?:(other|two|three)\\s+)?((?:${DAY_RE})(?:\\s*(?:,|and|&)\\s*(?:${DAY_RE}))*)\\b`),
      (m) => {
        const days = m[2]!.split(/\s*(?:,|and|&)\s*/).map((d) => DAY_WORDS[d.trim()]).filter((d): d is number => d !== undefined);
        const byDay: WeekdayRule[] = [...new Set(days)].map((day) => ({ day }));
        return { freq: 'WEEKLY', interval: m[1] ? NUM_WORDS[m[1]]! : 1, byDay };
      },
    ],
    // every month on the 1st / every month on the last day
    [
      /\b(?:every\s+month|monthly)\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/,
      (m) => {
        const n = Number(m[1]);
        return n >= 1 && n <= 31 ? { freq: 'MONTHLY', interval: 1, byMonthDay: [n] } : null;
      },
    ],
    [/\b(?:every\s+month|monthly)\s+on\s+(?:the\s+)?last\s+day\b/, () => ({ freq: 'MONTHLY', interval: 1, byMonthDay: [-1] })],
    // every 2 weeks / every other day / every 3 months
    [
      /\bevery\s+(\d{1,3}|other|two|three|four|five|six)\s+(day|week|month|year)s?\b/,
      (m) => {
        const n = /\d/.test(m[1]!) ? Number(m[1]) : NUM_WORDS[m[1]!]!;
        const freq = ({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' } as const)[m[2] as 'day'];
        return n >= 1 ? { freq, interval: n } : null;
      },
    ],
    [/\bevery\s+other\s+(day|week|month|year)\b/, (m) => ({ freq: ({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' } as const)[m[1] as 'day'], interval: 2 })],
    [/\b(?:every\s+day|daily|each\s+day)\b/, () => ({ freq: 'DAILY', interval: 1 })],
    [/\b(?:every\s+week|weekly)\b/, () => ({ freq: 'WEEKLY', interval: 1 })],
    [/\b(?:every\s+month|monthly)\b/, () => ({ freq: 'MONTHLY', interval: 1 })],
    [/\b(?:every\s+year|yearly|annually)\b/, () => ({ freq: 'YEARLY', interval: 1 })],
  ];
  for (const [re, build] of tries) {
    const m = re.exec(t);
    if (!m) continue;
    const rule = build(m);
    if (rule) return { rule, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function cleanTitle(s: string): string {
  return s
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?:^|\s)(?:on|at|by|due|from)\s*$/i, '')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
}

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAdd {
  let text = input.trim();
  const today = localDate(now);
  let rule: Rule | null = null;

  const repeat = matchRepeat(text);
  if (repeat) {
    rule = repeat.rule;
    text = `${text.slice(0, repeat.start)} ${text.slice(repeat.end)}`;
  }

  let dueDate: string | null = null;
  let dueTime: string | null = null;
  const found = chrono.casual.parse(text, now, { forwardDate: true })[0];
  if (found) {
    const s = found.start;
    dueDate = `${s.get('year')}-${pad(s.get('month')!)}-${pad(s.get('day')!)}`;
    if (s.isCertain('hour')) dueTime = `${pad(s.get('hour')!)}:${pad(s.get('minute') ?? 0)}`;
    text = `${text.slice(0, found.index)} ${text.slice(found.index + found.text.length)}`;
    // A repeat rule alone ("every day at 9am") gets its time but no specific date.
    if (rule && !found.start.isCertain('day') && !found.start.isCertain('weekday')) dueDate = null;
  }

  let rrule: string | null = null;
  if (rule) {
    // Anchor the series at the stated date (or today), then use its first occurrence.
    const anchor = dueDate ?? today;
    rrule = formatRRule(rule);
    dueDate = firstOnOrAfter(parseRRule(rrule), anchor, anchor) ?? anchor;
  }

  const title = cleanTitle(text) || input.trim();
  return { title, dueDate, dueTime, rrule };
}
