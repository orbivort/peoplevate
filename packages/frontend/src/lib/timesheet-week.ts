/**
 * Pure helpers for the week-at-a-glance timesheet editor.
 *
 * The editor renders a Monday→Sunday matrix where every **row is a
 * `(project, task)` pair** — the exact granularity at which the API rejects
 * overlapping entries — and every cell holds the hours logged that day.
 *
 * Everything here is framework-free so the matrix, the diff against the loaded
 * timesheet, and the submission rules can be unit-tested in isolation and
 * reused by both the desktop table and the mobile day ledger.
 */
import type { PerDayTotal, Project, ProjectTask, TimesheetEntry } from '@/types/timesheet';

import { formatDayHeader, weekdayDatesWithZeroHours } from './timesheet-utils';

/** Accepted granularity for a single cell (matches the API's zod rule). */
export const HOURS_STEP = 0.25;
/** Maximum hours in a single cell (API: per-entry cap). */
export const MAX_HOURS_PER_CELL = 24;
/** Maximum hours for one day across every project (API: `DAY_TOTAL_EXCEEDED`). */
export const MAX_HOURS_PER_DAY = 24;

/** Round to 2 decimals — mirrors the `Decimal(5,2)` server precision. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Keys ───────────────────────────────────────────────────────────────────

/** Identity of a grid row: a project, optionally narrowed to one task. */
export interface WeekRowRef {
  projectId: string;
  taskId: string | null;
}

/** Stable row id. UUIDs never contain `|`, so it is a safe separator. */
export function rowKey(projectId: string, taskId: string | null): string {
  return `${projectId}|${taskId ?? ''}`;
}

/** Inverse of {@link rowKey}. */
export function parseRowKey(key: string): WeekRowRef {
  const [projectId = '', taskId = ''] = key.split('|');
  return { projectId, taskId: taskId === '' ? null : taskId };
}

/** Stable cell id: a row plus one date. */
export function cellKey(rowId: string, date: string): string {
  return `${rowId}|${date}`;
}

/** Inverse of {@link cellKey} (splits on the last separator). */
export function parseCellKey(key: string): { rowId: string; date: string } {
  const index = key.lastIndexOf('|');
  return { rowId: key.slice(0, index), date: key.slice(index + 1) };
}

// ── Rows & matrix ──────────────────────────────────────────────────────────

export interface WeekRow {
  /** {@link rowKey} of the row. */
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  isBillable: boolean;
  taskId: string | null;
  taskName: string | null;
  /** `entry` rows come from the loaded timesheet; `manual` rows are user-added. */
  source: 'entry' | 'manual';
}

export interface WeekMatrix {
  /** Rows seeded from the loaded entries, ordered by project code then task. */
  rows: WeekRow[];
  /** Server hours per cell key (absent = 0). */
  baseline: Record<string, number>;
  /** Server entry ids per cell key (usually zero or one). */
  entryIds: Record<string, string[]>;
  /** Cell keys backed by more than one entry — inline editing is disabled. */
  splitCells: Record<string, true>;
}

function rowFromEntry(entry: TimesheetEntry): WeekRow {
  return {
    id: rowKey(entry.projectId, entry.taskId),
    projectId: entry.projectId,
    projectCode: entry.project.code,
    projectName: entry.project.name,
    isBillable: entry.project.isBillable,
    taskId: entry.taskId,
    taskName: entry.task?.name ?? null,
    source: 'entry',
  };
}

/** Build a row for a project the user added to the grid by hand. */
export function manualWeekRow(project: Project, task: ProjectTask | null): WeekRow {
  return {
    id: rowKey(project.id, task?.id ?? null),
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    isBillable: project.isBillable,
    taskId: task?.id ?? null,
    taskName: task?.name ?? null,
    source: 'manual',
  };
}

/**
 * Fold the week's entries into the grid's baseline state. Entries outside
 * `dates` are ignored defensively; entries sharing a cell are summed and the
 * cell is flagged as split so the editor leaves it read-only.
 */
