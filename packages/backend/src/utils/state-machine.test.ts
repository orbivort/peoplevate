import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Prisma config so no real DB adapter is instantiated at load time.
vi.mock('../config/prisma.js', () => ({
  prisma: {},
}));

// Mock the audit context wrapper so `transitionEntity` can be exercised without
// a live database transaction. It passes a fake transaction client with the
// `auditLog.create` delegate used by the application-level audit entry.
const tx = {
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
};
const withAuditContext = vi.fn(
  async (_prisma: unknown, _actorId: string, _actorName: string, fn: (t: typeof tx) => unknown) =>
    fn(tx),
);
vi.mock('./audit-context.js', () => ({
  withAuditContext,
}));

const { assertTransition, InvalidTransitionError, transitionEntity } =
  await import('./state-machine');

// A simple, self-contained transition map for employment statuses.
const map = {
  'New Hire': ['Active', 'Terminated'],
  Active: ['On Leave', 'Terminated'],
  'On Leave': ['Active', 'Terminated'],
  Probation: ['Active', 'Terminated'],
  Terminated: [],
};

describe('assertTransition', () => {
  it('does not throw for an allowed transition', () => {
    expect(() => assertTransition('Employee', map, 'New Hire', 'Active')).not.toThrow();
  });

  it('throws InvalidTransitionError for a disallowed transition', () => {
    expect(() => assertTransition('Employee', map, 'Terminated', 'Active')).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws when the source state is unknown', () => {
    expect(() => assertTransition('Employee', map, 'Bogus', 'Active')).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('transitionEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the update inside the audit context when the transition is valid', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'emp-1', status: 'Active' });

    const result = await transitionEntity({
      entity: 'Employee',
      action: 'EMPLOYEE_UPDATED',
      entityId: 'emp-1',
      from: 'New Hire',
      to: 'Active',
      map,
      actorId: 'actor-1',
      actorName: 'Ada Lovelace',
      update,
    });

    expect(result).toEqual({ id: 'emp-1', status: 'Active' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(withAuditContext).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an illegal transition before invoking the update', async () => {
    const update = vi.fn();

    await expect(
      transitionEntity({
        entity: 'Employee',
        action: 'EMPLOYEE_UPDATED',
        entityId: 'emp-1',
        from: 'Terminated',
        to: 'Active',
        map,
        actorId: 'actor-1',
        actorName: 'Ada Lovelace',
        update,
      }),
    ).rejects.toThrow(InvalidTransitionError);

    expect(update).not.toHaveBeenCalled();
    expect(withAuditContext).not.toHaveBeenCalled();
  });
});
