-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'APPROVE';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntity" ADD VALUE 'TIMESHEET';
ALTER TYPE "AuditEntity" ADD VALUE 'TIMESHEET_ENTRY';
ALTER TYPE "AuditEntity" ADD VALUE 'PROJECT';
ALTER TYPE "AuditEntity" ADD VALUE 'PROJECT_TASK';

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "client" TEXT,
    "is_billable" BOOLEAN NOT NULL DEFAULT false,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEntry" (
    "id" TEXT NOT NULL,
    "timesheet_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "hours" DECIMAL(5,2) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetApproval" (
    "id" TEXT NOT NULL,
    "timesheet_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTask_project_id_name_key" ON "ProjectTask"("project_id", "name");

-- CreateIndex
CREATE INDEX "Timesheet_employee_id_idx" ON "Timesheet"("employee_id");

-- CreateIndex
CREATE INDEX "Timesheet_status_idx" ON "Timesheet"("status");

-- CreateIndex
CREATE INDEX "Timesheet_period_start_idx" ON "Timesheet"("period_start");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_employee_id_period_start_key" ON "Timesheet"("employee_id", "period_start");

-- CreateIndex
CREATE INDEX "TimesheetEntry_employee_id_entry_date_idx" ON "TimesheetEntry"("employee_id", "entry_date");

-- CreateIndex
CREATE INDEX "TimesheetEntry_project_id_entry_date_idx" ON "TimesheetEntry"("project_id", "entry_date");

-- CreateIndex
CREATE INDEX "TimesheetEntry_timesheet_id_idx" ON "TimesheetEntry"("timesheet_id");

-- CreateIndex
CREATE INDEX "TimesheetApproval_timesheet_id_idx" ON "TimesheetApproval"("timesheet_id");

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetApproval" ADD CONSTRAINT "TimesheetApproval_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- Audit Log Triggers (Phase 3: Timesheet tables)
-- ──────────────────────────────────────────────
-- Extend the shared audit function with the new timesheet table mappings.
-- Note: no trigger on "TimesheetApproval" — approve/reject decisions are
-- logged at the application level with AuditAction APPROVE/REJECT against
-- entity TIMESHEET (the trigger can only emit CREATE/UPDATE/DELETE).

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
    WHEN 'Project'            THEN 'PROJECT'
    WHEN 'ProjectTask'        THEN 'PROJECT_TASK'
    WHEN 'Timesheet'          THEN 'TIMESHEET'
    WHEN 'TimesheetEntry'     THEN 'TIMESHEET_ENTRY'
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

-- Phase 3 audit triggers: timesheet tables
CREATE TRIGGER "Project_audit" AFTER INSERT OR UPDATE OR DELETE ON "Project" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "ProjectTask_audit" AFTER INSERT OR UPDATE OR DELETE ON "ProjectTask" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "Timesheet_audit" AFTER INSERT OR UPDATE OR DELETE ON "Timesheet" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER "TimesheetEntry_audit" AFTER INSERT OR UPDATE OR DELETE ON "TimesheetEntry" FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
