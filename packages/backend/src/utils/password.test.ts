import { describe, expect, it } from 'vitest';

import { hashPassword, validatePasswordPolicy, verifyPassword } from './password';

describe('validatePasswordPolicy', () => {
  it('accepts a password that meets every rule', () => {
    const result = validatePasswordPolicy('Str0ng!Pass');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a password that is too short', () => {
    const result = validatePasswordPolicy('Ab1!');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must be at least 8 characters');
  });

  it('reports every violated rule', () => {
    const result = validatePasswordPolicy('alllowercase');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Password must contain at least 1 uppercase letter',
        'Password must contain at least 1 number',
        'Password must contain at least 1 special character',
      ]),
    );
  });
});

describe('hashPassword / verifyPassword', () => {
  it('verifies a hash produced from the same password', async () => {
    const hash = await hashPassword('Str0ng!Pass');
    expect(hash).not.toBe('Str0ng!Pass');
    await expect(verifyPassword(hash, 'Str0ng!Pass')).resolves.toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const hash = await hashPassword('Str0ng!Pass');
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });
});
