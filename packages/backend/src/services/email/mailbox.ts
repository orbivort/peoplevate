import type { MailPayload } from './transport.js';

/**
 * In-memory, observable outbox used by the mock email transport.
 *
 * In `EMAIL_MODE=mock`, every message that `email-service.ts` would deliver via
 * SMTP is instead written to this mailbox, so tests and E2E runs can assert
 * "what would have been sent" without making any network calls.
 */
export class Mailbox {
  private messages: MailPayload[] = [];

  push(payload: MailPayload): void {
    this.messages.push({ ...payload });
  }

  all(): MailPayload[] {
    return this.messages.map((m) => ({ ...m }));
  }

  findByRecipient(to: string): MailPayload[] {
    return this.all().filter((m) => m.to === to);
  }

  findBySubject(subject: string): MailPayload[] {
    return this.all().filter((m) => m.subject === subject);
  }

  clear(): void {
    this.messages = [];
  }

  get size(): number {
    return this.messages.length;
  }
}

/** Shared singleton injected into the mock transport so tests can observe it. */
export const mailbox = new Mailbox();
