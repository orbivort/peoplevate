-- Consolidated initial migration (single init)
-- ─────────────────────────────────────────────────────────────
-- This single migration replaces all previous incremental
-- migrations and produces the complete final schema on a fresh
-- database. Source of truth: prisma/schema.prisma.
--
-- Merged from:
--   20260802235300_init
--   20260802235312_audit_triggers
--   20260803090000_fix_audit_trigger
--   20260803210000_phase2_workflow_modules
--   20260803210001_phase2_audit_triggers
--   20260803230000_leave_holidays_config
--   20260804230000_leave_policy_group
--   20260804235000_leave_policy_group_grades
--   20260805120000_drop_leave_entitlement_template
--   20260807014847_gdpr_compliance (retention, DSAR, breach,
--     consent, key management, anomaly detection)
--
-- The intermediate ALTER/DROP steps (e.g. LeaveEntitlementTemplate,
-- LeavePolicyGroup.grade/min_tenure_months) are intentionally
-- omitted because a fresh database already starts from the final
-- shape. Likewise, GDPR enums are defined in full and the extra
-- AuditAction / AuditEntity values are inlined into their CREATE
-- TYPE statements rather than using ALTER TYPE ... ADD VALUE.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'HR_MANAGER', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_SETUP', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('NEW_HIRE', 'PROBATION', 'ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('PROMOTION', 'TRANSFER', 'MANAGER_CHANGE', 'SALARY_ADJUSTMENT', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('APPLIED', 'PENDING');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT', 'NATIONAL_ID', 'PASSPORT', 'WORK_PERMIT', 'CERTIFICATION', 'MEDICAL_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('EXPIRED', 'SOON');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'READ', 'VIEW', 'DOWNLOAD', 'EXPORT', 'CONSENT', 'PURGE', 'DSAR');

