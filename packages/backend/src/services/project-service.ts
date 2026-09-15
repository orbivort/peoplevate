import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import { HttpError } from '../utils/http-error.js';

// ── DTOs (camelCase, contract-shaped) ──────────

export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  client: string | null;
  isBillable: boolean;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
  taskCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectTaskDto {
  id: string;
  projectId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectAdminDto {
  id: string;
  code: string;
  name: string;
  client: string | null;
  isBillable: boolean;
  isActive: boolean;
  entryCount: number;
  taskCount: number;
}

interface RawProject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  client: string | null;
  is_billable: boolean;
  start_date: Date | null;
  end_date: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface RawProjectWithCount extends RawProject {
  _count: { tasks: number };
}

interface RawTask {
  id: string;
  project_id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ── Helpers ─────────────────────────────────────

function isPrismaErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === code
  );
}

/**
 * Translate known Prisma errors at the service boundary so callers receive a
 * proper HttpError instead of an opaque 500.
 */
function translatePrismaError(err: unknown): never {
  if (isPrismaErrorCode(err, 'P2002')) {
    throw new HttpError(409, 'A record with the same unique value already exists');
  }
  if (isPrismaErrorCode(err, 'P2025')) {
    throw new HttpError(404, 'Resource not found');
  }
  if (isPrismaErrorCode(err, 'P2003')) {
    throw new HttpError(400, 'A referenced record does not exist');
  }
  throw err;
}

function mapProjectDto(project: RawProjectWithCount): ProjectDto {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    description: project.description,
    client: project.client,
    isBillable: project.is_billable,
    startDate: project.start_date,
    endDate: project.end_date,
    isActive: project.is_active,
    taskCount: project._count.tasks,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function mapTaskDto(task: RawTask): ProjectTaskDto {
  return {
    id: task.id,
    projectId: task.project_id,
    name: task.name,
    isActive: task.is_active,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

/** When both dates are given, the start must not be after the end. */
function assertValidDateRange(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
): void {
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new HttpError(400, 'Start date must be before end date');
  }
}

// ── Projects ────────────────────────────────────

export async function listProjects(params: {
  includeInactive?: boolean | undefined;
}): Promise<ProjectDto[]> {
  const where: Record<string, unknown> = { deleted_at: null };
  if (!params.includeInactive) where.is_active = true;

  const projects = await prisma.project.findMany({
    where: where as never,
    orderBy: { code: 'asc' },
    include: { _count: { select: { tasks: { where: { deleted_at: null } } } } },
  });
  return projects.map(mapProjectDto);
}

export async function createProject(params: {
  code: string;
  name: string;
  description?: string | null | undefined;
  client?: string | null | undefined;
  isBillable?: boolean | undefined;
  startDate?: Date | null | undefined;
  endDate?: Date | null | undefined;
  actorId: string;
  actorName: string;
}): Promise<ProjectDto> {
  const code = params.code?.trim();
  const name = params.name?.trim();
  if (!code) throw new HttpError(400, 'Project code is required');
  if (!name) throw new HttpError(400, 'Project name is required');
  assertValidDateRange(params.startDate, params.endDate);

  // Check against ALL rows (including soft-deleted) — the DB unique constraint
  // on code spans soft-deleted rows too, so a plain create would 500 otherwise.
  const existing = await prisma.project.findFirst({ where: { code }, select: { id: true } });
  if (existing) throw new HttpError(409, 'A project with this code already exists');

  try {
    const project = await withAuditContext(prisma, params.actorId, params.actorName, (tx) =>
      tx.project.create({
        data: {
          code,
          name,
          description: params.description ?? null,
          client: params.client ?? null,
          is_billable: params.isBillable ?? false,
          start_date: params.startDate ?? null,
          end_date: params.endDate ?? null,
        },
        include: { _count: { select: { tasks: { where: { deleted_at: null } } } } },
      }),
    );
    return mapProjectDto(project);
  } catch (err) {
    translatePrismaError(err);
  }
}

export async function updateProject(params: {
  projectId: string;
  code?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  client?: string | null | undefined;
  isBillable?: boolean | undefined;
  startDate?: Date | null | undefined;
  endDate?: Date | null | undefined;
  isActive?: boolean | undefined;
  actorId: string;
  actorName: string;
}): Promise<ProjectDto> {
  const project = await prisma.project.findFirst({
    where: { id: params.projectId, deleted_at: null },
  });
  if (!project) throw new HttpError(404, 'Project not found');

  if (params.code !== undefined) {
    const code = params.code.trim();
    if (!code) throw new HttpError(400, 'Project code is required');
    if (code !== project.code) {
      const clash = await prisma.project.findFirst({
        where: { code, id: { not: params.projectId } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, 'A project with this code already exists');
    }
  }

  const nextStartDate = params.startDate !== undefined ? params.startDate : project.start_date;
  const nextEndDate = params.endDate !== undefined ? params.endDate : project.end_date;
  assertValidDateRange(nextStartDate, nextEndDate);

  const data: Record<string, unknown> = {};
  if (params.code !== undefined) data.code = params.code.trim();
  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) throw new HttpError(400, 'Project name is required');
    data.name = name;
  }
  if (params.description !== undefined) data.description = params.description ?? null;
  if (params.client !== undefined) data.client = params.client ?? null;
  if (params.isBillable !== undefined) data.is_billable = params.isBillable;
  if (params.startDate !== undefined) data.start_date = params.startDate ?? null;
  if (params.endDate !== undefined) data.end_date = params.endDate ?? null;
  if (params.isActive !== undefined) data.is_active = params.isActive;

  try {
    const updated = await withAuditContext(prisma, params.actorId, params.actorName, (tx) =>
      tx.project.update({
        where: { id: params.projectId },
        data: data as never,
        include: { _count: { select: { tasks: { where: { deleted_at: null } } } } },
      }),
    );
    return mapProjectDto(updated);
  } catch (err) {
    translatePrismaError(err);
  }
}

export async function deleteProject(params: {
  projectId: string;
  actorId: string;
  actorName: string;
}): Promise<{ deleted: true }> {
  const project = await prisma.project.findFirst({
    where: { id: params.projectId, deleted_at: null },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, 'Project not found');

  // Blocked while any non-deleted entry references the project or one of its tasks.
  const entryCount = await prisma.timesheetEntry.count({
    where: {
      deleted_at: null,
      OR: [{ project_id: params.projectId }, { task: { project_id: params.projectId } }],
    },
  });
  if (entryCount > 0) {
    throw new HttpError(
      409,
      'Project has timesheet entries and cannot be deleted. Deactivate it instead',
    );
  }

  const now = new Date();
  await withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    // updateMany does not fire @updatedAt, so set it explicitly.
    await tx.projectTask.updateMany({
      where: { project_id: params.projectId, deleted_at: null },
      data: { deleted_at: now, updated_at: now },
    });
    await tx.project.update({
      where: { id: params.projectId },
      data: { deleted_at: now, is_active: false },
    });
  });
  return { deleted: true };
}

export async function getProjectsWithEntryCounts(): Promise<ProjectAdminDto[]> {
  const projects = await prisma.project.findMany({
    where: { deleted_at: null },
    orderBy: { code: 'asc' },
    include: {
      _count: {
        select: {
          entries: { where: { deleted_at: null } },
          tasks: { where: { deleted_at: null } },
        },
      },
    },
  });
  return projects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client,
    isBillable: p.is_billable,
    isActive: p.is_active,
    entryCount: p._count.entries,
    taskCount: p._count.tasks,
  }));
}

