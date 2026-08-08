import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';

export async function createDepartment(params: {
  name: string;
  description?: string | undefined;
  parentId?: string | undefined;
}) {
  // Circular reference check
  if (params.parentId) {
    await checkCircularReference(params.parentId, null);
  }

  return prisma.department.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      ...(params.parentId ? { parent: { connect: { id: params.parentId } } } : {}),
    },
  });
}

export async function updateDepartment(
  id: string,
  params: {
    name?: string | undefined;
    description?: string | undefined;
    parentId?: string | undefined;
  },
) {
  if (params.parentId) {
    await checkCircularReference(params.parentId, id);
  }

  return prisma.department.update({
    where: { id, deleted_at: null },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.description !== undefined ? { description: params.description ?? null } : {}),
      ...(params.parentId ? { parent: { connect: { id: params.parentId } } } : {}),
    },
  });
}

export async function deleteDepartment(id: string): Promise<void> {
  const [positions, employees] = await Promise.all([
    prisma.position.count({ where: { department_id: id, deleted_at: null } }),
    prisma.employee.count({ where: { department_id: id, deleted_at: null } }),
  ]);

  if (positions > 0 || employees > 0) {
    throw new HttpError(
      409,
      `Cannot delete: department has ${positions} active position(s) and ${employees} active employee(s)`,
    );
  }

  await prisma.department.update({
    where: { id },
    data: { deleted_at: new Date() },
  });
}

export async function listDepartments() {
  const departments = await prisma.department.findMany({
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

  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    parent: d.parent,
    positionCount: d._count.positions,
    employeeCount: d._count.employees,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

export async function createPosition(params: {
  name: string;
  grade?: string | undefined;
  description?: string | undefined;
  departmentId: string;
}) {
  return prisma.position.create({
    data: {
      name: params.name,
      grade: params.grade ?? null,
      description: params.description ?? null,
      department_id: params.departmentId,
    },
  });
}

export async function updatePosition(
  id: string,
  params: {
    name?: string | undefined;
    grade?: string | undefined;
    description?: string | undefined;
  },
) {
  return prisma.position.update({
    where: { id, deleted_at: null },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.grade !== undefined ? { grade: params.grade ?? null } : {}),
      ...(params.description !== undefined ? { description: params.description ?? null } : {}),
    },
  });
}

export async function deletePosition(id: string): Promise<void> {
  const count = await prisma.employee.count({
    where: { position_id: id, deleted_at: null },
  });

  if (count > 0) {
    throw new HttpError(409, `Cannot delete: position has ${count} active employee(s)`);
  }

  await prisma.position.update({
    where: { id },
    data: { deleted_at: new Date() },
  });
}

export async function listPositions(departmentId?: string) {
  const where: Record<string, unknown> = { deleted_at: null };
  if (departmentId) {
    where.department_id = departmentId;
  }

  const positions = await prisma.position.findMany({
    where,
    include: {
      department: { select: { id: true, name: true } },
      _count: {
        select: { employees: { where: { deleted_at: null } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  return positions.map((p) => ({
    id: p.id,
    name: p.name,
    grade: p.grade,
    description: p.description,
    department: p.department,
    employeeCount: p._count.employees,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }));
}

// ── Helpers ──────────────────────────────────

async function checkCircularReference(parentId: string, selfId: string | null): Promise<void> {
  if (selfId && parentId === selfId) {
    throw new HttpError(400, 'A department cannot be its own parent');
  }

  const visited = new Set<string>();
  let current = parentId;

  while (current) {
    if (visited.has(current)) {
      throw new HttpError(400, 'Circular reference detected in department hierarchy');
    }
    if (selfId && current === selfId) {
      throw new HttpError(400, 'Circular reference detected: this department is a descendant');
    }
    visited.add(current);

    const dept = await prisma.department.findUnique({
      where: { id: current },
      select: { parent_id: true },
    });
    if (!dept) break;
    current = dept.parent_id ?? '';
  }
}
