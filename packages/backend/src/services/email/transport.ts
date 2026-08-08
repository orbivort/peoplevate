import { SmtpTransport } from './smtp-transport.js';
import { MockTransport } from './mock-transport.js';
import { mailbox } from './mailbox.js';

/**
 * The normalized shape of an email handed to a transport. Keeping this minimal
 * keeps both transports and the templates in `email-service.ts` simple.
 */
export interface MailPayload {
  to: string;
  subject: string;
  html: string;
}

/**
 * Strategy seam: any transport knows how to deliver a single email. The public
 * API of `email-service.ts` only depends on this interface, so swapping between
 * real SMTP and a mock becomes a one-line factory decision.
 */
export interface EmailTransport {
  deliver(payload: MailPayload): Promise<void>;
}

/**
 * Resolves the transport implementation from the `EMAIL_MODE` switch.
 *
 * - `real` (default, also used when the mode is missing/`undefined`) → SMTP via
 *   nodemailer, preserving production behavior.
 * - `mock` → in-process mailbox with zero network I/O.
 */
export function buildTransport(mode: string | undefined): EmailTransport {
  if (mode === 'mock') {
    return new MockTransport(mailbox);
  }
  return new SmtpTransport();
}
