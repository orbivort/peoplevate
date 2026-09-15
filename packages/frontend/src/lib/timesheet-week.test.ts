import { describe, expect, it } from 'vitest';

import { weekDates } from './timesheet-utils';
import {
  buildWeekMatrix,
  cellKey,
  defaultActiveDate,
  diffWeekCells,
  manualWeekRow,
  parseCellInputs,
  parseCellKey,
  parseHoursInput,
  parseRowKey,
  rowKey,
  round2,
  seedCellInputs,
  validateWeekDraft,
  weekdayShort,
} from './timesheet-week';
import type { Project, ProjectTask, TimesheetEntry } from '@/types/timesheet';

const PERIOD_START = '2026-09-14T00:00:00.000Z';
const DATES = weekDates(PERIOD_START);

function makeEntry(overrides: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    id: 'entry-1',
    timesheetId: 'ts-1',
    employeeId: 'e-006',
    entryDate: '2026-09-14',
    projectId: 'p-erp',
    project: { id: 'p-erp', code: 'ERP-001', name: 'ERP Migration', isBillable: true },
    taskId: null,
    task: null,
    hours: 8,
    description: null,
    createdAt: '2026-09-14T08:00:00Z',
    updatedAt: '2026-09-14T08:00:00Z',
    ...overrides,
  };
}

