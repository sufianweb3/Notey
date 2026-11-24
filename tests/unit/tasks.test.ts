import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../../src/shared/quick-add';
import {
  describeRRule,
  formatRRule,
  isValidRRule,
  nextOccurrence,
  parseRRule,
  RRuleError,
  type Rule,
} from '../../src/shared/recurrence';

const next = (rrule: string, anchor: string, after: string) => nextOccurrence(parseRRule(rrule), anchor, after);

/** The next n occurrences from the anchor. */
function series(rrule: string, anchor: string, n: number) {
  const rule = parseRRule(rrule);
  const out: string[] = [];
  let after = '0000-01-01';
  for (let i = 0; i < n; i++) {
    const d = nextOccurrence(rule, anchor, after);
    if (!d) break;
    out.push(d);
    after = d;
  }
  return out;
}

describe('RRULE subset', () => {
  it('parses and formats round trip', () => {
    for (const s of ['FREQ=DAILY', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', 'FREQ=MONTHLY;BYDAY=-1FR', 'FREQ=MONTHLY;BYMONTHDAY=1,15', 'FREQ=DAILY;COUNT=3', 'FREQ=YEARLY;UNTIL=20301231']) {
      expect(formatRRule(parseRRule(s))).toBe(s);
    }
  });

  it('rejects what it does not support', () => {
    for (const s of ['', 'FREQ=HOURLY', 'FREQ=DAILY;BYHOUR=9', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=WEEKLY;BYDAY=1MO', 'FREQ=DAILY;INTERVAL=0', 'FREQ=MONTHLY;BYMONTHDAY=0']) {
      expect(() => parseRRule(s), s).toThrow(RRuleError);
    }
    expect(isValidRRule('FREQ=DAILY')).toBe(true);
  });

  it('daily, every other day', () => {
    expect(series('FREQ=DAILY', '2026-11-24', 3)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
    expect(series('FREQ=DAILY;INTERVAL=2', '2026-11-24', 3)).toEqual(['2026-11-24', '2026-11-26', '2026-11-28']);
  });

  it('weekdays skip the weekend', () => {
    expect(series('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-11-27', 3)).toEqual(['2026-11-27', '2026-11-30', '2026-12-01']);
  });

  it('every 2 weeks on Monday and Thursday counts weeks from the anchor week', () => {
    expect(series('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', '2026-11-23', 4)).toEqual(['2026-11-23', '2026-11-26', '2026-12-07', '2026-12-10']);
  });

  it('monthly on the 31st lands on the last day of short months', () => {
    expect(series('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31', 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(series('FREQ=MONTHLY;BYMONTHDAY=-1', '2028-01-31', 2)).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('monthly on the last Friday and the first Monday', () => {
    expect(series('FREQ=MONTHLY;BYDAY=-1FR', '2026-11-01', 3)).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
    expect(series('FREQ=MONTHLY;BYDAY=1MO', '2026-11-01', 2)).toEqual(['2026-11-02', '2026-12-07']);
  });

  it('yearly on 29 February falls back to 28 February', () => {
    expect(series('FREQ=YEARLY', '2028-02-29', 3)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
  });

  it('stops at COUNT and UNTIL', () => {
    expect(series('FREQ=DAILY;COUNT=3', '2026-11-24', 10)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
    expect(next('FREQ=DAILY;COUNT=3', '2026-11-24', '2026-11-26')).toBeNull();
    expect(series('FREQ=WEEKLY;UNTIL=20261208', '2026-11-24', 10)).toEqual(['2026-11-24', '2026-12-01', '2026-12-08']);
  });

  it('describes rules in plain words', () => {
    expect(describeRRule('FREQ=DAILY')).toBe('Daily');
    expect(describeRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Weekdays');
    expect(describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,MO')).toBe('Every 2 weeks on Mon, Thu');
    expect(describeRRule('FREQ=MONTHLY;BYMONTHDAY=1')).toBe('Monthly on the 1st');
    expect(describeRRule('FREQ=MONTHLY;BYDAY=-1FR')).toBe('Monthly on the last Friday');
    expect(describeRRule('nonsense')).toBe('Custom');
  });
});

describe('quick add', () => {
  // Tuesday 24 November 2026, 10:00 local time.
  const now = new Date(2026, 10, 24, 10, 0);
  const q = (s: string) => parseQuickAdd(s, now);

  it('plain titles stay plain', () => {
    expect(q('Buy milk')).toEqual({ title: 'Buy milk', dueDate: null, dueTime: null, rrule: null });
  });

  it('dates and times', () => {
    expect(q('Call Rafi tomorrow 3pm')).toEqual({ title: 'Call Rafi', dueDate: '2026-11-25', dueTime: '15:00', rrule: null });
    expect(q('Invoice CRG Attire on Friday')).toMatchObject({ title: 'Invoice CRG Attire', dueDate: '2026-11-27', dueTime: null });
    expect(q('Dentist next monday at 9:30')).toMatchObject({ title: 'Dentist', dueDate: '2026-11-30', dueTime: '09:30' });
  });

  it('repeats', () => {
    expect(q('Review logs every day')).toEqual({ title: 'Review logs', dueDate: '2026-11-24', dueTime: null, rrule: 'FREQ=DAILY' });
    expect(q('Pay rent every month on 1st')).toEqual({ title: 'Pay rent', dueDate: '2026-12-01', dueTime: null, rrule: 'FREQ=MONTHLY;BYMONTHDAY=1' });
    expect(q('Standup every weekday at 9am')).toEqual({
      title: 'Standup',
      dueDate: '2026-11-24',
      dueTime: '09:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    });
    expect(q('Gym every monday and thursday')).toMatchObject({ title: 'Gym', dueDate: '2026-11-26', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' });
    expect(q('Payroll every last friday')).toMatchObject({ title: 'Payroll', dueDate: '2026-11-27', rrule: 'FREQ=MONTHLY;BYDAY=-1FR' });
    expect(q('Water plants every 3 days')).toMatchObject({ title: 'Water plants', rrule: 'FREQ=DAILY;INTERVAL=3' });
  });

  it('never returns an empty title', () => {
    expect(q('tomorrow').title).toBe('tomorrow');
  });
});

describe('rule typing', () => {
  it('builds rules as plain data', () => {
    const r: Rule = { freq: 'WEEKLY', interval: 1, byDay: [{ day: 1 }] };
    expect(formatRRule(r)).toBe('FREQ=WEEKLY;BYDAY=MO');
  });
});
