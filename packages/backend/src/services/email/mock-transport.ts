import type { Mailbox } from './mailbox.js';
import type { EmailTransport, MailPayload } from './transport.js';

/**
 * Zero-network transport for dev and test environments.
 *
 * Every delivered payload is appended to the shared in-process `Mailbox`, which
 * tests and E2E runs can inspect to verify the email that would have been sent
 * over SMTP.
 */
export class MockTransport implements EmailTransport {
  constructor(private readonly target: Mailbox) {}

  async deliver(payload: MailPayload): Promise<void> {
    this.target.push(payload);
  }
}