export function buildWeekMatrix(entries: TimesheetEntry[], dates: string[]): WeekMatrix {
  const inWeek = new Set(dates);
  const rowMap = new Map<string, WeekRow>();
  const baseline: Record<string, number> = {};
  const entryIds: Record<string, string[]> = {};
  const splitCells: Record<string, true> = {};

  for (const entry of entries) {
    const date = entry.entryDate.slice(0, 10);
    if (!inWeek.has(date)) continue;
    const row = rowFromEntry(entry);
    if (!rowMap.has(row.id)) rowMap.set(row.id, row);

    const key = cellKey(row.id, date);
    baseline[key] = round2((baseline[key] ?? 0) + entry.hours);
    const ids = entryIds[key] ?? [];
    ids.push(entry.id);
    entryIds[key] = ids;
    if (ids.length > 1) splitCells[key] = true;
  }

  const rows = [...rowMap.values()].sort(
    (a, b) =>
      a.projectCode.localeCompare(b.projectCode) ||
      (a.taskName ?? '').localeCompare(b.taskName ?? ''),
  );

  return { rows, baseline, entryIds, splitCells };
}

// ── Cell inputs ────────────────────────────────────────────────────────────

/** Parse a raw cell input into hours, mirroring the API's zod rules. */
export function parseHoursInput(raw: string): { hours: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { hours: 0, error: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { hours: null, error: 'Enter a number.' };
  if (value < 0) return { hours: null, error: 'Hours cannot be negative.' };
  if (value > MAX_HOURS_PER_CELL) {
    return { hours: null, error: `Maximum ${MAX_HOURS_PER_CELL}h in one cell.` };
  }
  if (Math.round(value * 100) % (HOURS_STEP * 100) !== 0) {
    return { hours: null, error: `Use ${HOURS_STEP}h steps (e.g. 7.5).` };
  }
  return { hours: round2(value), error: null };
}

export interface ParsedCellInputs {
  /** Valid values per cell key; `0` means "clear this cell". */
  values: Record<string, number>;
  /** Field-level messages per cell key; invalid cells are excluded from `values`. */
  errors: Record<string, string>;
}

/** Parse every cell input once per keystroke-batch, keeping errors alongside. */
export function parseCellInputs(inputs: Record<string, string>): ParsedCellInputs {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(inputs)) {
    const { hours, error } = parseHoursInput(raw);
    if (error !== null || hours === null) {
      errors[key] = error ?? 'Enter a number.';
      continue;
    }
    values[key] = hours;
  }
  return { values, errors };
}

/** Seed the controlled inputs from the matrix baseline (`0` renders as empty). */
export function seedCellInputs(rows: WeekRow[], dates: string[], baseline: Record<string, number>) {
  const inputs: Record<string, string> = {};
  for (const row of rows) {
    for (const date of dates) {
      const key = cellKey(row.id, date);
      const hours = baseline[key] ?? 0;
      inputs[key] = hours > 0 ? String(hours) : '';
    }
  }
  return inputs;
}

// ── Diff ───────────────────────────────────────────────────────────────────

/** One cell that differs from the loaded timesheet. */
export interface WeekCellChange {
  rowId: string;
  projectId: string;
  taskId: string | null;
  date: string;
  /** Desired hours; `0` means the cell's entries should be removed. */
  hours: number;
  /** Server entry ids currently representing the cell. */
  entryIds: string[];
}

/**
 * Cells the user actually changed. Cells absent from `values` count as `0`, so
 * clearing a cell produces a change (and deletes its entry on save). Split
 * cells and rows that were removed from the grid are skipped.
 */
export function diffWeekCells(input: {
  rows: WeekRow[];
  values: Record<string, number>;
  baseline: Record<string, number>;
  entryIds: Record<string, string[]>;
  splitCells: Record<string, true>;
}): WeekCellChange[] {
  const rowIds = new Set(input.rows.map((row) => row.id));
  const keys = new Set([...Object.keys(input.values), ...Object.keys(input.baseline)]);
  const changes: WeekCellChange[] = [];

  for (const key of keys) {
    if (input.splitCells[key]) continue;
    const { rowId, date } = parseCellKey(key);
    if (!rowIds.has(rowId)) continue;

    const next = input.values[key] ?? 0;
    const previous = input.baseline[key] ?? 0;
    if (Math.abs(next - previous) < 1e-9) continue;

    const { projectId, taskId } = parseRowKey(rowId);
    changes.push({
      rowId,
      projectId,
      taskId,
      date,
      hours: next,
      entryIds: input.entryIds[key] ?? [],
    });
  }

  return changes;
}

