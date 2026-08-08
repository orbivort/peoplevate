import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authRoutes } from './routes/auth-routes.js';
import { userRoutes } from './routes/user-routes.js';
import { departmentRoutes } from './routes/department-routes.js';
import { positionRoutes } from './routes/position-routes.js';
import { employeeRoutes } from './routes/employee-routes.js';
import { documentRoutes } from './routes/document-routes.js';
import { employmentChangeRoutes } from './routes/employment-change-routes.js';
import { auditLogRoutes } from './routes/audit-log-routes.js';
import { alertRoutes } from './routes/alert-routes.js';
import { recruitmentRoutes } from './routes/recruitment-routes.js';
import { attendanceRoutes } from './routes/attendance-routes.js';
import { performanceRoutes } from './routes/performance-routes.js';
import { offboardingRoutes } from './routes/offboarding-routes.js';
import { keyManagementRoutes } from './routes/key-management-routes.js';
import { retentionRoutes } from './routes/retention-routes.js';
import { dataSubjectRightsRoutes } from './routes/data-subject-rights-routes.js';
import { dsarRoutes } from './routes/dsar-routes.js';
import { breachRoutes } from './routes/breach-routes.js';
import { anomalyRoutes } from './routes/anomaly-routes.js';
import { consentRoutes } from './routes/consent-routes.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found-handler.js';

/**
 * Builds the Express application with all middleware and routes wired up.
 *
 * This is separated from the server bootstrap (see `index.ts`) so tests can
 * exercise the routes via supertest without binding a port or starting cron.
 */
export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/departments', departmentRoutes);
  app.use('/api/positions', positionRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/employees', employmentChangeRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/audit-log', auditLogRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/recruitment', recruitmentRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/performance', performanceRoutes);
  app.use('/api/offboarding', offboardingRoutes);
  app.use('/api/keys', keyManagementRoutes);
  app.use('/api/retention', retentionRoutes);
  app.use('/api/data-subject-rights', dataSubjectRightsRoutes);
  app.use('/api/dsar', dsarRoutes);
  app.use('/api/breach', breachRoutes);
  app.use('/api/anomalies', anomalyRoutes);
  app.use('/api/consent', consentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
