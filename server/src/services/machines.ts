import type { FastifyBaseLogger } from 'fastify';
import { FetchError, safeFetch } from '../security/safeFetch.js';
import type { HouseSettingsService, MachineConfig } from './houseSettings.js';
import { parseNodeMetrics, rate, throttleFlags, type NodeReading } from './promText.js';

/**
 * Health of the house's machines (the hub's PC and the Pis), read from
 * node_exporter on each one over the home network. Only the addresses saved
 * in Settings → House are contacted, only on the LAN (safeFetch lanOnly), and
 * only GET /metrics. Readings stay in memory: the last hour, for the graphs.
 */

const HISTORY_MS = 60 * 60_000;
const MAX_METRICS_BYTES = 4 * 1024 * 1024;

export interface MachinePoint {
  t: number;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  tempC: number | null;
}

export interface MachineStatus {
  id: string;
  name: string;
  kind: 'pc' | 'pi';
  cockpitUrl: string;
  /** The host part of the saved address, for display. */
  host: string;
  online: boolean;
  /** When it last answered (ISO), null if never. */
  lastSeenAt: string | null;
  /** Since when it hasn't answered (ISO), while offline. */
  offlineSince: string | null;
  error: string | null;
  uptimeSec: number | null;
  cpuPct: number | null;
  cores: number;
  memUsed: number | null;
  memTotal: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  tempC: number | null;
  load: [number, number, number] | null;
  netRxBps: number | null;
  netTxBps: number | null;
  os: string | null;
  hostname: string | null;
  arch: string | null;
  /** Raspberry Pi power state (only with the optional textfile script). */
  power: { underVoltageNow: boolean; throttledNow: boolean; underVoltageSinceBoot: boolean; throttledSinceBoot: boolean } | null;
}

interface State {
  config: MachineConfig;
  last: NodeReading | null;
  prev: NodeReading | null;
  lastSeenAt: number | null;
  offlineSince: number | null;
  error: string | null;
  history: MachinePoint[];
}

const pct = (part: number | null, whole: number | null): number | null =>
  part !== null && whole !== null && whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** What a person should read when a machine can't be reached. */
function describe(err: unknown): string {
  if (err instanceof FetchError) {
    if (err.status === 404) return 'node_exporter answered, but not at /metrics';
    if (err.status) return `node_exporter answered with an error (${err.status})`;
    if (err.message.startsWith('not a home-network address')) return 'That address isn’t on your home network';
    if (err.message === 'response too large') return 'node_exporter’s answer was too large';
    return err.message;
  }
  const e = (typeof err === 'object' && err !== null ? err : {}) as { name?: string; cause?: { code?: string } };
  const code = e.cause?.code;
  if (e.name === 'TimeoutError') return 'No answer within 5 seconds';
  if (code === 'ECONNREFUSED') return 'Connection refused: is node_exporter running, and port 9100 open?';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'The machine can’t be reached (off, or a different network?)';
  if (code === 'ENOTFOUND') return 'That name can’t be found on the network';
  return 'Couldn’t read it';
}

export async function readMachine(url: string): Promise<NodeReading> {
  const host = new URL(url).hostname;
  const res = await safeFetch(`${url}/metrics`, {
    allowHosts: [host],
    allowHttp: true,
    lanOnly: true,
    timeoutMs: 5_000,
    maxBytes: MAX_METRICS_BYTES,
    headers: { accept: 'text/plain;version=0.0.4, */*;q=0.1' },
  });
  return parseNodeMetrics(res.bodyText);
}

