import { z } from 'zod';
import { FetchError, safeFetch } from '../security/safeFetch.js';

/**
 * Settings for the LED plane tracker (c0wsaysmoo/plane-tracker-rgb-pi), edited
 * from HomeBase and saved on the tracker through its own /api/config, exactly
 * like the tracker's /config page does.
 *
 * The schema mirrors what that page sends (web/templates/config.html,
 * collectConfig) with the same allowed values. The hub validates everything
 * before it reaches the tracker, and merges it over the tracker's current file
 * so settings the page doesn't show (for example route_cache) are kept.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const pct = z.number().int().min(0).max(100);
const code = z.string().regex(/^[A-Z0-9]{3,4}$/, 'Use a 3–4 letter airport code');
const callsign = z.string().regex(/^[A-Z0-9-]{1,10}$/, 'Callsigns are letters, digits and dashes');
// Checked label by label (no backtracking-prone regex on user input).
const isHostname = (v: string): boolean =>
  v.length <= 253 && v.split('.').every((l) => l.length >= 1 && l.length <= 63 && /^[A-Za-z0-9-]+$/.test(l) && !l.startsWith('-') && !l.endsWith('-'));
const hostname = z.string().max(253).refine(isHostname, 'Use a hostname like plane-clock or plane-clock.local');
const isLatLon = (v: string): boolean => {
  const parts = v.split(',').map((p) => p.trim());
  if (parts.length !== 2) return false;
  if (parts.some((p) => p === '' || p.length > 20)) return false;
  const [a, b] = parts.map(Number);
  return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
};
// A slave tracker takes its master as a Pi hostname (-> http://<name>.local:8080)
// or a full base URL, e.g. HomeBase's feed http://192.168.1.20:8081.
const isMasterUrl = (v: string): boolean => {
  if (v.length > 200 || !/^https?:\/\//.test(v)) return false;
  try {
    const u = new URL(v);
    return u.username === '' && u.password === '' && (u.pathname === '/' || u.pathname === '') && u.search === '' && u.hash === '' && !v.endsWith('/');
  } catch {
    return false;
  }
};
const masterTracker = z
  .string()
  .max(253)
  .refine((v) => v === '' || isHostname(v) || isMasterUrl(v), 'Use a hostname like plane-clock, or a base URL like http://192.168.1.20:8081');
// API keys: printable, no spaces. Masked values from the tracker ("abcd****wxyz")
// pass through unchanged and the tracker keeps the stored key.
const secret = z.string().max(300).regex(/^[\x21-\x7e]*$/, 'Keys can’t contain spaces');

export const SOURCES = ['AirLabs', 'FlightAware', 'FR24'] as const;

export const trackerSettingsSchema = z.strictObject({
  config: z.strictObject({
    location: z.strictObject({
      journey_code: code,
      clock_format: z.enum(['12hr', '24hr']),
      temperature_units: z.enum(['imperial', 'metric']),
      distance_units: z.enum(['imperial', 'metric', 'nautical']),
      speed_units: z.enum(['imperial', 'metric', 'knots']),
      location_home: z.tuple([lat, lon]),
      temperature_location: z.string().max(60).refine((v) => v === '' || isLatLon(v), 'Use “lat, lon”'),
      zone_home: z.strictObject({ tl_y: lat, tl_x: lon, br_y: lat, br_x: lon }),
    }),
    display: z.strictObject({
      brightness: pct,
      brightness_night: pct,
      night_brightness: z.boolean(),
      night_start: hhmm,
      night_end: hhmm,
      // The page offers 1–3; allow a little more so a hand-edited value isn't rejected.
      gpio_slowdown: z.number().int().min(0).max(5),
      hat_pwm_enabled: z.boolean(),
      led_rgb_sequence: z.enum(['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR']),
      forecast_days: z.number().int().min(1).max(5),
      forecast_mode: z.enum(['daily', 'hourly', 'scheduled']),
      forecast_hourly_start: hhmm,
      forecast_hourly_end: hhmm,
    }),
    flights: z.strictObject({
      min_altitude: z.number().int().min(0).max(60_000),
      max_farthest: z.number().int().min(1).max(10),
      max_closest: z.number().int().min(1).max(10),
      email: z.union([z.literal(''), z.email().max(254)]),
      blocked_callsigns: z.array(callsign).max(500),
      airport_status_list: z
        .string()
        .max(500)
        .refine((v) => v === '' || v.split(', ').every((c) => /^[A-Z0-9]{3,4}$/.test(c)), 'Comma-separated airport codes'),
      weather_alerts_enabled: z.boolean(),
      iss_alerts_enabled: z.boolean(),
    }),
    stats: z.strictObject({ stats_log_days: z.number().int().min(0).max(36_500) }),
    master_slave: z.strictObject({
      master_tracker: masterTracker,
      other_tracker_hostnames: z.array(hostname).max(20),
    }),
    api_sources: z.strictObject({
      order: z
        .array(z.enum(SOURCES))
        .length(SOURCES.length)
        .refine((o) => new Set(o).size === o.length, 'Each source once'),
      enabled: z.strictObject({ AirLabs: z.boolean(), FlightAware: z.boolean(), FR24: z.boolean() }),
      airlabs_reset_day: z.number().int().min(1).max(31),
      flightaware_reset_day: z.number().int().min(1).max(31),
      fr24_reset_day: z.number().int().min(1).max(31),
    }),
  }),
  secrets: z.strictObject({
    tomorrow_api_key: secret,
    opensky_client_id: secret,
    opensky_client_secret: secret,
    airlabs_api_keys: z.array(secret.min(1)).max(20),
    flightaware_api_keys: z.array(secret.min(1)).max(20),
    flightaware_monthly_limit: z.number().min(0).max(1000),
    flightradar24_key: secret,
  }),
});
export type TrackerSettings = z.infer<typeof trackerSettingsSchema>;

/** Wi-Fi join request (forwarded to the tracker's nmcli wrapper). */
export const wifiConnectSchema = z.strictObject({
  ssid: z.string().trim().min(1).max(32),
  password: z.string().max(63).default(''),
});

