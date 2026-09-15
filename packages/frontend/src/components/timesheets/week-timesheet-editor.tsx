import { Plus, RotateCcw, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  WeekDayLedger,
  WeekLedgerMatrix,
  WeekLedgerNotices,
  WeekLedgerSummary,
  type WeekLedgerCellContext,
} from '@/components/timesheets/week-ledger';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { projectRepo } from '@/lib/timesheet-api';
import {
  formatDayHeader,
  formatHours,
  isWeekend,
  todayISO,
  weekDates,
} from '@/lib/timesheet-utils';
import {
  buildWeekMatrix,
  cellKey,
  defaultActiveDate,
  diffWeekCells,
  manualWeekRow,
  parseCellInputs,
  rowKey,
  seedCellInputs,
  validateWeekDraft,
  type WeekCellChange,
  type WeekRow,
} from '@/lib/timesheet-week';
import { cn } from '@/lib/utils';
import type { Project, ProjectTask, TimesheetDetail } from '@/types/timesheet';

export interface WeekTimesheetEditorProps {
  /** The loaded week. The page remounts the editor whenever this changes. */
  timesheet: TimesheetDetail;
  /** Active project catalog used by the "add project row" control. */
  projects: Project[];
  /** False while the timesheet is SUBMITTED or APPROVED (grid goes read-only). */
  editable: boolean;
  /** True while a save is in flight. */
  saving: boolean;
  /** Persists the changed cells; the page owns the request, toast, and state. */
  onSave: (changes: WeekCellChange[]) => Promise<void>;
  /** Opens the submission confirmation (only reachable from a clean draft). */
  onSubmit: () => void;
  /** Lets the page warn before a week change throws unsaved edits away. */
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * Week-at-a-glance timesheet editor.
 *
 * Every row is a `(project, task)` pair — the granularity at which the API
 * rejects overlapping entries — and the columns are Mon–Sun, so an entire week
 * is captured in one sitting with no per-day dialog. Hours are typed straight
 * into the grid, the summary recomputes as you type, and one save reconciles
 * every changed cell with the API.
 *
 * The ledger shell is shared with the manager's review view
 * (`week-ledger.tsx`); this component supplies the editable cells and the
 * save/submit actions. Below `md` the same draft is edited one day at a time
 * through a day switcher, which keeps the inputs finger-sized.
 */
export function WeekTimesheetEditor({
  timesheet,
  projects,
  editable,
  saving,
  onSave,
  onSubmit,
  onDirtyChange,
}: WeekTimesheetEditorProps) {
  const dates = useMemo(() => weekDates(timesheet.periodStart), [timesheet.periodStart]);
  const matrix = useMemo(
    () => buildWeekMatrix(timesheet.entries, dates),
    [timesheet.entries, dates],
  );

  const [rows, setRows] = useState<WeekRow[]>(matrix.rows);
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    seedCellInputs(matrix.rows, dates, matrix.baseline),
  );
  const [activeDate, setActiveDate] = useState(() => defaultActiveDate(dates, todayISO()));
  const [addProjectId, setAddProjectId] = useState('');
  const [addTaskId, setAddTaskId] = useState('');
  const [addTasks, setAddTasks] = useState<ProjectTask[]>([]);

  const parsed = useMemo(() => parseCellInputs(inputs), [inputs]);
  const validation = useMemo(
    () =>
      validateWeekDraft({
        rows,
        values: parsed.values,
        inputErrors: parsed.errors,
        dates,
        periodStart: timesheet.periodStart,
      }),
    [rows, parsed, dates, timesheet.periodStart],
  );
  const changes = useMemo(
    () =>
      diffWeekCells({
        rows,
        values: parsed.values,
        baseline: matrix.baseline,
        entryIds: matrix.entryIds,
        splitCells: matrix.splitCells,
      }),
    [rows, parsed, matrix],
  );

  const isDirty = changes.length > 0;
  const hasHours = validation.weeklyTotal > 0;

  // Report dirtiness upward so the page can guard week navigation. The page
  // stores it in a ref, so this notification never triggers a re-render.
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // ── Draft mutations ──────────────────────────────────────────────────────

