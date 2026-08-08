import cron, { type ScheduledTask } from 'node-cron';
import { env } from './env.js';
import { logger } from './logger.js';
import { runExpiryCheck } from '../services/alert-service.js';
import { runLeaveAccrual } from '../services/attendance-service.js';
import { runDeactivationCheck } from '../services/offboarding-service.js';
import { autoCreateProbationCycles } from '../services/performance-service.js';
import { executePurge, purgeOldIpAddresses } from '../services/retention-service.js';
import { checkBreachEscalations } from '../services/breach-service.js';
import { checkDsarSla } from '../routes/dsar-routes.js';

const scheduledTasks: ScheduledTask[] = [];

export function startCronJobs(): void {
  // Document expiry check — daily at 8:00 AM
  scheduledTasks.push(
    cron.schedule(env.EXPIRY_CHECK_CRON_EXPRESSION, async () => {
      try {
        await runExpiryCheck();
      } catch (err) {
        logger.error('Expiry check cron job failed:', err);
      }
    }),
  );

  // Phase 2 — Leave balance accrual — daily (default 2:00 AM)
  scheduledTasks.push(
    cron.schedule(env.LEAVE_ACCRUAL_CRON_EXPRESSION, async () => {
      try {
        await runLeaveAccrual();
      } catch (err) {
        logger.error('Leave accrual cron job failed:', err);
      }
    }),
  );

  // Phase 2 — Deactivate accounts on deactivation_date — daily (default 3:00 AM)
  scheduledTasks.push(
    cron.schedule(env.DEACTIVATION_CHECK_CRON_EXPRESSION, async () => {
      try {
        await runDeactivationCheck();
      } catch (err) {
        logger.error('Deactivation check cron job failed:', err);
      }
    }),
  );

  // Phase 2 — Performance: auto-create/open PROBATION cycles before probation ends — daily (default 5:00 AM)
  scheduledTasks.push(
    cron.schedule(env.PROBATION_CYCLE_CRON_EXPRESSION, async () => {
      try {
        const result = await autoCreateProbationCycles();
        logger.info(`Probation cycle auto-initiation complete: ${result.created} cycle(s) created`);
      } catch (err) {
        logger.error('Probation cycle auto-initiation cron job failed:', err);
      }
    }),
  );

  // GDPR - Data retention purge - daily (default 4:00 AM)
  scheduledTasks.push(
    cron.schedule(env.RETENTION_PURGE_CRON_EXPRESSION, async () => {
      try {
        const result = await executePurge(null, 'system-cron');
        logger.info(
          `Retention purge complete: ${result.purged} purged, ${result.anonymized} anonymized, ` +
            `${result.skipped} skipped, ${result.errors.length} errors`,
        );
        const ipPurged = await purgeOldIpAddresses();
        if (ipPurged > 0) {
          logger.info(`IP address minimization: ${ipPurged} old IP addresses anonymized`);
        }
      } catch (err) {
        logger.error('Retention purge cron job failed:', err);
      }
    }),
  );

  // GDPR - DSAR SLA check - daily (default 6:00 AM)
  scheduledTasks.push(
    cron.schedule(env.DSAR_SLA_CRON_EXPRESSION, async () => {
      try {
        await checkDsarSla();
        logger.info('DSAR SLA check complete');
      } catch (err) {
        logger.error('DSAR SLA cron job failed:', err);
      }
    }),
  );

  // GDPR - Breach escalation check - hourly
  scheduledTasks.push(
    cron.schedule(env.BREACH_ESCALATION_CRON_EXPRESSION, async () => {
      try {
        await checkBreachEscalations();
        logger.info('Breach escalation check complete');
      } catch (err) {
        logger.error('Breach escalation cron job failed:', err);
      }
    }),
  );

  logger.info('Cron jobs scheduled');
}

/**
 * Stops all scheduled cron jobs. Called during graceful shutdown so no job
 * fires while the process is draining.
 */
export function stopCronJobs(): void {
  for (const task of scheduledTasks) {
    task.destroy();
  }
  scheduledTasks.length = 0;
}
