import { useMemo, useState } from 'react';

import {
  WeekDayLedger,
  WeekLedgerMatrix,
  WeekLedgerNotices,
  WeekLedgerSummary,
  type WeekLedgerCellContext,
} from '@/components/timesheets/week-ledger';
import { formatHours, isWeekend, todayISO, weekDates } from '@/lib/timesheet-utils';
import {
  buildWeekMatrix,
  cellKey,
  defaultActiveDate,
  rowKey,
  validateWeekDraft,
} from '@/lib/timesheet-week';
import type { TimesheetDetail, TimesheetEntry } from '@/types/timesheet';

export interface WeekReviewLedgerProps {
  /** The submitted timesheet being reviewed. */
  timesheet: TimesheetDetail;
}

/**
 * Read-only rendering of a submitted week for the approving manager.
 *
 * It deliberately mirrors the employee's editor — same rows, same columns,
 * same summary — so a decision can be made against exactly the shape the hours
 * were entered in. Cells show the submitted figure (with the entry's note as a
 * tooltip) and nothing is editable.
 */
export function WeekReviewLedger({ timesheet }: WeekReviewLedgerProps) {
  const dates = useMemo(() => weekDates(timesheet.periodStart), [timesheet.periodStart]);
  const matrix = useMemo(
    () => buildWeekMatrix(timesheet.entries, dates),
    [timesheet.entries, dates],
  );
  const totals = useMemo(
    () =>
      validateWeekDraft({
        rows: matrix.rows,
        values: matrix.baseline,
        inputErrors: {},
        dates,
        periodStart: timesheet.periodStart,
      }),
    [matrix, dates, timesheet.periodStart],
  );
  const [activeDate, setActiveDate] = useState(() => defaultActiveDate(dates, todayISO()));

  const entryByCell = useMemo(() => {
    const map = new Map<string, TimesheetEntry>();
    for (const entry of timesheet.entries) {
      map.set(cellKey(rowKey(entry.projectId, entry.taskId), entry.entryDate.slice(0, 10)), entry);
    }
    return map;
  }, [timesheet.entries]);

  const workingDays = dates.filter((date) => !isWeekend(date)).length;
  const loggedDays = dates.filter((date) => (totals.dayTotals[date] ?? 0) > 0).length;

  const renderCell = ({ row, date, hours }: WeekLedgerCellContext) => {
    const description = entryByCell.get(cellKey(row.id, date))?.description ?? null;
    return (
      <span className="flex flex-col items-center" data-slot="review-cell" title={description ?? undefined}>
        {hours > 0 ? (
          <span className="font-mono text-sm font-semibold tabular-nums text-ink-800">
            {formatHours(hours)}h
          </span>
        ) : (
          <span className="text-ink-300" aria-hidden="true">
            ·
          </span>
        )}
        {description && (
          <span
            className="mt-1 h-1 w-1 rounded-full bg-ink-300"
            aria-hidden="true"
            data-slot="note-marker"
          />
        )}
      </span>
    );
  };

  return (
    <div className="space-y-4" data-slot="week-review-ledger">
      <WeekLedgerSummary
        weeklyTotal={totals.weeklyTotal}
        projectTotals={totals.projectTotals}
        loggedDays={loggedDays}
        workingDays={workingDays}
      />

      <WeekLedgerNotices
        emptyWeekdays={totals.emptyWeekdays}
        emptyWeekdayHint="the employee logged no hours on those days — check before approving."
      />

      {matrix.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-300 bg-white px-4 py-6 text-center text-sm text-ink-500">
          This week has no entries.
        </p>
      ) : (
        <>
          <WeekLedgerMatrix
            dates={dates}
            rows={matrix.rows}
            hours={matrix.baseline}
            dayTotals={totals.dayTotals}
            rowTotals={totals.rowTotals}
            weeklyTotal={totals.weeklyTotal}
            splitCells={matrix.splitCells}
            renderCell={renderCell}
          />
          <WeekDayLedger
            dates={dates}
            rows={matrix.rows}
            hours={matrix.baseline}
            dayTotals={totals.dayTotals}
            activeDate={activeDate}
            onSelectDate={setActiveDate}
            splitCells={matrix.splitCells}
            renderCell={renderCell}
          />
        </>
      )}
    </div>
  );
}
