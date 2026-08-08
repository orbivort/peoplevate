/**
 * Demo accounts created by `packages/backend/prisma/seed.ts`. These are the
 * only credentials guaranteed to exist after a fresh seed of the E2E database.
 *
 * Keep in sync with the seed script's log output. They power the cross-role
 * journeys (employee submits leave → manager approves, etc.).
 */
export const ACCOUNTS = {
  admin: { email: 'admin@example.com', password: 'Admin@12345!', role: 'ADMIN' },
  hr: { email: 'hr@example.com', password: 'HR@12345!', role: 'HR_MANAGER' },
  manager: { email: 'manager@example.com', password: 'Manager@12345!', role: 'MANAGER' },
  employee: { email: 'employee@example.com', password: 'Employee@12345!', role: 'EMPLOYEE' },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;
