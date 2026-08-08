/**
 * Re-encryption script: re-encrypts all field-level encrypted data and files
 * with the new active key version after a key rotation.
 *
 * Usage: npx tsx scripts/re-encrypt-data.ts
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import { prisma } from '../src/config/prisma.js';
import { encrypt, decrypt, encryptWithKeyVersion, KeyStatus } from '../src/crypto-reexport.js';
import { getActiveKeyVersion } from '../src/services/key-management-service.js';

async function main(): Promise<void> {
  console.log('Starting re-encryption...');

  const activeKey = await getActiveKeyVersion('DATA_ENCRYPTION');
  if (!activeKey) {
    console.error('No active data-encryption key version found.');
    process.exit(1);
  }
  console.log(`Active key version: ${activeKey.key_id}`);

  // Re-encrypt employee field-level data (national_id, salary)
  const employees = await prisma.employee.findMany({
    where: {
      OR: [{ national_id_encrypted: { not: null } }, { salary_encrypted: { not: null } }],
    },
    select: { id: true, national_id_encrypted: true, salary_encrypted: true },
  });

  let fieldCount = 0;
  for (const emp of employees) {
    const updates: Record<string, string | null> = {};
    if (emp.national_id_encrypted) {
      const plaintext = decrypt(emp.national_id_encrypted);
      updates.national_id_encrypted = encrypt(plaintext);
      fieldCount++;
    }
    if (emp.salary_encrypted) {
      const plaintext = decrypt(emp.salary_encrypted);
      updates.salary_encrypted = encrypt(plaintext);
      fieldCount++;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.employee.update({ where: { id: emp.id }, data: updates });
    }
  }
  console.log(`Re-encrypted ${fieldCount} field-level values.`);

  // Re-encrypt files
  const docs = await prisma.document.findMany({
    where: { deleted_at: null, encryption_key_version_id: { not: activeKey.key_id } },
  });

  let fileCount = 0;
  for (const doc of docs) {
    if (!doc.encryption_key_version_id || !doc.encryption_iv || !doc.encryption_tag) continue;
    try {
      const ciphertext = await fs.readFile(doc.file_path);
      const { decryptWithKeyVersion } = await import('../src/utils/crypto.js');
      const plaintext = decryptWithKeyVersion(
        ciphertext,
        'DATA_ENCRYPTION',
        doc.encryption_key_version_id,
        Buffer.from(doc.encryption_iv),
        Buffer.from(doc.encryption_tag),
      );
      const {
        ciphertext: newCipher,
        keyVersionId,
        iv,
        tag,
      } = encryptWithKeyVersion(plaintext, 'DATA_ENCRYPTION', activeKey.key_id);
      await fs.writeFile(doc.file_path, newCipher);
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          encryption_key_version_id: keyVersionId,
          encryption_iv: Buffer.from(iv),
          encryption_tag: Buffer.from(tag),
        },
      });
      fileCount++;
    } catch (err) {
      console.error(`  Failed to re-encrypt file for document ${doc.id}:`, err);
    }
  }
  console.log(`Re-encrypted ${fileCount} files.`);
  console.log('Re-encryption complete.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Re-encryption failed:', err);
  process.exit(1);
});
