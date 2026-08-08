import 'dotenv/config';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { startCronJobs, stopCronJobs } from './config/cron.js';
import { prisma } from './config/prisma.js';
import { bootstrapKeyVersions } from './services/key-management-service.js';

const app = createApp();

// Only bind the port and start scheduled jobs when running as the entrypoint.
// In tests, `app` is imported directly from `./app.js` so no server is started.
// E2E tests run a real server against a test database — `E2E_MODE` bypasses the
// guard so the process actually binds to a port while keeping NODE_ENV=test for
// Prisma/Vitest/seed configuration.
const isE2E = process.env.E2E_MODE === 'true';

if (process.env.NODE_ENV !== 'test' || isE2E) {
  // Bootstrap encryption key versions on startup
  void bootstrapKeyVersions().catch((err) =>
    logger.error('Failed to bootstrap key versions:', err),
  );

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    // Don't start cron jobs during E2E — background timers interfere with tests.
    if (!isE2E) {
      startCronJobs();
    }
  });

  // Graceful shutdown: drain in-flight requests, stop cron jobs, and disconnect
  // the database before exiting. Force-exits after a timeout so the process
  // cannot hang a deploy/redeploy indefinitely.
  const SHUTDOWN_TIMEOUT_MS = 10_000;

  function shutdown(signal: string): void {
    logger.info(`Received ${signal}; shutting down gracefully`);

    // Stop accepting new requests and give in-flight ones time to finish.
    server.close(() => {
      logger.info('HTTP server closed');
      void shutdownDb();
    });

    // If connections refuse to drain, hard-exit after the timeout.
    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    // Best-effort cleanup that can run immediately while the server drains.
    stopCronJobs();

    async function shutdownDb(): Promise<void> {
      try {
        await prisma.$disconnect();
        logger.info('Prisma client disconnected');
        process.exit(0);
      } catch (err) {
        logger.error('Error during Prisma disconnect:', err);
        process.exit(1);
      }
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
