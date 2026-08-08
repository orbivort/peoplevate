import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { env } from './env.js';

// Dedicated transport for email activity. Alongside the console, every email-send
// attempt is appended to <LOG_DIR>/email.log so operations can review what was
// sent (or failed) — especially useful when EMAIL_MODE=mock, where there is no
// SMTP server to inspect. Only email-related messages are written to the file;
// all other log lines remain console-only.
const emailOnly = winston.format((info) =>
  typeof info.message === 'string' &&
  (info.message.startsWith('Email sent to ') || info.message.startsWith('Failed to send email to '))
    ? info
    : false,
)();

function createEmailFileTransport(): winston.transports.FileTransportInstance | null {
  try {
    // winston's File transport does not create the directory, so ensure it
    // exists up front. If the directory cannot be created, fall back to
    // console-only logging rather than crashing the app.
    fs.mkdirSync(env.LOG_DIR, { recursive: true });
  } catch {
    return null;
  }
  return new winston.transports.File({
    filename: path.join(env.LOG_DIR, 'email.log'),
    format: winston.format.combine(
      emailOnly,
      winston.format.errors({ stack: true }),
      winston.format.timestamp(),
      winston.format.json(),
    ),
  });
}

const emailFileTransport = createEmailFileTransport();

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'peoplevate-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
    // Only add the file transport when the directory was created successfully.
    ...(emailFileTransport ? [emailFileTransport] : []),
  ],
});
