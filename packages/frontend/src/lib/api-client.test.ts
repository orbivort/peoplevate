import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const authStorage = vi.hoisted(() => {
  const state = {
    accessToken: 'acc' as string | null,
    refreshToken: 'ref' as string | null,
  };
  return {
    state,
    getAccessToken: vi.fn(() => state.accessToken),
    getRefreshToken: vi.fn(() => state.refreshToken),
    clear: vi.fn(() => {
      state.accessToken = null;
      state.refreshToken = null;
    }),
    setSession: vi.fn((accessToken: string, refreshToken: string) => {
      state.accessToken = accessToken;
      state.refreshToken = refreshToken;
    }),
    getStoredUser: vi.fn(),
  };
});

vi.mock('@/lib/auth-storage', () => ({
  authStorage,
  getTokens: vi.fn(),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  setAccessToken: vi.fn(),
}));

import { api } from './api-client';

describe('api-client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authStorage.state.accessToken = 'acc';
    authStorage.state.refreshToken = 'ref';
    fetchMock = vi.fn();
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function okJson(body: unknown, status = 200) {
    const text = JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => text,
    } as Response;
  }

  it('sends authenticated GET with default headers', async () => {
    fetchMock.mockResolvedValue(await okJson({ ok: true }));
    await api.get('/api/x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/x');
    expect(opts.method).toBe('GET');
    expect(opts.headers.get('Authorization')).toBe('Bearer acc');
  });

  it('omits auth header when auth:false', async () => {
    fetchMock.mockResolvedValue(await okJson({}));
    await api.get('/api/public', { auth: false });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.get('Authorization')).toBeNull();
  });

  it('serializes JSON bodies for post/put/patch', async () => {
    fetchMock.mockResolvedValue(await okJson({ id: 1 }));
    await api.post('/api/y', { a: 1 });
    await api.put('/api/y', { b: 2 });
    await api.patch('/api/y', { c: 3 });
    const methods = fetchMock.mock.calls.map((c) => c[1].method);
    expect(methods).toEqual(['POST', 'PUT', 'PATCH']);
    fetchMock.mock.calls.forEach((c) => {
      expect(JSON.parse(c[1].body)).toBeTruthy();
    });
  });

  it('supports no-body methods (DELETE)', async () => {
    fetchMock.mockResolvedValue(await okJson({}));
    await api.del('/api/z/1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/z/1');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('parses JSON error responses into an Error with details', async () => {
    fetchMock.mockResolvedValue(await okJson({ error: 'bad', details: { f: 'req' } }, 400));
    await expect(api.get('/api/err')).rejects.toThrow('bad');
  });

  it('retries on 401 once after a successful refresh', async () => {
    const fail = await okJson({ error: 'unauthorized' }, 401);
    const refreshOk = await okJson({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      user: null,
    });
    const success = await okJson({ ok: true });
    // Call order: main (401) -> refresh (200) -> retry main (success).
    fetchMock
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(refreshOk)
      .mockResolvedValueOnce(success);
    const result = await api.get('/api/sec');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.get('Authorization')).toBe('Bearer new-access');
    expect(result).toEqual({ ok: true });
  });

  it('throws when refresh fails (no refresh token)', async () => {
    authStorage.state.accessToken = null;
    authStorage.state.refreshToken = null;
    fetchMock.mockResolvedValue(await okJson({ error: 'unauthorized' }, 401));
    await expect(api.get('/api/sec')).rejects.toThrow('unauthorized');
  });

  it('throws when a non-JSON error body is returned', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
      text: async () => 'Internal Server Error',
    } as Response);
    await expect(api.get('/api/boom')).rejects.toThrow('Request failed');
  });

  it('clears tokens when refresh returns 401', async () => {
    authStorage.state.accessToken = 'a';
    authStorage.state.refreshToken = 'r';
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return okJson({ error: 'invalid' }, 401);
      }
      return okJson({ error: 'unauthorized' }, 401);
    });
    await expect(api.get('/api/sec')).rejects.toThrow();
  });
});
