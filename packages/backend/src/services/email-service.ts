import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { buildTransport } from './email/transport.js';

// The transport is resolved once at startup. In `EMAIL_MODE=mock` it writes to
// an in-process mailbox (zero network I/O); otherwise it uses nodemailer over
// SMTP. Building it lazily inside the transport keeps module load side-effect
// free.
const transport = buildTransport(env.EMAIL_MODE);

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    await transport.deliver({ to, subject, html });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Failed to send email to ${to}:`, err);
    // Don't throw — email failure should not block the operation
  }
}

export function sendSetupEmail(to: string, setupToken: string): Promise<void> {
  const url = `${env.CORS_ORIGIN}/setup?token=${setupToken}`;
  const html = `
    <h2>Welcome to Peoplevate</h2>
    <p>Your account has been created. Please set your password to activate your account.</p>
    <p><a href="${url}">Set your password</a></p>
    <p>This link expires in ${env.SETUP_TOKEN_EXPIRY_HOURS} hours.</p>
    <p>If you did not expect this email, please contact HR.</p>
  `;
  return sendEmail(to, 'Set up your Peoplevate account', html);
}

export function sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
  const url = `${env.CORS_ORIGIN}/reset-password?token=${resetToken}`;
  const html = `
    <h2>Password Reset Request</h2>
    <p>You requested a password reset. Click the link below to set a new password.</p>
    <p><a href="${url}">Reset your password</a></p>
    <p>This link expires in ${env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS} hour(s).</p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;
  return sendEmail(to, 'Reset your Peoplevate password', html);
}

export function sendLockoutNotification(to: string): Promise<void> {
  const html = `
    <h2>Account Locked</h2>
    <p>Your Peoplevate account has been locked due to too many failed login attempts.</p>
    <p>Please try again in ${env.ACCOUNT_LOCKOUT_DURATION_MIN} minutes, or contact HR to reset your password.</p>
  `;
  return sendEmail(to, 'Your Peoplevate account has been locked', html);
}

// ──────────────────────────────────────────────
// Phase 2: Workflow notification templates
// ──────────────────────────────────────────────

export function sendOfferLetterEmail(
  to: string,
  candidateName: string,
  position: string,
): Promise<void> {
  const html = `
    <h2>Offer of Employment</h2>
    <p>Dear ${candidateName},</p>
    <p>Congratulations! Peoplevate is pleased to offer you the position of <strong>${position}</strong>.</p>
    <p>Please log in to the candidate portal to review your offer letter and respond.</p>
  `;
  return sendEmail(to, `Your offer from Peoplevate — ${position}`, html);
}

export function sendLeaveStatusEmail(
  to: string,
  employeeName: string,
  status: string,
  leaveType: string,
): Promise<void> {
  const html = `
    <h2>Leave Request Update</h2>
    <p>Dear ${employeeName},</p>
    <p>Your ${leaveType} leave request has been <strong>${status}</strong>.</p>
    <p>Please check your leave balance and dashboard for details.</p>
  `;
  return sendEmail(to, `Leave request ${status}`, html);
}

export function sendEvaluationCycleEmail(
  to: string,
  employeeName: string,
  cycleType: string,
): Promise<void> {
  const html = `
    <h2>Performance Evaluation Open</h2>
    <p>Dear ${employeeName},</p>
    <p>The <strong>${cycleType}</strong> evaluation period is now open.</p>
    <p>Please complete your self-evaluation by the deadline.</p>
  `;
  return sendEmail(to, `${cycleType} evaluation is open`, html);
}

export function sendClearanceReminderEmail(
  to: string,
  assigneeName: string,
  item: string,
): Promise<void> {
  const html = `
    <h2>Clearance Item Reminder</h2>
    <p>Dear ${assigneeName},</p>
    <p>You have a pending clearance item: <strong>${item}</strong>.</p>
    <p>Please complete or sign off on it to proceed with offboarding.</p>
  `;
  return sendEmail(to, 'Clearance item reminder', html);
}

export function sendDeactivationNotice(to: string, employeeName: string): Promise<void> {
  const html = `
    <h2>Access Revoked</h2>
    <p>Dear ${employeeName},</p>
    <p>Your Peoplevate access has been revoked. Contact HR if you believe this is in error.</p>
  `;
  return sendEmail(to, 'Your Peoplevate access has been revoked', html);
}

export function sendResignationAck(to: string, employeeName: string): Promise<void> {
  const html = `
    <h2>Resignation Received</h2>
    <p>Dear ${employeeName},</p>
    <p>We have received your resignation. Your Manager and HR have been notified for acknowledgment.</p>
    <p>An offboarding process will begin shortly.</p>
  `;
  return sendEmail(to, 'Your resignation has been received', html);
}
