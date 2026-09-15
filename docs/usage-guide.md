# Peoplevate Usage Guide

This guide explains how to use **Peoplevate** from the perspective of its users —
employees, managers, HR staff, and administrators. It walks through each functional
module, the common workflows, and the URL routes you will use in the web application.

> **Role terms used below:** _Admin_, _HR Manager_, _Manager_, and _Employee_.
> See [Roles & Permissions](./roles-permissions.md) for the full capability matrix.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Authentication & Account](#authentication--account)
- [Dashboard](#dashboard)
- [Organization](#organization)
- [Employees](#employees)
- [Recruitment & Onboarding](#recruitment--onboarding)
- [Attendance & Leave](#attendance--leave)
- [Timesheets](#timesheets)
- [Performance](#performance)
- [Offboarding](#offboarding)
- [Documents](#documents)
- [Audit Log](#audit-log)
- [Privacy & GDPR](#privacy--gdpr)
- [Administration](#administration)

---

## Getting Started

### First Login

1. When an account is created for you, an invitation is sent by email containing a
   **setup link**.
2. Open the link. On the first-time setup page (`/setup`) you will set your password.
   Passwords are validated against the configured policy (minimum length, argon2 hashing).
3. After setup you can sign in at `/login`.

### Signing In

- Enter your email and password at `/login`.
- The system issues a short-lived access token and a longer-lived refresh token.
  The frontend refreshes the session automatically.
- After **5 failed login attempts within 15 minutes**, the account is locked for the
  configured duration as a security measure.
- If you forget your password, use the "Forgot password" link to request a reset link.

### Session & Logout

- Sessions stay active until you log out or the refresh token expires.
- Always use the **Sign out** option in the application to revoke your session and refresh token.

---

## Authentication & Account

| Route              | Purpose                              | Who           |
| ------------------ | ------------------------------------ | ------------- |
| `/login`           | Sign in                              | All           |
| `/forgot-password` | Request a password reset             | All           |
| `/setup`           | Activate an invited account          | Invited users |
| `/app/profile`     | View and edit your own profile       | All           |
| `/app/settings`    | Change password and account settings | All           |

**Workflow — reset your password:**

1. Go to `/forgot-password` and enter your email.
2. Check your inbox for a reset link (valid for the configured expiry).
3. Open the link, choose a new password, and confirm.

---

## Dashboard

- **Route:** `/app`
- **Who:** All authenticated users.

The dashboard is the landing page after sign-in. It surfaces summary information and
shortcuts relevant to your role. Content varies by role — for example, managers see
team-facing summaries while employees see their own status.

---

## Organization

- **Routes:**
  - `/app/departments` — manage the department hierarchy
  - `/app/positions` — manage positions within departments
- **Who:** Admin, HR Manager.

**Departments** are hierarchical (a department can have a parent department). Create the
top-level structure first, then add child departments.

**Positions** are unique within a department (a department cannot have two positions with
the same name). Create positions before assigning employees to them.

**Workflow — set up the org structure:**

1. Create the root departments under `/app/departments`.
2. Add child departments and set parent relationships as needed.
3. Create positions under `/app/positions`, selecting their department.
4. Optionally assign a manager (position) for each department.

---

## Employees

- **Routes:**
  - `/app/employees` — employee list
  - `/app/employees/new` — create an employee (Admin / HR Manager)
  - `/app/employees/:id` — employee profile
  - `/app/employees/:id/edit` — edit an employee (Admin / HR Manager)
- **Who:** List and view by all staff; create/edit by Admin and HR Manager only.

Employees are linked to users, departments, positions, and managers. Each employee has a
unique employee number.

**Workflow — hire an employee:**

1. Create the employee record at `/app/employees/new` with personal details, department,
   position, manager, and hire date.
2. The record is created with the employee's status. Onboarding tasks are generated
   automatically when a candidate is converted to an employee (see Recruitment).

**Employment changes:**

- Managers and HR/Admin can record employment changes (promotion, transfer, manager
  change, salary adjustment, status change).
- Salary information is **encrypted at rest** and only shown to roles with salary access.
- Manager-recorded changes are typically pending and require approval; HR/Admin changes
  can apply immediately or be scheduled to an effective date.

---

## Recruitment & Onboarding

- **Routes:**
  - `/app/recruitment` — job requisitions
  - `/app/recruitment/candidates` — candidate pipeline
  - `/app/recruitment/interviews` — interviews
  - `/app/recruitment/offers` — offer letters
  - `/app/recruitment/onboarding` — onboarding tasks
- **Who:** Requisition, candidate, interview, offer, and conversion management by
  Admin / HR Manager; Managers can schedule interviews and view job postings.

**Candidate lifecycle:** `APPLIED → SCREENING → INTERVIEW → OFFER → HIRED`

**Workflow — run a recruitment cycle:**

1. Create a **job requisition** at `/app/recruitment`.
2. Publish a **job posting** and track **candidates** through the pipeline.
3. Schedule **interviews** against a position.
4. When a candidate passes, generate an **offer letter**.
5. Once the candidate accepts, **convert** them to an employee. The system automatically
   creates the onboarding task checklist.

**Onboarding tasks** include: document submission, equipment assignment, orientation
session, and system access setup. These are tracked under `/app/recruitment/onboarding`.

---

## Attendance & Leave

- **Routes:**
  - `/app/attendance` — clock in/out and attendance records
  - `/app/leave-holidays` — leave types, holidays, and your leave balance
- **Who:**
  - Clock in/out and view own attendance: all staff.
  - View team attendance: Manager, HR Manager, Admin.
  - Submit leave requests: all staff.
  - Approve leave (first level): Manager; final approval: HR Manager, Admin.
  - Manage leave types: HR Manager, Admin.

**Attendance:**

- Clock in and clock out at `/app/attendance`. Grace periods and end-of-business cutoffs
  are configurable.
- Employees see their own records; managers see team attendance; HR/Admin see all.

**Leave:**

- Leave is governed by **leave types** and **policies** that determine entitlements and
  balances.
- Employees submit **leave requests**.
- A request flows through approvals: **Manager approval → HR approval → Approved**.
- Check available balance and company **holidays** at `/app/leave-holidays`.

---

## Timesheets

- **Routes:**
  - `/app/timesheets` — log your own hours for a week (all staff)
  - `/app/timesheets/approvals` — review and decide on submitted weeks (Manager, HR Manager, Admin)
  - `/app/timesheets/reports` — analyse worked hours and export them (Manager, HR Manager, Admin)
  - `/app/admin/projects` — manage the project and task catalog (Admin, HR Manager)
- **Who:**
  - Log, save, submit, and view your own approval history: all staff with a linked employee record.
  - Approve or reject: the employee's **manager**, HR Manager, or Admin.
  - Run reports: Manager (their direct reports only), HR Manager and Admin (everyone).
  - Manage projects and tasks: HR Manager, Admin.

Timesheets record **how working time is distributed across projects and tasks**. Each employee
fills in a Monday–Sunday week against a managed project catalog, submits it for approval, and —
once approved — those hours feed the working-time reports.

> **Related module:** timesheets complement [Attendance & Leave](#attendance--leave).
> Attendance records _presence_ (clock in/out); timesheets record _effort allocation_.

### The weekly timesheet

- A timesheet always covers one **Monday–Sunday** week (Monday 00:00 to Sunday 23:59:59).
- Only the **current and previous week** can be logged, viewed, or edited. The week navigator
  stops at the previous week, and older weeks are not available.
- A week is created automatically the first time you open it or log an hour, and starts as
  **Draft**.

**Status lifecycle:**

`Draft → Submitted → Approved`, or `Submitted → Rejected → (edit and resubmit) → Submitted`

- **Draft / Rejected** — you can add, change, and remove entries.
- **Submitted / Approved** — entries are **locked** and the week is read-only.

### Logging hours

Open `/app/timesheets` and select a week. The page shows a **project × day grid**:

1. Use **Add project row** to add a project, optionally narrowing it to one of its tasks.
2. Type the hours for each day into the matching cell. You can log several projects on the same day.
3. Totals update as you type: per project, per day, days logged, and the week total.
4. Choose **Save week** to persist your changes, or **Discard** to revert them.

**Entry rules:**

- Hours are entered in **0.25-hour steps** (for example `7.5`), greater than `0`, and at most
  **24 hours per entry**.
- The **total for a single day cannot exceed 24 hours** across all projects.
- You cannot log two entries for the **same project and task on the same day**.
- Only **active** projects and tasks can be logged.
- Clearing a cell deletes that entry when you save.

On narrow screens the same week is edited one day at a time through a day switcher, so the hour
inputs stay finger-sized.

> The week grid logs **hours**. The API can also store an optional description (up to 500
> characters) on each entry, but the web grid does not capture descriptions.

### Submitting for approval

1. Save all changed cells — **Submit week** stays disabled while there are unsaved changes.
2. Select **Submit week**. The confirmation dialog shows the week total, a per-project recap, and
   a non-blocking warning for any working day (Mon–Fri) with no hours.
3. Confirm. The week moves to **Submitted**, its entries lock, and **your manager is notified by
   email**.

Submission requires at least one entry and an **assigned manager**. If you have no manager,
submission is blocked with guidance to contact HR.

### Reviewing and resubmitting

If your manager rejects the week it returns to **Rejected**, the entries unlock, and a banner
shows who rejected it and their comment. Adjust the hours and submit again — the same timesheet
record is reused, so the full history is preserved.

The **Approval history** panel below the week lists every submission and decision with the
approver and comment.

### Approving timesheets

At `/app/timesheets/approvals`, managers and HR/Admin see the queue of **Submitted** weeks. For
each row you can:

- **Review** — expand the row to see the employee's week ledger in read-only form.
- **Approve** — optionally add a comment; the week becomes **Approved** and locks.
- **Reject** — a comment is **required** (1–500 characters); the week unlocks so the employee can
  correct and resubmit it.
- **Approve selected** — approve several reviewed weeks in one action.

You cannot approve or reject your **own** timesheet. The employee is notified by email when the
decision is made (rejections include the comment).

### Working-time reports

At `/app/timesheets/reports` you can aggregate worked hours over a date range:

- **Group by:** employee, project, or department.
- **Filters:** date range (required), employee, department, and project.
- **Approval status:** reports include **approved** hours only by default; tick _Include pending &
  rejected_ to widen the scope.
- **Summary** tab — aggregated totals (the employee view also shows billable hours).
- **Details** tab — the individual entries behind the totals, with pagination.
- **Export CSV** — downloads every entry matching the current filters.

Data is scoped by role: managers see their **direct reports**, HR Manager and Admin see everyone.
Employees do not have access to the report pages.

Every report run and CSV export is recorded in the [audit log](#audit-log).

### Managing the project catalog

At `/app/admin/projects` (Admin / HR Manager) you maintain the catalog employees log against:

- **Create / edit projects** — a unique code, name, optional description and client, a billable
  flag, and optional start/end dates.
- **Activate / deactivate** — only active projects appear to employees. Deactivating hides a
  project from new entries while preserving its history and reports.
- **Manage tasks** — tasks belong to one project, are unique within it, and can be activated or
  deactivated.
- **Delete** — a project or task that has timesheet entries **cannot be deleted**; deactivate it
  instead.

The seeded sample data (`pnpm db:seed`) includes three example projects with tasks so you can try
the flow immediately.

---

## Performance

- **Route:** `/app/performance`
- **Who:** Self-evaluation by all staff; manager evaluation by Managers; HR review and
  finalization by HR Manager / Admin.

**Evaluation cycles** are of type probation, mid-year, or end-year. The review workflow is:

`SELF_EVALUATION → MANAGER_EVALUATION → HR_REVIEW → COMPLETED`

**Workflow — complete a review:**

1. The employee submits a **self-evaluation**.
2. The manager adds the **manager evaluation**.
3. HR performs the **HR review** and finalizes the review.
4. An optional **rebuttal** can be attached.

Probation reviews are generated automatically based on the probation configuration and
the employee's hire date.

---

## Offboarding

- **Route:** `/app/offboarding`
- **Who:** Submit resignation (all staff); initiate termination and manage the process
  (Admin / HR Manager).

**Offboarding state machine:**
`INITIATED → CLEARANCE_IN_PROGRESS → EXIT_INTERVIEW → SETTLEMENT → CLOSED`

**Workflow — separate an employee:**

1. An Admin/HR Manager initiates an offboarding record, or an employee submits a resignation.
2. **Clearance items** are completed (equipment returns, handover, etc.).
3. An **exit interview** is conducted and recorded.
4. The **settlement** is processed.
5. The record is closed. Terminated records are retained per the data retention policy
   (default 7 years) before automated purge.

---

## Documents

- **Who:** Upload documents — Admin, HR Manager. View documents per access control.

Documents are typed (contract, national ID, passport, and others). Sensitive data is
**encrypted at rest**. The system monitors **document expiry** and raises alerts when a
document is about to expire or has expired. Expiry checks run on a scheduled cron job.

---

## Audit Log

- **Route:** `/app/audit-log`
- **Who:** Admin, HR Manager.

Every mutation (create, update, delete) plus logins and logouts is recorded in an
**immutable audit log**. Use the audit log to trace changes, logins, and data access for
security and compliance purposes. Server-side pagination is supported for large volumes.

---

## Privacy & GDPR

- **Routes:**
  - `/app/my-data` — view the data stored about you (all users)
  - `/app/compliance/data-subject-rights` — manage data subject rights (Admin / HR Manager)
- **Who:** Self-service data views for all; compliance management for Admin / HR Manager.

**As an employee** you can review the personal data stored about you under `/app/my-data`
and exercise your rights.

**As Admin / HR Manager** you can manage **data subject access requests (DSARs)**, including
access, rectification, erasure, and portability, subject to the configured SLA. Retention
policies determine how long different data categories are kept.

---

## Administration

- **Routes:**
  - `/app/users` — user management (Admin only)
  - `/app/compliance/retention` — retention policies (Admin / HR Manager)
  - `/app/compliance/breach` — breach register (Admin / HR Manager)
  - `/app/compliance/dsar` — DSAR queue (Admin / HR Manager)
  - `/app/compliance/consent` — consent management (Admin / HR Manager)
  - `/app/compliance/keys` — key management (Admin / HR Manager)
  - `/app/audit-log` — audit log (Admin / HR Manager)

**User Management (`/app/users`)** — Admin only:

- Create user accounts (triggers the setup-token invitation email).
- Change a user's **role** (you cannot change your own role).
- **Activate** or **deactivate** accounts (you cannot deactivate yourself).

**Compliance modules** — Admin / HR Manager:

- **Retention:** configure how long data categories are retained; automated purge runs on
  a schedule.
- **Breach:** register data breaches and manage the notification workflow.
- **DSAR:** work the data-subject-request queue within SLA.
- **Consent:** record and manage consent.
- **Keys:** manage encryption keys used to protect sensitive fields.

---

## Role Reference Summary

| Capability area            | Employee |       Manager       | HR Manager | Admin |
| -------------------------- | :------: | :-----------------: | :--------: | :---: |
| View own profile           |    ✅    |         ✅          |     ✅     |  ✅   |
| Submit leave request       |    ✅    |         ✅          |     ✅     |  ✅   |
| Clock attendance           |    ✅    |          —          |     —      |  ✅   |
| Log & submit own timesheet |    ✅    |         ✅          |     ✅     |  ✅   |
| View team attendance       |    —     |         ✅          |     ✅     |  ✅   |
| Approve leave (level 1)    |    —     |         ✅          |     ✅     |  ✅   |
| Approve team timesheets    |    —     |         ✅          |     ✅     |  ✅   |
| View timesheet reports     |    —     | ✅ (direct reports) |     ✅     |  ✅   |
| Manage projects & tasks    |    —     |          —          |     ✅     |  ✅   |
| Self-evaluation            |    ✅    |         ✅          |     ✅     |  ✅   |
| Submit resignation         |    ✅    |         ✅          |     ✅     |  ✅   |
| Schedule interviews        |    —     |         ✅          |     ✅     |  ✅   |
| View job postings          |    —     |         ✅          |     ✅     |  ✅   |
| Create/edit employees      |    —     |          —          |     ✅     |  ✅   |
| Manage organization        |    —     |          —          |     ✅     |  ✅   |
| Final leave approval       |    —     |          —          |     ✅     |  ✅   |
| Manage leave types         |    —     |          —          |     ✅     |  ✅   |
| View audit log             |    —     |          —          |     ✅     |  ✅   |
| GDPR compliance modules    |    —     |          —          |     ✅     |  ✅   |
| Manage users               |    —     |          —          |     —      |  ✅   |
| Access salary              |    —     |          —          |     ✅     |  ✅   |

The authoritative mapping is enforced in the backend RBAC layer and per-record ownership
checks; see [Roles & Permissions](./roles-permissions.md).
