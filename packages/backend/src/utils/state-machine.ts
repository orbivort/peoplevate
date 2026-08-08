import type { Prisma } from '#prisma';
import { PrismaClient, AuditAction, AuditEntity } from '#prisma';
import { prisma } from '../config/prisma.js';
import { withAuditContext } from './audit-context.js';

/**
 * A transition map defines the allowed target states from a given current state.
 * Each value is an array of state strings.
 */
export type TransitionMap = Record<string, string[]>;

/**
 * Thrown when a state transition is not allowed by the configured transition map.
 */
export class InvalidTransitionError extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`Invalid transition for ${entity}: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Validates that a transition from `from` to `to` is allowed by the map.
 * Throws InvalidTransitionError if not allowed.
 */
export function assertTransition(
  entity: string,
  map: TransitionMap,
  from: string,
  to: string,
): void {
  const allowed = map[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
}

/**
 * Runs a state transition inside a transaction with audit support.
 * Sets the audit context (actor) before the update so the DB trigger records
 * the actor, then returns the updated row. All transitions must be audited.
 */
export async function transitionEntity<T>(args: {
  entity: AuditEntity;
  action: AuditAction;
  entityId: string;
  from: string;
  to: string;
  map: TransitionMap;
  actorId: string;
  actorName: string;
  update: (tx: Prisma.TransactionClient) => Promise<T>;
  note?: string;
}): Promise<T> {
  const { entity, action, entityId, from, to, map, actorId, actorName, update, note } = args;

  assertTransition(entity, map, from, to);

  return withAuditContext(prisma, actorId, actorName, async (tx) => {
    const result = await update(tx as unknown as PrismaClient);

    // Application-level audit entry for the transition with old/new status.
    await tx.auditLog.create({
      data: {
        actor_id: actorId,
        actor_name: actorName,
        action,
        entity,
        entity_id: entityId,
        old_value: { status: from, note: note ?? null } as Prisma.InputJsonValue,
        new_value: { status: to, note: note ?? null } as Prisma.InputJsonValue,
      },
    });

    return result;
  });
}
