import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';

const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId: string | null;
} = { userId: 'u-1', email: 'jane@example.com', role: 'HR_MANAGER', employeeId: 'emp-1' };

// Route the multer disk-storage uploads to a temp dir so tests don't pollute
// the workspace, then clean it up once the suite finishes. `vi.hoisted` runs
// before imports are initialized, so only Node globals (process) are safe to
// reference here.
const testUploadDir = vi.hoisted(() => `${process.cwd()}/.peoplevate-doc-routes-${process.pid}`);
vi.mock('../config/env.js', () => ({
  env: {
    UPLOAD_DIR: testUploadDir,
    MAX_FILE_SIZE_MB: 5,
  },
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    employee: { findUnique: vi.fn(), findFirst: vi.fn() },
    document: { findFirst: vi.fn() },
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = authUser;
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireHR: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../services/document-service.js', () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

vi.mock('../services/breach-service.js', () => ({
  checkBulkDownloadSpike: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import * as docService from '../services/document-service.js';
import * as breachService from '../services/breach-service.js';
import { documentRoutes } from './document-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listDocuments: vi.mocked(docService.listDocuments),
  uploadDocument: vi.mocked(docService.uploadDocument),
  downloadDocument: vi.mocked(docService.downloadDocument),
  deleteDocument: vi.mocked(docService.deleteDocument),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeFindFirst: vi.mocked(prisma.employee.findFirst),
  documentFindFirst: vi.mocked(prisma.document.findFirst),
  checkBulkDownloadSpike: vi.mocked(breachService.checkBulkDownloadSpike),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/documents', documentRoutes);
  app.use(errorHandler);
  return app;
}

function setUser(role: string, employeeId: string | null = 'emp-1'): void {
  authUser.role = role;
  authUser.employeeId = employeeId;
}

describe('document-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser('HR_MANAGER', 'emp-1');
    mocked.listDocuments.mockResolvedValue([] as never);
    mocked.uploadDocument.mockResolvedValue({ id: 'doc-1' } as never);
    mocked.deleteDocument.mockResolvedValue(undefined as never);
    mocked.checkBulkDownloadSpike.mockResolvedValue(undefined as never);
  });

  describe('GET /api/documents/employee/:employeeId', () => {
    it('returns documents for an HR user', async () => {
      mocked.listDocuments.mockResolvedValue([{ id: 'doc-1' }] as never);

      const res = await request(buildApp()).get('/api/documents/employee/emp-2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ documents: [{ id: 'doc-1' }] });
      expect(mocked.listDocuments).toHaveBeenCalledWith('emp-2');
    });

    it('allows an employee to read their own documents', async () => {
      setUser('EMPLOYEE', 'emp-1');

      const res = await request(buildApp()).get('/api/documents/employee/emp-1');

      expect(res.status).toBe(200);
      expect(mocked.listDocuments).toHaveBeenCalledWith('emp-1');
    });

    it('returns 403 when an employee reads another employee documents', async () => {
      setUser('EMPLOYEE', 'emp-1');

      const res = await request(buildApp()).get('/api/documents/employee/emp-2');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Access denied' });
      expect(mocked.listDocuments).not.toHaveBeenCalled();
    });

    it('allows a manager to read a direct report documents', async () => {
      setUser('MANAGER', 'emp-1');
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'emp-1' } as never);

      const res = await request(buildApp()).get('/api/documents/employee/emp-2');

      expect(res.status).toBe(200);
      expect(mocked.listDocuments).toHaveBeenCalledWith('emp-2');
    });

    it('returns 403 when a manager reads a non-report documents', async () => {
      setUser('MANAGER', 'emp-1');
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'emp-9' } as never);

      const res = await request(buildApp()).get('/api/documents/employee/emp-2');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Access denied' });
      expect(mocked.listDocuments).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.listDocuments.mockRejectedValue(
        Object.assign(new Error('Employee not found'), { status: 404 }),
      );

      const res = await request(buildApp()).get('/api/documents/employee/emp-2');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Employee not found');
    });
  });

  describe('POST /api/documents/employee/:employeeId', () => {
    it('uploads a document', async () => {
      mocked.uploadDocument.mockResolvedValue({ id: 'doc-1' } as never);

      const res = await request(buildApp())
        .post('/api/documents/employee/emp-2')
        .field('type', 'CONTRACT')
        .attach('file', Buffer.from('hello'), 'contract.pdf');

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'doc-1' });
      const arg = mocked.uploadDocument.mock.calls[0]?.[0] as {
        employeeId: string;
        type: string;
        uploadedBy: string;
        file: { originalName: string };
      };
      expect(arg.employeeId).toBe('emp-2');
      expect(arg.type).toBe('CONTRACT');
      expect(arg.uploadedBy).toBe('u-1');
      expect(arg.file.originalName).toBe('contract.pdf');
    });

    it('returns 400 when no file is attached', async () => {
      const res = await request(buildApp())
        .post('/api/documents/employee/emp-2')
        .field('type', 'CONTRACT');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No file uploaded' });
      expect(mocked.uploadDocument).not.toHaveBeenCalled();
    });

    it('returns 400 on an invalid document type', async () => {
      const res = await request(buildApp())
        .post('/api/documents/employee/emp-2')
        .field('type', 'NOT_A_TYPE')
        .attach('file', Buffer.from('hello'), 'contract.pdf');

      expect(res.status).toBe(400);
      expect(mocked.uploadDocument).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.uploadDocument.mockRejectedValue(
        Object.assign(new Error('File type not allowed'), { status: 400 }),
      );

      const res = await request(buildApp())
        .post('/api/documents/employee/emp-2')
        .field('type', 'CONTRACT')
        .attach('file', Buffer.from('hello'), 'contract.pdf');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('File type not allowed');
    });
  });

  describe('GET /api/documents/:id/download', () => {
    it('returns 404 when the document does not exist', async () => {
      mocked.documentFindFirst.mockResolvedValue(null as never);

      const res = await request(buildApp()).get('/api/documents/doc-1/download');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Document not found' });
      expect(mocked.downloadDocument).not.toHaveBeenCalled();
    });

    it('returns 403 when an employee downloads another employee document', async () => {
      setUser('EMPLOYEE', 'emp-1');
      mocked.documentFindFirst.mockResolvedValue({
        id: 'doc-1',
        employee_id: 'emp-2',
      } as never);

      const res = await request(buildApp()).get('/api/documents/doc-1/download');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Access denied' });
      expect(mocked.downloadDocument).not.toHaveBeenCalled();
    });

    it('returns 403 when a manager downloads a non-report document', async () => {
      setUser('MANAGER', 'emp-1');
      mocked.documentFindFirst.mockResolvedValue({
        id: 'doc-1',
        employee_id: 'emp-2',
      } as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'emp-9' } as never);

      const res = await request(buildApp()).get('/api/documents/doc-1/download');

      expect(res.status).toBe(403);
      expect(mocked.downloadDocument).not.toHaveBeenCalled();
    });

    it('streams the file when access is granted', async () => {
      mocked.documentFindFirst.mockResolvedValue({
        id: 'doc-1',
        employee_id: 'emp-2',
      } as never);
      mocked.downloadDocument.mockResolvedValue({
        filePath: new URL(import.meta.url).pathname.replace(/^\//, ''),
        mimeType: 'text/plain',
        originalName: 'contract.pdf',
      } as never);

      const res = await request(buildApp()).get('/api/documents/doc-1/download');

      expect(mocked.downloadDocument).toHaveBeenCalledWith('doc-1', 'u-1', 'jane@example.com');
      expect(res.headers['content-disposition']).toBe('attachment; filename="contract.pdf"');
      expect(res.headers['content-type']).toContain('text/plain');
      // The bulk-download-spike detector is fed on every successful download.
      expect(mocked.checkBulkDownloadSpike).toHaveBeenCalledWith('u-1');
    });

    it('does not feed the spike detector when the download fails', async () => {
      mocked.documentFindFirst.mockResolvedValue({
        id: 'doc-1',
        employee_id: 'emp-2',
      } as never);
      mocked.downloadDocument.mockRejectedValue(
        Object.assign(new Error('File missing on disk'), { status: 404 }),
      );

      const res = await request(buildApp()).get('/api/documents/doc-1/download');

      expect(res.status).toBe(404);
      expect(mocked.checkBulkDownloadSpike).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.documentFindFirst.mockResolvedValue({
        id: 'doc-1',
        employee_id: 'emp-2',
      } as never);
      mocked.downloadDocument.mockRejectedValue(
        Object.assign(new Error('File missing on disk'), { status: 404 }),
      );

      const res = await request(buildApp()).get('/api/documents/doc-1/download');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('File missing on disk');
    });
  });

  describe('DELETE /api/documents/:id', () => {
    it('deletes a document', async () => {
      const res = await request(buildApp()).delete('/api/documents/doc-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Document deleted' });
      expect(mocked.deleteDocument).toHaveBeenCalledWith('doc-1');
    });

    it('forwards service errors', async () => {
      mocked.deleteDocument.mockRejectedValue(
        Object.assign(new Error('Document not found'), { status: 404 }),
      );

      const res = await request(buildApp()).delete('/api/documents/doc-1');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Document not found');
    });
  });
});

afterAll(() => {
  fs.rmSync(testUploadDir, { recursive: true, force: true });
});