export class MachinesService {
  private readonly states = new Map<string, State>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly settings: HouseSettingsService,
    private readonly log?: FastifyBaseLogger,
    private readonly read: (url: string) => Promise<NodeReading> = readMachine,
  ) {
    this.sync();
    settings.onChange(() => {
      this.sync();
      this.changed();
      if (this.running) this.schedule(0);
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Match the in-memory state to the saved machine list. */
  private sync(): void {
    const wanted = new Map(this.settings.values.machines.map((m) => [m.id, m]));
    for (const id of this.states.keys()) if (!wanted.has(id)) this.states.delete(id);
    for (const [id, config] of wanted) {
      const s = this.states.get(id);
      if (!s) this.states.set(id, { config, last: null, prev: null, lastSeenAt: null, offlineSince: null, error: null, history: [] });
      else if (s.config.url !== config.url) this.states.set(id, { config, last: null, prev: null, lastSeenAt: null, offlineSince: null, error: null, history: [] });
      else s.config = config;
    }
  }

  async pollOnce(now = Date.now()): Promise<void> {
    await Promise.all(
      [...this.states.values()].map(async (s) => {
        try {
          const reading = await this.read(s.config.url);
          s.prev = s.last;
          s.last = reading;
          s.lastSeenAt = now;
          s.offlineSince = null;
          s.error = null;
          const st = this.status(s, now);
          s.history.push({ t: now, cpu: st.cpuPct, mem: pct(st.memUsed, st.memTotal), disk: pct(st.diskUsed, st.diskTotal), tempC: st.tempC });
        } catch (err) {
          s.error = describe(err);
          s.offlineSince ??= now;
        }
        while (s.history.length > 0 && (s.history[0]?.t ?? now) < now - HISTORY_MS) s.history.shift();
      }),
    );
    this.changed();
  }

  private status(s: State, now = Date.now()): MachineStatus {
    const r = s.last;
    const p = s.prev;
    const seconds = r && p ? r.time - p.time : 0;
    let cpuPct: number | null = null;
    if (r && p && r.cpuTotal > p.cpuTotal) {
      const busy = (r.cpuBusy - p.cpuBusy) / (r.cpuTotal - p.cpuTotal);
      cpuPct = Number.isFinite(busy) ? Math.round(Math.min(Math.max(busy, 0), 1) * 1000) / 10 : null;
    }
    const offlineAfter = this.settings.values.alerts.offlineMin * 60_000;
    const online = s.lastSeenAt !== null && (s.offlineSince === null || now - s.lastSeenAt < Math.min(offlineAfter, 3 * this.settings.values.pollSec * 1000));
    let host = '';
    try {
      host = new URL(s.config.url).host;
    } catch {
      // keep it blank
    }
    return {
      id: s.config.id,
      name: s.config.name,
      kind: s.config.kind,
      cockpitUrl: s.config.cockpitUrl,
      host,
      online,
      lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null,
      offlineSince: s.offlineSince ? new Date(s.offlineSince).toISOString() : null,
      error: s.error,
      uptimeSec: r && r.bootTime ? Math.max(0, Math.round(r.time - r.bootTime)) : null,
      cpuPct,
      cores: r?.cores ?? 0,
      memUsed: r && r.memTotal !== null && r.memAvailable !== null ? r.memTotal - r.memAvailable : null,
      memTotal: r?.memTotal ?? null,
      diskUsed: r && r.diskSize !== null && r.diskAvail !== null ? r.diskSize - r.diskAvail : null,
      diskTotal: r?.diskSize ?? null,
      tempC: r?.tempC ?? null,
      load: r?.load ?? null,
      netRxBps: r && p ? rate(p.netRx, r.netRx, seconds) : null,
      netTxBps: r && p ? rate(p.netTx, r.netTx, seconds) : null,
      os: r?.os ?? null,
      hostname: r?.hostname ?? null,
      arch: r?.arch ?? null,
      power: r && r.throttled !== null ? throttleFlags(r.throttled) : null,
    };
  }

  list(now = Date.now()): MachineStatus[] {
    return this.settings.values.machines.flatMap((m) => {
      const s = this.states.get(m.id);
      return s ? [this.status(s, now)] : [];
    });
  }

  history(): Record<string, MachinePoint[]> {
    const out: Record<string, MachinePoint[]> = {};
    for (const [id, s] of this.states) out[id] = s.history;
    return out;
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.pollOnce()
        .catch((err: unknown) => this.log?.warn({ err }, 'machine poll failed'))
        .finally(() => {
          if (this.running) this.schedule(this.settings.values.pollSec * 1000);
        });
    }, ms);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(1_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
