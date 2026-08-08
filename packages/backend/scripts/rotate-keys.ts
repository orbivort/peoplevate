/**
 * Key rotation script: creates a new active key version for a purpose,
 * retires the previous one, and prompts the operator to update the env.
 *
 * Usage: npx tsx scripts/rotate-keys.ts <purpose>
 *   purpose: data-encryption | token-signing
 */
import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { KeyPurpose, KeyStatus } from '#prisma';

async function main(): Promise<void> {
  const purposeArg = process.argv[2]?.toUpperCase();
  if (!purposeArg || !['DATA_ENCRYPTION', 'TOKEN_SIGNING'].includes(purposeArg)) {
    console.error('Usage: npx tsx scripts/rotate-keys.ts <data-encryption|token-signing>');
    process.exit(1);
  }
  const purpose = purposeArg as KeyPurpose;

  const current = await prisma.encryptionKeyVersion.findFirst({
    where: { purpose, status: KeyStatus.ACTIVE },
  });

  const nextVersionNumber = current
    ? parseInt(current.key_id.match(/-v(\d+)$/)?.[1] ?? '0', 10) + 1
    : 1;
  const newKeyId = `${purpose.toLowerCase()}-v${nextVersionNumber}`;

  const result = await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.encryptionKeyVersion.update({
        where: { id: current.id },
        data: { status: KeyStatus.RETIRED, retired_at: new Date() },
      });
    }
    return tx.encryptionKeyVersion.create({
      data: { key_id: newKeyId, purpose, status: KeyStatus.ACTIVE },
    });
  });

  console.log(`Key rotated successfully.`);
  console.log(`  New active key: ${result.key_id}`);
  console.log(`  Previous key:  ${current?.key_id ?? 'none'}`);
  console.log('');
  console.log('IMPORTANT: Update the corresponding env var with the new secret:');
  console.log(
    purpose === KeyPurpose.DATA_ENCRYPTION
      ? '  FIELD_ENCRYPTION_KEY=<new-secret-at-least-32-chars>'
      : '  JWT_SECRET=<new-secret-at-least-32-chars>',
  );
  console.log('Then run: npx tsx scripts/re-encrypt-data.ts');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Key rotation failed:', err);
  process.exit(1);
});
