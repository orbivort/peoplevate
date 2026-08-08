import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CandidateSource, EmploymentType } from '#prisma';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR, requireHRorManager } from '../middleware/rbac.js';
import * as recruitment from '../services/recruitment-service.js';

export const recruitmentRoutes: Router = Router();
recruitmentRoutes.use(authenticate);

// ── Requisitions ───────────────────────────────

recruitmentRoutes.get('/requisitions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const requisitions = await recruitment.listRequisitions({
      role: user.role,
      userId: user.userId,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    res.json({ requisitions });
  } catch (err) {
    next(err);
  }
});

const createRequisitionSchema = z.object({
  title: z.string().min(1),
  departmentId: z.string().min(1),
  positionId: z.string().min(1),
  headcount: z.coerce.number().int().min(1),
  employmentType: z.nativeEnum(EmploymentType),
  closingDate: z.coerce.date().optional(),
});

recruitmentRoutes.post(
  '/requisitions',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createRequisitionSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const result = await recruitment.createRequisition({ ...data, createdBy: user.userId });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.post(
  '/requisitions/:id/submit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await recruitment.submitRequisition(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.post(
  '/requisitions/:id/approve',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await recruitment.approveRequisition(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.post(
  '/requisitions/:id/publish',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await recruitment.publishRequisition(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.post(
  '/requisitions/:id/close',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await recruitment.closeRequisition(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

// ── Candidates ─────────────────────────────────

recruitmentRoutes.get(
  '/candidates',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const candidates = await recruitment.listCandidates({
        requisitionId:
          typeof req.query.requisitionId === 'string' ? req.query.requisitionId : undefined,
        stage: typeof req.query.stage === 'string' ? req.query.stage : undefined,
        role: user.role,
        userId: user.userId,
      });
      res.json({ candidates });
    } catch (err) {
      next(err);
    }
  },
);

const createCandidateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  source: z.nativeEnum(CandidateSource).optional(),
  requisitionId: z.string().min(1),
  consentRecorded: z.boolean().optional(),
});

recruitmentRoutes.post(
  '/candidates',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createCandidateSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const result = await recruitment.createCandidate({
        ...data,
        source: data.source ?? CandidateSource.DIRECT,
        consentRecorded: data.consentRecorded ?? false,
        actorId: user.userId,
        actorName: user.email,
        role: user.role,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

const updateStageSchema = z.object({
  stage: z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']),
});

recruitmentRoutes.patch(
  '/candidates/:id/stage',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateStageSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await recruitment.updateCandidateStage({
          id: String(req.params.id),
          to: data.stage,
          actorId: user.userId,
          actorName: user.email,
          role: user.role,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ── Interviews ─────────────────────────────────

recruitmentRoutes.get(
  '/candidates/:id/interviews',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ interviews: await recruitment.listCandidateInterviews(String(req.params.id)) });
    } catch (err) {
      next(err);
    }
  },
);

const createInterviewSchema = z.object({
  scheduledAt: z.coerce.date(),
  durationMin: z.coerce.number().int().default(30),
  interviewerIds: z.array(z.string()).default([]),
  location: z.string().optional(),
  notes: z.string().optional(),
});

recruitmentRoutes.post(
  '/candidates/:id/interviews',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createInterviewSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const result = await recruitment.createInterview({
        candidateId: String(req.params.id),
        ...data,
        actorId: user.userId,
        actorName: user.email,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.delete(
  '/candidates/:id/interviews/:interviewId',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const result = await recruitment.deleteInterview({
        candidateId: String(req.params.id),
        interviewId: String(req.params.interviewId),
        actorId: user.userId,
        actorName: user.email,
      });
      res.json({ interview: result });
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.patch(
  '/candidates/:id/interviews/:interviewId/status',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({ status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']) });
      const { status } = schema.parse(req.body);
      const user = getAuthUser(req)!;
      const result = await recruitment.updateInterviewStatus({
        candidateId: String(req.params.id),
        interviewId: String(req.params.interviewId),
        to: status,
        actorId: user.userId,
        actorName: user.email,
      });
      res.json({ interview: result });
    } catch (err) {
      next(err);
    }
  },
);

// ── Offer Letters ──────────────────────────────

const createOfferSchema = z.object({
  position: z.string().min(1),
  salary: z.coerce.number().int().min(0),
  startDate: z.coerce.date(),
  terms: z.string().optional(),
});

recruitmentRoutes.post(
  '/candidates/:id/offers',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createOfferSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const result = await recruitment.createOffer({
        candidateId: String(req.params.id),
        ...data,
        createdBy: user.userId,
        actorId: user.userId,
        actorName: user.email,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.get(
  '/offers',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const offers = await recruitment.listOffers({
        role: user.role,
        userId: user.userId,
        departmentId:
          typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined,
      });
      res.json({ offers });
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.post(
  '/offers/:id/send',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      res.json(await recruitment.sendOffer(String(req.params.id), user.userId, user.email));
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.post(
  '/offers/:id/accept',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await recruitment.acceptOffer(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

recruitmentRoutes.delete(
  '/offers/:id',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      res.json(await recruitment.deleteOffer(String(req.params.id), user.userId, user.email));
    } catch (err) {
      next(err);
    }
  },
);

// ── Candidate → Employee conversion ────────────

const convertSchema = z.object({
  departmentId: z.string().min(1),
  positionId: z.string().min(1),
  hireDate: z.coerce.date(),
  managerId: z.string().optional(),
});

recruitmentRoutes.post(
  '/candidates/:id/convert',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = convertSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const result = await recruitment.convertCandidateToEmployee({
        candidateId: String(req.params.id),
        ...data,
        actorId: user.userId,
        actorName: user.email,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── Onboarding tasks ───────────────────────────

recruitmentRoutes.get(
  '/employees/:id/onboarding',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      res.json({
        tasks: await recruitment.listOnboardingTasks(String(req.params.id), user.userId, user.role),
      });
    } catch (err) {
      next(err);
    }
  },
);

const updateTaskSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETE', 'OVERDUE']).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
});

recruitmentRoutes.patch(
  '/onboarding-tasks/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateTaskSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await recruitment.updateOnboardingTask({
          id: String(req.params.id),
          ...data,
          actorId: user.userId,
          role: user.role,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
