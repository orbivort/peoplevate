import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentType } from '#prisma';

const hoisted = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  getActiveKeyVersion: vi.fn(),
  encryptWithKeyVersion: vi.fn(),
  decryptWithKeyVersion: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    readFile: hoisted.readFile,
    writeFile: hoisted.writeFile,
    unlink: hoisted.unlink,
    access: hoisted.access,
  },
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    document: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    MAX_FILE_SIZE_MB: 5,
    UPLOAD_DIR: '/tmp/uploads',
  },
}));

vi.mock('../utils/crypto.js', () => ({
  encryptWithKeyVersion: hoisted.encryptWithKeyVersion,
  decryptWithKeyVersion: hoisted.decryptWithKeyVersion,
}));

vi.mock('./key-management-service.js', () => ({
  getActiveKeyVersion: hoisted.getActiveKeyVersion,
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: hoisted.logAuditEvent,
}));

import { prisma } from '../config/prisma.js';
import {
  deleteDocument,
  downloadDocument,
  listDocuments,
  uploadDocument,
} from './document-service.js';

const mocked = {
  documentCreate: vi.mocked(prisma.document.create),
  documentFindMany: vi.mocked(prisma.document.findMany),
  documentFindFirst: vi.mocked(prisma.document.findFirst),
  documentUpdate: vi.mocked(prisma.document.update),
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

describe('document-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadDocument', () => {
    const validFile = {
      originalName: 'passport.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      filePath: '/tmp/uploads/uuid-1234.pdf',
      storedFilename: 'uuid-1234.pdf',
    };

    it('rejects disallowed file extensions', async () => {
      await expectHttpError(
        uploadDocument({
          employeeId: 'emp-1',
          type: DocumentType.PASSPORT,
          file: { ...validFile, storedFilename: 'virus.exe' },
          uploadedBy: 'user-1',
        }),
        400,
        'File type not allowed',
      );
      expect(mocked.documentCreate).not.toHaveBeenCalled();
    });

    it('rejects disallowed MIME types', async () => {
      await expectHttpError(
        uploadDocument({
          employeeId: 'emp-1',
          type: DocumentType.PASSPORT,
          file: { ...validFile, mimeType: 'application/x-msdownload' },
          uploadedBy: 'user-1',
        }),
        400,
        'MIME type not allowed',
      );
    });

    it('rejects files larger than the configured max size', async () => {
      await expectHttpError(
        uploadDocument({
          employeeId: 'emp-1',
          type: DocumentType.PASSPORT,
          file: { ...validFile, size: 10 * 1024 * 1024 },
          uploadedBy: 'user-1',
        }),
        400,
        'File too large',
      );
    });

    it('persists the document record for an on-disk file', async () => {
      hoisted.readFile.mockResolvedValue(Buffer.from('pdf-bytes'));
      hoisted.writeFile.mockResolvedValue(undefined);
      hoisted.getActiveKeyVersion.mockResolvedValue({ key_id: 'data-encryption-v1' } as never);
      hoisted.encryptWithKeyVersion.mockReturnValue({
        ciphertext: Buffer.from('encrypted'),
        keyVersionId: 'data-encryption-v1',
        iv: Buffer.from('iv'),
        tag: Buffer.from('tag'),
      });
      mocked.documentCreate.mockResolvedValue({ id: 'doc-1' } as never);

      const result = await uploadDocument({
        employeeId: 'emp-1',
        type: DocumentType.PASSPORT,
        file: validFile,
        uploadedBy: 'user-1',
        expiryDate: new Date('2030-01-01'),
      });

      expect(result).toEqual({ id: 'doc-1' });
      expect(mocked.documentCreate).toHaveBeenCalledWith({
        data: {
          employee_id: 'emp-1',
          type: DocumentType.PASSPORT,
          original_filename: 'passport.pdf',
          stored_filename: 'uuid-1234.pdf',
          file_path: '/tmp/uploads/uuid-1234.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
          uploaded_by: 'user-1',
          expiry_date: new Date('2030-01-01'),
          encryption_key_version_id: 'data-encryption-v1',
          encryption_iv: Buffer.from('iv'),
          encryption_tag: Buffer.from('tag'),
        },
      });
    });
  });

  describe('listDocuments', () => {
    it('returns documents mapped with expiry status', async () => {
      const now = new Date();
      const soon = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
      mocked.documentFindMany.mockResolvedValue([
        {
          id: 'doc-1',
          type: DocumentType.PASSPORT,
          original_filename: 'passport.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
          uploaded_by: 'user-1',
          created_at: now,
          expiry_date: soon,
        },
      ] as never);

      const result = await listDocuments('emp-1');

      expect(result).toHaveLength(1);
      expect((result[0] as { expiryStatus: string }).expiryStatus).toBe('soon');
      expect(mocked.documentFindMany).toHaveBeenCalledWith({
        where: { employee_id: 'emp-1', deleted_at: null },
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('downloadDocument', () => {
    it('returns file metadata for an existing document', async () => {
      hoisted.readFile.mockResolvedValue(Buffer.from('pdf-bytes'));
      hoisted.logAuditEvent.mockResolvedValue(undefined);
      mocked.documentFindFirst.mockResolvedValue({
        id: 'doc-1',
        file_path: '/tmp/uploads/doc.pdf',
        mime_type: 'application/pdf',
        original_filename: 'passport.pdf',
      } as never);

      const result = await downloadDocument('doc-1', 'u-1', 'admin@example.com');

      expect(result).toEqual({
        buffer: Buffer.from('pdf-bytes'),
        mimeType: 'application/pdf',
        originalName: 'passport.pdf',
      });
    });

    it('throws 404 when the document does not exist', async () => {
      mocked.documentFindFirst.mockResolvedValue(null);

      await expectHttpError(
        downloadDocument('missing', 'u-1', 'admin@example.com'),
        404,
        'Document not found',
      );
    });
  });

  describe('deleteDocument', () => {
    it('marks the document as deleted', async () => {
      hoisted.unlink.mockResolvedValue(undefined);
      hoisted.access.mockRejectedValue(new Error('ENOENT'));
      mocked.documentFindFirst.mockResolvedValue({
        id: 'doc-1',
        file_path: '/tmp/uploads/doc.pdf',
      } as never);
      mocked.documentUpdate.mockResolvedValue({} as never);

      await deleteDocument('doc-1');

      expect(mocked.documentUpdate).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { deleted_at: expect.any(Date) },
      });
    });
  });
});
