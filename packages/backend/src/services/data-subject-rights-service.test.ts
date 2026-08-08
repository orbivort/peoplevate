import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { decrypt } from '../utils/crypto.js';
import { logAuditEvent } from './audit-service.js';
import { deleteEmployeeFiles } from './document-service.js';
import {
  eraseSubjectData,
  exportSubjectData,
  getSubjectData,
  resolveSubjectUserId,
} from './data-subject-rights-service.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    document: { findMany: vi.fn() },
    attendanceRecord: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    performanceReview: { findMany: vi.fn() },
    candidate: { findFirst: vi.fn(), updateMany: vi.fn() },
    offboardingRecord: { findFirst: vi.fn() },
    consentRecord: { findMany: vi.fn(), updateMany: vi.fn() },
    legalHold: { findMany: vi.fn() },
    employee: { update: vi.fn() },
  },
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('./document-service.js', () => ({
  deleteEmployeeFiles: vi.fn(),
}));

vi.mock('../utils/crypto.js', () => ({
  decrypt: vi.fn(),
}));

const m = {
  userFindUnique: vi.mocked(prisma.user.findUnique),
  userUpdate: vi.mocked(prisma.user.update),
  documentFindMany: vi.mocked(prisma.document.findMany),
  attendanceFindMany: vi.mocked(prisma.attendanceRecord.findMany),
  leaveFindMany: vi.mocked(prisma.leaveRequest.findMany),
  performanceFindMany: vi.mocked(prisma.performanceReview.findMany),
  candidateFindFirst: vi.mocked(prisma.candidate.findFirst),
  consentFindMany: vi.mocked(prisma.consentRecord.findMany),
  legalHoldFindMany: vi.mocked(prisma.legalHold.findMany),
  employeeUpdate: vi.mocked(prisma.employee.update),
  candidateUpdateMany: vi.mocked(prisma.candidate.updateMany),
  consentUpdateMany: vi.mocked(prisma.consentRecord.updateMany),
  logAuditEvent: vi.mocked(logAuditEvent),
  deleteEmployeeFiles: vi.mocked(deleteEmployeeFiles),
  decrypt: vi.mocked(decrypt),
};

const actor = { actorId: 'u-1', actorName: 'Jane' };

const subjectUser = {
  id: 'u-5',
  email: 'priya@example.com',
  name: 'Priya',
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  created_at: new Date('2026-01-01'),
  employee: {
    id: 'e-5',
    employee_no: 'E-5',
    first_name: 'Priya',
    last_name: 'Nair',
    email: 'priya@example.com',
    phone: '123',
    national_id_encrypted: 'enc-nid',
    salary_encrypted: 'enc-salary',
    hire_date: new Date('2026-01-01'),
    deactivation_date: null,
  },
};

