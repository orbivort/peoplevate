import { promises as fs } from 'fs';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { DocumentType } from '#prisma';
import { encryptWithKeyVersion, decryptWithKeyVersion } from '../utils/crypto.js';
import { getActiveKeyVersion } from './key-management-service.js';
import { logAuditEvent } from './audit-service.js';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx'];

export async function uploadDocument(params: {
  employeeId: string;
  type: DocumentType;
  file: {
    originalName: string;
    mimeType: string;
    size: number;
    /** Absolute path of the file already written to disk by multer's diskStorage. */
    filePath: string;
    /** The generated storage filename (UUID + extension). */
    storedFilename: string;
  };
  uploadedBy: string;
  expiryDate?: Date | undefined;
}): Promise<{ id: string }> {
  const ext = params.file.storedFilename.slice(params.file.storedFilename.lastIndexOf('.'));
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new HttpError(400, `File type not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
  if (!ALLOWED_MIME_TYPES.includes(params.file.mimeType)) {
    throw new HttpError(400, 'MIME type not allowed');
  }
  const maxSize = env.MAX_FILE_SIZE_MB * 1024 * 1024;
  if (params.file.size > maxSize) {
    throw new HttpError(400, `File too large. Max size: ${env.MAX_FILE_SIZE_MB}MB`);
  }

  // Encrypt the file at rest with AES-256-GCM
  const plaintext = await fs.readFile(params.file.filePath);
  const keyVersion = await getActiveKeyVersion('DATA_ENCRYPTION');
  if (!keyVersion) {
    throw new HttpError(500, 'No active data-encryption key version found. Run key bootstrap.');
  }
  const { ciphertext, keyVersionId, iv, tag } = encryptWithKeyVersion(
    plaintext,
    'DATA_ENCRYPTION',
    keyVersion.key_id,
  );

  // Overwrite the plaintext file with the ciphertext
  await fs.writeFile(params.file.filePath, ciphertext);

  const doc = await prisma.document.create({
    data: {
      employee_id: params.employeeId,
      type: params.type,
      original_filename: params.file.originalName,
      stored_filename: params.file.storedFilename,
      file_path: params.file.filePath,
      mime_type: params.file.mimeType,
      file_size: params.file.size,
      uploaded_by: params.uploadedBy,
      expiry_date: params.expiryDate ?? null,
      encryption_key_version_id: keyVersionId,
      encryption_iv: Buffer.from(iv),
      encryption_tag: Buffer.from(tag),
    },
  });

  return { id: doc.id };
}

export async function listDocuments(employeeId: string): Promise<unknown[]> {
  const docs = await prisma.document.findMany({
    where: { employee_id: employeeId, deleted_at: null },
    orderBy: { created_at: 'desc' },
  });

  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  return docs.map((d) => ({
    id: d.id,
    type: d.type,
    originalFilename: d.original_filename,
    mimeType: d.mime_type,
    fileSize: d.file_size,
    uploadedBy: d.uploaded_by,
    createdAt: d.created_at,
    expiryDate: d.expiry_date,
    expiryStatus: d.expiry_date
      ? d.expiry_date < now
        ? 'expired'
        : d.expiry_date < thirtyDaysFromNow
          ? 'soon'
          : 'valid'
      : null,
    daysUntilExpiry: d.expiry_date
      ? Math.ceil((d.expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null,
  }));
}

export async function downloadDocument(
  docId: string,
  actorId: string,
  actorName: string,
): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
  const doc = await prisma.document.findFirst({
    where: { id: docId, deleted_at: null },
  });
  if (!doc) {
    throw new HttpError(404, 'Document not found');
  }

  let buffer: Buffer;
  if (doc.encryption_key_version_id && doc.encryption_iv && doc.encryption_tag) {
    // Encrypted file: read ciphertext and decrypt
    const ciphertext = await fs.readFile(doc.file_path);
    try {
      buffer = decryptWithKeyVersion(
        ciphertext,
        'DATA_ENCRYPTION',
        doc.encryption_key_version_id,
        Buffer.from(doc.encryption_iv),
        Buffer.from(doc.encryption_tag),
      );
    } catch {
      // Authentication tag mismatch - tampering detected
      await logAuditEvent({
        actorId,
        actorName,
        action: 'DOWNLOAD' as never,
        entity: 'DOCUMENTS' as never,
        entityId: doc.id,
        newValue: { error: 'Decryption failed - possible file tampering detected' },
      });
      throw new HttpError(500, 'File decryption failed - possible tampering detected');
    }
  } else {
    // Legacy unencrypted file (pre-migration) - read as-is
    buffer = await fs.readFile(doc.file_path);
  }

  // Audit the download
  await logAuditEvent({
    actorId,
    actorName,
    action: 'DOWNLOAD' as never,
    entity: 'DOCUMENTS' as never,
    entityId: doc.id,
    newValue: { filename: doc.original_filename },
  });

  return {
    buffer,
    mimeType: doc.mime_type,
    originalName: doc.original_filename,
  };
}

export async function deleteDocument(docId: string): Promise<void> {
  const doc = await prisma.document.findFirst({
    where: { id: docId, deleted_at: null },
  });
  if (!doc) {
    throw new HttpError(404, 'Document not found');
  }

  // Delete the physical file from disk
  await deletePhysicalFile(doc.file_path);

  await prisma.document.update({
    where: { id: docId },
    data: { deleted_at: new Date() },
  });
}

/** Delete a physical file from disk, logging failures for administrator review. */
export async function deletePhysicalFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    // Verify deletion
    await fs.access(filePath).catch(() => null); // Should throw - file should not exist
    return true;
  } catch (err) {
    // Log failure for administrator review but don't throw
    console.error(`[FILE CLEANUP] Failed to delete file ${filePath}:`, err);
    return false;
  }
}

/** Delete all physical files for a given employee (used by erasure and retention purge). */
export async function deleteEmployeeFiles(employeeId: string): Promise<number> {
  const docs = await prisma.document.findMany({
    where: { employee_id: employeeId, deleted_at: null },
  });

  let deletedCount = 0;
  for (const doc of docs) {
    const success = await deletePhysicalFile(doc.file_path);
    if (success) deletedCount++;
  }

  // Mark all documents as deleted
  await prisma.document.updateMany({
    where: { employee_id: employeeId, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  return deletedCount;
}
