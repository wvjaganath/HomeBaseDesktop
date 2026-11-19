import { z } from 'zod';
import type { DB } from '../db.js';
import { lanBaseUrlWith } from './hubSettings.js';

/**
 * Settings → House: the machines whose health the hub shows (each runs
 * node_exporter), extra Bluetooth listeners for Govee room sensors, and when
 * to raise an alert. Stored in the database like the rest of the hub's
 * settings (key 'house' in hub_settings); temperatures are kept in °C.
 */

const required = (schema: ReturnType<typeof lanBaseUrlWith>) => schema.refine((v) => v !== '', 'Enter an address');

export const machineSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
  name: z.string().trim().min(1, 'Give it a name').max(40),
  /** node_exporter's base address, e.g. http://192.168.1.20:9100 */
  url: required(lanBaseUrlWith('Use the machine’s home-network address with node_exporter’s port, like http://192.168.1.20:9100')),
  kind: z.enum(['pc', 'pi']),
  /** Optional: Cockpit (or another admin page) for this machine, opened in a new tab. */
  cockpitUrl: lanBaseUrlWith('Use a home-network address, like https://192.168.1.20:9090'),
});
export type MachineConfig = z.infer<typeof machineSchema>;

export const houseSettingsSchema = z.strictObject({
  machines: z.array(machineSchema).max(12, 'Up to 12 machines'),
  /** Govee Bluetooth listeners on other machines (e.g. a Pi near far-away sensors). */
  listeners: z.array(required(lanBaseUrlWith('Use the listener’s home-network address, like http://192.168.1.41:8686'))).max(4),
  /** Seconds between machine readings. */
  pollSec: z.union([z.literal(10), z.literal(15), z.literal(30), z.literal(60)]),
  alerts: z.strictObject({
    offlineMin: z.number().int().min(1).max(60),
    cpuTempMaxC: z.number().min(40).max(110),
    diskPct: z.number().int().min(50).max(99),
    memPct: z.number().int().min(50).max(99),
    /** null = no alert. */
    roomMaxC: z.number().min(-20).max(60).nullable(),
    roomMinC: z.number().min(-30).max(50).nullable(),
    humidityMax: z.number().int().min(30).max(100).nullable(),
    batteryMin: z.number().int().min(0).max(50),
    sensorStaleMin: z.number().int().min(5).max(240),
  }),
});
export type HouseSettings = z.infer<typeof houseSettingsSchema>;

export const HOUSE_DEFAULTS: HouseSettings = {
  machines: [],
  listeners: [],
  pollSec: 15,
  alerts: {
    offlineMin: 2,
    cpuTempMaxC: 70,
    diskPct: 90,
    memPct: 90,
    roomMaxC: null,
    roomMinC: null,
    humidityMax: 65,
    batteryMin: 15,
    sensorStaleMin: 30,
  },
};

export class HouseSettingsService {
  private current: HouseSettings;
  private readonly listeners = new Set<(next: HouseSettings) => void>();

  constructor(private readonly db: DB) {
    const row = db.prepare(`SELECT value FROM hub_settings WHERE key = 'house'`).get() as { value: string } | undefined;
    let loaded: HouseSettings = HOUSE_DEFAULTS;
    if (row) {
      try {
        const raw = JSON.parse(row.value) as Partial<HouseSettings>;
        // Keys added by a later version fall back to their defaults.
        const parsed = houseSettingsSchema.safeParse({ ...HOUSE_DEFAULTS, ...raw, alerts: { ...HOUSE_DEFAULTS.alerts, ...raw.alerts } });
        if (parsed.success) loaded = parsed.data;
      } catch {
        loaded = HOUSE_DEFAULTS;
      }
    }
    this.current = loaded;
  }

  get values(): HouseSettings {
    return this.current;
  }

  onChange(fn: (next: HouseSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(input: unknown, by: string): HouseSettings {
    const next = houseSettingsSchema.parse(input);
    const ids = new Set(next.machines.map((m) => m.id));
    if (ids.size !== next.machines.length) throw new z.ZodError([{ code: 'custom', path: ['machines'], message: 'Two machines have the same id', input }]);
    this.db
      .prepare(
        `INSERT INTO hub_settings (key, value, updated_at, updated_by) VALUES ('house', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(JSON.stringify(next), new Date().toISOString(), by);
    this.current = next;
    for (const fn of this.listeners) fn(next);
    return next;
  }
}
