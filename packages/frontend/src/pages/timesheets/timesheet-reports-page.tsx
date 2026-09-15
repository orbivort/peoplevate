import { BarChart3, Download, FileClock, Play, Table2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ReportSummaryTable } from '@/components/timesheets/report-summary-table';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useDepartments, useEmployees } from '@/data/data-layer';
import { projectRepo, timesheetReportRepo } from '@/lib/timesheet-api';
import { formatDate } from '@/lib/utils';
import { formatHours, todayISO } from '@/lib/timesheet-utils';
import type {
  DetailsReportResponse,
  Project,
  ReportGroupBy,
  SummaryReportResponse,
} from '@/types/timesheet';

function firstDayOfMonthISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Filter snapshot shape handed to the report repositories. */
interface ReportFilters {
  from: string;
  to: string;
  groupBy: ReportGroupBy;
  employeeId?: string;
  departmentId?: string;
  projectId?: string;
  includeAllStatuses?: boolean;
}

export function TimesheetReportsPage() {
  const { showToast, toastElement } = useToast();
  const { data: employees } = useEmployees();
  const { data: departments } = useDepartments();

  // ── Filters ──────────────────────────────────────────────────────────────
  const [from, setFrom] = useState(firstDayOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('employee');
  const [employeeId, setEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [includeAllStatuses, setIncludeAllStatuses] = useState(false);

  // ── Results ──────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<SummaryReportResponse | null>(null);
  const [details, setDetails] = useState<DetailsReportResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [running, setRunning] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectRepo
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filters = useMemo(
    () => ({
      from,
      to,
      groupBy,
      ...(employeeId ? { employeeId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(projectId ? { projectId } : {}),
      includeAllStatuses,
    }),
    [from, to, groupBy, employeeId, departmentId, projectId, includeAllStatuses],
  );

  /** Filters snapshot applied by the last "Run report" click (null = not run). */
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters | null>(null);

  // Run the summary whenever the report is (re)run. Busy flags are raised by
  // the triggering event handler ("Run report"), never synchronously here.
  useEffect(() => {
    if (!appliedFilters) return;
    let cancelled = false;
    timesheetReportRepo
      .summary(appliedFilters)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to run the report.');
      })
      .finally(() => {
        if (!cancelled) setRunning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedFilters]);

  // Details are fetched (paged) only while the Details tab is visible.
  useEffect(() => {
    if (!appliedFilters) return;
    let cancelled = false;
    timesheetReportRepo
      .details({ ...appliedFilters, page, pageSize })
      .then((res) => {
        if (!cancelled) setDetails(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load details.');
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedFilters, page, pageSize]);

  const handleRun = useCallback(() => {
    if (!from || !to) {
      setError('From and to dates are required.');
      return;
    }
    if (to < from) {
      setError('The end date cannot be before the start date.');
      return;
    }
    if (filters === appliedFilters) return; // nothing changed since the last run
    setError(null);
    setRunning(true);
    setDetailsLoading(true);
    setPage(1);
    setAppliedFilters(filters);
  }, [from, to, filters, appliedFilters]);

  /** Pagination handlers raise the details spinner before changing the page. */
  const handlePageChange = useCallback(
    (next: number) => {
      if (next === page) return;
      setDetailsLoading(true);
      setPage(next);
    },
    [page],
  );

  const handlePageSizeChange = useCallback(
    (size: number) => {
      if (size === pageSize) return;
      setDetailsLoading(true);
      setPageSize(size);
      setPage(1);
    },
    [pageSize],
  );

  const handleExport = useCallback(async () => {
    if (!appliedFilters) return;
    setExporting(true);
    try {
      await timesheetReportRepo.exportCsv(appliedFilters);
      showToast('success', 'CSV export downloaded.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [appliedFilters, showToast]);

  const totalPages = details ? Math.max(1, Math.ceil(details.total / details.pageSize)) : 1;

  return (
    <div>
      {toastElement}
      <PageHeader
        title="Timesheet reports"
        description="Analyze worked hours by employee, project, or department over a date range."
        actions={
          <Button
            variant="outline"
            onClick={() => void handleExport()}
            disabled={exporting || !appliedFilters}
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        }
      />

      {/* Filter bar */}
      <Card className="mb-6">
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="report-from">From *</Label>
              <Input
                id="report-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-to">To *</Label>
              <Input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-employee">Employee</Label>
              <NativeSelect
                id="report-employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">All employees</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.employeeNo})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-department">Department</Label>
              <NativeSelect
                id="report-department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="report-project">Project</Label>
              <NativeSelect
                id="report-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} — {project.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-end gap-2">
              <input
                id="report-all-statuses"
                type="checkbox"
                checked={includeAllStatuses}
                onChange={(e) => setIncludeAllStatuses(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-ink-300 accent-ink-900"
              />
              <Label htmlFor="report-all-statuses" className="cursor-pointer">
                Include pending & rejected
              </Label>
            </div>
            <div className="flex items-end">
              <Button variant="accent" onClick={handleRun} disabled={running}>
                <Play className="h-4 w-4" />
                {running ? 'Running…' : 'Run report'}
              </Button>
            </div>
          </div>
          {!includeAllStatuses && (
            <p className="text-xs text-ink-400">
              Showing approved hours only. Tick “Include pending & rejected” to widen the scope.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">
            <BarChart3 className="h-3.5 w-3.5" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="details">
            <Table2 className="h-3.5 w-3.5" />
            Details
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          {/* Group-by segmented control */}
          <div className="mb-4 flex items-center gap-1 self-start rounded-lg bg-ink-100 p-1">
            {(['employee', 'project', 'department'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setGroupBy(option)}
                className={
                  groupBy === option
                    ? 'rounded-md bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-sm'
                    : 'rounded-md px-3 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:text-ink-900'
                }
              >
                {option === 'employee' ? 'By employee' : option === 'project' ? 'By project' : 'By department'}
              </button>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              {summary === null ? (
                <div className="flex h-32 items-center justify-center text-sm text-ink-500">
                  Set your filters and run the report to see results.
                </div>
              ) : (
                <ReportSummaryTable rows={summary.rows} groupBy={summary.groupBy} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {detailsLoading && details === null ? (
                <div className="flex h-32 items-center justify-center text-sm text-ink-500">
                  Loading details…
                </div>
              ) : details === null ? (
                <div className="flex h-32 items-center justify-center text-sm text-ink-500">
                  Set your filters and run the report to see entries.
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Task</TableHead>
                        <TableHead>Hours</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.entries.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-8 text-center text-sm text-ink-400">
                            No entries for the selected filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        details.entries.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="text-sm font-medium text-ink-900">
                              {entry.employeeName}
                            </TableCell>
                            <TableCell className="text-sm text-ink-600">
                              {formatDate(entry.entryDate)}
                            </TableCell>
                            <TableCell className="text-sm text-ink-700">
                              {entry.project.code} — {entry.project.name}
                            </TableCell>
                            <TableCell className="text-sm text-ink-600">
                              {entry.task?.name ?? '—'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {formatHours(entry.hours)}h
                            </TableCell>
                            <TableCell className="text-xs text-ink-500">
                              {entry.timesheetStatus}
                            </TableCell>
                            <TableCell
                              className="max-w-48 truncate text-sm text-ink-500"
                              title={entry.description ?? undefined}
                            >
                              {entry.description ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    total={details.total}
                    pageSize={details.pageSize}
                    onPageChange={handlePageChange}
                    onPageSizeChange={handlePageSizeChange}
                    disabled={detailsLoading}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-400">
        <FileClock className="h-3.5 w-3.5" />
        Every report run and CSV export is recorded in the audit log.
      </p>
    </div>
  );
}
