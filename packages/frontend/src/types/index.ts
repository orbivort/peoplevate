// Domain types for Phase 1: Foundation & Core Employee Data Management

export type Role = 'Admin' | 'HR Manager' | 'Manager' | 'Employee';

export type EmploymentStatus = 'New Hire' | 'Probation' | 'Active' | 'On Leave' | 'Terminated';

export type EmploymentType = 'Full-time' | 'Part-time' | 'Contract';

export interface User {
  id: string;
  email: string;
  role: Role;
  status: 'active' | 'deactivated' | 'pending_setup';
  employeeId?: string | undefined;
}

export interface Department {
  id: string;
  name: string;
  description?: string | undefined;
  parentId?: string | null;
  createdAt: string;
  positionCount: number;
  employeeCount: number;
}

export interface Position {
  id: string;
  name: string;
  grade?: string | undefined;
  description?: string | undefined;
  departmentId: string;
  departmentName: string;
  employeeCount: number;
  createdAt: string;
}

export interface Employee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female' | 'Other';
  nationalId: string;
  email: string;
  phone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  managerId?: string | null;
  managerName?: string | null;
  hireDate: string;
  employmentType: EmploymentType;
  salary: number;
  status: EmploymentStatus;
  deactivationDate?: string | null;
  avatarUrl?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export type DocumentType =
  | 'Contract'
  | 'National ID'
  | 'Passport'
  | 'Work Permit'
  | 'Certification'
  | 'Medical Certificate'
  | 'Other';

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  type: DocumentType;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  expiryDate?: string | null;
}

export type ChangeType =
  'Promotion' | 'Transfer' | 'Manager Change' | 'Salary Adjustment' | 'Status Change';

export interface EmploymentChange {
  id: string;
  employeeId: string;
  changeType: ChangeType;
  oldValue: string;
  newValue: string;
  effectiveDate: string;
  status: 'Applied' | 'Pending';
  reason: string;
  recordedBy: string;
  recordedAt: string;
}

/** A single field-level change extracted from an audit log row. */
export interface AuditChange {
  field: string;
  label: string;
  old: string | null;
  new: string | null;
  sensitive: boolean;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT';
  entity: string;
  entityLabel: string;
  entityId: string;
  changes: AuditChange[];
  /** Result of the operation. Audit rows are immutable so this is "Success". */
  status: string;
  timestamp: string;
}

/** Query parameters for fetching a page of audit log entries. */
export interface AuditLogQueryParams {
  action?: string | undefined;
  entity?: string | undefined;
  search?: string | undefined;
  /** Inclusive ISO date-range start (YYYY-MM-DD or full timestamp). */
  from?: string | undefined;
  /** Inclusive ISO date-range end (YYYY-MM-DD or full timestamp). */
  to?: string | undefined;
  /** Filter by the actor (user) who performed the operation. */
  user?: string | undefined;
  page: number;
  pageSize: number;
  /**
   * Frontend-only hint (never sent to the API) that restricts the result set to
   * employee/document entities. Used to mirror the backend's HR-scope behavior
   * in mock/fallback mode; the real backend always enforces this server-side.
   */
  hrScoped?: boolean | undefined;
}

