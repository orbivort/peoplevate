import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      employeeId: 'emp-1',
    };
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireRoles: vi.fn(
    (..._roles: unknown[]) =>
      (_req: unknown, _res: unknown, next: () => void) =>
        next(),
  ),
}));

vi.mock('../services/key-management-service.js', () => ({
  listKeyVersions: vi.fn(),
  rotateKey: vi.fn(),
  getKeyRotationStatus: vi.fn(),
}));

import { authenticate } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import * as keyMgmtService from '../services/key-management-service.js';
import { keyManagementRoutes } from './key-management-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listKeyVersions: vi.mocked(keyMgmtService.listKeyVersions),
  rotateKey: vi.mocked(keyMgmtService.rotateKey),
  getKeyRotationStatus: vi.mocked(keyMgmtService.getKeyRotationStatus),
  authenticate: vi.mocked(authenticate),
  requireRoles: vi.mocked(requireRoles),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/keys', keyManagementRoutes);
  app.use(errorHandler);
  return app;
}

const dataEncryptionVersion = {
  id: 'kv-1',
  key_id: 'data_encryption-v1',
  purpose: 'DATA_ENCRYPTION',
  status: 'ACTIVE',
  created_at: new Date('2026-01-01'),
  activated_at: new Date('2026-01-01'),
  retired_at: null,
};

const tokenSigningVersion = {
  id: 'kv-2',
  key_id: 'token_signing-v1',
  purpose: 'TOKEN_SIGNING',
  status: 'ACTIVE',
  created_at: new Date('2026-01-01'),
  activated_at: new Date('2026-01-01'),
  retired_at: null,
};

