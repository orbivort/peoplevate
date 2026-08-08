import path from 'node:path';
import fsp from 'node:fs/promises';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { encrypt, decrypt, maskValue } from '../utils/crypto.js';
import { HttpError } from '../utils/http-error.js';
import { EmploymentStatus, EmploymentType, Gender, AuditAction, AuditEntity } from '#prisma';
import { logAuditEvent } from './audit-service.js';

// ── Employee List ─────────────────────────────

export async function listEmployees(params: {
  role: string;
  userId: string;
  employeeId?: string | null | undefined;
  search?: string | undefined;
  status?: string | undefined;
  departmentId?: string | undefined;
}) {
  const where: Record<string, unknown> = { deleted_at: null };

  // Role-scoped visibility
  if (params.role === 'EMPLOYEE') {
    // Employee sees only self
    if (!params.employeeId) return [];
    where.id = params.employeeId;
  } else if (params.role === 'MANAGER') {
    // Manager sees direct reports + self
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    where.OR = [{ manager_id: self.id }, { id: self.id }];
  }
  // ADMIN and HR_MANAGER see all

  // Filters
  if (params.search) {
    where.OR = [
      ...((where.OR as unknown[] | undefined) ?? []),
      { first_name: { contains: params.search, mode: 'insensitive' } },
      { last_name: { contains: params.search, mode: 'insensitive' } },
      { email: { contains: params.search, mode: 'insensitive' } },
      { employee_no: { contains: params.search, mode: 'insensitive' } },
      { position: { name: { contains: params.search, mode: 'insensitive' } } },
    ];
  }
  if (params.status) {
    where.status = params.status;
  }
  if (params.departmentId) {
    where.department_id = params.departmentId;
  }

  const employees = await prisma.employee.findMany({
    where,
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      manager: { select: { id: true, first_name: true, last_name: true } },
    },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  });

  return employees.map((e) => formatEmployeeListItem(e, params.role));
}

// ── Employee Profile ──────────────────────────

export async function getEmployee(
  id: string,
  role: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const employee = await prisma.employee.findFirst({
    where: { id, deleted_at: null },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true, grade: true } },
      manager: { select: { id: true, first_name: true, last_name: true } },
      user: { select: { id: true, email: true, role: true } },
      _count: { select: { documents: { where: { deleted_at: null } } } },
    },
  });

  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }

  // RBAC: Employee can only view self; Manager can view self + direct reports
  if (role === 'EMPLOYEE') {
    const selfEmployee = await prisma.employee.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (selfEmployee?.id !== id) {
      throw new HttpError(403, 'You can only view your own profile');
    }
  } else if (role === 'MANAGER') {
    const selfEmployee = await prisma.employee.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (selfEmployee?.id !== id && employee.manager_id !== selfEmployee?.id) {
      throw new HttpError(403, 'You can only view your own profile and direct reports');
    }
  }

  return formatEmployeeProfile(employee, role);
}

// ── Create Employee ───────────────────────────

export async function createEmployee(params: {
  firstName: string;
  lastName: string;
  dateOfBirth?: Date | undefined;
  gender?: Gender | undefined;
  nationalId?: string | undefined;
  email: string;
  phone?: string | undefined;
  address?: string | undefined;
  emergencyContactName?: string | undefined;
  emergencyContactRelationship?: string | undefined;
  emergencyContactPhone?: string | undefined;
  departmentId: string;
  positionId: string;
  managerId?: string | undefined;
  hireDate: Date;
  employmentType: EmploymentType;
  salary?: number | undefined;
  status?: EmploymentStatus | undefined;
}): Promise<{ id: string; employeeNo: string }> {
  // Check duplicate national ID
  if (params.nationalId) {
    const encrypted = encrypt(params.nationalId);
    // We can't search by encrypted value directly, so we check all employees
    // In production, a hash column would be used for lookup
    const existing = await prisma.employee.findFirst({
      where: { national_id_encrypted: encrypted, deleted_at: null },
    });
    if (existing) {
      throw new HttpError(
        409,
        'An employee with this national ID already exists. Please contact HR.',
      );
    }
  }

  // Generate employee number
  const employeeNo = await generateEmployeeNo();

  const employee = await prisma.employee.create({
    data: {
      employee_no: employeeNo,
      first_name: params.firstName,
      last_name: params.lastName,
      date_of_birth: params.dateOfBirth ?? null,
      gender: params.gender ?? null,
      national_id_encrypted: params.nationalId ? encrypt(params.nationalId) : null,
      email: params.email.toLowerCase(),
      phone: params.phone ?? null,
      address: params.address ?? null,
      emergency_contact_name: params.emergencyContactName ?? null,
      emergency_contact_relationship: params.emergencyContactRelationship ?? null,
      emergency_contact_phone: params.emergencyContactPhone ?? null,
      department_id: params.departmentId,
      position_id: params.positionId,
      manager_id: params.managerId ?? null,
      hire_date: params.hireDate,
      employment_type: params.employmentType,
      salary_encrypted: params.salary != null ? encrypt(String(params.salary)) : null,
      status: params.status ?? EmploymentStatus.NEW_HIRE,
    },
  });

  return { id: employee.id, employeeNo: employee.employee_no };
}

