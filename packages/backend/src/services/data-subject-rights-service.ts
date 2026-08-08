import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { decrypt } from '../utils/crypto.js';
import { logAuditEvent } from './audit-service.js';
import { deleteEmployeeFiles } from './document-service.js';

/**
 * Data Subject Rights Service
 *
 * Implements GDPR Art. 15 (access), Art. 17 (erasure), and Art. 20 (portability).
 */

/** Aggregate all personal data for a data subject across all modules (Art. 15). */
export async function getSubjectData(subjectUserId?: string, subjectEmail?: string) {
  if (!subjectUserId && !subjectEmail) {
    throw new HttpError(400, 'Either subjectUserId or subjectEmail is required');
  }

  const user = subjectUserId
    ? await prisma.user.findUnique({
        where: { id: subjectUserId },
        include: { employee: true },
      })
    : await prisma.user.findFirst({
        where: { email: subjectEmail ?? '' },
        include: { employee: true },
      });

  if (!user) {
    throw new HttpError(404, 'Data subject not found');
  }

  const employeeId = user.employee?.id;

  const [
    documents,
    attendance,
    leaveRequests,
    performanceReviews,
    candidate,
    offboarding,
    consents,
  ] = await Promise.all([
    employeeId
      ? prisma.document.findMany({ where: { employee_id: employeeId, deleted_at: null } })
      : Promise.resolve([]),
    employeeId
      ? prisma.attendanceRecord.findMany({ where: { employee_id: employeeId } })
      : Promise.resolve([]),
    employeeId
      ? prisma.leaveRequest.findMany({ where: { employee_id: employeeId } })
      : Promise.resolve([]),
    employeeId
      ? prisma.performanceReview.findMany({ where: { employee_id: employeeId } })
      : Promise.resolve([]),
    prisma.candidate.findFirst({ where: { email: user.email } }),
    employeeId
      ? prisma.offboardingRecord.findFirst({ where: { employee_id: employeeId } })
      : Promise.resolve(null),
    prisma.consentRecord.findMany({
      where: { data_subject_user_id: user.id },
      orderBy: { recorded_at: 'desc' },
    }),
  ]);

  // Decrypt sensitive fields for the access response
  let nationalId: string | null = null;
  let salary: string | null = null;
  if (user.employee?.national_id_encrypted) {
    try {
      nationalId = decrypt(user.employee.national_id_encrypted);
    } catch {
      nationalId = '[DECRYPTION_FAILED]';
    }
  }
  if (user.employee?.salary_encrypted) {
    try {
      salary = decrypt(user.employee.salary_encrypted);
    } catch {
      salary = '[DECRYPTION_FAILED]';
    }
  }

  const result = {
    dataCategories: [
      'user-account',
      'employee-profile',
      'attendance',
      'leave',
      'performance',
      'documents',
      'recruitment',
      'offboarding',
      'consent',
    ],
    processingPurposes: [
      'HR administration',
      'Payroll',
      'Attendance tracking',
      'Leave management',
      'Performance evaluation',
      'Regulatory compliance',
    ],
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.created_at,
    },
    employee: user.employee
      ? {
          id: user.employee.id,
          employeeNo: user.employee.employee_no,
          firstName: user.employee.first_name,
          lastName: user.employee.last_name,
          email: user.employee.email,
          phone: user.employee.phone,
          nationalId,
          salary,
          hireDate: user.employee.hire_date,
          ...(user.employee.deactivation_date
            ? { deactivationDate: user.employee.deactivation_date }
            : {}),
        }
      : null,
    documents: documents.map((d) => ({
      id: d.id,
      type: d.type,
      originalFilename: d.original_filename,
      mimeType: d.mime_type,
      fileSize: d.file_size,
      uploadedBy: d.uploaded_by,
      createdAt: d.created_at,
      expiryDate: d.expiry_date,
    })),
    attendance: attendance.map((a) => ({
      id: a.id,
      type: a.type,
      timestamp: a.timestamp,
      ipAddress: a.ip_address,
    })),
    leaveRequests: leaveRequests.map((l) => ({
      id: l.id,
      leaveTypeId: l.leave_type_id,
      startDate: l.start_date,
      endDate: l.end_date,
      status: l.status,
      reason: l.reason,
    })),
    performanceReviews: performanceReviews.map((p) => ({
      id: p.id,
      cycleId: p.cycle_id,
      status: p.status,
      overallRating: p.overall_rating,
      selfEvalSubmittedAt: p.self_eval_submitted_at,
      managerEvalSubmittedAt: p.manager_eval_submitted_at,
    })),
    candidate: candidate
      ? {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          stage: candidate.stage,
          appliedAt: candidate.applied_at,
        }
      : null,
    offboarding: offboarding
      ? {
          id: offboarding.id,
          status: offboarding.status,
          initiatedAt: offboarding.initiated_at,
          lastWorkingDay: offboarding.last_working_day,
        }
      : null,
    consents: consents.map((c) => ({
      id: c.id,
      purpose: c.processing_purpose,
      status: c.status,
      mechanism: c.mechanism,
      noticeVersion: c.notice_version,
      recordedAt: c.recorded_at,
    })),
  };

  return result;
}

