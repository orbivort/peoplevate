import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    projectTask: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    timesheetEntry: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: (tx: unknown) => unknown) =>
      cb(prisma),
  ),
}));

import { prisma } from '../config/prisma.js';
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getProjectsWithEntryCounts,
  listProjects,
  updateProject,
  updateTask,
} from './project-service.js';

const mocked = {
  projectFindFirst: vi.mocked(prisma.project.findFirst),
  projectFindMany: vi.mocked(prisma.project.findMany),
  projectCreate: vi.mocked(prisma.project.create),
  projectUpdate: vi.mocked(prisma.project.update),
  taskFindFirst: vi.mocked(prisma.projectTask.findFirst),
  taskCreate: vi.mocked(prisma.projectTask.create),
  taskUpdate: vi.mocked(prisma.projectTask.update),
  taskUpdateMany: vi.mocked(prisma.projectTask.updateMany),
  entryCount: vi.mocked(prisma.timesheetEntry.count),
};

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    code: 'ERP-001',
    name: 'ERP Migration',
    description: 'Legacy ERP migration',
    client: 'Internal',
    is_billable: true,
    start_date: new Date('2026-01-05T00:00:00Z'),
    end_date: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    _count: { tasks: 3 },
    ...overrides,
  };
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    name: 'Implementation',
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { status: number }).status).toBe(status);
    if (message) expect((err as Error).message).toContain(message);
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