// ── Validation & totals ────────────────────────────────────────────────────

export interface ProjectWeekTotal {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
}

export interface WeekValidation {
  /** Field-level messages per cell key (from {@link parseCellInputs}). */
  errors: Record<string, string>;
  /** Live hours per date, including unsaved edits. */
  dayTotals: Record<string, number>;
  /** Dates whose total exceeds {@link MAX_HOURS_PER_DAY}. */
  dayErrors: Record<string, string>;
  /** Live total per row id. */
  rowTotals: Record<string, number>;
  /** Live total per project, rolled up across task rows. */
  projectTotals: ProjectWeekTotal[];
  /** Live weekly total across every project. */
  weeklyTotal: number;
  /** Working days (Mon–Fri) still at zero hours — a non-blocking warning. */
  emptyWeekdays: string[];
  /** True when saving/submitting must be blocked. */
  invalid: boolean;
}

/**
 * Validate the draft and recompute every total the editor displays. Totals are
 * derived from the draft values so the summary updates as the user types,
 * while `invalid` gates saving and submission.
 */
export function validateWeekDraft(input: {
  rows: WeekRow[];
  values: Record<string, number>;
  inputErrors: Record<string, string>;
  dates: string[];
  periodStart: string;
}): WeekValidation {
  const { rows, values, dates, periodStart } = input;
  const rowTotals: Record<string, number> = {};
  const dayTotals: Record<string, number> = {};
  const byProject = new Map<string, ProjectWeekTotal>();

  for (const date of dates) dayTotals[date] = 0;

  for (const row of rows) {
    let rowTotal = 0;
    for (const date of dates) {
      const hours = values[cellKey(row.id, date)] ?? 0;
      if (hours === 0) continue;
      rowTotal += hours;
      dayTotals[date] = round2((dayTotals[date] ?? 0) + hours);
      const project = byProject.get(row.projectId) ?? {
        projectId: row.projectId,
        projectCode: row.projectCode,
        projectName: row.projectName,
        hours: 0,
      };
      project.hours = round2(project.hours + hours);
      byProject.set(row.projectId, project);
    }
    rowTotals[row.id] = round2(rowTotal);
  }

  const dayErrors: Record<string, string> = {};
  for (const date of dates) {
    if ((dayTotals[date] ?? 0) > MAX_HOURS_PER_DAY) {
      dayErrors[date] = `Total for this day cannot exceed ${MAX_HOURS_PER_DAY}h.`;
    }
  }

  const perDayTotals: PerDayTotal[] = dates.map((date) => ({
    date,
    hours: dayTotals[date] ?? 0,
  }));

  const weeklyTotal = round2(
    Object.values(dayTotals).reduce((sum, hours) => sum + hours, 0),
  );

  return {
    errors: input.inputErrors,
    dayTotals,
    dayErrors,
    rowTotals,
    projectTotals: [...byProject.values()].sort((a, b) =>
      a.projectCode.localeCompare(b.projectCode),
    ),
    weeklyTotal,
    emptyWeekdays: weekdayDatesWithZeroHours(periodStart, perDayTotals),
    invalid:
      Object.keys(input.inputErrors).length > 0 || Object.keys(dayErrors).length > 0,
  };
}

/** Short weekday label ("Mon") for a date, used by the mobile day switcher. */
export function weekdayShort(dateISO: string): string {
  return formatDayHeader(dateISO).split(',')[0] ?? dateISO;
}

/**
 * Default day for the mobile ledger: today when it falls inside the week,
 * otherwise Monday.
 */
export function defaultActiveDate(dates: string[], today: string): string {
  return dates.includes(today) ? today : (dates[0] ?? today);
}
