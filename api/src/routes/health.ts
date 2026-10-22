import { Hono } from 'hono';
import { isDatabaseReachable } from '#db/client';
import pkg from '../../../package.json' with { type: 'json' };

export type DatabaseProbe = () => Promise<boolean>;

export type HealthBody = {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  version: string;
};

const defaultProbe: DatabaseProbe = async () => isDatabaseReachable();

export function healthRoutes(probe: DatabaseProbe = defaultProbe) {
  return new Hono().get('/health', async (c) => {
    const up = await probe();
    const body: HealthBody = {
      status: up ? 'ok' : 'degraded',
      database: up ? 'up' : 'down',
      version: pkg.version,
    };
    return c.json(body);
  });
}