const project: Project = {
  id: 'p-web',
  code: 'WEB-002',
  name: 'Website Redesign',
  description: null,
  client: null,
  isBillable: false,
  startDate: null,
  endDate: null,
  isActive: true,
  taskCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const task: ProjectTask = {
  id: 't-impl',
  projectId: 'p-web',
  name: 'Implementation',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('grid keys', () => {
  it('round-trips row ids, including the "no task" case', () => {
    expect(rowKey('p-erp', null)).toBe('p-erp|');
    expect(parseRowKey('p-erp|')).toEqual({ projectId: 'p-erp', taskId: null });
    expect(parseRowKey(rowKey('p-erp', 't-1'))).toEqual({ projectId: 'p-erp', taskId: 't-1' });
  });

  it('round-trips cell ids after the row separator', () => {
    const key = cellKey(rowKey('p-erp', 't-1'), '2026-09-15');
    expect(key).toBe('p-erp|t-1|2026-09-15');
    expect(parseCellKey(key)).toEqual({ rowId: 'p-erp|t-1', date: '2026-09-15' });
  });
});

describe('buildWeekMatrix', () => {
  it('seeds one row per (project, task) ordered by project code', () => {
    const matrix = buildWeekMatrix(
      [
        makeEntry({ id: 'e-2', projectId: 'p-web', project: { id: 'p-web', code: 'WEB-002', name: 'Website Redesign', isBillable: false } }),
        makeEntry(),
      ],
      DATES,
    );

    expect(matrix.rows.map((row) => row.projectCode)).toEqual(['ERP-001', 'WEB-002']);
    expect(matrix.rows[0]).toMatchObject({ taskId: null, taskName: null, source: 'entry' });
    expect(matrix.baseline[cellKey(rowKey('p-erp', null), '2026-09-14')]).toBe(8);
    expect(matrix.entryIds[cellKey(rowKey('p-erp', null), '2026-09-14')]).toEqual(['entry-1']);
  });

  it('sums entries that share a cell and flags it as split', () => {
    const matrix = buildWeekMatrix(
      [
        makeEntry({ id: 'e-1', taskId: 't-1', task: { id: 't-1', name: 'Implementation' }, hours: 4 }),
        makeEntry({ id: 'e-2', taskId: 't-1', task: { id: 't-1', name: 'Implementation' }, hours: 3.5 }),
      ],
      DATES,
    );

    const key = cellKey(rowKey('p-erp', 't-1'), '2026-09-14');
    expect(matrix.baseline[key]).toBe(7.5);
    expect(matrix.entryIds[key]).toEqual(['e-1', 'e-2']);
    expect(matrix.splitCells[key]).toBe(true);
  });

  it('ignores entries outside the requested week', () => {
    const matrix = buildWeekMatrix([makeEntry({ entryDate: '2026-08-31' })], DATES);
    expect(matrix.rows).toHaveLength(0);
  });

  it('builds a manual row from the project catalog', () => {
    expect(manualWeekRow(project, task)).toEqual({
      id: 'p-web|t-impl',
      projectId: 'p-web',
      projectCode: 'WEB-002',
      projectName: 'Website Redesign',
      isBillable: false,
      taskId: 't-impl',
      taskName: 'Implementation',
      source: 'manual',
    });
    expect(manualWeekRow(project, null).taskName).toBeNull();
  });
});

describe('parseHoursInput', () => {
  it('accepts blank as "clear the cell" and valid 0.25 steps', () => {
    expect(parseHoursInput('')).toEqual({ hours: 0, error: null });
    expect(parseHoursInput('8')).toEqual({ hours: 8, error: null });
    expect(parseHoursInput(' 7.5 ')).toEqual({ hours: 7.5, error: null });
    expect(parseHoursInput('0.25')).toEqual({ hours: 0.25, error: null });
  });

  it('rejects negative, oversized, non-multiple, and non-numeric input', () => {
    expect(parseHoursInput('-1').error).toMatch(/negative/i);
    expect(parseHoursInput('25').error).toMatch(/maximum 24h/i);
    expect(parseHoursInput('7.55').error).toMatch(/0.25h steps/i);
    expect(parseHoursInput('abc').error).toMatch(/number/i);
  });

  it('rounds to the server precision', () => {
    expect(round2(7.1 + 0.2)).toBe(7.3);
    expect(parseHoursInput('7.25').hours).toBe(7.25);
    // 7.1 is not a 0.25 multiple, so it is rejected rather than rounded.
    expect(parseHoursInput('7.1').hours).toBeNull();
  });
});

describe('parseCellInputs', () => {
  it('splits valid values from field errors', () => {
    const { values, errors } = parseCellInputs({ 'p-erp||2026-09-14': '8', 'p-erp||2026-09-15': 'nope' });
    expect(values).toEqual({ 'p-erp||2026-09-14': 8 });
    expect(errors['p-erp||2026-09-15']).toMatch(/number/i);
  });
});

describe('seedCellInputs', () => {
  it('renders zero baseline as an empty input and non-zero as a string', () => {
    const rows = buildWeekMatrix([makeEntry()], DATES).rows;
    const inputs = seedCellInputs(rows, DATES, { [cellKey('p-erp|', '2026-09-14')]: 8 });
    expect(inputs['p-erp||2026-09-14']).toBe('8');
    expect(inputs['p-erp||2026-09-15']).toBe('');
  });
});

describe('diffWeekCells', () => {
  const matrix = buildWeekMatrix([makeEntry()], DATES);

  function diff(values: Record<string, number>, rows = matrix.rows) {
    return diffWeekCells({
      rows,
      values,
      baseline: matrix.baseline,
      entryIds: matrix.entryIds,
      splitCells: matrix.splitCells,
    });
  }

  it('returns nothing when the draft matches the baseline', () => {
    expect(diff({ ...matrix.baseline })).toEqual([]);
  });

  it('reports an update with the entry it targets', () => {
    expect(diff({ ...matrix.baseline, 'p-erp||2026-09-14': 6 })).toEqual([
      {
        rowId: 'p-erp|',
        projectId: 'p-erp',
        taskId: null,
        date: '2026-09-14',
        hours: 6,
        entryIds: ['entry-1'],
      },
    ]);
  });

  it('reports a clear (0h) when a baseline cell disappears from the draft', () => {
    const changes = diff({});
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ hours: 0, entryIds: ['entry-1'] });
  });

  it('reports a create for a brand-new cell', () => {
    const changes = diff({ ...matrix.baseline, 'p-erp||2026-09-17': 4 });
    expect(changes).toEqual([
      { rowId: 'p-erp|', projectId: 'p-erp', taskId: null, date: '2026-09-17', hours: 4, entryIds: [] },
    ]);
  });

  it('skips rows removed from the grid and split cells', () => {
    expect(diff({ ...matrix.baseline, 'p-erp||2026-09-14': 6 }, [])).toEqual([]);

    const split = buildWeekMatrix(
      [
        makeEntry({ id: 'a', taskId: 't-1', task: { id: 't-1', name: 'A' }, hours: 4 }),
        makeEntry({ id: 'b', taskId: 't-1', task: { id: 't-1', name: 'A' }, hours: 4 }),
      ],
      DATES,
    );
    const key = 'p-erp|t-1|2026-09-14';
    expect(
      diffWeekCells({
        rows: split.rows,
        values: { ...split.baseline, [key]: 2 },
        baseline: split.baseline,
        entryIds: split.entryIds,
        splitCells: split.splitCells,
      }),
    ).toEqual([]);
  });
});

