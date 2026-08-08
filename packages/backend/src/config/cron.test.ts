import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn(() => fakeTask()) },
}));

vi.mock('./env.js', () => ({
  env: {
    EXPIRY_CHECK_CRON_EXPRESSION: '0 8 * * *',
    LEAVE_ACCRUAL_CRON_EXPRESSION: '0 2 * * *',
    DEACTIVATION_CHECK_CRON_EXPRESSION: '0 3 * * *',
    PROBATION_CYCLE_CRON_EXPRESSION: '0 5 * * *',
    RETENTION_PURGE_CRON_EXPRESSION: '0 4 * * *',
    DSAR_SLA_CRON_EXPRESSION: '0 6 * * *',
    BREACH_ESCALATION_CRON_EXPRESSION: '0 * * * *',
  },
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/alert-service.js', () => ({ runExpiryCheck: vi.fn() }));
vi.mock('../services/attendance-service.js', () => ({ runLeaveAccrual: vi.fn() }));
vi.mock('../services/offboarding-service.js', () => ({ runDeactivationCheck: vi.fn() }));
vi.mock('../services/performance-service.js', () => ({ autoCreateProbationCycles: vi.fn() }));
vi.mock('../services/retention-service.js', () => ({
  executePurge: vi.fn(),
  purgeOldIpAddresses: vi.fn(),
}));
vi.mock('../services/breach-service.js', () => ({ checkBreachEscalations: vi.fn() }));
vi.mock('../routes/dsar-routes.js', () => ({ checkDsarSla: vi.fn() }));

import cron, { type ScheduledTask } from 'node-cron';
import { logger } from './logger.js';
import { runExpiryCheck } from '../services/alert-service.js';
import { runLeaveAccrual } from '../services/attendance-service.js';
import { runDeactivationCheck } from '../services/offboarding-service.js';
import { autoCreateProbationCycles } from '../services/performance-service.js';
import { executePurge, purgeOldIpAddresses } from '../services/retention-service.js';
import { checkBreachEscalations } from '../services/breach-service.js';
import { checkDsarSla } from '../routes/dsar-routes.js';
import { startCronJobs, stopCronJobs } from './cron.js';

/** Minimal ScheduledTask double whose destroy() records the call. */
function fakeTask(): ScheduledTask {
  return { destroy: vi.fn() } as unknown as ScheduledTask;
}

const scheduleMock = vi.mocked(cron.schedule);

/** Retrieve the handler registered for a given cron expression. */
function handlerFor(expression: string): () => Promise<void> {
  const call = scheduleMock.mock.calls.find((c) => c[0] === expression);
  if (!call) throw new Error(`No cron job registered for ${expression}`);
  return call[1] as () => Promise<void>;
}

describe('startCronJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(autoCreateProbationCycles).mockResolvedValue({ created: 0 } as never);
    vi.mocked(executePurge).mockResolvedValue({
      purged: 0,
      anonymized: 0,
      skipped: 0,
      errors: [],
    } as never);
    vi.mocked(purgeOldIpAddresses).mockResolvedValue(0);
    vi.mocked(checkBreachEscalations).mockResolvedValue(undefined as never);
    vi.mocked(checkDsarSla).mockResolvedValue(undefined as never);
  });

  it('registers all seven scheduled jobs', () => {
    startCronJobs();

    expect(scheduleMock).toHaveBeenCalledTimes(7);
    expect(scheduleMock.mock.calls.map((c) => c[0])).toEqual([
      '0 8 * * *',
      '0 2 * * *',
      '0 3 * * *',
      '0 5 * * *',
      '0 4 * * *',
      '0 6 * * *',
      '0 * * * *',
    ]);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('Cron jobs scheduled');
  });

  it.each([
    ['0 8 * * *', runExpiryCheck, 'Expiry check cron job failed:'],
    ['0 2 * * *', runLeaveAccrual, 'Leave accrual cron job failed:'],
    ['0 3 * * *', runDeactivationCheck, 'Deactivation check cron job failed:'],
  ])('runs the job for %s and logs failures', async (expression, job, errorMessage) => {
    startCronJobs();
    const handler = handlerFor(expression);

    vi.mocked(job).mockResolvedValue(undefined as never);
    await handler();
    expect(vi.mocked(job)).toHaveBeenCalledOnce();

    vi.mocked(job).mockRejectedValue(new Error('boom'));
    await handler();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(errorMessage, expect.any(Error));
  });

  it('logs the number of probation cycles created', async () => {
    startCronJobs();
    vi.mocked(autoCreateProbationCycles).mockResolvedValue({ created: 3 } as never);

    await handlerFor('0 5 * * *')();

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'Probation cycle auto-initiation complete: 3 cycle(s) created',
    );
  });

  it('logs an error when probation cycle auto-initiation fails', async () => {
    startCronJobs();
    vi.mocked(autoCreateProbationCycles).mockRejectedValue(new Error('boom'));

    await handlerFor('0 5 * * *')();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'Probation cycle auto-initiation cron job failed:',
      expect.any(Error),
    );
  });

  it('runs the retention purge job and logs the summary', async () => {
    startCronJobs();
    vi.mocked(executePurge).mockResolvedValue({
      purged: 5,
      anonymized: 2,
      skipped: 1,
      errors: ['boom'],
    } as never);
    vi.mocked(purgeOldIpAddresses).mockResolvedValue(3);

    await handlerFor('0 4 * * *')();

    expect(vi.mocked(executePurge)).toHaveBeenCalledWith(null, 'system-cron');
    expect(vi.mocked(purgeOldIpAddresses)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'Retention purge complete: 5 purged, 2 anonymized, 1 skipped, 1 errors',
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'IP address minimization: 3 old IP addresses anonymized',
    );
  });

  it('does not log IP minimization when no IPs were purged', async () => {
    startCronJobs();
    vi.mocked(purgeOldIpAddresses).mockResolvedValue(0);

    await handlerFor('0 4 * * *')();

    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining('IP address minimization'),
    );
  });

  it('logs an error when the retention purge job fails', async () => {
    startCronJobs();
    vi.mocked(executePurge).mockRejectedValue(new Error('boom'));

    await handlerFor('0 4 * * *')();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'Retention purge cron job failed:',
      expect.any(Error),
    );
  });

  it('runs the DSAR SLA check job and logs completion', async () => {
    startCronJobs();

    await handlerFor('0 6 * * *')();

    expect(vi.mocked(checkDsarSla)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('DSAR SLA check complete');
  });

  it('logs an error when the DSAR SLA check job fails', async () => {
    startCronJobs();
    vi.mocked(checkDsarSla).mockRejectedValue(new Error('boom'));

    await handlerFor('0 6 * * *')();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'DSAR SLA cron job failed:',
      expect.any(Error),
    );
  });

  it('runs the breach escalation check job and logs completion', async () => {
    startCronJobs();

    await handlerFor('0 * * * *')();

    expect(vi.mocked(checkBreachEscalations)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('Breach escalation check complete');
  });

  it('logs an error when the breach escalation check job fails', async () => {
    startCronJobs();
    vi.mocked(checkBreachEscalations).mockRejectedValue(new Error('boom'));

    await handlerFor('0 * * * *')();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'Breach escalation cron job failed:',
      expect.any(Error),
    );
  });
});

describe('stopCronJobs', () => {
  it('destroys all scheduled tasks and clears the list', () => {
    const before = vi.mocked(cron.schedule).mock.results.length;
    startCronJobs();
    const tasks = vi
      .mocked(cron.schedule)
      .mock.results.slice(before)
      .map((r) => r.value as ScheduledTask);

    stopCronJobs();

    expect(tasks.length).toBe(7);
    for (const task of tasks) {
      expect(task.destroy).toHaveBeenCalledOnce();
    }
  });

  it('is safe to call when no jobs are scheduled', () => {
    expect(() => stopCronJobs()).not.toThrow();
  });
});
