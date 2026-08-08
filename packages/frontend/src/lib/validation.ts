// Lightweight validation helpers (no external dep) used by Formik via validate().
// Kept intentionally simple for the prototype.

export const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  if (!value) return 'Email is required.';
  if (!emailRe.test(value)) return 'Enter a valid email address.';
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required.';
  if (value.length < 8) return 'Must be at least 8 characters.';
}

export function validateRequired(value: string, label = 'This field'): string | undefined {
  if (!value || !value.trim()) return `${label} is required.`;
}

/**
 * Enforces the password policy from FR-003 / NFR 8.2:
 * min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special.
 */
export function validatePasswordPolicy(value: string): string | undefined {
  if (!value) return 'Password is required.';
  if (value.length < 8) return 'Must be at least 8 characters.';
  if (!/[A-Z]/.test(value)) return 'Must include an uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Must include a lowercase letter.';
  if (!/[0-9]/.test(value)) return 'Must include a number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Must include a special character.';
}

export function validatePasswordMatch(value: string, other: string): string | undefined {
  if (value !== other) return 'Passwords do not match.';
}

export function validateDate(value: string, label = 'Date'): string | undefined {
  if (!value) return `${label} is required.`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return `Enter a valid ${label.toLowerCase()}.`;
}
