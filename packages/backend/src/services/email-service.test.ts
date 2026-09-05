import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above imports, so the mock fn must be too.
const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

vi.mock('../config/env.js', () => ({
  env: {
    SMTP_HOST: 'smtp.test',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    SMTP_FROM: 'noreply@peoplevate.test',
    CORS_ORIGIN: 'https://app.test',
    SETUP_TOKEN_EXPIRY_HOURS: 48,
    PASSWORD_RESET_TOKEN_EXPIRY_HOURS: 1,
    ACCOUNT_LOCKOUT_DURATION_MIN: 30,
  },
}));

vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../config/logger.js';
import {
  sendClearanceReminderEmail,
  sendDeactivationNotice,
  sendEmail,
  sendEvaluationCycleEmail,
  sendLeaveStatusEmail,
  sendLockoutNotification,
  sendOfferLetterEmail,
  sendPasswordResetEmail,
  sendResignationAck,
  sendSetupEmail,
} from './email-service.js';

/** Grab the payload passed to the most recent sendMail call. */
function lastMail(): { from: string; to: string; subject: string; html: string } {
  return sendMailMock.mock.calls.at(-1)?.[0];
}

describe('email-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockResolvedValue({ messageId: 'msg-1' });
  });

  describe('sendEmail', () => {
    it('sends mail with the configured from address and logs success', async () => {
      await sendEmail('a@example.com', 'Subject', '<p>Body</p>');

      expect(lastMail()).toEqual({
        from: 'noreply@peoplevate.test',
        to: 'a@example.com',
        subject: 'Subject',
        html: '<p>Body</p>',
      });
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith('Email sent to a@example.com: Subject');
    });

    it('swallows transport errors so callers are not blocked', async () => {
      sendMailMock.mockRejectedValue(new Error('smtp down'));

      await expect(sendEmail('a@example.com', 'Subject', '<p>Body</p>')).resolves.toBeUndefined();
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Failed to send email to a@example.com:',
        expect.any(Error),
      );
    });
  });

  it('sendSetupEmail embeds the setup link and expiry', async () => {
    await sendSetupEmail('new@example.com', 'tok-123');

    const mail = lastMail();
    expect(mail.subject).toBe('Set up your Peoplevate account');
    expect(mail.html).toContain('https://app.test/setup?token=tok-123');
    expect(mail.html).toContain('48 hours');
  });

  it('sendPasswordResetEmail embeds the reset link and expiry', async () => {
    await sendPasswordResetEmail('user@example.com', 'reset-9');

    const mail = lastMail();
    expect(mail.subject).toBe('Reset your Peoplevate password');
    expect(mail.html).toContain('https://app.test/reset-password?token=reset-9');
    expect(mail.html).toContain('1 hour(s)');
  });

  it('sendLockoutNotification states the lockout duration', async () => {
    await sendLockoutNotification('locked@example.com');

    const mail = lastMail();
    expect(mail.subject).toBe('Your Peoplevate account has been locked');
    expect(mail.html).toContain('30 minutes');
  });

  it('sendOfferLetterEmail includes candidate name and position', async () => {
    await sendOfferLetterEmail('cand@example.com', 'Ann Lee', 'Senior Engineer');

    const mail = lastMail();
    expect(mail.subject).toBe('Your offer from Peoplevate — Senior Engineer');
    expect(mail.html).toContain('Ann Lee');
    expect(mail.html).toContain('Senior Engineer');
  });

  it('sendLeaveStatusEmail includes the status and leave type', async () => {
    await sendLeaveStatusEmail('emp@example.com', 'Bob Ray', 'APPROVED', 'Annual');

    const mail = lastMail();
    expect(mail.subject).toBe('Leave request APPROVED');
    expect(mail.html).toContain('Bob Ray');
    expect(mail.html).toContain('Annual');
  });

  it('sendEvaluationCycleEmail includes the cycle type', async () => {
    await sendEvaluationCycleEmail('emp@example.com', 'Cat Poe', 'ANNUAL');

    const mail = lastMail();
    expect(mail.subject).toBe('ANNUAL evaluation is open');
    expect(mail.html).toContain('Cat Poe');
  });

  it('sendClearanceReminderEmail names the pending item', async () => {
    await sendClearanceReminderEmail('it@example.com', 'IT Team', 'Return laptop');

    const mail = lastMail();
    expect(mail.subject).toBe('Clearance item reminder');
    expect(mail.html).toContain('Return laptop');
  });

  it('sendDeactivationNotice addresses the employee', async () => {
    await sendDeactivationNotice('ex@example.com', 'Dan Fox');

    const mail = lastMail();
    expect(mail.subject).toBe('Your Peoplevate access has been revoked');
    expect(mail.html).toContain('Dan Fox');
  });

  it('sendResignationAck acknowledges the resignation', async () => {
    await sendResignationAck('emp@example.com', 'Eve Kim');

    const mail = lastMail();
    expect(mail.subject).toBe('Your resignation has been received');
    expect(mail.html).toContain('Eve Kim');
  });
});