describe('validateWeekDraft', () => {
  // Two project rows so the per-day cap (which sums across projects) is exercised.
  const rows = buildWeekMatrix(
    [
      makeEntry(),
      makeEntry({
        id: 'entry-2',
        entryDate: '2026-09-16',
        projectId: 'p-web',
        project: { id: 'p-web', code: 'WEB-002', name: 'Website Redesign', isBillable: false },
        hours: 2.5,
      }),
    ],
    DATES,
  ).rows;

  function validate(values: Record<string, number>, inputErrors: Record<string, string> = {}) {
    return validateWeekDraft({ rows, values, inputErrors, dates: DATES, periodStart: PERIOD_START });
  }

  it('computes row, day, project, and weekly totals from the draft', () => {
    const result = validate({ 'p-erp||2026-09-14': 6, 'p-erp||2026-09-16': 2.5 });
    expect(result.weeklyTotal).toBe(8.5);
    expect(result.dayTotals['2026-09-14']).toBe(6);
    expect(result.dayTotals['2026-09-16']).toBe(2.5);
    expect(result.rowTotals['p-erp|']).toBe(8.5);
    expect(result.projectTotals).toEqual([
      { projectId: 'p-erp', projectCode: 'ERP-001', projectName: 'ERP Migration', hours: 8.5 },
    ]);
    expect(result.invalid).toBe(false);
  });

  it('blocks the day cap and reports the offending dates', () => {
    const result = validate({ 'p-erp||2026-09-14': 20, 'p-web||2026-09-14': 6 });
    expect(result.dayTotals['2026-09-14']).toBe(26);
    expect(result.dayErrors['2026-09-14']).toMatch(/cannot exceed 24h/i);
    expect(result.invalid).toBe(true);
  });

  it('flags working days without hours without blocking submission', () => {
    const result = validate({ 'p-erp||2026-09-14': 8 });
    expect(result.emptyWeekdays).toEqual(['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
    expect(result.invalid).toBe(false);
  });

  it('is invalid when a cell input could not be parsed', () => {
    const result = validate({ 'p-erp||2026-09-14': 8 }, { 'p-erp||2026-09-15': 'Enter a number.' });
    expect(result.invalid).toBe(true);
    expect(result.errors['p-erp||2026-09-15']).toBe('Enter a number.');
  });
});

describe('date helpers', () => {
  it('renders a short weekday label', () => {
    expect(weekdayShort('2026-09-14')).toBe('Mon');
    expect(weekdayShort('2026-09-20')).toBe('Sun');
  });

  it('defaults to today when it falls in the week, else Monday', () => {
    expect(defaultActiveDate(DATES, '2026-09-16')).toBe('2026-09-16');
    expect(defaultActiveDate(DATES, '2026-10-01')).toBe('2026-09-14');
  });
});
