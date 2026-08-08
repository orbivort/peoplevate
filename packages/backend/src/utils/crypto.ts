import crypto from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32; // AES-256

/**
 * Derives the AES-256 key directly from the configured secret (first 32 bytes as UTF-8).
 * The secret MUST be >= 32 characters. This replaces the legacy unkeyed SHA-256 derivation.
 */
function getKeyBytes(secret: string): Buffer {
  const buf = Buffer.from(secret, 'utf8');
  if (buf.length < KEY_LENGTH) {
    throw new Error(
      `Encryption key must be at least ${KEY_LENGTH} bytes (got ${buf.length}). ` +
        'Set FIELD_ENCRYPTION_KEY to a string of at least 32 characters.',
    );
  }
  return buf.subarray(0, KEY_LENGTH);
}

/**
 * Legacy key derivation using unkeyed SHA-256. Retained ONLY for decrypting
 * data encrypted before the key-management refactor. New encryption uses direct key bytes.
 */
function getLegacyKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/** Returns the active key bytes for a given purpose. */
function getActiveKey(purpose: KeyPurpose): Buffer {
  const secret = purpose === 'DATA_ENCRYPTION' ? env.FIELD_ENCRYPTION_KEY : env.JWT_SECRET;
  return getKeyBytes(secret);
}

/**
 * Resolves key bytes for a specific key version ID. Since key material is
 * env-sourced in this phase, all versions of a purpose map to the same env
 * secret. When rotation occurs, the operator updates the env and runs the
 * re-encryption script to migrate data to the new key.
 */
export function resolveKey(purpose: KeyPurpose, _keyVersionId: string): Buffer {
  return getActiveKey(purpose);
}

// ──────────────────────────────────────────────
// Legacy field-level encrypt/decrypt (backward compatible)
// Format: iv:tag:ciphertext (all hex)
// ──────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-256-GCM with the active data-encryption key.
 * Uses direct key bytes (not SHA-256 derivation).
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getActiveKey('DATA_ENCRYPTION'), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a ciphertext string. Tries the new direct-key method first;
 * falls back to the legacy SHA-256 key for data encrypted before the refactor.
 */
export function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Invalid ciphertext format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  // Try new direct-key decryption first
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getActiveKey('DATA_ENCRYPTION'), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Fall back to legacy SHA-256 key for pre-refactor data
    const decipher = crypto.createDecipheriv(ALGORITHM, getLegacyKey(env.FIELD_ENCRYPTION_KEY), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }
}

// ──────────────────────────────────────────────
// Versioned-key encrypt/decrypt (for file encryption and new field encryption)
// ──────────────────────────────────────────────

export type KeyPurpose = 'DATA_ENCRYPTION' | 'TOKEN_SIGNING';

export interface EncryptedPayload {
  ciphertext: Buffer;
  keyVersionId: string;
  iv: Buffer;
  tag: Buffer;
}

/**
 * Encrypts a plaintext buffer with AES-256-GCM using the active key version
 * for the given purpose. Returns the ciphertext along with the key version ID,
 * IV, and authentication tag for storage and later decryption.
 */
export function encryptWithKeyVersion(
  plaintext: Buffer | string,
  purpose: KeyPurpose,
  keyVersionId: string,
): EncryptedPayload {
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = resolveKey(purpose, keyVersionId);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, keyVersionId, iv, tag };
}

/**
 * Decrypts a ciphertext buffer with AES-256-GCM using the key version
 * identified by keyVersionId. Throws on authentication tag mismatch (tampering).
 */
export function decryptWithKeyVersion(
  ciphertext: Buffer,
  purpose: KeyPurpose,
  keyVersionId: string,
  iv: Buffer,
  tag: Buffer,
): Buffer {
  const key = resolveKey(purpose, keyVersionId);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

// ──────────────────────────────────────────────
// Masking utility
// ──────────────────────────────────────────────

/**
 * Fully redacts a value, returning a redaction marker with no partial disclosure.
 * GDPR compliance: national ID must be fully redacted for non-authorized roles.
 */
export function maskValue(value: string | null | undefined, _visibleChars = 0): string {
  if (!value) return '';
  return '•'.repeat(8);
}