// ── Update Employee ───────────────────────────

export async function updateEmployee(
  id: string,
  params: {
    firstName?: string | undefined;
    lastName?: string | undefined;
    dateOfBirth?: Date | undefined;
    gender?: Gender | undefined;
    nationalId?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
    address?: string | undefined;
    emergencyContactName?: string | undefined;
    emergencyContactRelationship?: string | undefined;
    emergencyContactPhone?: string | undefined;
    departmentId?: string | undefined;
    positionId?: string | undefined;
    managerId?: string | undefined;
    hireDate?: Date | undefined;
    employmentType?: EmploymentType | undefined;
    salary?: number | undefined;
    status?: EmploymentStatus | undefined;
  },
  role: string,
): Promise<void> {
  const data: Record<string, unknown> = {};

  if (params.firstName !== undefined) data.first_name = params.firstName;
  if (params.lastName !== undefined) data.last_name = params.lastName;
  if (params.dateOfBirth !== undefined) data.date_of_birth = params.dateOfBirth;
  if (params.gender !== undefined) data.gender = params.gender;
  if (params.email !== undefined) data.email = params.email.toLowerCase();
  if (params.phone !== undefined) data.phone = params.phone;
  if (params.address !== undefined) data.address = params.address;
  if (params.departmentId !== undefined) data.department_id = params.departmentId;
  if (params.positionId !== undefined) data.position_id = params.positionId;
  if (params.managerId !== undefined) data.manager_id = params.managerId;
  if (params.hireDate !== undefined) data.hire_date = params.hireDate;
  if (params.employmentType !== undefined) data.employment_type = params.employmentType;
  if (params.status !== undefined) data.status = params.status;

  // Sensitive fields — only HR/Admin can update
  if (role === 'ADMIN' || role === 'HR_MANAGER') {
    if (params.nationalId !== undefined)
      data.national_id_encrypted = params.nationalId ? encrypt(params.nationalId) : null;
    if (params.salary !== undefined)
      data.salary_encrypted = params.salary != null ? encrypt(String(params.salary)) : null;
    if (params.emergencyContactName !== undefined)
      data.emergency_contact_name = params.emergencyContactName;
    if (params.emergencyContactRelationship !== undefined)
      data.emergency_contact_relationship = params.emergencyContactRelationship;
    if (params.emergencyContactPhone !== undefined)
      data.emergency_contact_phone = params.emergencyContactPhone;
  }

  await prisma.employee.update({
    where: { id },
    data,
  });
}

// ── Self-Service Update (Employee edits own profile) ──

// Simple phone format validation: allows +, spaces, dashes, parentheses, digits;
// must contain at least 7 digits.
function isValidPhone(value: string): boolean {
  const digitCount = value.replace(/\D/g, '').length;
  return digitCount >= 7 && digitCount <= 15 && /^[+\d\s()-]+$/.test(value);
}

