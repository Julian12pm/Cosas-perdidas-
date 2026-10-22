import { EventEmitter } from 'node:events';
import type { JsonRecord } from '#db/schema';

/** A notification as the browser receives it on the event stream. */
export interface AppNotification {
  id: string;
  type: string;
  reportId: string | null;
  payload: JsonRecord;
  createdAt: number;
}

/**
 * The in-process fan-out.
 *
 * Every API process keeps its own hub, so a notification reaches the browsers
 * connected to the process that wrote it.
 */
class NotificationHub {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(0);
  }

  /** Pushes a notification to every stream of the user. */
  publish(userId: string, notification: AppNotification): void {
    this.#emitter.emit(`user:${userId}`, notification);
  }

  /** Subscribes to the notifications of a user and returns the unsubscribe. */
  subscribe(userId: string, listener: (notification: AppNotification) => void): () => void {
    const channel = `user:${userId}`;
    this.#emitter.on(channel, listener);
    return () => {
      this.#emitter.off(channel, listener);
    };
  }
}

/** The hub every route module and the event stream share. */
export const notificationHub = new NotificationHub();