describe('key-management-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listKeyVersions.mockResolvedValue([]);
    mocked.rotateKey.mockResolvedValue(dataEncryptionVersion as never);
    mocked.getKeyRotationStatus.mockResolvedValue({
      purpose: 'DATA_ENCRYPTION',
      activeVersion: dataEncryptionVersion,
      retiredVersions: [],
      reEncryptionNeeded: false,
    } as never);
  });

  describe('authentication', () => {
    it('rejects requests without the authenticate middleware passing', async () => {
      // Simulate the authenticate middleware blocking the request.
      mocked.authenticate.mockImplementationOnce((_req, res, _next) => {
        res.status(401).json({ error: 'No token provided' });
      });

      const res = await request(buildApp()).get('/api/keys');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('No token provided');
    });
  });

  describe('GET /api/keys', () => {
    it('lists all key versions when no purpose query is given', async () => {
      mocked.listKeyVersions.mockResolvedValue([
        dataEncryptionVersion,
        tokenSigningVersion,
      ] as never);

      const res = await request(buildApp()).get('/api/keys');

      expect(res.status).toBe(200);
      expect(res.body.versions).toHaveLength(2);
      expect(res.body.versions[0]).toMatchObject({ id: 'kv-1', key_id: 'data_encryption-v1' });
      expect(res.body.versions[1]).toMatchObject({ id: 'kv-2', key_id: 'token_signing-v1' });
      expect(mocked.listKeyVersions).toHaveBeenCalledWith(undefined);
    });

    it('filters by purpose when the purpose query is provided', async () => {
      mocked.listKeyVersions.mockResolvedValue([dataEncryptionVersion] as never);

      const res = await request(buildApp()).get('/api/keys?purpose=DATA_ENCRYPTION');

      expect(res.status).toBe(200);
      expect(res.body.versions).toHaveLength(1);
      expect(res.body.versions[0]).toMatchObject({ id: 'kv-1', key_id: 'data_encryption-v1' });
      expect(mocked.listKeyVersions).toHaveBeenCalledWith('DATA_ENCRYPTION');
    });

    it('forwards service errors to the error handler', async () => {
      mocked.listKeyVersions.mockRejectedValue(new Error('db failure'));

      const res = await request(buildApp()).get('/api/keys');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/keys/status', () => {
    it('returns status for both purposes when none is specified', async () => {
      const deStatus = {
        purpose: 'DATA_ENCRYPTION',
        activeVersion: dataEncryptionVersion,
        retiredVersions: [],
        reEncryptionNeeded: false,
      };
      const tsStatus = {
        purpose: 'TOKEN_SIGNING',
        activeVersion: tokenSigningVersion,
        retiredVersions: [],
        reEncryptionNeeded: false,
      };
      mocked.getKeyRotationStatus
        .mockResolvedValueOnce(deStatus as never)
        .mockResolvedValueOnce(tsStatus as never);

      const res = await request(buildApp()).get('/api/keys/status');

      expect(res.status).toBe(200);
      expect(res.body.statuses).toHaveLength(2);
      expect(res.body.statuses[0]).toMatchObject({
        purpose: 'DATA_ENCRYPTION',
        reEncryptionNeeded: false,
      });
      expect(res.body.statuses[0].activeVersion).toMatchObject({ key_id: 'data_encryption-v1' });
      expect(res.body.statuses[1]).toMatchObject({
        purpose: 'TOKEN_SIGNING',
        reEncryptionNeeded: false,
      });
      expect(res.body.statuses[1].activeVersion).toMatchObject({ key_id: 'token_signing-v1' });
      expect(mocked.getKeyRotationStatus).toHaveBeenCalledTimes(2);
      expect(mocked.getKeyRotationStatus).toHaveBeenNthCalledWith(1, 'DATA_ENCRYPTION');
      expect(mocked.getKeyRotationStatus).toHaveBeenNthCalledWith(2, 'TOKEN_SIGNING');
    });

    it('returns status for a single purpose when provided', async () => {
      const deStatus = {
        purpose: 'DATA_ENCRYPTION',
        activeVersion: dataEncryptionVersion,
        retiredVersions: [],
        reEncryptionNeeded: false,
      };
      mocked.getKeyRotationStatus.mockResolvedValue(deStatus as never);

      const res = await request(buildApp()).get('/api/keys/status?purpose=TOKEN_SIGNING');

      expect(res.status).toBe(200);
      expect(res.body.statuses).toHaveLength(1);
      expect(res.body.statuses[0]).toMatchObject({
        purpose: 'DATA_ENCRYPTION',
        reEncryptionNeeded: false,
      });
      expect(res.body.statuses[0].activeVersion).toMatchObject({ key_id: 'data_encryption-v1' });
      expect(mocked.getKeyRotationStatus).toHaveBeenCalledTimes(1);
      expect(mocked.getKeyRotationStatus).toHaveBeenCalledWith('TOKEN_SIGNING');
    });

    it('forwards service errors to the error handler', async () => {
      mocked.getKeyRotationStatus.mockRejectedValue(new Error('status failure'));

      const res = await request(buildApp()).get('/api/keys/status');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/keys/rotate', () => {
    it('rotates a key for a valid purpose and returns the new version', async () => {
      const newVersion = { ...dataEncryptionVersion, id: 'kv-3', key_id: 'data_encryption-v2' };
      mocked.rotateKey.mockResolvedValue(newVersion as never);

      const res = await request(buildApp())
        .post('/api/keys/rotate')
        .send({ purpose: 'DATA_ENCRYPTION' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe(
        'Key rotated successfully. Update the corresponding env var and run the re-encryption script.',
      );
      expect(res.body.newVersion).toMatchObject({
        id: 'kv-3',
        key_id: 'data_encryption-v2',
        purpose: 'DATA_ENCRYPTION',
        status: 'ACTIVE',
        retired_at: null,
      });
      expect(mocked.rotateKey).toHaveBeenCalledWith(
        'DATA_ENCRYPTION',
        'admin-1',
        'admin@example.com',
      );
    });

    it('returns 400 when purpose is missing', async () => {
      const res = await request(buildApp()).post('/api/keys/rotate').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid purpose');
      expect(mocked.rotateKey).not.toHaveBeenCalled();
    });

    it('returns 400 when purpose is an invalid value', async () => {
      const res = await request(buildApp()).post('/api/keys/rotate').send({ purpose: 'BOGUS' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid purpose');
      expect(mocked.rotateKey).not.toHaveBeenCalled();
    });

    it('returns 400 when purpose is the wrong type (number)', async () => {
      const res = await request(buildApp()).post('/api/keys/rotate').send({ purpose: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid purpose');
      expect(mocked.rotateKey).not.toHaveBeenCalled();
    });

    it('forwards service errors to the error handler', async () => {
      mocked.rotateKey.mockRejectedValue(new Error('rotate failure'));

      const res = await request(buildApp())
        .post('/api/keys/rotate')
        .send({ purpose: 'TOKEN_SIGNING' });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });
});
