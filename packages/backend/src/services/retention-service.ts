import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { logAuditEvent } from './audit-service.js';
import { deletePhysicalFile } from './document-service.js';
import { RetentionAction, type RetentionDataCategory } from '#prisma';

const BATCH_SIZE = 100;

interface PurgeCandidate {
  id: string;
  entityType: string;
  entityId: string;
  categoryName: string;
  daysOverdue: number;
}

/** List all retention policies. */
export async function listPolicies() {
  return prisma.retentionPolicy.findMany({
    orderBy: { data_category: 'asc' },
  });
}

/** Create or update a retention policy. */
export async function upsertPolicy(params: {
  dataCategory: RetentionDataCategory;
  retentionYears: number;
  action: RetentionAction;
  description?: string;
  isDefault?: boolean;
}) {
  return prisma.retentionPolicy.upsert({
    where: { data_category: params.dataCategory },
    create: {
      data_category: params.dataCategory,
      retention_years: params.retentionYears,
      action: params.action,
      description: params.description ?? null,
      is_default: params.isDefault ?? false,
    },
    update: {
      retention_years: params.retentionYears,
      action: params.action,
      description: params.description ?? null,
      is_default: params.isDefault ?? false,
    },
  });
}

/** Place a legal hold on a record. */
export async function placeLegalHold(params: {
  entityType: string;
  entityId: string;
  reason: string;
  actorId: string;
  actorName: string;
}) {
  if (!params.reason?.trim()) {
    throw new HttpError(400, 'Legal hold requires a reason');
  }
  const hold = await prisma.legalHold.create({
    data: {
      entity_type: params.entityType,
      entity_id: params.entityId,
      reason: params.reason,
      created_by_id: params.actorId,
    },
  });
  await logAuditEvent({
    actorId: params.actorId,
    actorName: params.actorName,
    action: 'CREATE' as never,
    entity: 'RETENTION' as never,
    entityId: params.entityId,
    newValue: { legalHoldId: hold.id, reason: params.reason },
  });
  return hold;
}

/** Release a legal hold. */
export async function releaseLegalHold(holdId: string, actorId: string, actorName: string) {
  const hold = await prisma.legalHold.update({
    where: { id: holdId },
    data: { released_at: new Date() },
  });
  await logAuditEvent({
    actorId,
    actorName,
    action: 'UPDATE' as never,
    entity: 'RETENTION' as never,
    entityId: hold.entity_id,
    newValue: { legalHoldReleased: true },
  });
  return hold;
}

/** Check if a record is under legal hold. */
async function isUnderLegalHold(entityType: string, entityId: string): Promise<boolean> {
  const hold = await prisma.legalHold.findFirst({
    where: { entity_type: entityType, entity_id: entityId, released_at: null },
  });
  return !!hold;
}

/** Dry-run: return records that would be purged without modifying anything. */
export async function dryRunPurge(): Promise<PurgeCandidate[]> {
  const policies = await listPolicies();
  const candidates: PurgeCandidate[] = [];
  const now = new Date();

  for (const policy of policies) {
    const overdue = await findOverdueRecords(policy, now);
    for (const record of overdue) {
      const held = await isUnderLegalHold(record.entityType, record.entityId);
      if (!held) {
        candidates.push({
          id: record.entityId,
          entityType: record.entityType,
          entityId: record.entityId,
          categoryName: policy.data_category,
          daysOverdue: Math.floor(
            (now.getTime() - record.cutoffDate.getTime()) / (1000 * 60 * 60 * 24),
          ),
        });
      }
    }
  }

  return candidates;
}