export async function selfUpdateEmployee(params: {
  employeeId: string;
  userId: string;
  userEmail: string;
  fields: {
    phone?: string | undefined;
    address?: string | undefined;
    emergencyContactName?: string | undefined;
    emergencyContactRelationship?: string | undefined;
    emergencyContactPhone?: string | undefined;
  };
}): Promise<void> {
  // Verify the employee belongs to the requesting user
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
    select: {
      id: true,
      phone: true,
      address: true,
      emergency_contact_name: true,
      emergency_contact_relationship: true,
      emergency_contact_phone: true,
      user_id: true,
    },
  });

  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }

  if (employee.user_id !== params.userId) {
    throw new HttpError(403, 'You can only edit your own profile.');
  }

  // Build update data with validation
  const data: Record<string, unknown> = {};
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (params.fields.phone !== undefined) {
    if (employee.phone && params.fields.phone.trim() === '') {
      throw new HttpError(400, 'Phone cannot be emptied. It was previously set.');
    }
    if (params.fields.phone.trim() !== '' && !isValidPhone(params.fields.phone)) {
      throw new HttpError(400, 'Phone number format is invalid.');
    }
    data.phone = params.fields.phone.trim() || null;
    oldValues.phone = employee.phone;
    newValues.phone = data.phone;
  }

  if (params.fields.address !== undefined) {
    if (employee.address && params.fields.address.trim() === '') {
      throw new HttpError(400, 'Address cannot be emptied. It was previously set.');
    }
    data.address = params.fields.address.trim() || null;
    oldValues.address = employee.address;
    newValues.address = data.address;
  }

  if (params.fields.emergencyContactName !== undefined) {
    if (employee.emergency_contact_name && params.fields.emergencyContactName.trim() === '') {
      throw new HttpError(400, 'Emergency contact name cannot be emptied. It was previously set.');
    }
    data.emergency_contact_name = params.fields.emergencyContactName.trim() || null;
    oldValues.emergencyContactName = employee.emergency_contact_name;
    newValues.emergencyContactName = data.emergency_contact_name;
  }

  if (params.fields.emergencyContactRelationship !== undefined) {
    if (
      employee.emergency_contact_relationship &&
      params.fields.emergencyContactRelationship.trim() === ''
    ) {
      throw new HttpError(
        400,
        'Emergency contact relationship cannot be emptied. It was previously set.',
      );
    }
    data.emergency_contact_relationship = params.fields.emergencyContactRelationship.trim() || null;
    oldValues.emergencyContactRelationship = employee.emergency_contact_relationship;
    newValues.emergencyContactRelationship = data.emergency_contact_relationship;
  }

  if (params.fields.emergencyContactPhone !== undefined) {
    if (employee.emergency_contact_phone && params.fields.emergencyContactPhone.trim() === '') {
      throw new HttpError(400, 'Emergency contact phone cannot be emptied. It was previously set.');
    }
    if (
      params.fields.emergencyContactPhone.trim() !== '' &&
      !isValidPhone(params.fields.emergencyContactPhone)
    ) {
      throw new HttpError(400, 'Emergency contact phone format is invalid.');
    }
    data.emergency_contact_phone = params.fields.emergencyContactPhone.trim() || null;
    oldValues.emergencyContactPhone = employee.emergency_contact_phone;
    newValues.emergencyContactPhone = data.emergency_contact_phone;
  }

  if (Object.keys(data).length === 0) {
    return; // No fields to update
  }

  await prisma.employee.update({
    where: { id: params.employeeId },
    data,
  });

  // Create explicit audit log entry with old/new values for each changed field.
  // (PostgreSQL triggers also capture the row-level update automatically via
  // withAuditContext, but this provides field-level change detail.)
  await logAuditEvent({
    actorId: params.userId,
    actorName: params.userEmail,
    action: AuditAction.UPDATE,
    entity: AuditEntity.EMPLOYEES,
    entityId: params.employeeId,
    oldValue: oldValues,
    newValue: newValues,
  });
}

// ── Self-Service Avatar ───────────────────────

