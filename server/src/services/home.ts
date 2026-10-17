import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env.js';
import { TrackerAdmin } from './trackerAdmin.js';

export interface Home {
  lat: number;
  lon: number;
}
export type HomeSource = 'hub.env' | 'tracker' | null;

const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000; // until the tracker has answered once (it may still be starting)
const valid = (lat: unknown, lon: unknown): lat is number =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/**
 * Where home is, for the radar and the maps.
 *
 * HOME_LAT / HOME_LON in hub.env win. Without them, the hub uses the home
 * location saved in the plane tracker's settings (Settings → Plane tracker →
 * Location), so it only has to be entered once.
 */
export class HomeLocation {
  private value: Home | null;
  private from: HomeSource;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    env: Env,
    private readonly log?: FastifyBaseLogger,
    private readonly admin: TrackerAdmin = new TrackerAdmin(env.TRACKER_URL),
  ) {
    const fromEnv = valid(env.HOME_LAT, env.HOME_LON);
    this.value = fromEnv ? { lat: env.HOME_LAT, lon: env.HOME_LON } : null;
    this.from = fromEnv ? 'hub.env' : null;
  }

  get(): Home | null {
    return this.value;
  }

  get source(): HomeSource {
    return this.from;
  }

  /** Called when home becomes known or changes. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Re-read the tracker's home location (no-op when hub.env sets it). */
  async refresh(): Promise<void> {
    if (this.from === 'hub.env' || !this.admin.configured) return;
    try {
      const { config } = await this.admin.getSettings();
      const loc = config.location;
      const pair = typeof loc === 'object' && loc !== null ? (loc as Record<string, unknown>).location_home : null;
      const [lat, lon] = Array.isArray(pair) ? (pair as unknown[]) : [];
      if (!valid(lat, lon) || typeof lon !== 'number') return;
      const next = { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
      if (this.value?.lat === next.lat && this.value.lon === next.lon) return;
      this.value = next;
      this.from = 'tracker';
      this.log?.info('home location taken from the plane tracker settings');
      for (const fn of this.listeners) fn();
    } catch {
      // Tracker not up yet; try again on the next refresh.
    }
  }

  start(): void {
    if (this.from === 'hub.env' || !this.admin.configured || this.timer) return;
    this.stopped = false;
    const loop = (): void => {
      void this.refresh().finally(() => {
        if (!this.stopped) this.timer = setTimeout(loop, this.value ? REFRESH_MS : RETRY_MS);
      });
    };
    loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