-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('EMPLOYEES', 'DEPARTMENTS', 'POSITIONS', 'USERS', 'AUTH', 'DOCUMENTS', 'JOB_REQUISITIONS', 'JOB_POSTINGS', 'CANDIDATES', 'INTERVIEWS', 'OFFER_LETTERS', 'ONBOARDING_TASKS', 'ATTENDANCE_RECORDS', 'LEAVE_TYPES', 'LEAVE_ENTITLEMENTS', 'LEAVE_REQUESTS', 'LEAVE_APPROVALS', 'LEAVE_BALANCES', 'EVALUATION_CYCLES', 'PERFORMANCE_REVIEWS', 'OFFBOARDING_RECORDS', 'CLEARANCE_ITEMS', 'EXIT_INTERVIEWS', 'SETTLEMENTS', 'DATA_SUBJECT_RIGHTS', 'BREACH', 'CONSENT', 'RETENTION', 'KEYS', 'ANOMALIES');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('REFERRAL', 'JOB_BOARD', 'DIRECT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingTaskType" AS ENUM ('DOCUMENT_SUBMISSION', 'EQUIPMENT_ASSIGNMENT', 'ORIENTATION_SESSION', 'SYSTEM_ACCESS_SETUP');

-- CreateEnum
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('PENDING', 'COMPLETE', 'OVERDUE');

-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_INFO');

-- CreateEnum
CREATE TYPE "EvaluationType" AS ENUM ('PROBATION', 'MID_YEAR', 'END_YEAR');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_STARTED', 'SELF_EVALUATION', 'MANAGER_EVALUATION', 'HR_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SeparationType" AS ENUM ('RESIGNATION', 'DISMISSAL', 'END_OF_CONTRACT');

-- CreateEnum
CREATE TYPE "OffboardingStatus" AS ENUM ('INITIATED', 'CLEARANCE_IN_PROGRESS', 'EXIT_INTERVIEW', 'SETTLEMENT', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClearanceItemStatus" AS ENUM ('PENDING', 'COMPLETE', 'WAIVED');

-- CreateEnum
CREATE TYPE "ClearanceCategory" AS ENUM ('ASSET_RETURN', 'ACCESS_REVOCATION', 'KNOWLEDGE_TRANSFER', 'FINAL_SETTLEMENT');

-- CreateEnum
CREATE TYPE "RetentionDataCategory" AS ENUM ('TERMINATED_EMPLOYEE_RECORDS', 'CANDIDATE_RESUMES', 'CONTRACTS', 'MEDICAL_RECORDS', 'SALARY_RECORDS', 'ATTENDANCE_RECORDS', 'LEAVE_RECORDS', 'AUDIT_LOGS');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('HARD_DELETE', 'ANONYMIZE');

-- CreateEnum
CREATE TYPE "DsarType" AS ENUM ('ACCESS', 'ERASURE', 'PORTABILITY', 'RECTIFICATION');

-- CreateEnum
CREATE TYPE "DsarStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BreachSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "BreachContainmentStatus" AS ENUM ('OPEN', 'CONTAINED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BreachNotificationType" AS ENUM ('SUPERVISORY_AUTHORITY', 'DATA_SUBJECT');

-- CreateEnum
CREATE TYPE "ConsentMechanism" AS ENUM ('CHECKBOX', 'SIGNATURE', 'EXPLICIT');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GIVEN', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "KeyPurpose" AS ENUM ('DATA_ENCRYPTION', 'TOKEN_SIGNING');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AnomalyAlertType" AS ENUM ('FAILED_LOGIN_SPIKE', 'BULK_DOWNLOAD_SPIKE');

-- CreateEnum
CREATE TYPE "AnomalyAlertStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "setup_token" TEXT,
    "setup_token_expires" TIMESTAMP(3),
    "reset_token" TEXT,
    "reset_token_expires" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" TEXT,
    "description" TEXT,
    "department_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employee_no" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "gender" "Gender",
    "national_id_encrypted" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_relationship" TEXT,
    "emergency_contact_phone" TEXT,
    "department_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "manager_id" TEXT,
    "hire_date" TIMESTAMP(3) NOT NULL,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "salary_encrypted" TEXT,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'NEW_HIRE',
    "deactivation_date" TIMESTAMP(3),
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "user_id" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentChange" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "change_type" "ChangeType" NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "status" "ChangeStatus" NOT NULL DEFAULT 'APPLIED',
    "reason" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "original_filename" TEXT NOT NULL,
    "stored_filename" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "encryption_key_version_id" TEXT,
    "encryption_iv" BYTEA,
    "encryption_tag" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpiryAlert" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "days_until_expiry" INTEGER NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpiryAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" "AuditEntity" NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequisition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "employment_type" "EmploymentType" NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "closing_date" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "JobRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL,
    "requisition_id" TEXT NOT NULL,
    "posting_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closing_date" TIMESTAMP(3),
    "status" "RequisitionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "resume_path" TEXT,
    "source" "CandidateSource" NOT NULL DEFAULT 'DIRECT',
    "requisition_id" TEXT NOT NULL,
    "stage" "CandidateStage" NOT NULL DEFAULT 'APPLIED',
    "consent_recorded" BOOLEAN NOT NULL DEFAULT false,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "employee_id" TEXT,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "interviewer_ids" TEXT[],
    "location" TEXT,
    "notes" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferLetter" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "salary" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "terms" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "sent_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "OfferLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "OnboardingTaskType" NOT NULL,
    "assignee_id" TEXT,
    "due_date" TIMESTAMP(3),
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "AttendanceType" NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accrual_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carry_forward_policy" TEXT NOT NULL DEFAULT 'none',
    "max_consecutive_days" INTEGER,
    "approval_levels" INTEGER NOT NULL DEFAULT 1,
    "auto_approve_sick_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveEntitlement" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "annual_entitlement" DOUBLE PRECISION NOT NULL,
    "year" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'POLICY',
    "policy_group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "LeaveEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "attachment_path" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING_MANAGER_APPROVAL',
    "submitted_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApproval" (
    "id" TEXT NOT NULL,
    "leave_request_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "accrued_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "used_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicyGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "year" INTEGER NOT NULL,
    "employment_type" "EmploymentType",
    "grades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "department_id" TEXT,
    "proration_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "LeavePolicyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicyGroupEntitlement" (
    "id" TEXT NOT NULL,
    "policy_group_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "annual_days" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "LeavePolicyGroupEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicyAssignment" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "policy_group_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_manual" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "LeavePolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'STATUTORY',
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCycle" (
    "id" TEXT NOT NULL,
    "type" "EvaluationType" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "self_eval_start" TIMESTAMP(3) NOT NULL,
    "self_eval_end" TIMESTAMP(3) NOT NULL,
    "manager_eval_start" TIMESTAMP(3) NOT NULL,
    "manager_eval_end" TIMESTAMP(3) NOT NULL,
    "hr_review_start" TIMESTAMP(3) NOT NULL,
    "hr_review_end" TIMESTAMP(3) NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "EvaluationCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "self_eval_submitted_at" TIMESTAMP(3),
    "self_eval" JSONB,
    "manager_eval_submitted_at" TIMESTAMP(3),
    "manager_eval" JSONB,
    "overall_rating" INTEGER,
    "hr_comments" TEXT,
    "hr_finalized_at" TIMESTAMP(3),
    "rebuttal" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OffboardingRecord" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "separation_type" "SeparationType" NOT NULL,
    "reason" TEXT,
    "last_working_day" TIMESTAMP(3) NOT NULL,
    "status" "OffboardingStatus" NOT NULL DEFAULT 'INITIATED',
    "initiated_by" TEXT NOT NULL,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivation_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "OffboardingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceItem" (
    "id" TEXT NOT NULL,
    "offboarding_id" TEXT NOT NULL,
    "category" "ClearanceCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "responsible_party_id" TEXT,
    "status" "ClearanceItemStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "sign_off_by" TEXT,
    "waived_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ClearanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitInterview" (
    "id" TEXT NOT NULL,
    "offboarding_id" TEXT NOT NULL,
    "conducted_by" TEXT,
    "conducted_at" TIMESTAMP(3),
    "declined" BOOLEAN NOT NULL DEFAULT false,
    "responses" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "offboarding_id" TEXT NOT NULL,
    "last_working_day" TIMESTAMP(3) NOT NULL,
    "leave_encashment_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leave_encashment_amount" INTEGER NOT NULL DEFAULT 0,
    "pending_dues" JSONB,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "outstanding_flagged" BOOLEAN NOT NULL DEFAULT false,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "data_category" "RetentionDataCategory" NOT NULL,
    "retention_years" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectAccessRequest" (
    "id" TEXT NOT NULL,
    "request_type" "DsarType" NOT NULL,
    "status" "DsarStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "data_subject_user_id" TEXT,
    "data_subject_email" TEXT NOT NULL,
    "identity_verified_by_id" TEXT,
    "identity_verified_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "sla_deadline" TIMESTAMP(3),
    "assigned_to_id" TEXT,
    "rejection_reason" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSubjectAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataBreach" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detection_at" TIMESTAMP(3) NOT NULL,
    "severity" "BreachSeverity" NOT NULL,
    "is_high_risk" BOOLEAN NOT NULL DEFAULT false,
    "data_categories_affected" TEXT[],
    "affected_subjects_count" INTEGER NOT NULL DEFAULT 0,
    "containment_status" "BreachContainmentStatus" NOT NULL DEFAULT 'OPEN',
    "root_cause" TEXT,
    "resolution" TEXT,
    "sa_notification_deadline" TIMESTAMP(3) NOT NULL,
    "sa_notified_at" TIMESTAMP(3),
    "sa_notification_method" TEXT,
    "sa_notification_reference" TEXT,
    "subject_notification_plan" TEXT,
    "subject_notified_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataBreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataBreachNotification" (
    "id" TEXT NOT NULL,
    "breach_id" TEXT NOT NULL,
    "notification_type" "BreachNotificationType" NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataBreachNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "data_subject_user_id" TEXT,
    "data_subject_email" TEXT NOT NULL,
    "processing_purpose" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "notice_version" TEXT NOT NULL,
    "mechanism" "ConsentMechanism" NOT NULL,
    "ip_address_truncated" TEXT,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GIVEN',
    "withdraws_consent_id" TEXT,
    "lawful_basis_override" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptionKeyVersion" (
    "id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "purpose" "KeyPurpose" NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "status" "KeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "EncryptionKeyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyAlert" (
    "id" TEXT NOT NULL,
    "alert_type" "AnomalyAlertType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "severity" "BreachSeverity" NOT NULL DEFAULT 'MEDIUM',
    "details" JSONB,
    "status" "AnomalyAlertStatus" NOT NULL DEFAULT 'OPEN',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "dismissal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnomalyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_hash_key" ON "RefreshToken"("token_hash");

-- CreateIndex
CREATE INDEX "RefreshToken_user_id_idx" ON "RefreshToken"("user_id");

-- CreateIndex
CREATE INDEX "RefreshToken_family_id_idx" ON "RefreshToken"("family_id");

-- CreateIndex
CREATE INDEX "Department_parent_id_idx" ON "Department"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_parent_id_key" ON "Department"("name", "parent_id");

-- CreateIndex
CREATE INDEX "Position_department_id_idx" ON "Position"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "Position_name_department_id_key" ON "Position"("name", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employee_no_key" ON "Employee"("employee_no");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_user_id_key" ON "Employee"("user_id");

-- CreateIndex
CREATE INDEX "Employee_department_id_idx" ON "Employee"("department_id");

-- CreateIndex
CREATE INDEX "Employee_position_id_idx" ON "Employee"("position_id");

-- CreateIndex
CREATE INDEX "Employee_manager_id_idx" ON "Employee"("manager_id");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_email_idx" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "EmploymentChange_employee_id_idx" ON "EmploymentChange"("employee_id");

-- CreateIndex
CREATE INDEX "EmploymentChange_status_idx" ON "EmploymentChange"("status");

-- CreateIndex
CREATE INDEX "EmploymentChange_effective_date_idx" ON "EmploymentChange"("effective_date");

-- CreateIndex
CREATE INDEX "Document_employee_id_idx" ON "Document"("employee_id");

-- CreateIndex
CREATE INDEX "Document_type_idx" ON "Document"("type");

-- CreateIndex
CREATE INDEX "Document_expiry_date_idx" ON "Document"("expiry_date");

-- CreateIndex
CREATE INDEX "ExpiryAlert_document_id_idx" ON "ExpiryAlert"("document_id");

-- CreateIndex
CREATE INDEX "ExpiryAlert_acknowledged_idx" ON "ExpiryAlert"("acknowledged");

-- CreateIndex
CREATE INDEX "ExpiryAlert_severity_idx" ON "ExpiryAlert"("severity");

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_idx" ON "AuditLog"("actor_id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "JobRequisition_department_id_idx" ON "JobRequisition"("department_id");

-- CreateIndex
CREATE INDEX "JobRequisition_status_idx" ON "JobRequisition"("status");

-- CreateIndex
CREATE INDEX "JobPosting_requisition_id_idx" ON "JobPosting"("requisition_id");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_employee_id_key" ON "Candidate"("employee_id");

-- CreateIndex
CREATE INDEX "Candidate_requisition_id_idx" ON "Candidate"("requisition_id");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_stage_idx" ON "Candidate"("stage");

-- CreateIndex
CREATE INDEX "Interview_candidate_id_idx" ON "Interview"("candidate_id");

-- CreateIndex
CREATE INDEX "Interview_scheduled_at_idx" ON "Interview"("scheduled_at");

-- CreateIndex
CREATE INDEX "OfferLetter_candidate_id_idx" ON "OfferLetter"("candidate_id");

-- CreateIndex
CREATE INDEX "OfferLetter_status_idx" ON "OfferLetter"("status");

-- CreateIndex
CREATE INDEX "OnboardingTask_employee_id_idx" ON "OnboardingTask"("employee_id");

-- CreateIndex
CREATE INDEX "OnboardingTask_assignee_id_idx" ON "OnboardingTask"("assignee_id");

-- CreateIndex
CREATE INDEX "OnboardingTask_status_idx" ON "OnboardingTask"("status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_employee_id_idx" ON "AttendanceRecord"("employee_id");

-- CreateIndex
CREATE INDEX "AttendanceRecord_timestamp_idx" ON "AttendanceRecord"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_name_deleted_at_key" ON "LeaveType"("name", "deleted_at");

-- CreateIndex
CREATE INDEX "LeaveEntitlement_employee_id_idx" ON "LeaveEntitlement"("employee_id");

-- CreateIndex
CREATE INDEX "LeaveEntitlement_policy_group_id_idx" ON "LeaveEntitlement"("policy_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEntitlement_employee_id_leave_type_id_year_key" ON "LeaveEntitlement"("employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "LeaveRequest_employee_id_idx" ON "LeaveRequest"("employee_id");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "LeaveRequest_leave_type_id_idx" ON "LeaveRequest"("leave_type_id");

-- CreateIndex
CREATE INDEX "LeaveApproval_leave_request_id_idx" ON "LeaveApproval"("leave_request_id");

-- CreateIndex
CREATE INDEX "LeaveBalance_employee_id_idx" ON "LeaveBalance"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employee_id_leave_type_id_year_key" ON "LeaveBalance"("employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "LeavePolicyGroup_year_idx" ON "LeavePolicyGroup"("year");

-- CreateIndex
CREATE INDEX "LeavePolicyGroup_employment_type_idx" ON "LeavePolicyGroup"("employment_type");

-- CreateIndex
CREATE INDEX "LeavePolicyGroup_department_id_idx" ON "LeavePolicyGroup"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicyGroup_name_year_key" ON "LeavePolicyGroup"("name", "year");

-- CreateIndex
CREATE INDEX "LeavePolicyGroupEntitlement_policy_group_id_idx" ON "LeavePolicyGroupEntitlement"("policy_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicyGroupEntitlement_policy_group_id_leave_type_id_key" ON "LeavePolicyGroupEntitlement"("policy_group_id", "leave_type_id");

-- CreateIndex
CREATE INDEX "LeavePolicyAssignment_employee_id_idx" ON "LeavePolicyAssignment"("employee_id");

-- CreateIndex
CREATE INDEX "LeavePolicyAssignment_policy_group_id_idx" ON "LeavePolicyAssignment"("policy_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicyAssignment_employee_id_year_key" ON "LeavePolicyAssignment"("employee_id", "year");

-- CreateIndex
CREATE INDEX "Holiday_year_idx" ON "Holiday"("year");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_name_date_deleted_at_key" ON "Holiday"("name", "date", "deleted_at");

-- CreateIndex
CREATE INDEX "EvaluationCycle_status_idx" ON "EvaluationCycle"("status");

-- CreateIndex
CREATE INDEX "PerformanceReview_employee_id_idx" ON "PerformanceReview"("employee_id");

-- CreateIndex
CREATE INDEX "PerformanceReview_cycle_id_idx" ON "PerformanceReview"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_cycle_id_employee_id_key" ON "PerformanceReview"("cycle_id", "employee_id");

-- CreateIndex
CREATE INDEX "OffboardingRecord_status_idx" ON "OffboardingRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OffboardingRecord_employee_id_key" ON "OffboardingRecord"("employee_id");

-- CreateIndex
CREATE INDEX "ClearanceItem_offboarding_id_idx" ON "ClearanceItem"("offboarding_id");

-- CreateIndex
CREATE INDEX "ClearanceItem_status_idx" ON "ClearanceItem"("status");

-- CreateIndex
CREATE INDEX "ExitInterview_offboarding_id_idx" ON "ExitInterview"("offboarding_id");

-- CreateIndex
CREATE INDEX "Settlement_offboarding_id_idx" ON "Settlement"("offboarding_id");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_data_category_key" ON "RetentionPolicy"("data_category");

-- CreateIndex
CREATE INDEX "LegalHold_entity_type_entity_id_idx" ON "LegalHold"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "DataSubjectAccessRequest_status_idx" ON "DataSubjectAccessRequest"("status");

-- CreateIndex
CREATE INDEX "DataSubjectAccessRequest_data_subject_user_id_idx" ON "DataSubjectAccessRequest"("data_subject_user_id");

-- CreateIndex
CREATE INDEX "DataSubjectAccessRequest_sla_deadline_idx" ON "DataSubjectAccessRequest"("sla_deadline");

-- CreateIndex
CREATE INDEX "DataBreach_containment_status_idx" ON "DataBreach"("containment_status");

-- CreateIndex
CREATE INDEX "DataBreach_sa_notified_at_idx" ON "DataBreach"("sa_notified_at");

-- CreateIndex
CREATE INDEX "DataBreachNotification_breach_id_idx" ON "DataBreachNotification"("breach_id");

-- CreateIndex
CREATE INDEX "ConsentRecord_data_subject_user_id_idx" ON "ConsentRecord"("data_subject_user_id");

-- CreateIndex
CREATE INDEX "ConsentRecord_status_idx" ON "ConsentRecord"("status");

-- CreateIndex
CREATE INDEX "ConsentRecord_processing_purpose_idx" ON "ConsentRecord"("processing_purpose");

-- CreateIndex
CREATE UNIQUE INDEX "EncryptionKeyVersion_key_id_key" ON "EncryptionKeyVersion"("key_id");

-- CreateIndex
CREATE INDEX "EncryptionKeyVersion_purpose_status_idx" ON "EncryptionKeyVersion"("purpose", "status");

-- CreateIndex
CREATE INDEX "AnomalyAlert_status_idx" ON "AnomalyAlert"("status");

-- CreateIndex
CREATE INDEX "AnomalyAlert_alert_type_idx" ON "AnomalyAlert"("alert_type");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentChange" ADD CONSTRAINT "EmploymentChange_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryAlert" ADD CONSTRAINT "ExpiryAlert_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "JobRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "JobRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_policy_group_id_fkey" FOREIGN KEY ("policy_group_id") REFERENCES "LeavePolicyGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicyGroupEntitlement" ADD CONSTRAINT "LeavePolicyGroupEntitlement_policy_group_id_fkey" FOREIGN KEY ("policy_group_id") REFERENCES "LeavePolicyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicyGroupEntitlement" ADD CONSTRAINT "LeavePolicyGroupEntitlement_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicyAssignment" ADD CONSTRAINT "LeavePolicyAssignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicyAssignment" ADD CONSTRAINT "LeavePolicyAssignment_policy_group_id_fkey" FOREIGN KEY ("policy_group_id") REFERENCES "LeavePolicyGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "EvaluationCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffboardingRecord" ADD CONSTRAINT "OffboardingRecord_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceItem" ADD CONSTRAINT "ClearanceItem_offboarding_id_fkey" FOREIGN KEY ("offboarding_id") REFERENCES "OffboardingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceItem" ADD CONSTRAINT "ClearanceItem_responsible_party_id_fkey" FOREIGN KEY ("responsible_party_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitInterview" ADD CONSTRAINT "ExitInterview_offboarding_id_fkey" FOREIGN KEY ("offboarding_id") REFERENCES "OffboardingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_offboarding_id_fkey" FOREIGN KEY ("offboarding_id") REFERENCES "OffboardingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectAccessRequest" ADD CONSTRAINT "DataSubjectAccessRequest_data_subject_user_id_fkey" FOREIGN KEY ("data_subject_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectAccessRequest" ADD CONSTRAINT "DataSubjectAccessRequest_identity_verified_by_id_fkey" FOREIGN KEY ("identity_verified_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectAccessRequest" ADD CONSTRAINT "DataSubjectAccessRequest_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBreach" ADD CONSTRAINT "DataBreach_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBreachNotification" ADD CONSTRAINT "DataBreachNotification_breach_id_fkey" FOREIGN KEY ("breach_id") REFERENCES "DataBreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBreachNotification" ADD CONSTRAINT "DataBreachNotification_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_data_subject_user_id_fkey" FOREIGN KEY ("data_subject_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_withdraws_consent_id_fkey" FOREIGN KEY ("withdraws_consent_id") REFERENCES "ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyAlert" ADD CONSTRAINT "AnomalyAlert_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- Audit Log Triggers
-- ──────────────────────────────────────────────
-- Reusable audit function. Maps every tracked table to its
-- AuditEntity enum value and writes a row into the immutable
-- AuditLog table. This is the final version (includes all Phase 1
-- and Phase 2 workflow tables).

CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id    TEXT;
  v_actor_name  TEXT;
  v_action_val  TEXT;
  v_entity_val  TEXT;
  v_entity_id   TEXT;
  v_old         JSONB;
  v_new         JSONB;
BEGIN
  -- Map TG_OP to the AuditAction enum: INSERT -> CREATE
  v_action_val := CASE TG_OP
    WHEN 'INSERT' THEN 'CREATE'
    ELSE TG_OP
  END;

  -- Map table name to entity enum
  v_entity_val := CASE TG_TABLE_NAME
    WHEN 'Employee'           THEN 'EMPLOYEES'
    WHEN 'Department'         THEN 'DEPARTMENTS'
    WHEN 'Position'           THEN 'POSITIONS'
    WHEN 'User'               THEN 'USERS'
    WHEN 'Document'           THEN 'DOCUMENTS'
    WHEN 'JobRequisition'     THEN 'JOB_REQUISITIONS'
    WHEN 'JobPosting'         THEN 'JOB_POSTINGS'
    WHEN 'Candidate'          THEN 'CANDIDATES'
    WHEN 'Interview'          THEN 'INTERVIEWS'
    WHEN 'OfferLetter'        THEN 'OFFER_LETTERS'
    WHEN 'OnboardingTask'     THEN 'ONBOARDING_TASKS'
    WHEN 'AttendanceRecord'   THEN 'ATTENDANCE_RECORDS'
    WHEN 'LeaveType'          THEN 'LEAVE_TYPES'
    WHEN 'LeaveEntitlement'   THEN 'LEAVE_ENTITLEMENTS'
    WHEN 'LeaveRequest'       THEN 'LEAVE_REQUESTS'
    WHEN 'LeaveApproval'      THEN 'LEAVE_APPROVALS'
    WHEN 'LeaveBalance'       THEN 'LEAVE_BALANCES'
    WHEN 'EvaluationCycle'    THEN 'EVALUATION_CYCLES'
    WHEN 'PerformanceReview'  THEN 'PERFORMANCE_REVIEWS'
    WHEN 'OffboardingRecord'  THEN 'OFFBOARDING_RECORDS'
    WHEN 'ClearanceItem'      THEN 'CLEARANCE_ITEMS'
    WHEN 'ExitInterview'      THEN 'EXIT_INTERVIEWS'
    WHEN 'Settlement'         THEN 'SETTLEMENTS'
    ELSE TG_TABLE_NAME
  END;

  -- Extract actor from session variable set by the application
  v_actor_id   := current_setting('app.actor_id', true);
  v_actor_name := current_setting('app.actor_name', true);

  IF v_action_val = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_entity_id := (v_old ->> 'id');
    v_new := NULL;
  ELSIF v_action_val = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id');
  ELSIF v_action_val = 'CREATE' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id');
  END IF;

  INSERT INTO "AuditLog" (id, actor_id, actor_name, action, entity, entity_id, old_value, new_value, timestamp)
  VALUES (
    gen_random_uuid(),
    NULLIF(v_actor_id, '')::text,
    NULLIF(v_actor_name, '')::text,
    v_action_val::"AuditAction",
    v_entity_val::"AuditEntity",
    v_entity_id,
    v_old,
    v_new,
    now()
  );

  -- Return appropriate record for each operation
  IF v_action_val = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Phase 1 audit triggers: core tables
CREATE TRIGGER audit_employees_insert
  AFTER INSERT ON "Employee"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_employees_update
  AFTER UPDATE ON "Employee"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_employees_delete
  AFTER DELETE ON "Employee"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_departments_insert
  AFTER INSERT ON "Department"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_departments_update
  AFTER UPDATE ON "Department"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_departments_delete
  AFTER DELETE ON "Department"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_positions_insert
  AFTER INSERT ON "Position"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_positions_update
  AFTER UPDATE ON "Position"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_positions_delete
  AFTER DELETE ON "Position"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_users_insert
  AFTER INSERT ON "User"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_users_update
  AFTER UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_users_delete
  AFTER DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_documents_insert
  AFTER INSERT ON "Document"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_documents_update
  AFTER UPDATE ON "Document"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_documents_delete
  AFTER DELETE ON "Document"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- Phase 2 audit triggers: workflow tables
CREATE TRIGGER "JobRequisition_audit" AFTER INSERT OR UPDATE OR DELETE ON "JobRequisition" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "JobPosting_audit" AFTER INSERT OR UPDATE OR DELETE ON "JobPosting" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "Candidate_audit" AFTER INSERT OR UPDATE OR DELETE ON "Candidate" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "Interview_audit" AFTER INSERT OR UPDATE OR DELETE ON "Interview" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "OfferLetter_audit" AFTER INSERT OR UPDATE OR DELETE ON "OfferLetter" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "OnboardingTask_audit" AFTER INSERT OR UPDATE OR DELETE ON "OnboardingTask" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "AttendanceRecord_audit" AFTER INSERT OR UPDATE OR DELETE ON "AttendanceRecord" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "LeaveType_audit" AFTER INSERT OR UPDATE OR DELETE ON "LeaveType" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "LeaveEntitlement_audit" AFTER INSERT OR UPDATE OR DELETE ON "LeaveEntitlement" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "LeaveRequest_audit" AFTER INSERT OR UPDATE OR DELETE ON "LeaveRequest" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "LeaveApproval_audit" AFTER INSERT OR UPDATE OR DELETE ON "LeaveApproval" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "LeaveBalance_audit" AFTER INSERT OR UPDATE OR DELETE ON "LeaveBalance" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "EvaluationCycle_audit" AFTER INSERT OR UPDATE OR DELETE ON "EvaluationCycle" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "PerformanceReview_audit" AFTER INSERT OR UPDATE OR DELETE ON "PerformanceReview" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "OffboardingRecord_audit" AFTER INSERT OR UPDATE OR DELETE ON "OffboardingRecord" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "ClearanceItem_audit" AFTER INSERT OR UPDATE OR DELETE ON "ClearanceItem" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "ExitInterview_audit" AFTER INSERT OR UPDATE OR DELETE ON "ExitInterview" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "Settlement_audit" AFTER INSERT OR UPDATE OR DELETE ON "Settlement" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ──────────────────────────────────────────────
-- Audit Log Immutability
-- ──────────────────────────────────────────────
-- Prevent UPDATE and DELETE on the audit_log table.

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable: UPDATE and DELETE are not allowed';
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