/** Server-side pagination metadata returned alongside a list of records. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ExpiryAlert {
  id: string;
  documentId: string;
  employeeId: string;
  employeeName: string;
  documentType: DocumentType;
  expiryDate: string;
  daysUntilExpiry: number;
  severity: 'expired' | 'soon';
  acknowledged: boolean;
}

// ---------------------------------------------------------------------------
// Phase 2: Recruitment & Onboarding (FR-006 – FR-013)
// ---------------------------------------------------------------------------

export type RequisitionStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Published' | 'Closed';

export interface JobRequisition {
  id: string;
  title: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  headcount: number;
  employmentType: EmploymentType;
  status: RequisitionStatus;
  createdBy: string;
  createdAt: string;
  publishedAt?: string | null;
  closingDate?: string | null;
  applicantCount: number;
}

export type CandidateStage = 'Applied' | 'Screening' | 'Interview' | 'Offer' | 'Hired' | 'Rejected';

export type CandidateSource = 'Referral' | 'Job Board' | 'Direct' | 'Internal';

export interface Candidate {
  id: string;
  requisitionId: string;
  requisitionTitle: string;
  name: string;
  email: string;
  phone: string;
  source: CandidateSource;
  stage: CandidateStage;
  resumeFilename?: string | undefined;
  consentRecorded: boolean;
  appliedAt: string;
  employeeId?: string | undefined;
  stageHistory: { stage: CandidateStage; at: string; by: string }[];
}

export interface Interview {
  id: string;
  candidateId: string;
  candidateName: string;
  requisitionTitle: string;
  scheduledAt: string;
  durationMin: number;
  interviewers: string[];
  location: string;
  notes?: string | undefined;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
}

export type OfferStatus = 'Draft' | 'Sent' | 'Accepted' | 'Declined';

export interface OfferLetter {
  id: string;
  candidateId: string;
  candidateName: string;
  position: string;
  salary: number;
  startDate: string;
  status: OfferStatus;
  sentAt?: string | null | undefined;
  acceptedAt?: string | null | undefined;
  createdBy: string;
  createdAt: string;
}

export type OnboardingTaskStatus = 'Pending' | 'Complete' | 'Overdue';
export type OnboardingTaskType =
  'Document Submission' | 'Equipment Assignment' | 'Orientation Session' | 'System Access Setup';

export interface OnboardingTask {
  id: string;
  employeeId: string;
  employeeName: string;
  type: OnboardingTaskType;
  assignee: string;
  dueDate: string;
  status: OnboardingTaskStatus;
  completedAt?: string | null;
}

export interface OnboardingRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  status: 'In Progress' | 'Complete';
  tasks: OnboardingTask[];
  completedTasks: number;
  totalTasks: number;
}

// ---------------------------------------------------------------------------
// Phase 2: Attendance & Leave Tracking (FR-019 – FR-024)
// ---------------------------------------------------------------------------

export type AttendanceStatus =
  'Present' | 'Absent' | 'Late' | 'Early Departure' | 'On Leave' | 'Holiday';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  clockIn?: string | null | undefined;
  clockOut?: string | null | undefined;
  totalHours?: number | null | undefined;
  status: AttendanceStatus;
  ipAddress?: string | null | undefined;
}

export type LeaveType = 'Annual' | 'Sick' | 'Personal' | 'Unpaid';

export type LeaveRequestStatus =
  'Pending Manager Approval' | 'Pending HR Approval' | 'Approved' | 'Rejected' | 'Withdrawn';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  attachmentFilename?: string | undefined;
  status: LeaveRequestStatus;
  submittedBy: string;
  submittedAt: string;
  approvals: {
    level: number;
    approver: string;
    decision: 'Approved' | 'Rejected' | 'Pending';
    comment?: string | undefined;
    at: string;
  }[];
}

export interface ProrationDetail {
  fullEntitlement: number;
  proratedEntitlement: number;
  hireDate: string;
  remainingDays: number;
  totalDays: number;
  remainingMonths: number;
  fraction: number;
}

export interface ProbationBlock {
  underProbation: boolean;
  hireDate: string;
  probationMonths: number;
  probationEndDate: string;
  remainingDays: number;
}

export interface LeaveBalance {
  employeeId: string;
  leaveType: LeaveType;
  leaveTypeId?: string | undefined;
  entitlement: number;
  accrued: number;
  used: number;
  pending: number;
  carryForward: number;
  available: number;
  source?: string | null;
  policyGroupName?: string | null;
  /** True when the entitlement was pro-rated for a mid-year joiner. */
  prorated?: boolean;
  /** Derivation metadata used to explain the pro-rated balance in the UI. */
  proration?: ProrationDetail | null;
  /** Present when the employee is under probation and has no leave entitlement. */
  probation?: ProbationBlock | null;
}

export interface LeavePolicyGroupEntitlement {
  id: string;
  leave_type_id: string;
  leave_type?: { id: string; name: string };
  annual_days: number;
}

export interface LeavePolicyGroup {
  id: string;
  name: string;
  description?: string | null;
  year: number;
  employment_type?: string | null;
  grades: string[];
  department_id?: string | null;
  proration_enabled: boolean;
  entitlements: LeavePolicyGroupEntitlement[];
  headcount?: number;
  created_at: string;
  updated_at: string;
}

