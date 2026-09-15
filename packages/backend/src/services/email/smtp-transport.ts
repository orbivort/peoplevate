import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import type { EmailTransport, MailPayload } from './transport.js';

/**
 * Hard upper bounds on a single SMTP delivery.
 *
 * nodemailer's defaults (2 min connect, 30 s greeting, 10 min socket) are far
 * too generous: a firewall that silently drops outbound SMTP traffic leaves the
 * connection hanging instead of failing fast, which keeps the caller (and any
 * HTTP request awaiting the notification) pending for minutes. Failing within
 * seconds keeps notifications non-blocking in practice.
 */
const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

/**
 * Production transport backed by nodemailer.
 *
 * The nodemailer transporter is created lazily on the first `deliver` call
 * rather than at module load, so merely importing this module never opens a
 * network connection. This is what keeps the existing unit test (which mocks
 * `nodemailer`) and any non-email import path free of SMTP side effects.
 */
export class SmtpTransport implements EmailTransport {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter === null) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
      });
    }
    return this.transporter;
  }

  async deliver(payload: MailPayload): Promise<void> {
    await this.getTransporter().sendMail({
      from: env.SMTP_FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
  }
}
