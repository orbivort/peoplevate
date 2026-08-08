import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '#prisma';
import type { AuthenticatedRequest } from './auth.js';

type Role = UserRole;

/**
 * Middleware factory: allows access only if the user has one of the specified roles.
 */
export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(authReq.user.role as Role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRoles(UserRole.ADMIN);
export const requireHR = requireRoles(UserRole.ADMIN, UserRole.HR_MANAGER);
export const requireHRorManager = requireRoles(
  UserRole.ADMIN,
  UserRole.HR_MANAGER,
  UserRole.MANAGER,
);
/** Read-only access for all authenticated staff (Admin, HR, Manager, Employee). */
export const requireAllStaff = requireRoles(
  UserRole.ADMIN,
  UserRole.HR_MANAGER,
  UserRole.MANAGER,
  UserRole.EMPLOYEE,
);

/**
 * Permission matrix check.
 * Returns true if the role has the given capability.
 */
export function hasCapability(role: string, capability: string): boolean {
  const matrix: Record<string, string[]> = {
    ADMIN: [
      'manageOrg',
      'manageUsers',
      'viewAllEmployees',
      'viewDirectReports',
      'viewOwnProfile',
      'accessSalary',
      'viewAuditLog',
      'viewFullAuditLog',
      'uploadDocuments',
      'recordAllChanges',
      'editEmployeeProfile',
      // Phase 2 — Recruitment
      'manageRequisitions',
      'trackCandidates',
      'scheduleInterviews',
      'generateOffers',
      'convertCandidate',
      'viewJobPostings',
      // Phase 2 — Attendance & Leave
      'clockAttendance',
      'viewAttendanceTeam',
      'viewAttendanceOwn',
      'submitLeaveRequest',
      'approveLeaveL1',
      'approveLeaveFinal',
      'manageLeaveTypes',
      // Phase 2 — Performance
      'conductReviews',
      'submitSelfEvaluation',
      'finalizeReviews',
      'viewEvaluationCycles',
      // Phase 2 — Offboarding
      'manageOffboarding',
      'submitResignation',
      'initiateTermination',
    ],
    HR_MANAGER: [
      'manageOrg',
      'viewAllEmployees',
      'viewDirectReports',
      'viewOwnProfile',
      'accessSalary',
      'viewAuditLog',
      'uploadDocuments',
      'recordAllChanges',
      'editEmployeeProfile',
      // Phase 2 — Recruitment
      'manageRequisitions',
      'trackCandidates',
      'scheduleInterviews',
      'generateOffers',
      'convertCandidate',
      'viewJobPostings',
      // Phase 2 — Attendance & Leave
      'viewAttendanceTeam',
      'viewAttendanceOwn',
      'approveLeaveL1',
      'approveLeaveFinal',
      'manageLeaveTypes',
      // Phase 2 — Performance
      'conductReviews',
      'submitSelfEvaluation',
      'finalizeReviews',
      'viewEvaluationCycles',
      // Phase 2 — Offboarding
      'manageOffboarding',
      'submitResignation',
      'initiateTermination',
    ],
    MANAGER: [
      'viewDirectReports',
      'viewOwnProfile',
      'editDirectReports',
      'recordPendingChanges',
      // Phase 2 — Recruitment
      'scheduleInterviews',
      'viewJobPostings',
      // Phase 2 — Attendance & Leave
      'viewAttendanceTeam',
      'viewAttendanceOwn',
      'submitLeaveRequest',
      'approveLeaveL1',
      // Phase 2 — Performance
      'conductReviews',
      'submitSelfEvaluation',
      'viewEvaluationCycles',
      // Phase 2 — Offboarding
      'submitResignation',
    ],
    EMPLOYEE: [
      'viewOwnProfile',
      // Phase 2 — Attendance & Leave
      'clockAttendance',
      'viewAttendanceOwn',
      'submitLeaveRequest',
      // Phase 2 — Performance
      'submitSelfEvaluation',
      // Phase 2 — Offboarding
      'submitResignation',
    ],
  };
  return (matrix[role] ?? []).includes(capability);
}