export type HolidayType = 'STATUTORY' | 'COMPANY' | 'FLOATING';

export type Holiday = {
  id: string;
  name: string;
  date: string;
  year: number;
  type: HolidayType;
  recurring: boolean;
};

// ---------------------------------------------------------------------------
// Phase 2: Performance Management (FR-025 – FR-029)
// ---------------------------------------------------------------------------

export type EvaluationType = 'Probation' | 'Mid-Year' | 'End-Year';
export type EvaluationPhase =
  'Not Started' | 'Self-Evaluation' | 'Manager Evaluation' | 'HR Review' | 'Completed' | 'Closed';
export type CycleStatus = 'Draft' | 'Open' | 'Closed';

export interface EvaluationCycle {
  id: string;
  type: EvaluationType;
  periodStart: string;
  periodEnd: string;
  selfEvalStart: string;
  selfEvalEnd: string;
  managerEvalStart: string;
  managerEvalEnd: string;
  hrReviewStart: string;
  hrReviewEnd: string;
  status: CycleStatus;
  currentPhase: EvaluationPhase;
}

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface CompetencyRating {
  competency: string;
  selfRating?: Rating | undefined;
  managerRating?: Rating | undefined;
  comments?: string | undefined;
}

export type ReviewStatus =
  'Not Started' | 'Self-Evaluation' | 'Manager Evaluation' | 'HR Review' | 'Completed';

export interface PerformanceReview {
  id: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  employeeName: string;
  managerName: string;
  status: ReviewStatus;
  selfEvaluationSubmitted: boolean;
  selfEvaluationSubmittedAt?: string | null;
  managerEvaluationSubmitted: boolean;
  managerEvaluationSubmittedAt?: string | null;
  hrFinalized: boolean;
  hrFinalizedAt?: string | null;
  competencies: CompetencyRating[];
  achievements?: string | undefined;
  goals?: string | undefined;
  managerComments?: string | undefined;
  hrComments?: string | undefined;
  overallRating?: Rating | undefined;
  rebuttal?: string | undefined;
}

// ---------------------------------------------------------------------------
// Phase 2: Offboarding & Separation (FR-030 – FR-035)
// ---------------------------------------------------------------------------

export type SeparationType = 'Resignation' | 'Dismissal' | 'End of Contract';
export type OffboardingStatus =
  'Initiated' | 'Clearance In Progress' | 'Exit Interview' | 'Settlement' | 'Closed';

export interface OffboardingRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  positionName: string;
  separationType: SeparationType;
  reason: string;
  lastWorkingDay: string;
  status: OffboardingStatus;
  initiatedBy: string;
  initiatedAt: string;
  deactivationDate: string;
  clearanceItems: ClearanceItem[];
  exitInterview?: ExitInterview | null;
  settlement?: FinalSettlement | null;
}

export type ClearanceItemStatus = 'Pending' | 'Complete' | 'Waived';
export type ClearanceCategory =
  'Asset Return' | 'Access Revocation' | 'Knowledge Transfer' | 'Final Settlement';

export interface ClearanceItem {
  id: string;
  category: ClearanceCategory;
  description: string;
  responsibleParty: string;
  status: ClearanceItemStatus;
  completedAt?: string | null;
  signOffBy?: string | undefined;
  waivedReason?: string | undefined;
}

export interface ExitInterview {
  conductedBy: string;
  conductedAt: string;
  declined: boolean;
  responses: { question: string; answer: string }[];
}

export interface FinalSettlement {
  generatedAt: string;
  lastWorkingDay: string;
  leaveEncashmentDays: number;
  leaveEncashmentAmount: number;
  pendingDues: { description: string; amount: number }[];
  totalAmount: number;
  outstandingFlagged: boolean;
}

// ---------------------------------------------------------------------------
// GDPR Compliance
// ---------------------------------------------------------------------------

