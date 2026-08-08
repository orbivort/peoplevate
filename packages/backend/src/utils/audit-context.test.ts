import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '#prisma';
import { withAuditContext } from './audit-context.js';

/** Minimal Prisma double that runs the transaction callback against a fake tx. */
function buildPrisma(): {
  client: PrismaClient;
  executeRaw: ReturnType<typeof vi.fn>;
  tx: { $executeRaw: ReturnType<typeof vi.fn> };
} {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const tx = { $executeRaw: executeRaw, marker: 'tx' };
  const client = {
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaClient;
  return { client, executeRaw, tx };
}

describe('withAuditContext', () => {
  it('sets actor config and returns the callback result', async () => {
    const { client, executeRaw } = buildPrisma();

    const result = await withAuditContext(client, 'u-1', 'Jane Doe', async () => 'done');

    expect(result).toBe('done');
    expect(executeRaw).toHaveBeenCalledTimes(2);
    // Tagged-template values are passed as the interpolated arguments.
    expect(executeRaw.mock.calls[0]?.slice(1)).toContain('u-1');
    expect(executeRaw.mock.calls[1]?.slice(1)).toContain('Jane Doe');
  });

  it('falls back to empty strings when actor details are null', async () => {
    const { client, executeRaw } = buildPrisma();

    await withAuditContext(client, null, null, async () => null);

    expect(executeRaw.mock.calls[0]?.slice(1)).toContain('');
    expect(executeRaw.mock.calls[1]?.slice(1)).toContain('');
  });

  it('passes the transaction client into the callback', async () => {
    const { client, tx } = buildPrisma();
    const callback = vi.fn().mockResolvedValue('ok');

    await withAuditContext(client, 'u-1', 'Jane', callback);

    expect(callback).toHaveBeenCalledWith(tx);
  });

  it('propagates errors thrown by the callback', async () => {
    const { client } = buildPrisma();

    await expect(
      withAuditContext(client, 'u-1', 'Jane', async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
  });
});