const looseObject = z.record(z.string(), z.unknown());
const trackerConfigResponse = z.looseObject({ config: looseObject.default({}), secrets: looseObject.default({}) });

export class TrackerAdminError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'unreachable' | 'rejected',
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON with object keys in a fixed order, so equal settings compare equal. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
function pickKeys(o: Json, keys: string[]): Json {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

/** New values over the tracker's current file, one section deep (keeps unknown keys). */
export function mergeTrackerConfig(current: Json, next: Json): Json {
  const out: Json = { ...current };
  for (const [section, values] of Object.entries(next)) {
    const prev = current[section];
    out[section] = isObj(prev) && isObj(values) ? { ...prev, ...values } : values;
  }
  return out;
}

/** A tracker request's result: status, parsed JSON (or null) and the raw text. */
export interface TrackerReply {
  status: number;
  body: unknown;
  text: string;
}

/**
 * Base for talking to a plane tracker's Flask app. Subclasses call fixed,
 * literal paths only, and only on the configured base URL's host (it comes
 * from hub settings and must never come from a request).
 */
export class TrackerClient<P extends string> {
  private readonly host: string;

  constructor(
    private readonly baseUrl: string,
    /** Shown when the address is missing, e.g. "TRACKER_URL isn’t set". */
    private readonly missing = 'TRACKER_URL isn’t set',
    private readonly what = 'the plane tracker',
    /** Addresses typed into Settings: home-network addresses only. */
    private readonly lanOnly = false,
  ) {
    this.host = baseUrl ? new URL(baseUrl).hostname : '';
  }

  get configured(): boolean {
    return this.baseUrl !== '';
  }

  protected async call(
    path: P,
    opts: { method?: 'GET' | 'POST'; json?: unknown; timeoutMs?: number; maxBytes?: number } = {},
  ): Promise<TrackerReply> {
    if (!this.configured) throw new TrackerAdminError(this.missing, 'not_configured');
    try {
      const res = await safeFetch(`${this.baseUrl}${path}`, {
        allowHosts: [this.host],
        allowHttp: true,
        allowPrivate: true, // the tracker lives on the LAN / Docker network by design
        lanOnly: this.lanOnly,
        timeoutMs: opts.timeoutMs ?? 8_000,
        maxBytes: opts.maxBytes ?? 1024 * 1024,
        method: opts.method ?? 'GET',
        json: opts.json,
        allowErrorStatus: true,
      });
      let body: unknown = null;
      try {
        body = JSON.parse(res.bodyText) as unknown;
      } catch {
        body = null;
      }
      return { status: res.status, body, text: res.bodyText };
    } catch (err) {
      const why = err instanceof FetchError || err instanceof Error ? err.message : 'unknown error';
      throw new TrackerAdminError(`Couldn’t reach ${this.what} (${why})`, 'unreachable');
    }
  }
}

type AdminPath = '/api/config' | '/api/restart' | '/api/system' | '/api/usage' | '/api/wifi/status' | '/api/wifi/scan' | '/api/wifi/connect';

/** The tracker's admin endpoints (settings, restart, status, Wi-Fi). */
export class TrackerAdmin extends TrackerClient<AdminPath> {
  async getSettings(): Promise<{ config: Json; secrets: Json }> {
    const r = await this.call('/api/config');
    const parsed = trackerConfigResponse.safeParse(r.body);
    if (r.status !== 200 || !parsed.success) throw new TrackerAdminError('The tracker sent an unexpected reply', 'unreachable');
    return { config: parsed.data.config, secrets: parsed.data.secrets };
  }

  /**
   * Saves the settings and says whether anything changed. The tracker's flight
   * loop reads its settings only when it starts (its web app, which receives
   * the save, is a separate process), so a change needs a restart to apply.
   */
  async saveSettings(next: TrackerSettings): Promise<{ changed: boolean }> {
    const current = await this.getSettings();
    const config = mergeTrackerConfig(current.config, next.config);
    // Secrets come back masked ("abcd****wxyz"); a value equal to what the
    // tracker showed is unchanged, anything else is new.
    const changed = !sameJson(config, current.config) || !sameJson(next.secrets, pickKeys(current.secrets, Object.keys(next.secrets)));
    const r = await this.call('/api/config', { method: 'POST', json: { config, secrets: next.secrets } });
    const body = isObj(r.body) ? r.body : {};
    if (r.status !== 200 || body.ok !== true) {
      const errors = Array.isArray(body.errors) ? body.errors.filter((e): e is string => typeof e === 'string').join('; ') : '';
      throw new TrackerAdminError(errors || `The tracker refused the settings (HTTP ${r.status})`, 'rejected');
    }
    return { changed };
  }

  async restart(): Promise<void> {
    const r = await this.call('/api/restart', { method: 'POST' });
    if (r.status !== 200) throw new TrackerAdminError(`The tracker didn’t restart (HTTP ${r.status})`, 'rejected');
  }

  async status(): Promise<{ system: unknown; usage: unknown }> {
    const [system, usage] = await Promise.all([this.call('/api/system'), this.call('/api/usage')]);
    return { system: system.status === 200 ? system.body : null, usage: usage.status === 200 ? usage.body : null };
  }

  async wifiStatus(): Promise<unknown> {
    const r = await this.call('/api/wifi/status', { timeoutMs: 20_000 });
    return r.body;
  }

  async wifiScan(): Promise<unknown> {
    const r = await this.call('/api/wifi/scan', { timeoutMs: 30_000 });
    return r.body;
  }

  async wifiConnect(input: z.infer<typeof wifiConnectSchema>): Promise<{ status: number; body: unknown }> {
    // nmcli can take up to 30 s; the tracker answers "switched" if the Pi moved networks.
    return this.call('/api/wifi/connect', { method: 'POST', json: input, timeoutMs: 40_000 });
  }
}
