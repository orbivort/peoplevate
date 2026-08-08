import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/prisma.js';
import { logAuditEvent } from './audit-service.js';
import {
  bootstrapKeyVersions,
  getActiveKeyVersion,
  getKeyRotationStatus,
  listKeyVersions,
  rotateKey,
} from './key-management-service.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    encryptionKeyVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

const m = {
  findFirst: vi.mocked(prisma.encryptionKeyVersion.findFirst),
  findMany: vi.mocked(prisma.encryptionKeyVersion.findMany),
  create: vi.mocked(prisma.encryptionKeyVersion.create),
  update: vi.mocked(prisma.encryptionKeyVersion.update),
  $transaction: vi.mocked(prisma.$transaction),
  logAuditEvent: vi.mocked(logAuditEvent),
};

const actor = { actorId: 'u-1', actorName: 'Jane' };

describe('key-management-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('bootstrapKeyVersions', () => {
    it('creates default active versions when none exist', async () => {
      m.findFirst.mockResolvedValue(null);
      m.create.mockResolvedValue({ id: 'kv-1' } as never);

      await bootstrapKeyVersions();

      expect(m.create).toHaveBeenCalledTimes(2);
      expect(m.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ key_id: 'data_encryption-v1', status: 'ACTIVE' }),
      });
      expect(m.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ key_id: 'token_signing-v1', status: 'ACTIVE' }),
      });
    });

    it('skips creation when an active version already exists', async () => {
      m.findFirst.mockResolvedValue({ id: 'kv-1' } as never);
      await bootstrapKeyVersions();
      expect(m.create).not.toHaveBeenCalled();
    });
  });

  describe('rotateKey', () => {
    it('creates v2 and retires v1 for DATA_ENCRYPTION', async () => {
      m.findFirst.mockResolvedValue({ id: 'kv-1', key_id: 'data_encryption-v1' } as never);
      m.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        const tx = {
          encryptionKeyVersion: { update: m.update, create: m.create },
        } as never;
        const result = await fn(tx as typeof prisma);
        return result;
      });
      m.update.mockResolvedValue({} as never);
      m.create.mockResolvedValue({
        id: 'kv-2',
        key_id: 'data_encryption-v2',
        purpose: 'DATA_ENCRYPTION',
      } as never);

      const result = await rotateKey('DATA_ENCRYPTION', actor.actorId, actor.actorName);

      expect(m.update).toHaveBeenCalledWith({
        where: { id: 'kv-1' },
        data: expect.objectContaining({ status: 'RETIRED', retired_at: expect.any(Date) }),
      });
      expect(m.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ key_id: 'data_encryption-v2', status: 'ACTIVE' }),
      });
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entity: 'KEYS' }),
      );
      expect(result.key_id).toBe('data_encryption-v2');
    });
  });

  describe('getKeyRotationStatus', () => {
    it('flags re-encryption as needed when retired versions exist', async () => {
      m.findMany.mockResolvedValue([
        { id: 'kv-1', status: 'RETIRED', purpose: 'DATA_ENCRYPTION' },
        { id: 'kv-2', status: 'ACTIVE', purpose: 'DATA_ENCRYPTION' },
      ] as never);

      const status = await getKeyRotationStatus('DATA_ENCRYPTION');
      expect(status.reEncryptionNeeded).toBe(true);
      expect(status.activeVersion?.id).toBe('kv-2');
      expect(status.retiredVersions).toHaveLength(1);
    });

    it('does not flag re-encryption when no retired versions exist', async () => {
      m.findMany.mockResolvedValue([
        { id: 'kv-1', status: 'ACTIVE', purpose: 'DATA_ENCRYPTION' },
      ] as never);

      const status = await getKeyRotationStatus('DATA_ENCRYPTION');
      expect(status.reEncryptionNeeded).toBe(false);
    });
  });

  describe('getActiveKeyVersion / listKeyVersions', () => {
    it('returns the active version ordered by activation date', async () => {
      m.findFirst.mockResolvedValue({ id: 'kv-1' } as never);
      await getActiveKeyVersion('TOKEN_SIGNING');
      expect(m.findFirst).toHaveBeenCalledWith({
        where: { purpose: 'TOKEN_SIGNING', status: 'ACTIVE' },
        orderBy: { activated_at: 'desc' },
      });
    });

    it('filters by purpose when provided', async () => {
      m.findMany.mockResolvedValue([] as never);
      await listKeyVersions('DATA_ENCRYPTION');
      expect(m.findMany).toHaveBeenCalledWith({
        where: { purpose: 'DATA_ENCRYPTION' },
        orderBy: { created_at: 'desc' },
      });
    });
  });
});
