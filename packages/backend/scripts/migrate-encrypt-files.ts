/**
 * One-time migration script: encrypts existing plaintext document files at rest.
 *
 * Idempotent: skips documents that already have encryption metadata.
 *
 * Usage: npx tsx scripts/migrate-encrypt-files.ts
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import { prisma } from '../src/config/prisma.js';
import { encryptWithKeyVersion } from '../src/utils/crypto.js';
import { getActiveKeyVersion } from '../src/services/key-management-service.js';

async function main(): Promise<void> {
  console.log('Starting file encryption migration...');

  const keyVersion = await getActiveKeyVersion('DATA_ENCRYPTION');
  if (!keyVersion) {
    console.error('No active data-encryption key version found. Run key bootstrap first.');
    process.exit(1);
  }

  const docs = await prisma.document.findMany({
    where: {
      deleted_at: null,
      encryption_key_version_id: null,
    },
  });

  console.log(`Found ${docs.length} plaintext documents to encrypt.`);

  let encrypted = 0;
  let failed = 0;

  for (const doc of docs) {
    try {
      const plaintext = await fs.readFile(doc.file_path);
      const { ciphertext, keyVersionId, iv, tag } = encryptWithKeyVersion(
        plaintext,
        'DATA_ENCRYPTION',
        keyVersion.key_id,
      );

      await fs.writeFile(doc.file_path, ciphertext);

      await prisma.document.update({
        where: { id: doc.id },
        data: {
          encryption_key_version_id: keyVersionId,
          encryption_iv: Buffer.from(iv),
          encryption_tag: Buffer.from(tag),
        },
      });

      encrypted++;
      if (encrypted % 50 === 0) {
        console.log(`  Encrypted ${encrypted}/${docs.length}...`);
      }
    } catch (err) {
      console.error(`  Failed to encrypt document ${doc.id} (${doc.file_path}):`, err);
      failed++;
    }
  }

  console.log(`Migration complete: ${encrypted} encrypted, ${failed} failed.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
