import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above imports, so the mock fns must be too.
const { sendMailMock, createTransportMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

vi.mock('../../config/env.js', () => ({
  env: {
    SMTP_HOST: 'smtp.test',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    SMTP_FROM: 'noreply@peoplevate.test',
  },
}));

import { buildTransport } from './transport.js';
import { mailbox, Mailbox } from './mailbox.js';
import { SmtpTransport } from './smtp-transport.js';
import { MockTransport } from './mock-transport.js';

describe('buildTransport', () => {
  it('resolves real mode to an SMTP transport', () => {
    expect(buildTransport('real')).toBeInstanceOf(SmtpTransport);
  });

  it('resolves mock mode to a mock transport', () => {
    expect(buildTransport('mock')).toBeInstanceOf(MockTransport);
  });

  it('resolves an undefined mode to an SMTP transport (safe default)', () => {
    expect(buildTransport(undefined)).toBeInstanceOf(SmtpTransport);
  });

  it('resolves an empty/unknown mode to an SMTP transport', () => {
    expect(buildTransport('')).toBeInstanceOf(SmtpTransport);
    expect(buildTransport('smtp')).toBeInstanceOf(SmtpTransport);
  });
});

describe('SmtpTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockResolvedValue({ messageId: 'msg-1' });
  });

  it('builds the transporter lazily and delivers via sendMail', async () => {
    const transport = new SmtpTransport();
    expect(createTransportMock).not.toHaveBeenCalled();

    await transport.deliver({ to: 'a@example.com', subject: 'Hi', html: '<p>Body</p>' });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.test',
      port: 587,
      secure: false,
      auth: { user: 'user', pass: 'pass' },
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@peoplevate.test',
      to: 'a@example.com',
      subject: 'Hi',
      html: '<p>Body</p>',
    });
  });

  it('reuses a single transporter across deliveries', async () => {
    const transport = new SmtpTransport();
    await transport.deliver({ to: 'a@example.com', subject: 'S1', html: 'x' });
    await transport.deliver({ to: 'b@example.com', subject: 'S2', html: 'y' });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });
});

describe('MockTransport + Mailbox', () => {
  beforeEach(() => {
    mailbox.clear();
  });

  it('records delivered payloads into the shared mailbox', async () => {
    const transport = new MockTransport(mailbox);
    await transport.deliver({ to: 'a@example.com', subject: 'S1', html: '<p>1</p>' });
    await transport.deliver({ to: 'a@example.com', subject: 'S2', html: '<p>2</p>' });
    await transport.deliver({ to: 'b@example.com', subject: 'S3', html: '<p>3</p>' });

    expect(mailbox.size).toBe(3);
    expect(mailbox.findByRecipient('a@example.com')).toHaveLength(2);
    expect(mailbox.findBySubject('S2')).toEqual([
      { to: 'a@example.com', subject: 'S2', html: '<p>2</p>' },
    ]);
  });

  it('returns copies so callers cannot mutate stored messages', async () => {
    const local = new Mailbox();
    await new MockTransport(local).deliver({ to: 'a@example.com', subject: 'S1', html: 'x' });

    const snapshot = local.all();
    snapshot[0].subject = 'tampered';

    expect(local.all()[0].subject).toBe('S1');
  });
});
