# Roles & Permissions

Peoplevate enforces **role-based access control (RBAC)** on both the frontend routes and
the backend middleware. This document describes the four roles and the capability matrix
that governs what each role can do.

> **Enforcement:** the capability matrix below mirrors the backend RBAC layer
> (`packages/backend/src/middleware/rbac.ts`). Frontend route guards provide the same
> role gating for the UI. Role changes require an **Admin** and cannot be applied to your
> own account.

---

## Roles

| Role | Symbol | Description |
| ---- | ------ | ----------- |
| **Admin** | `ADMIN` | Full system access: manages organization, users, employees, recruitment, compliance, and security configuration. |
| **HR Manager** | `HR_MANAGER` | Manages HR workflows: employees, organization, recruitment, leave final approval, performance review, offboarding, GDPR compliance. |
| **Manager** | `MANAGER` | Manages direct reports: team attendance, leave level-1 approval, interviews, performance manager evaluation, pending employment changes. |
| **Employee** | `EMPLOYEE` | Self-service: own profile, own attendance, leave requests, self-evaluation, resignation. |

---

## Capability Matrix

The following table lists every capability enforced by the system and which roles hold it.
A `✅` indicates the role has the capability.

### Core & Organization

| Capability | Admin | HR Manager | Manager | Employee |
| ---------- | :---: | :--------: | :-----: | :-------: |
| `viewOwnProfile` | ✅ | ✅ | ✅ | ✅ |
| `viewDirectReports` | ✅ | ✅ | ✅ | — |
| `viewAllEmployees` | ✅ | ✅ | — | — |
| `manageOrg` | ✅ | ✅ | — | — |
| `editEmployeeProfile` | ✅ | ✅ | — | — |
| `editDirectReports` | — | — | ✅ | — |
| `manageUsers` | ✅ | — | — | — |
| `viewAuditLog` | ✅ | ✅ | — | — |
| `viewFullAuditLog` | ✅ | — | — | — |
| `uploadDocuments` | ✅ | ✅ | — | — |
| `accessSalary` | ✅ | ✅ | — | — |
| `recordAllChanges` | ✅ | ✅ | — | — |
| `recordPendingChanges` | — | — | ✅ | — |

### Recruitment

| Capability | Admin | HR Manager | Manager | Employee |
| ---------- | :---: | :--------: | :-----: | :-------: |
| `manageRequisitions` | ✅ | ✅ | — | — |
| `trackCandidates` | ✅ | ✅ | — | — |
| `scheduleInterviews` | ✅ | ✅ | ✅ | — |
| `generateOffers` | ✅ | ✅ | — | — |
| `convertCandidate` | ✅ | ✅ | — | — |
| `viewJobPostings` | ✅ | ✅ | ✅ | — |

### Attendance & Leave

| Capability | Admin | HR Manager | Manager | Employee |
| ---------- | :---: | :--------: | :-----: | :-------: |
| `clockAttendance` | ✅ | — | — | ✅ |
| `viewAttendanceTeam` | ✅ | ✅ | ✅ | — |
| `viewAttendanceOwn` | ✅ | ✅ | ✅ | ✅ |
| `submitLeaveRequest` | ✅ | — | ✅ | ✅ |
| `approveLeaveL1` | ✅ | ✅ | ✅ | — |
| `approveLeaveFinal` | ✅ | ✅ | — | — |
| `manageLeaveTypes` | ✅ | ✅ | — | — |

### Performance

| Capability | Admin | HR Manager | Manager | Employee |
| ---------- | :---: | :--------: | :-----: | :-------: |
| `conductReviews` | ✅ | ✅ | ✅ | — |
| `submitSelfEvaluation` | ✅ | ✅ | ✅ | ✅ |
| `finalizeReviews` | ✅ | ✅ | — | — |
| `viewEvaluationCycles` | ✅ | ✅ | ✅ | — |

### Offboarding

| Capability | Admin | HR Manager | Manager | Employee |
| ---------- | :---: | :--------: | :-----: | :-------: |
| `manageOffboarding` | ✅ | ✅ | — | — |
| `submitResignation` | ✅ | ✅ | ✅ | ✅ |
| `initiateTermination` | ✅ | ✅ | — | — |

---

## Frontend Route Guards

The frontend applies the same role gating via `ProtectedRoute` with a `roles` prop:

- **Any authenticated user:** dashboard, profile, settings, my data, employee list/profile,
  leave & holidays, attendance, performance, offboarding, recruitment views.
- **Admin or HR Manager only:** create/edit employees, organization (departments/positions),
  audit log, all GDPR compliance pages.
- **Admin only:** user management (`/app/users`).

For the exact URL mapping, see the [Usage Guide](./usage-guide.md).

---

## Changing Roles

- **Who:** Admin only.
- **Constraint:** an Admin cannot change their **own** role.
- **Effect:** changing a role immediately affects the user's capabilities across the
  frontend and backend on their next request.

---

## Notes

- **Salary access** is restricted to Admin and HR Manager. Salary values are encrypted at
  rest and never logged or returned in plaintext to other roles.
- **Account deactivation** also cannot be applied to your own account.
- This matrix is authoritative for access control. When adding features, update both the
  backend `hasCapability` matrix and the corresponding route guards.
