import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { notifications } from '#db/schema';
import { notificationHub, type AppNotification } from '#events';
import { requireSession, type AppEnv } from '#auth/session';
import type { DatabaseProvider } from '#routes/common';

/** The heartbeat that keeps the connection open through the proxies. */
const HEARTBEAT_MS = 25_000;

/** The event stream of a user: the unread notifications and the ones to come. */
export function eventsRoutes(provider: DatabaseProvider) {
  const app = new Hono<AppEnv>();

  app.get('/events', requireSession(provider), (c) => {
    const user = c.get('user');
    const database = provider();

    return streamSSE(c, async (stream) => {
      const write = (notification: AppNotification) => {
        void stream
          .writeSSE({ event: notification.type, data: JSON.stringify(notification) })
          .catch(() => undefined);
      };

      const unsubscribe = notificationHub.subscribe(user.id, write);
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => undefined);
      }, HEARTBEAT_MS);

      // The stream lives until the browser goes away, and then it cleans up.
      const closed = new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat);
          unsubscribe();
          resolve();
        });
      });

      const pending = await database
        .select({
          id: notifications.id,
          type: notifications.type,
          reportId: notifications.reportId,
          payload: notifications.payload,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

      // The stream carries them, so they are read from now on.
      if (pending.length > 0) {
        await database
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
      }
      for (const row of pending) {
        await stream.writeSSE({
          event: row.type,
          data: JSON.stringify({
            id: row.id,
            type: row.type,
            reportId: row.reportId,
            payload: row.payload,
            createdAt: row.createdAt.getTime(),
          }),
        });
      }

      await closed;
    });
  });

  return app;
}
