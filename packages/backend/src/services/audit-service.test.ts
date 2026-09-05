import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditAction, AuditEntity } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { prisma } from '../config/prisma.js';
import {
  humanizeAction,
  humanizeEntity,
  logAuditEvent,
  logLogin,
  logLogout,
  summarizeAuditRow,
} from './audit-service.js';

const mockedAuditLog = {
  create: vi.mocked(prisma.auditLog.create),
};

describe('audit-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logAuditEvent', () => {
    it('creates an audit log entry with the provided fields', async () => {
      mockedAuditLog.create.mockResolvedValue({} as never);

      await logAuditEvent({
        actorId: 'user-1',
        actorName: 'John Doe',
        action: AuditAction.CREATE,
        entity: AuditEntity.EMPLOYEE,
        entityId: 'emp-1',
        oldValue: { name: 'old' },
        newValue: { name: 'new' },
      });

      expect(mockedAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_id: 'user-1',
          actor_name: 'John Doe',
          action: AuditAction.CREATE,
          entity: AuditEntity.EMPLOYEE,
          entity_id: 'emp-1',
          old_value: { name: 'old' },
          new_value: { name: 'new' },
        },
      });
    });

    it('defaults entityId to null when not provided', async () => {
      mockedAuditLog.create.mockResolvedValue({} as never);

      await logAuditEvent({
        actorId: 'user-1',
        actorName: 'John Doe',
        action: AuditAction.UPDATE,
        entity: AuditEntity.DEPARTMENT,
      });

      expect(mockedAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_id: 'user-1',
          actor_name: 'John Doe',
          action: AuditAction.UPDATE,
          entity: AuditEntity.DEPARTMENT,
          entity_id: null,
          old_value: undefined,
          new_value: undefined,
        },
      });
    });
  });

  describe('logLogin', () => {
    it('logs a LOGIN action against the AUTH entity', async () => {
      mockedAuditLog.create.mockResolvedValue({} as never);

      await logLogin('user-1', 'john@example.com');

      expect(mockedAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_id: 'user-1',
          actor_name: 'john@example.com',
          action: AuditAction.LOGIN,
          entity: AuditEntity.AUTH,
          entity_id: null,
          old_value: undefined,
          new_value: undefined,
        },
      });
    });
  });

  describe('logLogout', () => {
    it('logs a LOGOUT action against the AUTH entity', async () => {
      mockedAuditLog.create.mockResolvedValue({} as never);

      await logLogout('user-1', 'john@example.com');

      expect(mockedAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_id: 'user-1',
          actor_name: 'john@example.com',
          action: AuditAction.LOGOUT,
          entity: AuditEntity.AUTH,
          entity_id: null,
          old_value: undefined,
          new_value: undefined,
        },
      });
    });
  });

  describe('summarizeAuditRow', () => {
    it('humanizes the entity label', () => {
      const view = summarizeAuditRow({
        id: 'l1',
        entity: AuditEntity.JOB_REQUISITIONS,
      });
      expect(view.entityLabel).toBe('Job requisitions');
      expect(humanizeEntity(AuditEntity.EMPLOYEES)).toBe('Employees');
      expect(humanizeEntity('CUSTOM_TABLE')).toBe('Custom Table');
    });

    it('produces a field-level diff for UPDATE and redacts sensitive fields', () => {
      const view = summarizeAuditRow({
        id: 'l1',
        actor_id: 'u1',
        actor_name: 'Jing Zhao',
        action: 'UPDATE',
        entity: AuditEntity.EMPLOYEES,
        entity_id: 'emp-1',
        old_value: {
          status: 'ACTIVE',
          email: 'before@example.com',
          updated_at: '2026-08-07T08:00:00',
        },
        new_value: {
          status: 'PROBATION',
          email: 'after@example.com',
          updated_at: '2026-08-07T09:00:00',
        },
      });

      expect(view.action).toBe('UPDATE');
      expect(view.entityLabel).toBe('Employees');
      // Every audit row records a successfully committed operation.
      expect(view.status).toBe('Success');
      // updated_at is an internal tracking column and is excluded.
      const fields = view.changes.map((c) => c.field);
      expect(fields).toContain('status');
      expect(fields).toContain('email');
      expect(fields).not.toContain('updated_at');

      const status = view.changes.find((c) => c.field === 'status')!;
      expect(status.old).toBe('ACTIVE');
      expect(status.new).toBe('PROBATION');
      expect(status.sensitive).toBe(false);

      const email = view.changes.find((c) => c.field === 'email')!;
      expect(email.old).toBe('[redacted]');
      expect(email.new).toBe('[redacted]');
      expect(email.sensitive).toBe(true);
    });

    it('treats every field on a CREATE row as added', () => {
      const view = summarizeAuditRow({
        id: 'l2',
        action: 'CREATE',
        entity: AuditEntity.EMPLOYEES,
        new_value: { employee_no: 'EMP-1', status: 'ACTIVE', email: 'x@example.com' },
      });

      const fields = view.changes.map((c) => c.field);
      expect(fields).toContain('employee_no');
      expect(fields).toContain('status');
      expect(fields).toContain('email');

      const email = view.changes.find((c) => c.field === 'email')!;
      expect(email.old).toBeNull();
      expect(email.new).toBe('[redacted]');
    });

    it('skips null-only fields and raw FK id columns so the diff stays meaningful', () => {
      const view = summarizeAuditRow({
        id: 'l5',
        action: 'CREATE',
        entity: AuditEntity.EMPLOYEES,
        new_value: {
          employee_no: 'EMP-9',
          status: 'ACTIVE',
          // null-only: no meaningful value to show
          phone: null,
          address: null,
          date_of_birth: null,
          // raw FK references: internal UUIDs are not human-readable
          department_id: '11111111-1111-1111-1111-111111111111',
          position_id: '22222222-2222-2222-2222-222222222222',
        },
      });

      const fields = view.changes.map((c) => c.field);
      expect(fields).toContain('employee_no');
      expect(fields).toContain('status');
      expect(fields).not.toContain('phone');
      expect(fields).not.toContain('address');
      expect(fields).not.toContain('date_of_birth');
      expect(fields).not.toContain('department_id');
      expect(fields).not.toContain('position_id');
    });

    it('treats every field on a DELETE row as removed', () => {
      const view = summarizeAuditRow({
        id: 'l3',
        action: 'DELETE',
        entity: AuditEntity.DEPARTMENTS,
        old_value: { name: 'Sales' },
      });

      expect(view.changes).toHaveLength(1);
      expect(view.changes[0]).toMatchObject({ field: 'name', old: 'Sales', new: null });
    });

    it('produces no changes for LOGIN/LOGOUT events', () => {
      const view = summarizeAuditRow({
        id: 'l4',
        action: 'LOGIN',
        entity: AuditEntity.AUTH,
      });
      expect(view.changes).toEqual([]);
    });
  });

  describe('humanizeAction', () => {
    it('maps action enums to friendly verbs', () => {
      expect(humanizeAction('CREATE')).toBe('created');
      expect(humanizeAction('UPDATE')).toBe('updated');
      expect(humanizeAction('DELETE')).toBe('deleted');
      expect(humanizeAction('LOGIN')).toBe('logged in');
      expect(humanizeAction('EXPORT')).toBe('exported');
      expect(humanizeAction('bogus')).toBe('bogus');
    });
  });
});
