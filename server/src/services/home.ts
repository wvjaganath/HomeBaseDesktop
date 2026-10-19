import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env.js';
import { settingsFromEnv, type SettingsView } from './hubSettings.js';
import { TrackerAdmin } from './trackerAdmin.js';

export interface Home {
  lat: number;
  lon: number;
}
export type HomeSource = 'tracker' | 'settings' | null;
/** The plane tracker's box (its zone_home): planes inside it are "overhead". */
export interface Zone {
  top: number;
  left: number;
  bottom: number;
  right: number;
}
export type Units = 'imperial' | 'metric';

const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000; // until the tracker has answered once (it may still be starting)
/** A usable box: real numbers, top above bottom, left west of right, and not absurdly big. */
export function parseZone(z: unknown): Zone | null {
  if (typeof z !== 'object' || z === null) return null;
  const { tl_y: top, tl_x: left, br_y: bottom, br_x: right } = z as Record<string, unknown>;
  const nums = [top, left, bottom, right];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [t, l, b, r] = nums as [number, number, number, number];
  if (Math.abs(t) > 90 || Math.abs(b) > 90 || Math.abs(l) > 180 || Math.abs(r) > 180) return null;
  if (!(t > b && r > l) || t - b > 5 || r - l > 5) return null;
  return { top: t, left: l, bottom: b, right: r };
}

const valid = (lat: unknown, lon: unknown): lat is number =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/**
 * Where home is and which units to use, for the radar, maps and screens.
 *
 * One place to set them: the plane tracker's settings (Settings → Plane
 * tracker → Location), which the tracker needs anyway. Without a tracker, the
 * hub's own Settings → General values are used.
 */
export class HomeLocation {
  private fromTracker: { home: Home | null; units: Units | null; zone: Zone | null } = { home: null, units: null, zone: null };
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly listeners = new Set<() => void>();
  private readonly settings: SettingsView;
  private last = '';

  constructor(
    env: Env,
    private readonly log?: FastifyBaseLogger,
    settings?: SettingsView,
    private readonly admin: TrackerAdmin = new TrackerAdmin(env.TRACKER_URL),
  ) {
    this.settings = settings ?? settingsFromEnv(env);
    this.last = this.key();
  }

  /** True when a plane tracker is set up, so its Location settings lead. */
  get trackerLeads(): boolean {
    return this.admin.configured;
  }

  get(): Home | null {
    return this.fromTracker.home ?? this.settings().home;
  }

  get units(): Units {
    return this.fromTracker.units ?? this.settings().units;
  }

  /** The plane tracker's box, when it has a valid one. */
  get zone(): Zone | null {
    return this.fromTracker.zone;
  }

  get source(): HomeSource {
    if (this.fromTracker.home) return 'tracker';
    return this.settings().home ? 'settings' : null;
  }

  private key(): string {
    const h = this.get();
    const z = this.zone;
    return `${h ? `${h.lat},${h.lon}` : '-'}|${this.units}|${z ? `${z.top},${z.left},${z.bottom},${z.right}` : '-'}`;
  }

  /** Called when home or units change. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Tell listeners if the effective values moved (after a refresh or a settings save). */
  notify(): void {
    const k = this.key();
    if (k === this.last) return;
    this.last = k;
    for (const fn of this.listeners) fn();
  }

  /** Re-read the tracker's Location settings. */
  async refresh(): Promise<void> {
    if (!this.admin.configured) return;
    try {
      const { config } = await this.admin.getSettings();
      const loc = typeof config.location === 'object' && config.location !== null ? (config.location as Record<string, unknown>) : {};
      const [lat, lon] = Array.isArray(loc.location_home) ? (loc.location_home as unknown[]) : [];
      const home = valid(lat, lon) && typeof lon === 'number' ? { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) } : null;
      // The tracker also has "nautical"; the screens show miles for that.
      const units: Units | null = loc.distance_units === 'metric' ? 'metric' : loc.distance_units === 'imperial' || loc.distance_units === 'nautical' ? 'imperial' : null;
      const wasEmpty = !this.fromTracker.home;
      this.fromTracker = { home, units, zone: parseZone(loc.zone_home) };
      if (home && wasEmpty) this.log?.info('home location taken from the plane tracker settings');
      this.notify();
    } catch {
      // Tracker not up yet; keep what we had and try again.
    }
  }

  start(): void {
    if (!this.admin.configured || this.timer) return;
    this.stopped = false;
    const loop = (): void => {
      void this.refresh().finally(() => {
        if (!this.stopped) this.timer = setTimeout(loop, this.fromTracker.home ? REFRESH_MS : RETRY_MS);
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
