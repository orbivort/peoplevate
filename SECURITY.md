# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in
Peoplevate, please report it responsibly.

**Do NOT open a public issue for security vulnerabilities.** Instead, please
email the maintainers at https://github.com/orbivort/peoplevate/issues with the following details:

- A description of the vulnerability and its impact
- Steps to reproduce (if applicable)
- Affected versions / components

We will acknowledge your report within a reasonable timeframe and work with you
to understand and address it. We will not share your details without permission.

## Security Highlights

- PII and salary data are **encrypted at rest** (AES-256) using
  `FIELD_ENCRYPTION_KEY`. Plaintext passwords, salaries, and national IDs are
  never logged or stored.
- Passwords are hashed with **argon2**; JWT secrets and encryption keys require
  at least 32 characters and are environment-only (never committed).
- **RBAC** is enforced on both frontend routes and backend middleware.
- Every mutation records an **AuditLog** entry (CREATE / UPDATE / DELETE /
  LOGIN / LOGOUT).

## Responsible Disclosure

If you follow responsible disclosure (above), we will not take legal action
against you regarding your report, provided you act in good faith and do not
access or destroy data beyond what is necessary to demonstrate the issue.
