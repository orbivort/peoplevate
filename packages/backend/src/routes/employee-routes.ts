import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { EmploymentStatus, EmploymentType, Gender } from '#prisma';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR, requireHRorManager } from '../middleware/rbac.js';
import * as employeeService from '../services/employee-service.js';
import { withAuditContext } from '../utils/audit-context.js';
import { prisma } from '../config/prisma.js';

export const employeeRoutes: Router = Router();

employeeRoutes.use(authenticate);

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.nativeEnum(Gender).optional(),
  nationalId: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  departmentId: z.string().min(1),
  positionId: z.string().min(1),
  managerId: z.string().optional(),
  hireDate: z.coerce.date(),
  employmentType: z.nativeEnum(EmploymentType),
  salary: z.number().optional(),
  status: z.nativeEnum(EmploymentStatus).optional(),
});

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.nativeEnum(Gender).optional(),
  nationalId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  managerId: z.string().nullable().optional(),
  hireDate: z.coerce.date().optional(),
  employmentType: z.nativeEnum(EmploymentType).optional(),
  salary: z.number().optional(),
  status: z.nativeEnum(EmploymentStatus).optional(),
});

const selfUpdateSchema = z.object({
  phone: z.string().optional(),
  address: z.string().max(500).optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
});

const statusTransitionSchema = z.object({
  status: z.nativeEnum(EmploymentStatus),
  effectiveDate: z.coerce.date(),
  reason: z.string().optional(),
});

// Avatar upload config — images only, 2MB max
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.resolve(env.UPLOAD_DIR, 'avatars');
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
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!AVATAR_EXTENSIONS.includes(ext) || !AVATAR_MIME_TYPES.includes(file.mimetype)) {
      cb(new HttpError(400, 'Only JPEG, PNG, and WebP images are allowed.'));
      return;
    }
    cb(null, true);
  },
});

employeeRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, status, departmentId } = req.query as Record<string, string | undefined>;
    const user = getAuthUser(req)!;
    const employees = await employeeService.listEmployees({
      role: user.role,
      userId: user.userId,
      employeeId: user.employeeId,
      search,
      status,
      departmentId,
    });
    res.json({ employees });
  } catch (err) {
    next(err);
  }
});

employeeRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const employee = await employeeService.getEmployee(
      String(req.params.id),
      user.role,
      user.userId,
    );
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

employeeRoutes.post('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createSchema.parse(req.body);
    const user = getAuthUser(req)!;
    const result = await withAuditContext(prisma, user.userId, user.email, () =>
      employeeService.createEmployee(data),
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

employeeRoutes.put('/:id/self', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = selfUpdateSchema.parse(req.body);
    const user = getAuthUser(req)!;

    await withAuditContext(prisma, user.userId, user.email, () =>
      employeeService.selfUpdateEmployee({
        employeeId: String(req.params.id),
        userId: user.userId,
        userEmail: user.email,
        fields: data,
      }),
    );
    res.json({ message: 'Profile updated' });
  } catch (err) {
    next(err);
  }
});

// ── Avatar routes ─────────────────────────────

employeeRoutes.get('/:id/avatar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const result = await employeeService.getAvatarPath({
      employeeId: String(req.params.id),
      userId: user.userId,
      role: user.role,
    });

    if (!result) {
      res.status(404).json({ error: 'No avatar found' });
      return;
    }

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const { createReadStream } = await import('node:fs');
    createReadStream(result.filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

employeeRoutes.post(
  '/:id/avatar',
  avatarUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const user = getAuthUser(req)!;

      try {
        await withAuditContext(prisma, user.userId, user.email, () =>
          employeeService.setAvatar({
            employeeId: String(req.params.id),
            userId: user.userId,
            userEmail: user.email,
            filePath: file.path,
            storedFilename: file.filename,
          }),
        );
        res.json({
          message: 'Avatar uploaded',
          avatarUrl: `/api/employees/${req.params.id}/avatar`,
        });
      } catch (err) {
        // Clean up the uploaded file on error
        try {
          await import('node:fs/promises').then((fsp) => fsp.unlink(file.path));
        } catch {
          // ignore
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

employeeRoutes.delete('/:id/avatar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;

    await withAuditContext(prisma, user.userId, user.email, () =>
      employeeService.removeAvatar({
        employeeId: String(req.params.id),
        userId: user.userId,
        userEmail: user.email,
      }),
    );
    res.json({ message: 'Avatar removed' });
  } catch (err) {
    next(err);
  }
});

employeeRoutes.put(
  '/:id',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateSchema.parse(req.body);
      const user = getAuthUser(req)!;

      if (user.role === 'MANAGER') {
        const selfEmployee = await prisma.employee.findUnique({
          where: { user_id: user.userId },
          select: { id: true },
        });
        const target = await prisma.employee.findFirst({
          where: { id: String(req.params.id) },
          select: { manager_id: true },
        });
        if (!target || target.manager_id !== selfEmployee?.id) {
          res.status(403).json({ error: 'You can only edit your direct reports' });
          return;
        }
      }

      await withAuditContext(prisma, user.userId, user.email, () =>
        employeeService.updateEmployee(
          String(req.params.id),
          {
            ...data,
            managerId: data.managerId ?? undefined,
          },
          user.role,
        ),
      );
      res.json({ message: 'Employee updated' });
    } catch (err) {
      next(err);
    }
  },
);

employeeRoutes.patch(
  '/:id/status',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = statusTransitionSchema.parse(req.body);
      const user = getAuthUser(req)!;
      await withAuditContext(prisma, user.userId, user.email, () =>
        employeeService.transitionStatus({
          employeeId: String(req.params.id),
          newStatus: data.status,
          effectiveDate: data.effectiveDate,
          reason: data.reason,
          recordedBy: user.userId,
        }),
      );
      res.json({ message: 'Status transitioned' });
    } catch (err) {
      next(err);
    }
  },
);
