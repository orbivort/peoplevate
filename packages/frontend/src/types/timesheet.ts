// Domain types for the Timesheet feature.
//
// These mirror the locked backend API contract at
// `temp/docs/timesheet-api-contract.md`. The backend serializes camelCase DTOs
// (the service layer translates to/from snake_case columns), so responses can
// be used directly without adapters.

export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type ApprovalAction = 'APPROVE' | 'REJECT';

export type ReportGroupBy = 'employee' | 'project' | 'department';

/** Referenced employee stub embedded in timesheet DTOs. */
export interface TimesheetEmployeeRef {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
}

/** Referenced project stub embedded in entry DTOs. */
export interface EntryProjectRef {
  id: string;
  code: string;
  name: string;
  isBillable: boolean;
}

/** Referenced task stub embedded in entry DTOs. */
export interface EntryTaskRef {
  id: string;
  name: string;
}

export interface TimesheetEntry {
  id: string;
  timesheetId: string;
  employeeId: string;
  entryDate: string; // date-only semantics (YYYY-MM-DD)
  projectId: string;
  project: EntryProjectRef;
  taskId: string | null;
  task: EntryTaskRef | null;
  hours: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimesheetApproval {
  id: string;
  action: ApprovalAction;
  comment: string | null;
  approverId: string;
  approverEmail: string;
  createdAt: string;
}

export interface PerDayTotal {
  date: string; // YYYY-MM-DD
  hours: number;
}

export interface PerProjectTotal {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
}

/** List item / approval-queue row. */
export interface TimesheetSummary {
  id: string;
  employeeId: string;
  employee: TimesheetEmployeeRef;
  periodStart: string; // Monday 00:00
  periodEnd: string; // Sunday 23:59:59.999
  status: TimesheetStatus;
  submittedAt: string | null;
  weeklyTotalHours: number;
  entryCount: number;
}

/** Full timesheet with entries, approval history, and computed totals. */
export interface TimesheetDetail extends TimesheetSummary {
  createdAt: string;
  updatedAt: string;
  entries: TimesheetEntry[];
  approvals: TimesheetApproval[];
  perDayTotals: PerDayTotal[];
  perProjectTotals: PerProjectTotal[];
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  client: string | null;
  isBillable: boolean;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Project row enriched with usage counts for the admin catalog table. */
export interface ProjectAdminStats extends Project {
  entryCount: number;
}

// ── Reports ────────────────────────────────────────────────────────────────

export interface TimesheetReportFilters {
  from: string; // YYYY-MM-DD, required
  to: string; // YYYY-MM-DD, required
  groupBy?: ReportGroupBy;
  employeeId?: string;
  departmentId?: string;
  projectId?: string;
  includeAllStatuses?: boolean;
}

export interface EmployeeReportRow {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  totalHours: number;
  billableHours: number;
  entryCount: number;
}

export interface ProjectReportRow {
  projectId: string;
  projectCode: string;
  projectName: string;
  isBillable: boolean;
  totalHours: number;
  entryCount: number;
}

export interface DepartmentReportRow {
  departmentId: string;
  departmentName: string;
  employeeCount: number;
  totalHours: number;
  entryCount: number;
}

export type SummaryReportRow = EmployeeReportRow | ProjectReportRow | DepartmentReportRow;

export interface SummaryReportResponse {
  rows: SummaryReportRow[];
  groupBy: ReportGroupBy;
  from: string;
  to: string;
  includeAllStatuses: boolean;
}

/** Detail-row entry: a TimesheetEntry plus employee and status context. */
export interface ReportDetailEntry extends TimesheetEntry {
  employeeName: string;
  timesheetStatus: TimesheetStatus;
}

export interface DetailsReportResponse {
  entries: ReportDetailEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Payloads (writes) ──────────────────────────────────────────────────────

export interface CreateEntryPayload {
  entryDate: string; // YYYY-MM-DD
  projectId: string;
  taskId?: string | null;
  hours: number;
  description?: string | null;
}

export interface UpdateEntryPayload {
  entryDate?: string;
  projectId?: string;
  taskId?: string | null;
  hours?: number;
  description?: string | null;
}

export interface CreateProjectPayload {
  code: string;
  name: string;
  description?: string | null;
  client?: string | null;
  isBillable?: boolean;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateProjectPayload {
  code?: string;
  name?: string;
  description?: string | null;
  client?: string | null;
  isBillable?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
}
