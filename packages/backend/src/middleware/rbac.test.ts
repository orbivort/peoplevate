import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '#prisma';
import {
  hasCapability,
  requireAdmin,
  requireAllStaff,
  requireHR,
  requireHRorManager,
  requireRoles,
} from './rbac.js';

function buildRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  return res;
}

function buildReq(role?: string): Request {
  return (role ? { user: { userId: 'u1', role, email: 'a@example.com' } } : {}) as unknown as Request;
}

describe('requireRoles', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('returns 401 when the request is unauthenticated', () => {
    const res = buildRes();

    requireRoles(UserRole.ADMIN)(buildReq(), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the role is not permitted', () => {
    const res = buildRes();

    requireRoles(UserRole.ADMIN)(buildReq(UserRole.EMPLOYEE), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Insufficient permissions' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the role is permitted', () => {
    const res = buildRes();

    requireRoles(UserRole.ADMIN, UserRole.HR_MANAGER)(buildReq(UserRole.HR_MANAGER), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ['requireAdmin', requireAdmin, UserRole.ADMIN, UserRole.HR_MANAGER],
    ['requireHR', requireHR, UserRole.HR_MANAGER, UserRole.MANAGER],
    ['requireHRorManager', requireHRorManager, UserRole.MANAGER, UserRole.EMPLOYEE],
  ])('%s allows the expected role and blocks others', (_name, guard, allowed, blocked) => {
    const allowRes = buildRes();
    const allowNext = vi.fn();
    guard(buildReq(allowed), allowRes, allowNext);
    expect(allowNext).toHaveBeenCalledOnce();

    const blockRes = buildRes();
    const blockNext = vi.fn();
    guard(buildReq(blocked), blockRes, blockNext);
    expect(blockRes.statusCode).toBe(403);
    expect(blockNext).not.toHaveBeenCalled();
  });

  it('requireAllStaff admits every known role', () => {
    for (const role of [UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.MANAGER, UserRole.EMPLOYEE]) {
      const res = buildRes();
      const localNext = vi.fn();
      requireAllStaff(buildReq(role), res, localNext);
      expect(localNext).toHaveBeenCalledOnce();
    }
  });
});

describe('hasCapability', () => {
  it('grants admin-only capabilities to ADMIN', () => {
    expect(hasCapability('ADMIN', 'manageUsers')).toBe(true);
    expect(hasCapability('ADMIN', 'viewFullAuditLog')).toBe(true);
  });

  it('denies admin-only capabilities to HR_MANAGER', () => {
    expect(hasCapability('HR_MANAGER', 'manageUsers')).toBe(false);
    expect(hasCapability('HR_MANAGER', 'viewFullAuditLog')).toBe(false);
  });

  it('grants shared capabilities to HR_MANAGER', () => {
    expect(hasCapability('HR_MANAGER', 'viewAllEmployees')).toBe(true);
    expect(hasCapability('HR_MANAGER', 'approveLeaveFinal')).toBe(true);
  });

  it('limits MANAGER to team-scoped capabilities', () => {
    expect(hasCapability('MANAGER', 'viewDirectReports')).toBe(true);
    expect(hasCapability('MANAGER', 'approveLeaveL1')).toBe(true);
    expect(hasCapability('MANAGER', 'approveLeaveFinal')).toBe(false);
    expect(hasCapability('MANAGER', 'viewAllEmployees')).toBe(false);
  });

  it('limits EMPLOYEE to self-service capabilities', () => {
    expect(hasCapability('EMPLOYEE', 'viewOwnProfile')).toBe(true);
    expect(hasCapability('EMPLOYEE', 'submitLeaveRequest')).toBe(true);
    expect(hasCapability('EMPLOYEE', 'conductReviews')).toBe(false);
  });

  it('returns false for an unknown role', () => {
    expect(hasCapability('CONTRACTOR', 'viewOwnProfile')).toBe(false);
  });

  it('returns false for an unknown capability', () => {
    expect(hasCapability('ADMIN', 'launchRockets')).toBe(false);
  });
});
