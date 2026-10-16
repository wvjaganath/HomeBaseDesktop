import { EventEmitter } from 'node:events';

/** Events pushed to open screens over SSE (see routes/stream.ts). */
export interface HubEvents {
  /** Plane tracker state changed (overhead flights, weather, alerts, tracked flight). */
  tracker: { version: number };
  /** New radar snapshot available. */
  radar: { version: number };
  /** Synced items changed for these users (notes, reminders, workouts…). */
  items: { userIds: string[] };
  /** Calendar events refreshed for this user. */
  calendar: { userId: string };
  /** A kiosk's settings changed or a reload was requested. */
  device: { deviceId: string; action: 'settings' | 'reload' | 'revoked' };
}

export type HubEventName = keyof HubEvents;

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // One listener per open SSE connection; a household has a handful.
    this.emitter.setMaxListeners(200);
  }

  emit<K extends HubEventName>(name: K, payload: HubEvents[K]): void {
    this.emitter.emit(name, payload);
  }

  on<K extends HubEventName>(name: K, listener: (payload: HubEvents[K]) => void): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }

  listenerCount(name: HubEventName): number {
    return this.emitter.listenerCount(name);
  }
}
