/**
 * Pure date/week helpers for the Timesheet feature.
 *
 * All helpers work on local-timezone, Monday-based weeks and date-only
 * `YYYY-MM-DD` strings, matching the UI's week navigation and the API's
 * `periodStart` (Monday 00:00) / `entryDate` (date-only) semantics.
 */
import type { PerDayTotal, TimesheetStatus } from '@/types/timesheet';

/** Format a Date as a local `YYYY-MM-DD` string. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today as a local `YYYY-MM-DD` string. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** Parse a `YYYY-MM-DD` string into a local-midnight Date. */
function parseISODate(dateISO: string): Date {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Monday (00:00, local) of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Monday of the week containing `dateISO` (or of a full periodStart timestamp). */
export function mondayOf(dateISO: string): Date {
  return startOfWeek(parseISODate(dateISO));
}

/** The 7 `YYYY-MM-DD` dates (Mon–Sun) of the week starting at `periodStartISO`. */
export function weekDates(periodStartISO: string): string[] {
  const base = parseISODate(periodStartISO);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return toISODate(d);
  });
}

/** `YYYY-MM-DD` shifted by `days` (may be negative). */
export function addDays(dateISO: string, days: number): string {
  const d = parseISODate(dateISO);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Week label like "Sep 8 – Sep 14, 2026" for the week starting at `periodStartISO`. */
export function formatWeekLabel(periodStartISO: string): string {
  const dates = weekDates(periodStartISO);
  const start = parseISODate(dates[0] ?? periodStartISO);
  const end = parseISODate(dates[6] ?? periodStartISO);
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

/** Short day header like "Mon, Sep 14" for a `YYYY-MM-DD` string. */
export function formatDayHeader(dateISO: string): string {
  return parseISODate(dateISO).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** True when the date falls on a Saturday or Sunday. */
export function isWeekend(dateISO: string): boolean {
  const day = parseISODate(dateISO).getDay();
  return day === 0 || day === 6;
}

/**
 * True when the week containing `dateISO` is the current or previous week —
 * the only window the API allows for viewing/editing timesheets.
 */
export function isCurrentOrPreviousWeek(dateISO: string): boolean {
  const currentMonday = startOfWeek(new Date()).getTime();
  const weekMonday = mondayOf(dateISO).getTime();
  return weekMonday <= currentMonday && weekMonday >= currentMonday - 7 * 86_400_000;
}

/** Next-week navigation is allowed only while viewing a past (previous) week. */
export function canGoNextWeek(anchorISO: string): boolean {
  return mondayOf(anchorISO).getTime() < startOfWeek(new Date()).getTime();
}

/** Previous-week navigation stops at the previous week (the API's lower bound). */
export function canGoPrevWeek(anchorISO: string): boolean {
  return mondayOf(anchorISO).getTime() > startOfWeek(new Date()).getTime() - 7 * 86_400_000;
}

/** Map per-day totals keyed by `YYYY-MM-DD` (missing dates = 0 hours). */
export function dayTotalsByDate(perDayTotals: PerDayTotal[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const total of perDayTotals) map.set(total.date.slice(0, 10), total.hours);
  return map;
}

/**
 * Monday–Friday dates of the week that have no logged hours — surfaced as a
 * (non-blocking) completeness warning before submission.
 */
export function weekdayDatesWithZeroHours(
  periodStartISO: string,
  perDayTotals: PerDayTotal[],
): string[] {
  const totals = dayTotalsByDate(perDayTotals);
  return weekDates(periodStartISO).filter(
    (date) => !isWeekend(date) && (totals.get(date) ?? 0) === 0,
  );
}

/** Compact hours label: `8`, `7.5`, `0.25` (no trailing zeros). */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}

/** Badge styling per timesheet status, matching the app's badge conventions. */
export const timesheetStatusConfig: Record<
  TimesheetStatus,
  { label: string; badge: string; dot: string }
> = {
  DRAFT: {
    label: 'Draft',
    badge: 'border-transparent bg-ink-100 text-ink-700',
    dot: 'bg-ink-400',
  },
  SUBMITTED: {
    label: 'Submitted',
    badge: 'border-transparent bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
  },
  APPROVED: {
    label: 'Approved',
    badge: 'border-transparent bg-accent-100 text-accent-800',
    dot: 'bg-accent-500',
  },
  REJECTED: {
    label: 'Rejected',
    badge: 'border-transparent bg-red-100 text-red-700',
    dot: 'bg-red-500',
  },
};
