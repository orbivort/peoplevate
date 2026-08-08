import { prisma } from '../config/prisma.js';
import { KeyPurpose, KeyStatus } from '#prisma';
import { logAuditEvent } from './audit-service.js';

/**
 * Key Management Service
 *
 * Manages versioned, per-purpose encryption keys. Key material is sourced
 * from environment variables; this service tracks which key version is
 * active for each purpose in the EncryptionKeyVersion table.
 */

/** Ensure default key version rows exist for each purpose on startup. */
export async function bootstrapKeyVersions(): Promise<void> {
  for (const purpose of [KeyPurpose.DATA_ENCRYPTION, KeyPurpose.TOKEN_SIGNING]) {
    const existing = await prisma.encryptionKeyVersion.findFirst({
      where: { purpose, status: KeyStatus.ACTIVE },
    });
    if (!existing) {
      await prisma.encryptionKeyVersion.create({
        data: {
          key_id: `${purpose.toLowerCase()}-v1`,
          purpose,
          status: KeyStatus.ACTIVE,
        },
      });
    }
  }
}

/** Get the active key version for a purpose. */
export async function getActiveKeyVersion(purpose: KeyPurpose) {
  return prisma.encryptionKeyVersion.findFirst({
    where: { purpose, status: KeyStatus.ACTIVE },
    orderBy: { activated_at: 'desc' },
  });
}

/** List all key versions, optionally filtered by purpose. */
export async function listKeyVersions(purpose?: KeyPurpose) {
  return prisma.encryptionKeyVersion.findMany({
    where: purpose ? { purpose } : {},
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Rotate the key for a purpose: create a new active version and retire
 * the previous one. The operator must update the corresponding env var
 * with the new secret, then run the re-encryption script.
 */
export async function rotateKey(purpose: KeyPurpose, actorId: string, actorName: string) {
  const current = await getActiveKeyVersion(purpose);
  const nextVersionNumber = current ? extractVersionNumber(current.key_id) + 1 : 1;
  const newKeyId = `${purpose.toLowerCase()}-v${nextVersionNumber}`;

  // Create new active version and retire the old one in a transaction
  const result = await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.encryptionKeyVersion.update({
        where: { id: current.id },
        data: { status: KeyStatus.RETIRED, retired_at: new Date() },
      });
    }
    const newVersion = await tx.encryptionKeyVersion.create({
      data: {
        key_id: newKeyId,
        purpose,
        status: KeyStatus.ACTIVE,
      },
    });
    return newVersion;
  });

  await logAuditEvent({
    actorId,
    actorName,
    action: 'CREATE' as never,
    entity: 'KEYS' as never,
    entityId: result.id,
    newValue: { keyId: result.key_id, purpose: result.purpose },
  });

  return result;
}

/** Get key rotation status including whether re-encryption is needed. */
export async function getKeyRotationStatus(purpose: KeyPurpose) {
  const versions = await listKeyVersions(purpose);
  const active = versions.find((v) => v.status === KeyStatus.ACTIVE);
  const retired = versions.filter((v) => v.status === KeyStatus.RETIRED);
  const reEncryptionNeeded = retired.length > 0;

  return {
    purpose,
    activeVersion: active,
    retiredVersions: retired,
    reEncryptionNeeded,
  };
}

function extractVersionNumber(keyId: string): number {
  const match = keyId.match(/-v(\d+)$/);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}