export type RetentionDataCategory =
  | 'TERMINATED_EMPLOYEE_RECORDS'
  | 'CANDIDATE_RESUMES'
  | 'CONTRACTS'
  | 'ATTENDANCE_RECORDS'
  | 'LEAVE_RECORDS'
  | 'SALARY_RECORDS'
  | 'AUDIT_LOGS'
  | 'MEDICAL_RECORDS';

export type RetentionAction = 'HARD_DELETE' | 'ANONYMIZE';

export interface RetentionPolicy {
  id: string;
  dataCategory: RetentionDataCategory;
  retentionYears: number;
  action: RetentionAction;
  description?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LegalHold {
  id: string;
  entityType: string;
  entityId: string;
  reason: string;
  createdBy?: string | null;
  createdAt: string;
  releasedAt?: string | null;
}

export type DsarType = 'ACCESS' | 'ERASURE' | 'PORTABILITY' | 'RECTIFICATION';
export type DsarStatus =
  'PENDING_VERIFICATION' | 'VERIFIED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';

export interface DataSubjectAccessRequest {
  id: string;
  requestType: DsarType;
  status: DsarStatus;
  dataSubjectUserId?: string | null;
  dataSubjectEmail: string;
  description?: string | null;
  identityVerifiedBy?: string | null;
  identityVerifiedAt?: string | null;
  verifiedAt?: string | null;
  completedAt?: string | null;
  slaDeadline?: string | null;
  assignedTo?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BreachSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type BreachContainmentStatus = 'OPEN' | 'CONTAINED' | 'RESOLVED' | 'CLOSED';
export type BreachNotificationType = 'SUPERVISORY_AUTHORITY' | 'DATA_SUBJECT';

export interface DataBreach {
  id: string;
  title: string;
  description: string;
  detectionAt: string;
  severity: BreachSeverity;
  isHighRisk: boolean;
  dataCategoriesAffected: string[];
  affectedSubjectsCount: number;
  containmentStatus: BreachContainmentStatus;
  rootCause?: string | null;
  resolution?: string | null;
  saNotificationDeadline: string;
  saNotifiedAt?: string | null;
  saNotificationMethod?: string | null;
  saNotificationReference?: string | null;
  subjectNotificationPlan?: string | null;
  subjectNotifiedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataBreachNotification {
  id: string;
  breachId: string;
  notificationType: BreachNotificationType;
  method: string;
  reference?: string | null;
  sentAt: string;
}

export type ConsentMechanism = 'CHECKBOX' | 'SIGNATURE' | 'EXPLICIT';
export type ConsentStatus = 'GIVEN' | 'WITHDRAWN';

export interface ConsentRecord {
  id: string;
  dataSubjectUserId?: string | null;
  dataSubjectEmail: string;
  processingPurpose: string;
  consentText: string;
  noticeVersion: string;
  mechanism: ConsentMechanism;
  ipAddressTruncated?: string | null;
  status: ConsentStatus;
  withdrawsConsentId?: string | null;
  lawfulBasisOverride?: string | null;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type KeyPurpose = 'DATA_ENCRYPTION' | 'TOKEN_SIGNING';
export type KeyStatus = 'ACTIVE' | 'RETIRED';

export interface EncryptionKeyVersion {
  id: string;
  keyId: string;
  purpose: KeyPurpose;
  algorithm: string;
  status: KeyStatus;
  createdAt: string;
  activatedAt?: string | null;
  retiredAt?: string | null;
}

export interface KeyRotationStatus {
  purpose: KeyPurpose;
  currentVersion: string;
  active: boolean;
  needsReencryption: boolean;
}

export type AnomalyAlertType = 'FAILED_LOGIN_SPIKE' | 'BULK_DOWNLOAD_SPIKE';
export type AnomalyAlertStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED';

export interface AnomalyAlert {
  id: string;
  alertType: AnomalyAlertType;
  entityType: string;
  entityId: string;
  severity: string;
  details: Record<string, unknown>;
  status: AnomalyAlertStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  dismissalReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectDataBundle {
  user?: unknown;
  employee?: unknown;
  documents?: unknown[];
  attendance?: unknown[];
  leave?: unknown[];
  performance?: unknown[];
  candidate?: unknown;
  offboarding?: unknown;
  consent?: unknown[];
  [key: string]: unknown;
}