// ── Project tasks ───────────────────────────────

async function findActiveProject(projectId: string): Promise<{ id: string }> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

/** List a project's tasks (non-deleted; active only unless includeInactive). */
export async function listTasks(params: {
  projectId: string;
  includeInactive?: boolean | undefined;
}): Promise<ProjectTaskDto[]> {
  await findActiveProject(params.projectId);

  const where: Record<string, unknown> = {
    project_id: params.projectId,
    deleted_at: null,
  };
  if (!params.includeInactive) where.is_active = true;
  const tasks = await prisma.projectTask.findMany({
    where: where as never,
    orderBy: { name: 'asc' },
  });
  return tasks.map(mapTaskDto);
}

export async function createTask(params: {
  projectId: string;
  name: string;
  actorId: string;
  actorName: string;
}): Promise<ProjectTaskDto> {
  await findActiveProject(params.projectId);

  const name = params.name?.trim();
  if (!name) throw new HttpError(400, 'Task name is required');

  // The DB unique (project_id, name) spans soft-deleted rows — check all rows.
  const clash = await prisma.projectTask.findFirst({
    where: { project_id: params.projectId, name },
    select: { id: true },
  });
  if (clash) throw new HttpError(409, 'A task with this name already exists in this project');

  try {
    const task = await withAuditContext(prisma, params.actorId, params.actorName, (tx) =>
      tx.projectTask.create({ data: { project_id: params.projectId, name } }),
    );
    return mapTaskDto(task);
  } catch (err) {
    translatePrismaError(err);
  }
}

export async function updateTask(params: {
  taskId: string;
  name?: string | undefined;
  isActive?: boolean | undefined;
  actorId: string;
  actorName: string;
}): Promise<ProjectTaskDto> {
  const task = await prisma.projectTask.findFirst({
    where: { id: params.taskId, deleted_at: null },
  });
  if (!task) throw new HttpError(404, 'Task not found');

  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) throw new HttpError(400, 'Task name is required');
    if (name !== task.name) {
      const clash = await prisma.projectTask.findFirst({
        where: { project_id: task.project_id, name, id: { not: params.taskId } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, 'A task with this name already exists in this project');
    }
  }

  const data: Record<string, unknown> = {};
  if (params.name !== undefined) data.name = params.name.trim();
  if (params.isActive !== undefined) data.is_active = params.isActive;

  try {
    const updated = await withAuditContext(prisma, params.actorId, params.actorName, (tx) =>
      tx.projectTask.update({ where: { id: params.taskId }, data: data as never }),
    );
    return mapTaskDto(updated);
  } catch (err) {
    translatePrismaError(err);
  }
}

export async function deleteTask(params: {
  taskId: string;
  actorId: string;
  actorName: string;
}): Promise<{ deleted: true }> {
  const task = await prisma.projectTask.findFirst({
    where: { id: params.taskId, deleted_at: null },
    select: { id: true },
  });
  if (!task) throw new HttpError(404, 'Task not found');

  const entryCount = await prisma.timesheetEntry.count({
    where: { task_id: params.taskId, deleted_at: null },
  });
  if (entryCount > 0) {
    throw new HttpError(
      409,
      'Task has timesheet entries and cannot be deleted. Deactivate it instead',
    );
  }

  await withAuditContext(prisma, params.actorId, params.actorName, (tx) =>
    tx.projectTask.update({ where: { id: params.taskId }, data: { deleted_at: new Date() } }),
  );
  return { deleted: true };
}