export async function setAvatar(params: {
  employeeId: string;
  userId: string;
  userEmail: string;
  filePath: string;
  storedFilename: string;
}): Promise<string> {
  // Verify the employee belongs to the requesting user
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
    select: { id: true, user_id: true, avatar_url: true },
  });

  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }

  if (employee.user_id !== params.userId) {
    throw new HttpError(403, 'You can only update your own avatar.');
  }

  // Delete old avatar file if one exists
  if (employee.avatar_url) {
    const oldFilename = employee.avatar_url.split('/').pop();
    if (oldFilename) {
      const oldPath = path.join(env.UPLOAD_DIR, 'avatars', oldFilename);
      try {
        await fsp.unlink(oldPath);
      } catch {
        // File may already be gone; ignore
      }
    }
  }

  const avatarUrl = `/api/employees/${params.employeeId}/avatar`;
  await prisma.employee.update({
    where: { id: params.employeeId },
    data: { avatar_url: avatarUrl },
  });

  await logAuditEvent({
    actorId: params.userId,
    actorName: params.userEmail,
    action: AuditAction.UPDATE,
    entity: AuditEntity.EMPLOYEES,
    entityId: params.employeeId,
    oldValue: { avatarUrl: employee.avatar_url },
    newValue: { avatarUrl },
  });

  return avatarUrl;
}

export async function removeAvatar(params: {
  employeeId: string;
  userId: string;
  userEmail: string;
}): Promise<void> {
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
    select: { id: true, user_id: true, avatar_url: true },
  });

  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }

  if (employee.user_id !== params.userId) {
    throw new HttpError(403, 'You can only remove your own avatar.');
  }

  if (!employee.avatar_url) {
    return; // No avatar to remove
  }

  // Delete the file
  const filename = employee.avatar_url.split('/').pop();
  if (filename) {
    const filePath = path.join(env.UPLOAD_DIR, 'avatars', filename);
    try {
      await fsp.unlink(filePath);
    } catch {
      // File may already be gone; ignore
    }
  }

  await prisma.employee.update({
    where: { id: params.employeeId },
    data: { avatar_url: null },
  });

  await logAuditEvent({
    actorId: params.userId,
    actorName: params.userEmail,
    action: AuditAction.UPDATE,
    entity: AuditEntity.EMPLOYEES,
    entityId: params.employeeId,
    oldValue: { avatarUrl: employee.avatar_url },
    newValue: { avatarUrl: null },
  });
}

export async function getAvatarPath(params: {
  employeeId: string;
  userId: string;
  role: string;
}): Promise<{ filePath: string; mimeType: string } | null> {
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
    select: { id: true, user_id: true, avatar_url: true },
  });

  if (!employee || !employee.avatar_url) {
    return null;
  }

  // Self-authorization: employees can only view their own avatar
  // (Admins and HR can view anyone's)
  if (params.role === 'EMPLOYEE' && employee.user_id !== params.userId) {
    throw new HttpError(403, 'Access denied');
  }
  if (params.role === 'MANAGER') {
    const selfEmployee = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (selfEmployee?.id !== params.employeeId) {
      // Check if it's a direct report
      const target = await prisma.employee.findFirst({
        where: { id: params.employeeId },
        select: { manager_id: true },
      });
      if (target?.manager_id !== selfEmployee?.id) {
        throw new HttpError(403, 'Access denied');
      }
    }
  }

  const filename = employee.avatar_url.split('/').pop();
  if (!filename) return null;

  const filePath = path.join(env.UPLOAD_DIR, 'avatars', filename);
  const ext = path.extname(filename).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  return { filePath, mimeType };
}

// ── Status Transition ─────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  NEW_HIRE: ['PROBATION', 'ACTIVE'],
  PROBATION: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['ON_LEAVE', 'TERMINATED'],
  ON_LEAVE: ['ACTIVE', 'TERMINATED'],
  TERMINATED: [],
};

