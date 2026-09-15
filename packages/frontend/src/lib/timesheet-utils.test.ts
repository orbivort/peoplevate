import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  addDays,
  canGoNextWeek,
  canGoPrevWeek,
  dayTotalsByDate,
  formatDayHeader,
  formatHours,
  formatWeekLabel,
  isCurrentOrPreviousWeek,
  isWeekend,
  toISODate,
  todayISO,
  weekDates,
  weekdayDatesWithZeroHours,
} from './timesheet-utils';

// All fixtures assume "today" is Wednesday, Sep 16, 2026 (current week
// Sep 14–20; previous week Sep 7–13).
const TODAY = new Date(2026, 8, 16);

afterEach(() => {
  vi.useRealTimers();
});

describe('toISODate / todayISO', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(toISODate(new Date(2026, 8, 7))).toBe('2026-09-07');
    expect(toISODate(new Date(2026, 0, 3))).toBe('2026-01-03');
  });

  it('returns the current local date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    expect(todayISO()).toBe('2026-09-16');
  });
});

describe('weekDates', () => {
  it('returns the seven Mon–Sun dates of a period', () => {
    expect(weekDates('2026-09-14T00:00:00.000Z')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('normalizes a mid-week timestamp to its Monday', () => {
    expect(weekDates('2026-09-16T10:30:00.000Z')[0]).toBe('2026-09-16');
  });
});

describe('addDays', () => {
  it('shifts across month boundaries in both directions', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });
});

describe('formatWeekLabel', () => {
  it('renders a "Sep 14 – Sep 20, 2026" style label', () => {
    expect(formatWeekLabel('2026-09-14T00:00:00.000Z')).toBe('Sep 14 – Sep 20, 2026');
  });

  it('repeats the month when both bounds fall in the same month', () => {
    expect(formatWeekLabel('2026-09-07T00:00:00.000Z')).toBe('Sep 7 – Sep 13, 2026');
  });

  it('handles weeks spanning two months', () => {
    expect(formatWeekLabel('2026-08-31T00:00:00.000Z')).toBe('Aug 31 – Sep 6, 2026');
  });
});

describe('formatDayHeader', () => {
  it('renders a short weekday + day number', () => {
    expect(formatDayHeader('2026-09-14')).toBe('Mon, Sep 14');
  });
});

describe('isWeekend', () => {
  it('flags Saturday and Sunday only', () => {
    expect(isWeekend('2026-09-19')).toBe(true);
    expect(isWeekend('2026-09-20')).toBe(true);
    expect(isWeekend('2026-09-14')).toBe(false);
    expect(isWeekend('2026-09-18')).toBe(false);
  });
});

describe('week navigation bounds', () => {
  it('allows the current and previous week only', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    expect(isCurrentOrPreviousWeek('2026-09-16')).toBe(true); // current week
    expect(isCurrentOrPreviousWeek('2026-09-09')).toBe(true); // previous week
    expect(isCurrentOrPreviousWeek('2026-09-02')).toBe(false); // two weeks ago
    expect(isCurrentOrPreviousWeek('2026-09-23')).toBe(false); // next week
  });

  it('enables next only from the previous week and prev only from the current week', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    // Viewing the current week: can go back, cannot go forward.
    expect(canGoNextWeek('2026-09-16')).toBe(false);
    expect(canGoPrevWeek('2026-09-16')).toBe(true);
    // Viewing the previous week: can go forward, cannot go further back.
    expect(canGoNextWeek('2026-09-09')).toBe(true);
    expect(canGoPrevWeek('2026-09-09')).toBe(false);
  });
});

describe('day totals & warnings', () => {
  const perDayTotals = [
    { date: '2026-09-14', hours: 8 },
    { date: '2026-09-16', hours: 7.5 },
    { date: '2026-09-19', hours: 2 },
  ];

  it('maps per-day totals by date', () => {
    const map = dayTotalsByDate(perDayTotals);
    expect(map.get('2026-09-14')).toBe(8);
    expect(map.get('2026-09-15')).toBeUndefined();
  });

  it('lists weekdays (Mon–Fri) without logged hours', () => {
    expect(weekdayDatesWithZeroHours('2026-09-14T00:00:00.000Z', perDayTotals)).toEqual([
      '2026-09-15',
      '2026-09-17',
      '2026-09-18',
    ]);
  });

  it('returns no warnings when every weekday has hours', () => {
    const full = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].map(
      (date) => ({ date, hours: 8 }),
    );
    expect(weekdayDatesWithZeroHours('2026-09-14T00:00:00.000Z', full)).toEqual([]);
  });
});

describe('formatHours', () => {
  it('drops trailing zeros', () => {
    expect(formatHours(8)).toBe('8');
    expect(formatHours(7.5)).toBe('7.5');
    expect(formatHours(0.25)).toBe('0.25');
    expect(formatHours(7.1 + 0.2)).toBe('7.3'); // float-safe rounding
  });
});
