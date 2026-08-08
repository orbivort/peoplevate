import { PrismaClient } from '#prisma';

/**
 * Wraps a Prisma transaction with audit context set.
 */
export async function withAuditContext<T>(
  prisma: PrismaClient,
  actorId: string | null,
  actorName: string | null,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.actor_id', ${actorId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_name', ${actorName ?? ''}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}
