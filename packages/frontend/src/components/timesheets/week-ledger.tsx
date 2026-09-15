import { AlertTriangle, Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatDayHeader, formatHours, isWeekend } from '@/lib/timesheet-utils';
import { cellKey, weekdayShort, type ProjectWeekTotal, type WeekRow } from '@/lib/timesheet-week';
import { cn } from '@/lib/utils';

/**
 * Presentation layer for the weekly ledger.
 *
 * The employee's editor and the manager's review view render the exact same
 * shape — rows of `(project, task)` against Mon–Sun columns — so the two sides
 * of the workflow read identically. Only the cells differ, which is why they
 * are injected through a `renderCell` render prop: the editor puts an input
 * there, the reviewer puts the submitted figure.
 */

// ── Summary ────────────────────────────────────────────────────────────────

export interface WeekLedgerSummaryProps {
  /** Live weekly total. */
  weeklyTotal: number;
  /** Live per-project roll-up, with share-of-week bars. */
  projectTotals: ProjectWeekTotal[];
  /** Days in the week that carry hours. */
  loggedDays: number;
  /** Working days (Mon–Fri) in the week. */
  workingDays: number;
  /** Action buttons rendered on the right (save/submit, or a decision). */
  actions?: ReactNode;
  /** Optional status chip next to the stats (e.g. "Unsaved"). */
  badge?: ReactNode;
  className?: string;
}