describe('data-subject-rights-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.decrypt.mockImplementation((c: string) => `dec:${c}`);
  });

  describe('getSubjectData', () => {
    it('throws when neither id nor email is provided', async () => {
      await expect(getSubjectData()).rejects.toBeInstanceOf(HttpError);
    });

    it('aggregates data and decrypts sensitive fields', async () => {
      m.userFindUnique.mockResolvedValue(subjectUser as never);
      m.documentFindMany.mockResolvedValue([{ id: 'd-1', type: 'CONTRACT' }] as never);
      m.attendanceFindMany.mockResolvedValue([] as never);
      m.leaveFindMany.mockResolvedValue([] as never);
      m.performanceFindMany.mockResolvedValue([] as never);
      m.candidateFindFirst.mockResolvedValue(null);
      m.consentFindMany.mockResolvedValue([] as never);

      const result = await getSubjectData('u-5');

      expect(result.user.email).toBe('priya@example.com');
      expect(result.employee?.nationalId).toBe('dec:enc-nid');
      expect(result.employee?.salary).toBe('dec:enc-salary');
      expect(m.decrypt).toHaveBeenCalledWith('enc-nid');
      expect(m.decrypt).toHaveBeenCalledWith('enc-salary');
    });

    it('throws 404 when the user is not found', async () => {
      m.userFindUnique.mockResolvedValue(null);
      await expect(getSubjectData('missing')).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe('resolveSubjectUserId', () => {
    it('allows ADMIN/HR to access any subject', async () => {
      await expect(resolveSubjectUserId('u-9', 'u-1', 'ADMIN')).resolves.toBe('u-9');
      await expect(resolveSubjectUserId('u-9', 'u-1', 'HR_MANAGER')).resolves.toBe('u-9');
    });

    it('allows a user to access their own data', async () => {
      await expect(resolveSubjectUserId('u-5', 'u-5', 'EMPLOYEE')).resolves.toBe('u-5');
    });

    it('blocks non-privileged users from accessing others data', async () => {
      await expect(resolveSubjectUserId('u-9', 'u-5', 'EMPLOYEE')).rejects.toBeInstanceOf(
        HttpError,
      );
      await expect(resolveSubjectUserId('u-9', 'u-5', 'MANAGER')).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe('eraseSubjectData', () => {
    it('throws 404 when the subject is not found', async () => {
      m.userFindUnique.mockResolvedValue(null);
      await expect(
        eraseSubjectData('missing', actor.actorId, actor.actorName),
      ).rejects.toBeInstanceOf(HttpError);
    });

    it('anonymizes data and deletes files when no legal hold exists', async () => {
      m.userFindUnique.mockResolvedValue(subjectUser as never);
      m.legalHoldFindMany.mockResolvedValue([] as never);
      m.deleteEmployeeFiles.mockResolvedValue(3);
      m.employeeUpdate.mockResolvedValue({} as never);
      m.userUpdate.mockResolvedValue({} as never);
      m.candidateUpdateMany.mockResolvedValue({ count: 0 } as never);
      m.consentUpdateMany.mockResolvedValue({ count: 0 } as never);

      const result = await eraseSubjectData('u-5', actor.actorId, actor.actorName);

      expect(m.deleteEmployeeFiles).toHaveBeenCalledWith('e-5');
      expect(m.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e-5' },
        data: expect.objectContaining({ first_name: '[ERASED]', national_id_encrypted: null }),
      });
      expect(m.userUpdate).toHaveBeenCalledWith({
        where: { id: 'u-5' },
        data: expect.objectContaining({ status: 'DEACTIVATED', password_hash: '[ERASED]' }),
      });
      expect(result.filesDeleted).toBe(3);
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PURGE', entity: 'DATA_SUBJECT_RIGHTS' }),
      );
    });

    it('retains records and skips deletion when a legal hold exists', async () => {
      m.userFindUnique.mockResolvedValue(subjectUser as never);
      m.legalHoldFindMany.mockResolvedValue([
        { entity_type: 'employees', entity_id: 'e-5', reason: 'Litigation' },
      ] as never);
      m.candidateUpdateMany.mockResolvedValue({ count: 0 } as never);
      m.consentUpdateMany.mockResolvedValue({ count: 0 } as never);

      const result = await eraseSubjectData('u-5', actor.actorId, actor.actorName);

      expect(m.deleteEmployeeFiles).not.toHaveBeenCalled();
      expect(result.retainedRecords.length).toBeGreaterThan(0);
      expect(result.erased).toBe(true);
    });
  });

  describe('exportSubjectData', () => {
    it('exports JSON and logs an audit entry', async () => {
      m.userFindUnique.mockResolvedValue(subjectUser as never);
      m.documentFindMany.mockResolvedValue([] as never);
      m.attendanceFindMany.mockResolvedValue([] as never);
      m.leaveFindMany.mockResolvedValue([] as never);
      m.performanceFindMany.mockResolvedValue([] as never);
      m.candidateFindFirst.mockResolvedValue(null);
      m.consentFindMany.mockResolvedValue([] as never);

      const result = await exportSubjectData('u-5', 'json', actor.actorId, actor.actorName);

      expect(result.format).toBe('json');
      expect(result.data).toHaveProperty('user');
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT', entity: 'DATA_SUBJECT_RIGHTS' }),
      );
    });

    it('exports a flattened CSV structure', async () => {
      m.userFindUnique.mockResolvedValue(subjectUser as never);
      m.documentFindMany.mockResolvedValue([] as never);
      m.attendanceFindMany.mockResolvedValue([] as never);
      m.leaveFindMany.mockResolvedValue([] as never);
      m.performanceFindMany.mockResolvedValue([] as never);
      m.candidateFindFirst.mockResolvedValue(null);
      m.consentFindMany.mockResolvedValue([] as never);

      const result = await exportSubjectData('u-5', 'csv', actor.actorId, actor.actorName);

      expect(result.format).toBe('csv');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });
});
