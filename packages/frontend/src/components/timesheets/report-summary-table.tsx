import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatHours } from '@/lib/timesheet-utils';
import { cn } from '@/lib/utils';
import type {
  DepartmentReportRow,
  EmployeeReportRow,
  ProjectReportRow,
  ReportGroupBy,
  SummaryReportRow,
} from '@/types/timesheet';

/** Plain-div horizontal bar visualizing one row's share of the maximum. */
function DistributionBar({
  hours,
  maxHours,
  billable,
}: {
  hours: number;
  maxHours: number;
  billable: boolean;
}) {
  return (
    <div className="h-2.5 w-full min-w-36 overflow-hidden rounded-full bg-ink-100">
      <div
        className={cn('h-full rounded-full', billable ? 'bg-accent-500' : 'bg-ink-400')}
        style={{ width: `${maxHours > 0 ? (hours / maxHours) * 100 : 0}%` }}
        title={`${formatHours(hours)}h`}
      />
    </div>
  );
}

export interface ReportSummaryTableProps {
  rows: SummaryReportRow[];
  groupBy: ReportGroupBy;
}

/**
 * Summary report table whose columns adapt to the grouping dimension, plus a
 * plain-div horizontal bar visualization of totalHours (no chart library).
 */
export function ReportSummaryTable({ rows, groupBy }: ReportSummaryTableProps) {
  const maxHours = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.totalHours), 0),
    [rows],
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {groupBy === 'employee' && (
              <>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Total hours</TableHead>
                <TableHead>Billable</TableHead>
                <TableHead>Entries</TableHead>
              </>
            )}
            {groupBy === 'project' && (
              <>
                <TableHead>Project</TableHead>
                <TableHead>Billable</TableHead>
                <TableHead>Total hours</TableHead>
                <TableHead>Entries</TableHead>
              </>
            )}
            {groupBy === 'department' && (
              <>
                <TableHead>Department</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead>Total hours</TableHead>
                <TableHead>Entries</TableHead>
              </>
            )}
            <TableHead className="min-w-48">Distribution</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-ink-400">
                No data for the selected filters.
              </TableCell>
            </TableRow>
          ) : groupBy === 'employee' ? (
            (rows as EmployeeReportRow[]).map((row) => (
              <TableRow key={row.employeeId}>
                <TableCell>
                  <div className="font-medium text-ink-900">{row.employeeName}</div>
                  <div className="text-xs text-ink-400">{row.employeeNo}</div>
                </TableCell>
                <TableCell className="text-sm text-ink-600">{row.departmentName ?? '—'}</TableCell>
                <TableCell className="font-mono text-sm font-semibold">
                  {formatHours(row.totalHours)}h
                </TableCell>
                <TableCell className="font-mono text-sm text-ink-600">
                  {formatHours(row.billableHours)}h
                </TableCell>
                <TableCell className="text-sm text-ink-600">{row.entryCount}</TableCell>
                <TableCell>
                  <DistributionBar hours={row.totalHours} maxHours={maxHours} billable />
                </TableCell>
              </TableRow>
            ))
          ) : groupBy === 'project' ? (
            (rows as ProjectReportRow[]).map((row) => (
              <TableRow key={row.projectId}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge className="border-transparent bg-ink-900 px-1.5 font-mono text-[10px] text-ink-50">
                      {row.projectCode}
                    </Badge>
                    <span className="font-medium text-ink-900">{row.projectName}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {row.isBillable ? (
                    <Badge className="border-transparent bg-accent-100 text-accent-800">
                      Billable
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-ink-500">
                      Non-billable
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold">
                  {formatHours(row.totalHours)}h
                </TableCell>
                <TableCell className="text-sm text-ink-600">{row.entryCount}</TableCell>
                <TableCell>
                  <DistributionBar
                    hours={row.totalHours}
                    maxHours={maxHours}
                    billable={row.isBillable}
                  />
                </TableCell>
              </TableRow>
            ))
          ) : (
            (rows as DepartmentReportRow[]).map((row) => (
              <TableRow key={row.departmentId}>
                <TableCell className="font-medium text-ink-900">{row.departmentName}</TableCell>
                <TableCell className="text-sm text-ink-600">{row.employeeCount}</TableCell>
                <TableCell className="font-mono text-sm font-semibold">
                  {formatHours(row.totalHours)}h
                </TableCell>
                <TableCell className="text-sm text-ink-600">{row.entryCount}</TableCell>
                <TableCell>
                  <DistributionBar hours={row.totalHours} maxHours={maxHours} billable />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