/** Headline totals for a week: grand total, coverage stats, per-project split. */
export function WeekLedgerSummary({
  weeklyTotal,
  projectTotals,
  loggedDays,
  workingDays,
  actions,
  badge,
  className,
}: WeekLedgerSummaryProps) {
  return (
    <div
      className={cn(
        'grid gap-4 rounded-xl border border-ink-200 bg-ink-50/70 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center',
        className,
      )}
      data-slot="week-summary"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
            Week total
          </p>
          <p className="font-display text-4xl leading-none font-semibold text-ink-900">
            {formatHours(weeklyTotal)}
            <span className="ml-0.5 text-xl text-ink-400">h</span>
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
              Days logged
            </dt>
            <dd className="font-mono text-ink-800">
              {loggedDays}
              <span className="text-ink-400">/{workingDays}</span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
              Projects
            </dt>
            <dd className="font-mono text-ink-800">{projectTotals.length}</dd>
          </div>
        </dl>
        {badge}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}

      <div className="min-w-0 lg:col-span-2 lg:max-w-2xl" data-slot="project-totals">
        {projectTotals.length === 0 ? (
          <p className="text-sm text-ink-400">No hours logged yet.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {projectTotals.map((project) => {
              const share = weeklyTotal > 0 ? project.hours / weeklyTotal : 0;
              return (
                <li key={project.projectId} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="font-mono text-[10px] font-semibold text-ink-500">
                        {project.projectCode}
                      </span>
                      <span className="truncate text-ink-700">{project.projectName}</span>
                    </span>
                    <span className="font-mono font-semibold text-ink-800">
                      {formatHours(project.hours)}h
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-ink-200">
                    <div
                      className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-out"
                      style={{ width: `${Math.max(share * 100, 2)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Notices ────────────────────────────────────────────────────────────────

export interface WeekLedgerNoticesProps {
  /** Human-readable daily-cap breaches. */
  dayErrors?: string[];
  /** Number of cells with unparseable input. */
  cellErrorCount?: number;
  /** Mon–Fri dates left without hours. */
  emptyWeekdays?: string[];
  /** Explanation appended to the zero-hour warning (differs per audience). */
  emptyWeekdayHint?: string;
  /** Renders the read-only note for submitted/approved weeks. */
  locked?: boolean;
}

const DEFAULT_EMPTY_HINT = 'you can still submit if you did not work those days.';

/** Blocking errors and advisory warnings shown above the ledger. */
export function WeekLedgerNotices({
  dayErrors = [],
  cellErrorCount = 0,
  emptyWeekdays = [],
  emptyWeekdayHint = DEFAULT_EMPTY_HINT,
  locked = false,
}: WeekLedgerNoticesProps) {
  const hasBlocking = dayErrors.length > 0 || cellErrorCount > 0;
  if (!hasBlocking && emptyWeekdays.length === 0 && !locked) return null;

  return (
    <div className="space-y-2">
      {hasBlocking && (
        <div
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              {dayErrors.length > 0
                ? 'Daily hours exceed the 24h limit'
                : 'Some cells need attention'}
            </p>
            <p className="mt-0.5 text-red-600">
              {dayErrors.length > 0
                ? dayErrors.join(' ')
                : 'Fix the highlighted cells before saving the week.'}
            </p>
          </div>
        </div>
      )}
      {emptyWeekdays.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Working days without hours</p>
            <p className="mt-0.5 text-amber-700">
              {emptyWeekdays.map((date) => weekdayShort(date)).join(', ')} — {emptyWeekdayHint}
            </p>
          </div>
        </div>
      )}
      {locked && (
        <p className="flex items-center gap-1.5 text-xs text-ink-400">
          <Lock className="h-3.5 w-3.5" />
          Entries are locked while the timesheet is submitted or approved.
        </p>
      )}
    </div>
  );
}

// ── Matrix (tablet and up) ─────────────────────────────────────────────────

export interface WeekLedgerCellContext {
  row: WeekRow;
  rowIndex: number;
  date: string;
  /** Hours in the cell (`0` when empty). */
  hours: number;
  /** True when several server entries share the cell. */
  split: boolean;
}

export interface WeekLedgerMatrixProps {
  dates: string[];
  rows: WeekRow[];
  /** Hours per cell key (absent = 0). */
  hours: Record<string, number>;
  dayTotals: Record<string, number>;
  rowTotals: Record<string, number>;
  weeklyTotal: number;
  /** Dates breaching the daily cap — highlighted in the footer. */
  dayErrors?: Record<string, string>;
  splitCells?: Record<string, true>;
  renderCell: (context: WeekLedgerCellContext) => ReactNode;
  className?: string;
}

/** Sticky-header Mon–Sun matrix with a pinned row label, row and daily totals. */
export function WeekLedgerMatrix({
  dates,
  rows,
  hours,
  dayTotals,
  rowTotals,
  weeklyTotal,
  dayErrors = {},
  splitCells = {},
  renderCell,
  className,
}: WeekLedgerMatrixProps) {
  return (
    <div className={cn('hidden md:block', className)} data-slot="week-matrix">
      <div className="max-h-[68vh] overflow-auto rounded-xl border border-ink-200 bg-white">
        <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-20 min-w-52 border-r border-b border-ink-200 bg-ink-50 px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-ink-500 uppercase"
              >
                Project / task
              </th>
              {dates.map((date) => (
                <th
                  key={date}
                  scope="col"
                  className={cn(
                    'sticky top-0 z-10 border-b border-l border-ink-200 bg-ink-50 px-2 py-2 text-center',
                    isWeekend(date) && 'bg-ink-100',
                  )}
                >
                  <span className="block text-[11px] font-semibold tracking-wide text-ink-600 uppercase">
                    {weekdayShort(date)}
                  </span>
                  <span className="block text-[10px] font-normal text-ink-400">
                    {formatDayHeader(date).split(', ')[1]}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block font-mono text-xs font-semibold tabular-nums',
                      (dayTotals[date] ?? 0) > 0 ? 'text-accent-700' : 'text-ink-300',
                    )}
                  >
                    {formatHours(dayTotals[date] ?? 0)}h
                  </span>
                </th>
              ))}
              <th
                scope="col"
                className="sticky top-0 z-10 border-b border-l border-ink-200 bg-ink-50 px-3 py-2 text-center text-[11px] font-semibold tracking-wider text-ink-500 uppercase"
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-[5] border-r border-b border-ink-100 bg-white px-3 py-2 text-left align-middle font-normal transition-colors group-hover:bg-ink-50"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 rounded border border-ink-200 bg-ink-100 px-1 py-0.5 font-mono text-[10px] font-semibold text-ink-600">
                      {row.projectCode}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-800">
                        {row.projectName}
                      </span>
                      <span className="block truncate text-[11px] text-ink-400">
                        {row.taskName ?? 'No specific task'}
                        {row.isBillable && <span className="ml-1 text-accent-600">· billable</span>}
                      </span>
                    </span>
                  </div>
                </th>

                {dates.map((date) => {
                  const key = cellKey(row.id, date);
                  return (
                    <td
                      key={date}
                      className={cn(
                        'border-b border-l border-ink-100 p-1 text-center align-middle transition-colors group-hover:bg-ink-50',
                        isWeekend(date) && 'bg-ink-50/60',
                        dayErrors[date] !== undefined && 'bg-red-50/60',
                      )}
                    >
                      {renderCell({
                        row,
                        rowIndex,
                        date,
                        hours: hours[key] ?? 0,
                        split: splitCells[key] === true,
                      })}
                    </td>
                  );
                })}

                <td className="border-b border-l border-ink-100 px-3 py-2 text-right align-middle transition-colors group-hover:bg-ink-50">
                  <span className="font-mono text-sm font-semibold tabular-nums text-ink-800">
                    {formatHours(rowTotals[row.id] ?? 0)}h
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky bottom-0 left-0 z-[8] border-t border-r border-ink-200 bg-ink-50 px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-ink-500 uppercase"
              >
                Daily total
              </th>
              {dates.map((date) => (
                <td
                  key={date}
                  className={cn(
                    'sticky bottom-0 z-[6] border-t border-l border-ink-200 bg-ink-50 px-2 py-2 text-center',
                    dayErrors[date] !== undefined && 'bg-red-100',
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-sm font-semibold tabular-nums',
                      dayErrors[date] !== undefined ? 'text-danger-600' : 'text-ink-700',
                    )}
                  >
                    {formatHours(dayTotals[date] ?? 0)}h
                  </span>
                </td>
              ))}
              <td className="sticky bottom-0 z-[6] border-t border-l border-ink-200 bg-ink-50 px-3 py-2 text-right">
                <span className="font-mono text-sm font-bold tabular-nums text-ink-900">
                  {formatHours(weeklyTotal)}h
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Day ledger (mobile) ────────────────────────────────────────────────────

export interface WeekDayLedgerProps {
  dates: string[];
  rows: WeekRow[];
  hours: Record<string, number>;
  dayTotals: Record<string, number>;
  /** Date currently shown below the day switcher. */
  activeDate: string;
  onSelectDate: (date: string) => void;
  splitCells?: Record<string, true>;
  renderCell: (context: WeekLedgerCellContext) => ReactNode;
  className?: string;
}

/**
 * Mobile counterpart of {@link WeekLedgerMatrix}: a day switcher plus one row
 * per project, so the hours stay finger-sized on small screens.
 */
export function WeekDayLedger({
  dates,
  rows,
  hours,
  dayTotals,
  activeDate,
  onSelectDate,
  splitCells = {},
  renderCell,
  className,
}: WeekDayLedgerProps) {
  return (
    <div className={cn('space-y-3 md:hidden', className)} data-slot="mobile-day-ledger">
      <div className="grid grid-cols-7 gap-1">
        {dates.map((date) => {
          const isActive = date === activeDate;
          const total = dayTotals[date] ?? 0;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              aria-pressed={isActive}
              aria-label={`Show ${formatDayHeader(date)}`}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg border px-0.5 py-1.5 transition-colors',
                isActive
                  ? 'border-accent-500 bg-accent-50 text-accent-800'
                  : 'border-ink-200 bg-white text-ink-600',
                isWeekend(date) && !isActive && 'bg-ink-50',
              )}
            >
              <span className="text-[10px] font-semibold tracking-wide uppercase">
                {weekdayShort(date)}
              </span>
              <span
                className={cn(
                  'font-mono text-[11px] font-semibold tabular-nums',
                  total > 0 ? 'text-accent-700' : 'text-ink-300',
                  isActive && total > 0 && 'text-accent-800',
                )}
              >
                {formatHours(total)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/70 px-3 py-2">
          <span className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
            {formatDayHeader(activeDate)}
          </span>
          <span className="font-mono text-sm font-semibold text-ink-800">
            {formatHours(dayTotals[activeDate] ?? 0)}h
          </span>
        </div>
        <ul className="divide-y divide-ink-100">
          {rows.map((row, rowIndex) => {
            const key = cellKey(row.id, activeDate);
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-800">
                    <span className="font-mono text-[10px] text-ink-500">{row.projectCode}</span>{' '}
                    {row.projectName}
                  </p>
                  <p className="truncate text-[11px] text-ink-400">
                    {row.taskName ?? 'No specific task'}
                  </p>
                </div>
                {renderCell({
                  row,
                  rowIndex,
                  date: activeDate,
                  hours: hours[key] ?? 0,
                  split: splitCells[key] === true,
                })}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
