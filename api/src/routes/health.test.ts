import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as client from '#db/client';
import type { HealthBody } from '#routes/health';
import { app } from '#server';

const originalDatabaseUrl = process.env.DATABASE_URL;

async function readHealth(): Promise<HealthBody> {
  const response = await app.request('/health');
  expect(response.status).toBe(200);
  return (await response.json()) as HealthBody;
}

describe('GET /health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('answers with the status and the database state', async () => {
    const body = await readHealth();
    expect(body.status).toBeTypeOf('string');
    expect(body.database).toBeTypeOf('string');
    expect(body.version).toBeTypeOf('string');
  });

  it('is degraded when the database cannot be reached', async () => {
    process.env.DATABASE_URL = 'postgresql://nobody:nobody@127.0.0.1:1/none';
    const body = await readHealth();
    expect(body.status).toBe('degraded');
    expect(body.database).toBe('down');
  });

  it('is ok when the database answers', async () => {
    vi.spyOn(client, 'isDatabaseReachable').mockResolvedValue(true);
    const body = await readHealth();
    expect(body.status).toBe('ok');
    expect(body.database).toBe('up');
  });
});
