import { describe, expect, it } from 'vitest';

import {
  decrypt,
  decryptWithKeyVersion,
  encrypt,
  encryptWithKeyVersion,
  maskValue,
  resolveKey,
} from './crypto';

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext value', () => {
    const ciphertext = encrypt('super-secret-value');
    expect(ciphertext).not.toContain('super-secret-value');
    expect(decrypt(ciphertext)).toBe('super-secret-value');
  });

  it('produces unique ciphertexts for the same input (random IV)', () => {
    const a = encrypt('same-value');
    const b = encrypt('same-value');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it('throws on malformed ciphertext', () => {
    expect(() => decrypt('not-a-valid-ciphertext')).toThrow('Invalid ciphertext format');
  });
});

describe('versioned-key encrypt / decrypt', () => {
  it('round-trips a buffer with a key version', () => {
    const payload = encryptWithKeyVersion(
      Buffer.from('file-content', 'utf8'),
      'DATA_ENCRYPTION',
      'kv-001',
    );
    expect(payload.keyVersionId).toBe('kv-001');
    const decrypted = decryptWithKeyVersion(
      payload.ciphertext,
      'DATA_ENCRYPTION',
      payload.keyVersionId,
      payload.iv,
      payload.tag,
    );
    expect(decrypted.toString('utf8')).toBe('file-content');
  });

  it('throws when the authentication tag is tampered with', () => {
    const payload = encryptWithKeyVersion('sensitive', 'DATA_ENCRYPTION', 'kv-001');
    payload.tag[0] ^= 0xff;
    expect(() =>
      decryptWithKeyVersion(
        payload.ciphertext,
        'DATA_ENCRYPTION',
        payload.keyVersionId,
        payload.iv,
        payload.tag,
      ),
    ).toThrow();
  });

  it('resolves a key for either purpose', () => {
    const dataKey = resolveKey('DATA_ENCRYPTION', 'any');
    const tokenKey = resolveKey('TOKEN_SIGNING', 'any');
    expect(dataKey.length).toBe(32);
    expect(tokenKey.length).toBe(32);
  });
});

describe('maskValue', () => {
  it('returns an empty string for nullish values', () => {
    expect(maskValue(null)).toBe('');
    expect(maskValue(undefined)).toBe('');
    expect(maskValue('')).toBe('');
  });

  it('fully redacts values with no partial disclosure (GDPR)', () => {
    // The GDPR hardening task removed partial redaction — no characters are visible.
    expect(maskValue('12345678')).toBe('••••••••');
    expect(maskValue('ab')).toBe('••••••••');
  });

  it('ignores the visible-characters argument for full redaction', () => {
    expect(maskValue('12345678', 2)).toBe('••••••••');
  });
});