export async function transitionStatus(params: {
  employeeId: string;
  newStatus: EmploymentStatus;
  effectiveDate: Date;
  reason?: string | undefined;
  recordedBy: string;
}): Promise<void> {
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
  });

  if (!employee) {
    throw new HttpError(404, 'Employee not found');
  }

  const validTargets = VALID_TRANSITIONS[employee.status];
  if (!validTargets?.includes(params.newStatus)) {
    throw new HttpError(
      400,
      `Invalid status transition from ${employee.status} to ${params.newStatus}`,
    );
  }

  // Placeholder: check pending leave requests for On Leave transition
  // Placeholder: check offboarding completion for Terminated transition

  const updateData: Record<string, unknown> = { status: params.newStatus };
  if (params.newStatus === EmploymentStatus.TERMINATED) {
    updateData.deactivation_date = params.effectiveDate;
  }

  await prisma.employee.update({
    where: { id: params.employeeId },
    data: updateData,
  });

  // Record the status change
  await prisma.employmentChange.create({
    data: {
      employee_id: params.employeeId,
      change_type: 'STATUS_CHANGE',
      old_value: { status: employee.status },
      new_value: { status: params.newStatus },
      effective_date: params.effectiveDate,
      status: 'APPLIED',
      reason: params.reason ?? null,
      recorded_by: params.recordedBy,
    },
  });
}

// ── Helpers ──────────────────────────────────

async function generateEmployeeNo(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.employee.count({
    where: {
      employee_no: { startsWith: `EMP-${year}-` },
    },
  });
  return `EMP-${year}-${String(count + 1).padStart(4, '0')}`;
}

function formatEmployeeListItem(e: Record<string, unknown>, role: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: e.id,
    employeeNo: e.employee_no,
    firstName: e.first_name,
    lastName: e.last_name,
    dateOfBirth: e.date_of_birth,
    gender: e.gender,
    email: e.email,
    phone: e.phone,
    address: e.address,
    department: e.department,
    position: e.position,
    manager: e.manager,
    hireDate: e.hire_date,
    employmentType: e.employment_type,
    status: e.status,
    avatarUrl: e.avatar_url,
  };

  // Sensitive fields for authorized roles only
  if (role === 'ADMIN' || role === 'HR_MANAGER') {
    base.salary = e.salary_encrypted ? decrypt(e.salary_encrypted as string) : null;
    base.nationalId = e.national_id_encrypted ? decrypt(e.national_id_encrypted as string) : null;
    base.emergencyContactName = e.emergency_contact_name;
    base.emergencyContactRelationship = e.emergency_contact_relationship;
    base.emergencyContactPhone = e.emergency_contact_phone;
  } else {
    base.salary = 'Restricted';
    base.nationalId = e.national_id_encrypted
      ? maskValue(decrypt(e.national_id_encrypted as string))
      : null;
  }

  return base;
}

function formatEmployeeProfile(e: Record<string, unknown>, role: string): Record<string, unknown> {
  const isAuthorized = role === 'ADMIN' || role === 'HR_MANAGER';

  const profile: Record<string, unknown> = {
    id: e.id,
    employeeNo: e.employee_no,
    firstName: e.first_name,
    lastName: e.last_name,
    dateOfBirth: e.date_of_birth,
    gender: e.gender,
    email: e.email,
    phone: e.phone,
    address: e.address,
    department: e.department,
    position: e.position,
    manager: e.manager,
    hireDate: e.hire_date,
    employmentType: e.employment_type,
    status: e.status,
    deactivationDate: e.deactivation_date,
    avatarUrl: e.avatar_url,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    documentCount: (e as Record<string, unknown>)._count
      ? ((e as Record<string, Record<string, number>>)._count?.documents ?? 0)
      : 0,
    user: e.user,
  };

  // Sensitive fields
  if (isAuthorized) {
    profile.nationalId = e.national_id_encrypted
      ? decrypt(e.national_id_encrypted as string)
      : null;
    profile.salary = e.salary_encrypted ? decrypt(e.salary_encrypted as string) : null;
    profile.emergencyContactName = e.emergency_contact_name;
    profile.emergencyContactRelationship = e.emergency_contact_relationship;
    profile.emergencyContactPhone = e.emergency_contact_phone;
  } else {
    profile.nationalId = e.national_id_encrypted
      ? maskValue(decrypt(e.national_id_encrypted as string))
      : null;
    profile.salary = 'Restricted';
    profile.emergencyContactName = 'Restricted';
    profile.emergencyContactRelationship = 'Restricted';
    profile.emergencyContactPhone = 'Restricted';
  }

  return profile;
}