describe('project-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listProjects', () => {
    it('lists active projects only by default', async () => {
      mocked.projectFindMany.mockResolvedValue([projectRow()] as never);

      await listProjects({});

      expect(mocked.projectFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null, is_active: true },
          orderBy: { code: 'asc' },
        }),
      );
    });

    it('includes inactive projects when requested', async () => {
      mocked.projectFindMany.mockResolvedValue([] as never);

      await listProjects({ includeInactive: true });

      expect(mocked.projectFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });

    it('maps rows to the camelCase DTO with task counts', async () => {
      mocked.projectFindMany.mockResolvedValue([projectRow()] as never);

      const projects = await listProjects({});

      expect(projects[0]).toEqual(
        expect.objectContaining({
          id: 'proj-1',
          code: 'ERP-001',
          isBillable: true,
          isActive: true,
          taskCount: 3,
        }),
      );
    });
  });

  describe('createProject', () => {
    it('creates a project with mapped fields', async () => {
      mocked.projectFindFirst.mockResolvedValue(null as never);
      mocked.projectCreate.mockResolvedValue(projectRow() as never);

      const project = await createProject({
        code: 'ERP-001',
        name: 'ERP Migration',
        description: 'Legacy ERP migration',
        client: 'Internal',
        isBillable: true,
        startDate: new Date('2026-01-05'),
        actorId: 'user-hr',
        actorName: 'HR Manager',
      });

      expect(mocked.projectCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'ERP-001',
          name: 'ERP Migration',
          is_billable: true,
          start_date: new Date('2026-01-05'),
        }),
        include: expect.anything(),
      });
      expect(project.code).toBe('ERP-001');
    });

    it('throws 409 when the code is already taken', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-other' } as never);

      await expectHttpError(
        createProject({
          code: 'ERP-001',
          name: 'Duplicate',
          actorId: 'user-hr',
          actorName: 'HR',
        }),
        409,
        'code already exists',
      );
      expect(mocked.projectCreate).not.toHaveBeenCalled();
    });

    it('maps a P2002 unique violation from the DB to a 409', async () => {
      mocked.projectFindFirst.mockResolvedValue(null as never);
      mocked.projectCreate.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expectHttpError(
        createProject({ code: 'ERP-001', name: 'Race', actorId: 'u', actorName: 'n' }),
        409,
      );
    });

    it('throws 400 when startDate is after endDate', async () => {
      await expectHttpError(
        createProject({
          code: 'X-001',
          name: 'Dates',
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-05-01'),
          actorId: 'u',
          actorName: 'n',
        }),
        400,
        'Start date must be before end date',
      );
    });

    it('throws 400 for an empty code or name', async () => {
      await expectHttpError(
        createProject({ code: '  ', name: 'X', actorId: 'u', actorName: 'n' }),
        400,
        'code is required',
      );
      await expectHttpError(
        createProject({ code: 'X-001', name: '', actorId: 'u', actorName: 'n' }),
        400,
        'name is required',
      );
    });
  });

  describe('updateProject', () => {
    it('updates provided fields only', async () => {
      mocked.projectFindFirst.mockResolvedValue(projectRow() as never);
      mocked.projectUpdate.mockResolvedValue(
        projectRow({ name: 'ERP Migration v2', is_active: false }) as never,
      );

      const project = await updateProject({
        projectId: 'proj-1',
        name: 'ERP Migration v2',
        isActive: false,
        actorId: 'user-hr',
        actorName: 'HR',
      });

      expect(mocked.projectUpdate).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { name: 'ERP Migration v2', is_active: false },
        include: expect.anything(),
      });
      expect(project.isActive).toBe(false);
    });

    it('throws 404 when the project does not exist', async () => {
      mocked.projectFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        updateProject({ projectId: 'proj-x', name: 'X', actorId: 'u', actorName: 'n' }),
        404,
        'Project not found',
      );
    });

    it('throws 409 when renaming to a taken code', async () => {
      mocked.projectFindFirst.mockResolvedValueOnce(projectRow() as never);
      mocked.projectFindFirst.mockResolvedValueOnce({ id: 'proj-other' } as never);

      await expectHttpError(
        updateProject({ projectId: 'proj-1', code: 'WEB-002', actorId: 'u', actorName: 'n' }),
        409,
        'code already exists',
      );
    });

    it('validates the combined date range against existing values', async () => {
      mocked.projectFindFirst.mockResolvedValue(
        projectRow({ start_date: new Date('2026-06-01') }) as never,
      );

      await expectHttpError(
        updateProject({
          projectId: 'proj-1',
          endDate: new Date('2026-05-01'),
          actorId: 'u',
          actorName: 'n',
        }),
        400,
        'Start date must be before end date',
      );
    });
  });

  describe('deleteProject', () => {
    it('throws 404 when the project does not exist', async () => {
      mocked.projectFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        deleteProject({ projectId: 'proj-x', actorId: 'u', actorName: 'n' }),
        404,
      );
    });

    it('is blocked with 409 while entries reference the project or its tasks', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.entryCount.mockResolvedValue(3 as never);

      await expectHttpError(
        deleteProject({ projectId: 'proj-1', actorId: 'u', actorName: 'n' }),
        409,
        'has timesheet entries',
      );
      expect(mocked.projectUpdate).not.toHaveBeenCalled();
      expect(mocked.taskUpdateMany).not.toHaveBeenCalled();
    });

    it('checks entries referencing the project directly or via its tasks', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.entryCount.mockResolvedValue(0 as never);
      mocked.taskUpdateMany.mockResolvedValue({ count: 2 } as never);
      mocked.projectUpdate.mockResolvedValue(projectRow() as never);

      await deleteProject({ projectId: 'proj-1', actorId: 'u', actorName: 'n' });

      expect(mocked.entryCount).toHaveBeenCalledWith({
        where: {
          deleted_at: null,
          OR: [{ project_id: 'proj-1' }, { task: { project_id: 'proj-1' } }],
        },
      });
    });

    it('soft-deletes the project and its tasks, setting updated_at manually', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.entryCount.mockResolvedValue(0 as never);
      mocked.taskUpdateMany.mockResolvedValue({ count: 2 } as never);
      mocked.projectUpdate.mockResolvedValue(projectRow() as never);

      await deleteProject({ projectId: 'proj-1', actorId: 'u', actorName: 'n' });

      // @updatedAt does not fire on updateMany, so updated_at must be set explicitly.
      expect(mocked.taskUpdateMany).toHaveBeenCalledWith({
        where: { project_id: 'proj-1', deleted_at: null },
        data: { deleted_at: expect.any(Date), updated_at: expect.any(Date) },
      });
      expect(mocked.projectUpdate).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { deleted_at: expect.any(Date), is_active: false },
      });
    });
  });

  describe('getProjectsWithEntryCounts', () => {
    it('maps admin rows with entry and task counts', async () => {
      mocked.projectFindMany.mockResolvedValue([
        { ...projectRow(), _count: { entries: 42, tasks: 3 } },
      ] as never);

      const rows = await getProjectsWithEntryCounts();

      expect(rows[0]).toEqual({
        id: 'proj-1',
        code: 'ERP-001',
        name: 'ERP Migration',
        client: 'Internal',
        isBillable: true,
        isActive: true,
        entryCount: 42,
        taskCount: 3,
      });
    });
  });

  describe('createTask', () => {
    it('creates a task within a project', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.taskFindFirst.mockResolvedValue(null as never);
      mocked.taskCreate.mockResolvedValue(taskRow() as never);

      const task = await createTask({
        projectId: 'proj-1',
        name: 'Implementation',
        actorId: 'u',
        actorName: 'n',
      });

      expect(mocked.taskCreate).toHaveBeenCalledWith({
        data: { project_id: 'proj-1', name: 'Implementation' },
      });
      expect(task.name).toBe('Implementation');
    });

    it('throws 404 when the project does not exist', async () => {
      mocked.projectFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        createTask({ projectId: 'proj-x', name: 'T', actorId: 'u', actorName: 'n' }),
        404,
        'Project not found',
      );
    });

    it('throws 409 for a duplicate task name within the project', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.taskFindFirst.mockResolvedValue({ id: 'task-1' } as never);

      await expectHttpError(
        createTask({ projectId: 'proj-1', name: 'Implementation', actorId: 'u', actorName: 'n' }),
        409,
        'already exists',
      );
      expect(mocked.taskCreate).not.toHaveBeenCalled();
    });

    it('throws 400 for an empty task name', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);

      await expectHttpError(
        createTask({ projectId: 'proj-1', name: '  ', actorId: 'u', actorName: 'n' }),
        400,
        'name is required',
      );
    });
  });

  describe('updateTask', () => {
    it('renames and toggles activation', async () => {
      mocked.taskFindFirst
        .mockResolvedValueOnce(taskRow() as never) // load
        .mockResolvedValue(null as never); // clash check finds nothing
      mocked.taskUpdate.mockResolvedValue(taskRow({ name: 'Dev', is_active: false }) as never);

      const task = await updateTask({
        taskId: 'task-1',
        name: 'Dev',
        isActive: false,
        actorId: 'u',
        actorName: 'n',
      });

      expect(mocked.taskUpdate).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { name: 'Dev', is_active: false },
      });
      expect(task.isActive).toBe(false);
    });

    it('throws 404 when the task does not exist', async () => {
      mocked.taskFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        updateTask({ taskId: 'task-x', name: 'X', actorId: 'u', actorName: 'n' }),
        404,
        'Task not found',
      );
    });

    it('throws 409 when renaming to a duplicate name in the same project', async () => {
      mocked.taskFindFirst.mockResolvedValueOnce(taskRow() as never);
      mocked.taskFindFirst.mockResolvedValueOnce({ id: 'task-2' } as never);

      await expectHttpError(
        updateTask({ taskId: 'task-1', name: 'Design', actorId: 'u', actorName: 'n' }),
        409,
        'already exists',
      );
    });
  });

  describe('deleteTask', () => {
    it('throws 404 when the task does not exist', async () => {
      mocked.taskFindFirst.mockResolvedValue(null as never);

      await expectHttpError(deleteTask({ taskId: 'task-x', actorId: 'u', actorName: 'n' }), 404);
    });

    it('is blocked with 409 while entries reference the task', async () => {
      mocked.taskFindFirst.mockResolvedValue({ id: 'task-1' } as never);
      mocked.entryCount.mockResolvedValue(5 as never);

      await expectHttpError(
        deleteTask({ taskId: 'task-1', actorId: 'u', actorName: 'n' }),
        409,
        'has timesheet entries',
      );
      expect(mocked.taskUpdate).not.toHaveBeenCalled();
    });

    it('soft-deletes the task when unreferenced', async () => {
      mocked.taskFindFirst.mockResolvedValue({ id: 'task-1' } as never);
      mocked.entryCount.mockResolvedValue(0 as never);
      mocked.taskUpdate.mockResolvedValue(taskRow() as never);

      await deleteTask({ taskId: 'task-1', actorId: 'u', actorName: 'n' });

      expect(mocked.taskUpdate).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { deleted_at: expect.any(Date) },
      });
    });
  });
});