/** Erase all personal data for a data subject (Art. 17). */
export async function eraseSubjectData(
  subjectUserId: string,
  actorId: string,
  actorName: string,
): Promise<{ erased: boolean; retainedRecords: string[]; filesDeleted: number }> {
  const user = await prisma.user.findUnique({
    where: { id: subjectUserId },
    include: { employee: true },
  });

  if (!user) {
    throw new HttpError(404, 'Data subject not found');
  }

  const employeeId = user.employee?.id;
  const retainedRecords: string[] = [];

  // Check legal holds
  const holds = await prisma.legalHold.findMany({
    where: {
      released_at: null,
      OR: [
        { entity_type: 'users', entity_id: subjectUserId },
        ...(employeeId ? [{ entity_type: 'employees', entity_id: employeeId }] : []),
      ],
    },
  });

  if (holds.length > 0) {
    retainedRecords.push(...holds.map((h) => `${h.entity_type}:${h.entity_id} - ${h.reason}`));
  }

  // Delete physical files and document records
  let filesDeleted = 0;
  if (employeeId && holds.length === 0) {
    filesDeleted = await deleteEmployeeFiles(employeeId);
  }

  // Anonymize personal data across all linked models
  if (employeeId && holds.length === 0) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        first_name: '[ERASED]',
        last_name: '[ERASED]',
        email: `[erased-${employeeId}@removed.local]`,
        phone: null,
        national_id_encrypted: null,
        salary_encrypted: null,
        address: null,
      },
    });
  }

  // Anonymize user account
  if (holds.length === 0) {
    await prisma.user.update({
      where: { id: subjectUserId },
      data: {
        email: `[erased-${subjectUserId}@removed.local]`,
        name: '[ERASED]',
        status: 'DEACTIVATED',
        password_hash: '[ERASED]',
      },
    });
  }

  // Anonymize candidate records
  await prisma.candidate.updateMany({
    where: { email: user.email },
    data: {
      first_name: '[ERASED]',
      last_name: '[ERASED]',
      email: `[erased-${subjectUserId}@removed.local]`,
      phone: null,
    },
  });

  // Anonymize consent records (keep the audit trail but remove identifying info)
  await prisma.consentRecord.updateMany({
    where: { data_subject_user_id: subjectUserId },
    data: {
      data_subject_email: `[erased-${subjectUserId}@removed.local]`,
    },
  });

  await logAuditEvent({
    actorId,
    actorName,
    action: 'PURGE' as never,
    entity: 'DATA_SUBJECT_RIGHTS' as never,
    entityId: subjectUserId,
    newValue: {
      action: 'ERASURE',
      retainedRecords,
      filesDeleted,
    },
  });

  return { erased: true, retainedRecords, filesDeleted };
}

/** Export all personal data in structured format (Art. 20). */
export async function exportSubjectData(
  subjectUserId: string,
  format: 'json' | 'csv',
  actorId: string,
  actorName: string,
): Promise<{ data: unknown; format: string }> {
  const subjectData = await getSubjectData(subjectUserId);

  await logAuditEvent({
    actorId,
    actorName,
    action: 'EXPORT' as never,
    entity: 'DATA_SUBJECT_RIGHTS' as never,
    entityId: subjectUserId,
    newValue: { format },
  });

  if (format === 'csv') {
    // Flatten to CSV-like structure (array of {module, field, value})
    const rows: Record<string, unknown>[] = [];
    const flatten = (obj: Record<string, unknown>, module: string) => {
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          flatten(value as Record<string, unknown>, module);
        } else if (Array.isArray(value)) {
          rows.push({ module, field: key, value: JSON.stringify(value) });
        } else {
          rows.push({ module, field: key, value: String(value) });
        }
      }
    };
    flatten(subjectData as Record<string, unknown>, 'all');
    return { data: rows, format: 'csv' };
  }

  return { data: subjectData, format: 'json' };
}

/** Get the active data subject for a user (self or admin-specified). */
export async function resolveSubjectUserId(
  targetUserId: string,
  requesterId: string,
  requesterRole: string,
): Promise<string> {
  // Admin/HR can access any subject; others can only access their own
  if (targetUserId !== requesterId && !['ADMIN', 'HR_MANAGER'].includes(requesterRole)) {
    throw new HttpError(403, 'You can only access your own data');
  }
  return targetUserId;
}