/** Execute the purge: hard-delete or anonymize overdue records. */
export async function executePurge(
  actorId: string | null,
  actorName: string | null,
): Promise<{
  purged: number;
  anonymized: number;
  skipped: number;
  errors: string[];
}> {
  const policies = await listPolicies();
  const now = new Date();
  let purged = 0;
  let anonymized = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const policy of policies) {
    const overdue = await findOverdueRecords(policy, now);

    for (let i = 0; i < overdue.length; i += BATCH_SIZE) {
      const batch = overdue.slice(i, i + BATCH_SIZE);

      for (const record of batch) {
        try {
          const held = await isUnderLegalHold(record.entityType, record.entityId);
          if (held) {
            skipped++;
            continue;
          }

          if (policy.action === RetentionAction.HARD_DELETE) {
            await hardDeleteRecord(record, actorId, actorName);
            purged++;
          } else {
            await anonymizeRecord(record, actorId, actorName);
            anonymized++;
          }
        } catch (err) {
          errors.push(
            `Failed to purge ${record.entityType}:${record.entityId}: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  return { purged, anonymized, skipped, errors };
}

/** Purge/anonymize IP addresses older than IP_RETENTION_DAYS (data minimization). */
export async function purgeOldIpAddresses(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - env.IP_RETENTION_DAYS);

  const result = await prisma.attendanceRecord.updateMany({
    where: {
      ip_address: { not: null },
      timestamp: { lt: cutoff },
    },
    data: { ip_address: null },
  });

  if (result.count > 0) {
    await logAuditEvent({
      actorId: null,
      actorName: 'system-cron',
      action: 'PURGE' as never,
      entity: 'RETENTION' as never,
      entityId: 'ip-addresses',
      newValue: { purgedIpAddresses: result.count, retentionDays: env.IP_RETENTION_DAYS },
    });
  }

  return result.count;
}

/** Find records that are overdue based on the retention policy. */
async function findOverdueRecords(
  policy: { data_category: RetentionDataCategory; retention_years: number },
  now: Date,
): Promise<{ entityType: string; entityId: string; cutoffDate: Date }[]> {
  const cutoffDate = new Date(now);
  cutoffDate.setFullYear(cutoffDate.getFullYear() - policy.retention_years);

  const results: { entityType: string; entityId: string; cutoffDate: Date }[] = [];

  switch (policy.data_category) {
    case 'TERMINATED_EMPLOYEE_RECORDS': {
      const employees = await prisma.employee.findMany({
        where: {
          deleted_at: { not: null, lte: cutoffDate },
        },
        select: { id: true, deleted_at: true },
      });
      for (const emp of employees) {
        if (emp.deleted_at) {
          results.push({ entityType: 'employees', entityId: emp.id, cutoffDate: emp.deleted_at });
        }
      }
      break;
    }
    case 'CANDIDATE_RESUMES': {
      const candidates = await prisma.candidate.findMany({
        where: { created_at: { lte: cutoffDate } },
        select: { id: true, created_at: true },
      });
      for (const c of candidates) {
        results.push({ entityType: 'candidates', entityId: c.id, cutoffDate: c.created_at });
      }
      break;
    }
    // Other categories can be added incrementally
    default:
      break;
  }

  return results;
}

async function hardDeleteRecord(
  record: { entityType: string; entityId: string },
  actorId: string | null,
  actorName: string | null,
): Promise<void> {
  if (record.entityType === 'employees') {
    // Delete physical files first
    const docs = await prisma.document.findMany({
      where: { employee_id: record.entityId },
    });
    for (const doc of docs) {
      await deletePhysicalFile(doc.file_path);
    }
    await prisma.document.deleteMany({ where: { employee_id: record.entityId } });
    await prisma.employee.delete({ where: { id: record.entityId } });
  } else if (record.entityType === 'candidates') {
    await prisma.candidate.delete({ where: { id: record.entityId } });
  }

  await logAuditEvent({
    actorId,
    actorName,
    action: 'PURGE' as never,
    entity: 'RETENTION' as never,
    entityId: record.entityId,
    newValue: { entityType: record.entityType, action: 'HARD_DELETE' },
  });
}

async function anonymizeRecord(
  record: { entityType: string; entityId: string },
  actorId: string | null,
  actorName: string | null,
): Promise<void> {
  if (record.entityType === 'employees') {
    await prisma.employee.update({
      where: { id: record.entityId },
      data: {
        first_name: '[ANONYMIZED]',
        last_name: '[ANONYMIZED]',
        email: `[anonymized-${record.entityId}@removed.local]`,
        phone: null,
        national_id_encrypted: null,
        address: null,
      },
    });
    // Delete physical files
    const docs = await prisma.document.findMany({
      where: { employee_id: record.entityId },
    });
    for (const doc of docs) {
      await deletePhysicalFile(doc.file_path);
    }
    await prisma.document.updateMany({
      where: { employee_id: record.entityId },
      data: { deleted_at: new Date() },
    });
  } else if (record.entityType === 'candidates') {
    await prisma.candidate.update({
      where: { id: record.entityId },
      data: {
        first_name: '[ANONYMIZED]',
        last_name: '[ANONYMIZED]',
        email: `[anonymized-${record.entityId}@removed.local]`,
        phone: null,
      },
    });
  }

  await logAuditEvent({
    actorId,
    actorName,
    action: 'PURGE' as never,
    entity: 'RETENTION' as never,
    entityId: record.entityId,
    newValue: { entityType: record.entityType, action: 'ANONYMIZE' },
  });
}
