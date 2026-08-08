import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    department: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    employee: {
      count: vi.fn(),
    },
    position: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '../config/prisma.js';
import {
  createDepartment,
  createPosition,
  deleteDepartment,
  deletePosition,
  listDepartments,
  listPositions,
  updateDepartment,
  updatePosition,
} from './org-service.js';

const mocked = {
  departmentCreate: vi.mocked(prisma.department.create),
  departmentUpdate: vi.mocked(prisma.department.update),
  departmentFindMany: vi.mocked(prisma.department.findMany),
  departmentFindUnique: vi.mocked(prisma.department.findUnique),
  departmentCount: vi.mocked(prisma.department.count),
  employeeCount: vi.mocked(prisma.employee.count),
  positionCreate: vi.mocked(prisma.position.create),
  positionUpdate: vi.mocked(prisma.position.update),
  positionFindMany: vi.mocked(prisma.position.findMany),
  positionCount: vi.mocked(prisma.position.count),
};

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { status: number }).status).toBe(status);
    if (message) {
      expect((err as Error).message).toContain(message);
    }
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

describe('org-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDepartment', () => {
    it('creates a top-level department without a parent', async () => {
      mocked.departmentCreate.mockResolvedValue({ id: 'dep-1' } as never);

      await createDepartment({ name: 'Engineering' });

      expect(mocked.departmentCreate).toHaveBeenCalledWith({
        data: {
          name: 'Engineering',
          description: null,
        },
      });
    });

    it('creates a child department with a parent connection', async () => {
      mocked.departmentCreate.mockResolvedValue({ id: 'dep-2' } as never);

      await createDepartment({ name: 'Backend', parentId: 'dep-1' });

      expect(mocked.departmentCreate).toHaveBeenCalledWith({
        data: {
          name: 'Backend',
          description: null,
          parent: { connect: { id: 'dep-1' } },
        },
      });
    });

    it('throws when updateDepartment sets a department as its own parent', async () => {
      await expectHttpError(
        updateDepartment('dep-1', { parentId: 'dep-1' }),
        400,
        'cannot be its own parent',
      );
    });

    it('throws when updateDepartment would create a descendant cycle', async () => {
      mocked.departmentFindUnique
        .mockResolvedValueOnce({ parent_id: 'dep-3' } as never)
        .mockResolvedValueOnce({ parent_id: 'dep-1' } as never);

      await expectHttpError(updateDepartment('dep-1', { parentId: 'dep-2' }), 400, 'descendant');
      expect(mocked.departmentFindUnique).toHaveBeenCalledWith({
        where: { id: 'dep-2' },
        select: { parent_id: true },
      });
    });
  });

  describe('updateDepartment', () => {
    it('updates only provided fields', async () => {
      mocked.departmentUpdate.mockResolvedValue({ id: 'dep-1' } as never);

      await updateDepartment('dep-1', { name: 'New Name' });

      expect(mocked.departmentUpdate).toHaveBeenCalledWith({
        where: { id: 'dep-1', deleted_at: null },
        data: { name: 'New Name' },
      });
    });
  });

  describe('deleteDepartment', () => {
    it('soft-deletes when there are no active positions or employees', async () => {
      mocked.positionCount.mockResolvedValue(0);
      mocked.employeeCount.mockResolvedValue(0);
      mocked.departmentUpdate.mockResolvedValue({} as never);

      await deleteDepartment('dep-1');

      expect(mocked.departmentUpdate).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: { deleted_at: expect.any(Date) },
      });
    });

    it('throws 409 when the department still has active positions or employees', async () => {
      mocked.positionCount.mockResolvedValue(2);
      mocked.employeeCount.mockResolvedValue(1);

      await expectHttpError(
        deleteDepartment('dep-1'),
        409,
        '2 active position(s) and 1 active employee(s)',
      );
    });
  });

  describe('listDepartments', () => {
    it('returns mapped departments with counts', async () => {
      mocked.departmentFindMany.mockResolvedValue([
        {
          id: 'dep-1',
          name: 'Engineering',
          description: 'desc',
          parent: { id: 'dep-0', name: 'Root' },
          _count: { positions: 3, employees: 10 },
          created_at: new Date(),
          updated_at: new Date(),
        },
      ] as never);

      const result = await listDepartments();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'dep-1',
        name: 'Engineering',
        positionCount: 3,
        employeeCount: 10,
      });
      expect(mocked.departmentFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
        include: {
          parent: { select: { id: true, name: true } },
          _count: {
            select: {
              positions: { where: { deleted_at: null } },
              employees: { where: { deleted_at: null } },
            },
          },
        },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('createPosition', () => {
    it('creates a position linked to a department', async () => {
      mocked.positionCreate.mockResolvedValue({ id: 'pos-1' } as never);

      await createPosition({ name: 'Engineer', grade: 'G7', departmentId: 'dep-1' });

      expect(mocked.positionCreate).toHaveBeenCalledWith({
        data: {
          name: 'Engineer',
          grade: 'G7',
          description: null,
          department_id: 'dep-1',
        },
      });
    });
  });

  describe('updatePosition', () => {
    it('updates provided position fields', async () => {
      mocked.positionUpdate.mockResolvedValue({ id: 'pos-1' } as never);

      await updatePosition('pos-1', { grade: 'G8' });

      expect(mocked.positionUpdate).toHaveBeenCalledWith({
        where: { id: 'pos-1', deleted_at: null },
        data: { grade: 'G8' },
      });
    });
  });

  describe('deletePosition', () => {
    it('soft-deletes when no active employees use it', async () => {
      mocked.employeeCount.mockResolvedValue(0);
      mocked.positionUpdate.mockResolvedValue({} as never);

      await deletePosition('pos-1');

      expect(mocked.positionUpdate).toHaveBeenCalledWith({
        where: { id: 'pos-1' },
        data: { deleted_at: expect.any(Date) },
      });
    });

    it('throws 409 when the position still has active employees', async () => {
      mocked.employeeCount.mockResolvedValue(5);

      await expectHttpError(deletePosition('pos-1'), 409, '5 active employee(s)');
    });
  });

  describe('listPositions', () => {
    it('lists all positions when no department id is given', async () => {
      mocked.positionFindMany.mockResolvedValue([
        {
          id: 'pos-1',
          name: 'Engineer',
          grade: 'G7',
          description: null,
          department: { id: 'dep-1', name: 'Engineering' },
          _count: { employees: 4 },
          created_at: new Date(),
          updated_at: new Date(),
        },
      ] as never);

      const result = await listPositions();

      expect(result[0]).toMatchObject({ id: 'pos-1', name: 'Engineer', employeeCount: 4 });
      expect(mocked.positionFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
        include: {
          department: { select: { id: true, name: true } },
          _count: { select: { employees: { where: { deleted_at: null } } } },
        },
        orderBy: { name: 'asc' },
      });
    });

    it('filters by department id when provided', async () => {
      mocked.positionFindMany.mockResolvedValue([] as never);

      await listPositions('dep-1');

      expect(mocked.positionFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null, department_id: 'dep-1' },
        include: {
          department: { select: { id: true, name: true } },
          _count: { select: { employees: { where: { deleted_at: null } } } },
        },
        orderBy: { name: 'asc' },
      });
    });
  });
});