  const setCell = useCallback((rowId: string, date: string, value: string) => {
    const key = cellKey(rowId, date);
    setInputs((previous) => ({ ...previous, [key]: value }));
  }, []);

  const resetDraft = useCallback(() => {
    setRows(matrix.rows);
    setInputs(seedCellInputs(matrix.rows, dates, matrix.baseline));
  }, [matrix, dates]);

  const handleSave = useCallback(async () => {
    if (changes.length === 0) return;
    try {
      await onSave(changes);
    } catch {
      // The page surfaces the failure; the draft stays intact for a retry.
    }
  }, [changes, onSave]);

  // ── Add-row control ──────────────────────────────────────────────────────

  const handleProjectPick = useCallback((projectId: string) => {
    setAddProjectId(projectId);
    setAddTaskId('');
    setAddTasks([]);
  }, []);

  useEffect(() => {
    if (addProjectId === '') return;
    let cancelled = false;
    projectRepo
      .listTasks(addProjectId)
      .then((list) => {
        if (!cancelled) setAddTasks(list);
      })
      .catch(() => {
        if (!cancelled) setAddTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [addProjectId]);

  const candidateRowId = addProjectId === '' ? null : rowKey(addProjectId, addTaskId || null);
  const candidateExists = candidateRowId !== null && rows.some((row) => row.id === candidateRowId);

  const handleAddRow = useCallback(() => {
    const project = projects.find((candidate) => candidate.id === addProjectId);
    if (!project) return;
    const task = addTasks.find((candidate) => candidate.id === addTaskId) ?? null;
    const row = manualWeekRow(project, task);
    setRows((previous) =>
      previous.some((candidate) => candidate.id === row.id) ? previous : [...previous, row],
    );
    setAddProjectId('');
    setAddTaskId('');
    setAddTasks([]);
  }, [projects, addProjectId, addTasks, addTaskId]);

  // ── Keyboard flow: Enter walks down the same weekday ─────────────────────

  const handleCellKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    date: string,
  ) => {
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (rowIndex + 1 >= rows.length) {
      event.currentTarget.blur();
      return;
    }
    const selector = `[data-slot="hour-input"][data-row-index="${rowIndex + 1}"][data-date="${date}"]`;
    const next = document.querySelector<HTMLInputElement>(selector);
    if (next) {
      next.focus();
      next.select();
    }
  };

  const cellLabel = (row: WeekRow, date: string) =>
    `Hours for ${row.projectName}${row.taskName ? ` (${row.taskName})` : ''} on ${formatDayHeader(date)}`;

  // ── Cell renderers ───────────────────────────────────────────────────────

  /** Shared cell chrome: the hours input (or the read-only combined figure). */
  const renderCellInput = (context: WeekLedgerCellContext, variant: 'matrix' | 'day') => {
    const { row, rowIndex, date, hours, split } = context;
    const key = cellKey(row.id, date);
    const error = validation.errors[key];

    const control = split ? (
      <span
        className={cn(
          'font-mono font-semibold text-ink-700',
          variant === 'day' ? 'text-sm' : 'text-sm',
        )}
        title="Combined total for several logged entries on this day."
      >
        {formatHours(hours)}h
      </span>
    ) : (
      <input
        type="text"
        inputMode="decimal"
        data-slot="hour-input"
        data-row-index={rowIndex}
        data-date={date}
        aria-label={cellLabel(row, date)}
        aria-invalid={error !== undefined}
        placeholder="–"
        disabled={!editable}
        value={inputs[key] ?? ''}
        onChange={(event) => setCell(row.id, date, event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => handleCellKeyDown(event, rowIndex, date)}
        className={cn(
          'rounded-md text-center font-mono tabular-nums transition-colors focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-60',
          variant === 'matrix'
            ? 'h-9 w-14 border border-transparent bg-transparent text-sm text-ink-800 placeholder:text-ink-300 hover:bg-ink-100 focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/20'
            : 'h-11 w-20 border border-ink-300 bg-white text-base text-ink-900 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20',
          hours > 0 && variant === 'matrix' && 'font-semibold text-ink-900',
          error !== undefined &&
            (variant === 'matrix'
              ? 'border-danger-500 bg-red-50 text-danger-600 focus:border-danger-500 focus:ring-danger-500/20'
              : 'border-danger-500 ring-2 ring-danger-500/20'),
        )}
      />
    );

    return (
      <div
        className={cn('flex items-center', variant === 'matrix' ? 'justify-center' : 'shrink-0')}
      >
        {control}
      </div>
    );
  };

  // ── Derived display helpers ──────────────────────────────────────────────

  const weekendCount = dates.filter(isWeekend).length;
  const loggedDays = dates.filter((date) => (validation.dayTotals[date] ?? 0) > 0).length;
  const dayErrorMessages = Object.values(validation.dayErrors);
  const cellErrorCount = Object.keys(validation.errors).length;
  const blocking = validation.invalid;

  const submitHint = !editable
    ? 'Entries are locked while the timesheet is under review.'
    : isDirty
      ? 'Save your changes before submitting the week.'
      : blocking
        ? 'Resolve the highlighted problems before submitting.'
        : !hasHours
          ? 'Log at least one hour before submitting.'
          : null;

  return (
    <div className="space-y-4" data-slot="week-timesheet-editor">
      <WeekLedgerSummary
        weeklyTotal={validation.weeklyTotal}
        projectTotals={validation.projectTotals}
        loggedDays={loggedDays}
        workingDays={7 - weekendCount}
        badge={
          isDirty ? (
            <Badge variant="warning" className="gap-1.5" data-slot="unsaved-badge">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unsaved
            </Badge>
          ) : null
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={resetDraft}
              disabled={!isDirty || saving}
              title="Discard unsaved edits"
            >
              <RotateCcw className="h-4 w-4" />
              Discard
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={handleSave}
              disabled={!editable || !isDirty || blocking || saving}
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save week'}
            </Button>
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!editable || isDirty || blocking || !hasHours || saving}
            >
              <Send className="h-4 w-4" />
              Submit week
            </Button>
          </>
        }
      />

      <WeekLedgerNotices
        dayErrors={dayErrorMessages}
        cellErrorCount={cellErrorCount}
        emptyWeekdays={validation.emptyWeekdays}
        locked={!editable}
      />

      {submitHint && (
        <p className="text-xs text-ink-500" data-slot="submit-hint">
          {submitHint}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-300 bg-white px-6 py-10 text-center">
          <p className="font-medium text-ink-700">Nothing logged yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            Add a project row below, then type your hours across the week — you can save and submit
            everything in one go.
          </p>
        </div>
      ) : (
        <>
          <WeekLedgerMatrix
            dates={dates}
            rows={rows}
            hours={parsed.values}
            dayTotals={validation.dayTotals}
            rowTotals={validation.rowTotals}
            weeklyTotal={validation.weeklyTotal}
            dayErrors={validation.dayErrors}
            splitCells={matrix.splitCells}
            renderCell={(context) => renderCellInput(context, 'matrix')}
          />
          <WeekDayLedger
            dates={dates}
            rows={rows}
            hours={parsed.values}
            dayTotals={validation.dayTotals}
            activeDate={activeDate}
            onSelectDate={setActiveDate}
            splitCells={matrix.splitCells}
            renderCell={(context) => renderCellInput(context, 'day')}
          />
        </>
      )}

      {/* Add a project row */}
      {editable && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-ink-300 bg-ink-50/50 p-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <NativeSelect
              aria-label="Add project row"
              value={addProjectId}
              onChange={(event) => handleProjectPick(event.target.value)}
              className="sm:max-w-xs"
            >
              <option value="">Choose a project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} — {project.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Task for new row"
              value={addTaskId}
              onChange={(event) => setAddTaskId(event.target.value)}
              disabled={addProjectId === '' || addTasks.length === 0}
              className="sm:max-w-xs"
            >
              <option value="">No specific task</option>
              {addTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddRow}
            disabled={addProjectId === '' || candidateExists}
          >
            <Plus className="h-4 w-4" />
            {candidateExists ? 'Row already added' : 'Add row'}
          </Button>
        </div>
      )}

      {isDirty && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700" data-slot="dirty-notice">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Unsaved changes — save the week before navigating away or submitting.
        </p>
      )}
    </div>
  );
}
