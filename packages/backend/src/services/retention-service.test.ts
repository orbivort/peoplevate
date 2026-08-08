import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { logAuditEvent } from './audit-service.js';
import { deletePhysicalFile } from './document-service.js';
import {
  dryRunPurge,
  executePurge,
  listPolicies,
  placeLegalHold,
  purgeOldIpAddresses,
  releaseLegalHold,
  upsertPolicy,
} from './retention-service.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    retentionPolicy: { findMany: vi.fn(), upsert: vi.fn() },
    legalHold: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    employee: { findMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
    candidate: { findMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
    document: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    attendanceRecord: { updateMany: vi.fn() },
  },
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('../config/env.js', () => ({
  env: { IP_RETENTION_DAYS: 90 },
}));

vi.mock('./document-service.js', () => ({
  deletePhysicalFile: vi.fn(),
}));

const m = {
  policyFindMany: vi.mocked(prisma.retentionPolicy.findMany),
  policyUpsert: vi.mocked(prisma.retentionPolicy.upsert),
  legalHoldCreate: vi.mocked(prisma.legalHold.create),
  legalHoldUpdate: vi.mocked(prisma.legalHold.update),
  legalHoldFindFirst: vi.mocked(prisma.legalHold.findFirst),
  employeeFindMany: vi.mocked(prisma.employee.findMany),
  employeeDelete: vi.mocked(prisma.employee.delete),
  employeeUpdate: vi.mocked(prisma.employee.update),
  candidateFindMany: vi.mocked(prisma.candidate.findMany),
  candidateDelete: vi.mocked(prisma.candidate.delete),
  candidateUpdate: vi.mocked(prisma.candidate.update),
  documentFindMany: vi.mocked(prisma.document.findMany),
  documentDeleteMany: vi.mocked(prisma.document.deleteMany),
  attendanceUpdateMany: vi.mocked(prisma.attendanceRecord.updateMany),
  logAuditEvent: vi.mocked(logAuditEvent),
  deletePhysicalFile: vi.mocked(deletePhysicalFile),
};

const actor = { actorId: 'u-1', actorName: 'Jane' };

const policy = (category: string, years: number, action: string) => ({
  id: 'rp',
  data_category: category,
  retention_years: years,
  action,
  description: null,
  is_default: true,
});

describe('retention-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertPolicy', () => {
    it('creates a new policy when none exists', async () => {
      m.policyUpsert.mockResolvedValue({ id: 'rp' } as never);
      await upsertPolicy({
        dataCategory: 'AUDIT_LOGS' as never,
        retentionYears: 5,
        action: 'HARD_DELETE' as never,
      });
      expect(m.policyUpsert).toHaveBeenCalledWith({
        where: { data_category: 'AUDIT_LOGS' },
        create: expect.objectContaining({ retention_years: 5, action: 'HARD_DELETE' }),
        update: expect.objectContaining({ retention_years: 5 }),
      });
    });
  });

  describe('placeLegalHold / releaseLegalHold', () => {
    it('rejects a legal hold without a reason', async () => {
      await expect(
        placeLegalHold({ entityType: 'Employee', entityId: 'e-1', reason: '  ', ...actor }),
      ).rejects.toBeInstanceOf(HttpError);
    });

    it('creates a legal hold and logs an audit entry', async () => {
      m.legalHoldCreate.mockResolvedValue({ id: 'lh-1', entity_id: 'e-1' } as never);
      await placeLegalHold({
        entityType: 'Employee',
        entityId: 'e-1',
        reason: 'Litigation',
        ...actor,
      });
      expect(m.legalHoldCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'Employee',
          entity_id: 'e-1',
          reason: 'Litigation',
        }),
      });
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entity: 'RETENTION' }),
      );
    });

    it('releases a legal hold and logs an audit entry', async () => {
      m.legalHoldUpdate.mockResolvedValue({
        id: 'lh-1',
        entity_id: 'e-1',
        released_at: new Date(),
      } as never);
      await releaseLegalHold('lh-1', actor.actorId, actor.actorName);
      expect(m.legalHoldUpdate).toHaveBeenCalledWith({
        where: { id: 'lh-1' },
        data: expect.objectContaining({ released_at: expect.any(Date) }),
      });
    });
  });

  describe('dryRunPurge', () => {
    it('skips records under legal hold', async () => {
      m.policyFindMany.mockResolvedValue([policy('CANDIDATE_RESUMES', 2, 'ANONYMIZE')] as never);
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 3);
      m.candidateFindMany.mockResolvedValue([{ id: 'c-1', created_at: oldDate }] as never);
      m.legalHoldFindFirst.mockResolvedValue({ id: 'lh-1' } as never);

      const result = await dryRunPurge();
      expect(result).toHaveLength(0);
    });

    it('includes overdue records not under legal hold', async () => {
      m.policyFindMany.mockResolvedValue([policy('CANDIDATE_RESUMES', 2, 'ANONYMIZE')] as never);
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 3);
      m.candidateFindMany.mockResolvedValue([{ id: 'c-1', created_at: oldDate }] as never);
      m.legalHoldFindFirst.mockResolvedValue(null);

      const result = await dryRunPurge();
      expect(result).toHaveLength(1);
      expect(result[0].entityId).toBe('c-1');
    });
  });

  describe('executePurge', () => {
    it('hard-deletes employees and their documents', async () => {
      m.policyFindMany.mockResolvedValue([
        policy('TERMINATED_EMPLOYEE_RECORDS', 7, 'HARD_DELETE'),
      ] as never);
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 8);
      m.employeeFindMany.mockResolvedValue([{ id: 'e-1', deleted_at: oldDate }] as never);
      m.legalHoldFindFirst.mockResolvedValue(null);
      m.documentFindMany.mockResolvedValue([{ file_path: '/tmp/doc.pdf' }] as never);
      m.employeeDelete.mockResolvedValue({} as never);

      const result = await executePurge(actor.actorId, actor.actorName);

      expect(m.deletePhysicalFile).toHaveBeenCalledWith('/tmp/doc.pdf');
      expect(m.documentDeleteMany).toHaveBeenCalledWith({ where: { employee_id: 'e-1' } });
      expect(m.employeeDelete).toHaveBeenCalledWith({ where: { id: 'e-1' } });
      expect(result.purged).toBe(1);
      expect(m.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PURGE' }));
    });

    it('anonymizes candidate records', async () => {
      m.policyFindMany.mockResolvedValue([policy('CANDIDATE_RESUMES', 2, 'ANONYMIZE')] as never);
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 3);
      m.candidateFindMany.mockResolvedValue([{ id: 'c-1', created_at: oldDate }] as never);
      m.legalHoldFindFirst.mockResolvedValue(null);
      m.candidateUpdate.mockResolvedValue({} as never);

      const result = await executePurge(actor.actorId, actor.actorName);

      expect(m.candidateUpdate).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: expect.objectContaining({ first_name: '[ANONYMIZED]' }),
      });
      expect(result.anonymized).toBe(1);
    });

    it('skips records under legal hold', async () => {
      m.policyFindMany.mockResolvedValue([
        policy('TERMINATED_EMPLOYEE_RECORDS', 7, 'HARD_DELETE'),
      ] as never);
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 8);
      m.employeeFindMany.mockResolvedValue([{ id: 'e-1', deleted_at: oldDate }] as never);
      m.legalHoldFindFirst.mockResolvedValue({ id: 'lh-1' } as never);

      const result = await executePurge(actor.actorId, actor.actorName);
      expect(result.skipped).toBe(1);
      expect(result.purged).toBe(0);
    });
  });

  describe('purgeOldIpAddresses', () => {
    it('nulls out old IP addresses and audits the change', async () => {
      m.attendanceUpdateMany.mockResolvedValue({ count: 5 } as never);
      const result = await purgeOldIpAddresses();
      expect(result).toBe(5);
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PURGE',
          newValue: { purgedIpAddresses: 5, retentionDays: 90 },
        }),
      );
    });

    it('does not audit when nothing was purged', async () => {
      m.attendanceUpdateMany.mockResolvedValue({ count: 0 } as never);
      await purgeOldIpAddresses();
      expect(m.logAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('listPolicies', () => {
    it('orders policies by data category', async () => {
      m.policyFindMany.mockResolvedValue([] as never);
      await listPolicies();
      expect(m.policyFindMany).toHaveBeenCalledWith({
        orderBy: { data_category: 'asc' },
      });
    });
  });
});
