import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '#prisma';
import { HttpError } from '../utils/http-error.js';
import { InvalidTransitionError } from '../utils/state-machine.js';
import { logger } from '../config/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error(err.message, { stack: err.stack });

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.flatten().fieldErrors,
    });
  }

  if (err instanceof InvalidTransitionError) {
    return res.status(400).json({ error: err.message });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Resource already exists' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Resource not found' });
    }
  }

  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.code !== undefined && { code: err.code }),
    });
  }

  const status = (err as { status?: number }).status || 500;
  const message = status === 500 ? 'Internal server error' : err.message || 'An error occurred';

  return res.status(status).json({ error: message });
};
