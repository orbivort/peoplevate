import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const app = createApp();

describe('GET /health', () => {
  it('responds with an ok status and a timestamp', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });
});

describe('unknown routes', () => {
  it('returns 404 with the route in the error body', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining('/api/does-not-exist') });
  });
});
