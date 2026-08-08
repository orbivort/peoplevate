import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'path';
import crypto from 'crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import multer from 'multer';
import { DocumentType } from '#prisma';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as docService from '../services/document-service.js';
import { checkBulkDownloadSpike } from '../services/breach-service.js';
import { prisma } from '../config/prisma.js';

export const documentRoutes: Router = Router();

documentRoutes.use(authenticate);

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.resolve(env.UPLOAD_DIR);
      try {
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err as Error, dir);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext) || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new HttpError(400, 'File type not allowed'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Removes a partially-written upload from disk when validation fails after
 * multer has already streamed the file, preventing orphan files.
 */
async function cleanupUpload(filePath?: string): Promise<void> {
  if (filePath) {
    try {
      await fsp.unlink(filePath);
    } catch {
      // File already gone or unremovable; nothing else to do.
    }
  }
}

const uploadSchema = z.object({
  type: z.nativeEnum(DocumentType),
  expiryDate: z.coerce.date().optional(),
});

documentRoutes.get(
  '/employee/:employeeId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      if (user.role === 'EMPLOYEE' && user.employeeId !== req.params.employeeId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (user.role === 'MANAGER') {
        const selfEmployee = await prisma.employee.findUnique({
          where: { user_id: user.userId },
          select: { id: true },
        });
        const target = await prisma.employee.findFirst({
          where: { id: String(req.params.employeeId) },
          select: { manager_id: true },
        });
        if (
          target?.manager_id !== selfEmployee?.id &&
          user.employeeId !== String(req.params.employeeId)
        ) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }
      }

      const docs = await docService.listDocuments(String(req.params.employeeId));
      res.json({ documents: docs });
    } catch (err) {
      next(err);
    }
  },
);

documentRoutes.post(
  '/employee/:employeeId',
  requireHR,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      // Multer has already streamed the file to disk at this point; any failure
      // below must clean up the partial file to avoid leaving orphans.
      try {
        const data = uploadSchema.parse(req.body);
        const user = getAuthUser(req)!;
        const result = await docService.uploadDocument({
          employeeId: String(req.params.employeeId),
          type: data.type,
          file: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            filePath: file.path,
            storedFilename: file.filename,
          },
          uploadedBy: user.userId,
          expiryDate: data.expiryDate,
        });
        res.status(201).json(result);
      } catch (err) {
        await cleanupUpload(file.path);
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

documentRoutes.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const doc = await prisma.document.findFirst({
      where: { id: String(req.params.id), deleted_at: null },
    });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (user.role === 'EMPLOYEE' && user.employeeId !== doc.employee_id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (user.role === 'MANAGER') {
      const selfEmployee = await prisma.employee.findUnique({
        where: { user_id: user.userId },
        select: { id: true },
      });
      const target = await prisma.employee.findFirst({
        where: { id: doc.employee_id },
        select: { manager_id: true },
      });
      if (target?.manager_id !== selfEmployee?.id && user.employeeId !== doc.employee_id) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
    }

    const { buffer, mimeType, originalName } = await docService.downloadDocument(
      String(req.params.id),
      user.userId,
      user.email,
    );

    // Feed the bulk-download-spike detector. downloadDocument already emits a
    // DOWNLOAD audit record, so checkBulkDownloadSpike counts downloads per user
    // within its window to detect anomalous exfiltration (GDPR Art. 32).
    await checkBulkDownloadSpike(user.userId);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

documentRoutes.delete(
  '/:id',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await docService.deleteDocument(String(req.params.id));
      res.json({ message: 'Document deleted' });
    } catch (err) {
      next(err);
    }
  },
);
