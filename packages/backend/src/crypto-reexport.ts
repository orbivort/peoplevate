/**
 * Re-exports crypto and key-status utilities for scripts that operate outside
 * the normal service layer (e.g. `scripts/re-encrypt-data.ts`).
 *
 * Keeping these imports in a single module avoids pulling in the full service
 * graph and keeps the scripts' dependency surface minimal.
 */
export { encrypt, decrypt, encryptWithKeyVersion, decryptWithKeyVersion } from './utils/crypto.js';
export type { KeyPurpose, EncryptedPayload } from './utils/crypto.js';
export { KeyStatus } from '#prisma';
