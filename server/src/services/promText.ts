/**
 * A small reader for node_exporter's text format (Prometheus exposition),
 * keeping only the handful of series the House screens show. Everything
 * from the machine is untrusted: numbers are checked, labels are capped, and
 * unknown series are skipped without being stored.
 */

export interface NodeReading {
  /** Seconds since the epoch, from node_time_seconds (else the hub's clock). */
  time: number;
  bootTime: number | null;
  /** Summed over all CPUs (seconds). */
  cpuBusy: number;
  cpuTotal: number;
  cores: number;
  memTotal: number | null;
  memAvailable: number | null;
  diskSize: number | null;
  diskAvail: number | null;
  load: [number, number, number] | null;
  tempC: number | null;
  /** Summed over real network interfaces (bytes since boot). */
  netRx: number;
  netTx: number;
  os: string | null;
  hostname: string | null;
  kernel: string | null;
  arch: string | null;
  /** vcgencmd get_throttled bitmask (from the optional textfile script on a Pi). */
  throttled: number | null;
}

const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
const WANTED = new Set([
  'node_time_seconds',
  'node_boot_time_seconds',
  'node_cpu_seconds_total',
  'node_memory_MemTotal_bytes',
  'node_memory_MemAvailable_bytes',
  'node_filesystem_size_bytes',
  'node_filesystem_avail_bytes',
  'node_load1',
  'node_load5',
  'node_load15',
  'node_hwmon_temp_celsius',
  'node_hwmon_chip_names',
  'node_thermal_zone_temp',
  'node_network_receive_bytes_total',
  'node_network_transmit_bytes_total',
  'node_os_info',
  'node_uname_info',
  'homebase_rpi_throttled',
]);
/** Virtual and container interfaces, which would double-count traffic. */
const SKIP_IFACE = /^(lo|docker|veth|br-|virbr|cni|flannel|tun|tap|wg|zt|tailscale)/;
/** Sensor chips that measure the CPU itself. */
const CPU_CHIPS = /^(coretemp|k10temp|zenpower|cpu_thermal|cpu-thermal|soc_thermal|rpi_volt|x86_pkg_temp)$/;
const MAX_LINES = 50_000;
const MAX_LINE = 4_096;

/** name{labels} value [timestamp] → its parts, without a backtracking regex. */
function splitLine(line: string): { name: string; labels: string | undefined; value: number } | null {
  if (line.length > MAX_LINE) return null;
  const brace = line.indexOf('{');
  const space = line.search(/\s/);
  let name: string;
  let labelText: string | undefined;
  let rest: string;
  if (brace !== -1 && (space === -1 || brace < space)) {
    const close = line.lastIndexOf('}');
    if (close < brace) return null;
    name = line.slice(0, brace);
    labelText = line.slice(brace + 1, close);
    rest = line.slice(close + 1);
  } else {
    if (space === -1) return null;
    name = line.slice(0, space);
    rest = line.slice(space);
  }
  const value = Number(rest.trim().split(/\s+/)[0]);
  return { name, labels: labelText, value };
}

function labels(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const m of raw.matchAll(LABEL)) {
    const k = m[1];
    const v = m[2];
    if (k !== undefined && v !== undefined) out[k] = v.slice(0, 120).replace(/\\(.)/g, '$1');
  }
  return out;
}

const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);

export function parseNodeMetrics(text: string, now = Date.now()): NodeReading {
  const cpuIds = new Set<string>();
  let cpuBusy = 0;
  let cpuTotal = 0;
  let netRx = 0;
  let netTx = 0;
  const chipNames = new Map<string, string>();
  const hwmon: Array<{ chip: string; value: number }> = [];
  const zones: Array<{ type: string; value: number }> = [];
  const r: NodeReading = {
    time: now / 1000,
    bootTime: null,
    cpuBusy: 0,
    cpuTotal: 0,
    cores: 0,
    memTotal: null,
    memAvailable: null,
    diskSize: null,
    diskAvail: null,
    load: null,
    tempC: null,
    netRx: 0,
    netTx: 0,
    os: null,
    hostname: null,
    kernel: null,
    arch: null,
    throttled: null,
  };
  const load: [number | null, number | null, number | null] = [null, null, null];

  let n = 0;
  for (const raw of text.split('\n')) {
    if (++n > MAX_LINES) break;
    if (raw === '' || raw.charCodeAt(0) === 35 /* # */) continue;
    const parts = splitLine(raw.trim());
    if (!parts || !WANTED.has(parts.name) || !Number.isFinite(parts.value)) continue;
    const { name, value } = parts;
    const l = labels(parts.labels);
    switch (name) {
      case 'node_time_seconds':
        r.time = value;
        break;
      case 'node_boot_time_seconds':
        r.bootTime = value;
        break;
      case 'node_cpu_seconds_total': {
        if (l.cpu !== undefined) cpuIds.add(l.cpu);
        cpuTotal += value;
        if (l.mode !== 'idle' && l.mode !== 'iowait' && l.mode !== 'steal') cpuBusy += value;
        break;
      }
      case 'node_memory_MemTotal_bytes':
        r.memTotal = value;
        break;
      case 'node_memory_MemAvailable_bytes':
        r.memAvailable = value;
        break;
      case 'node_filesystem_size_bytes':
        if (l.mountpoint === '/' && l.fstype !== 'rootfs' && r.diskSize === null) r.diskSize = value;
        break;
      case 'node_filesystem_avail_bytes':
        if (l.mountpoint === '/' && l.fstype !== 'rootfs' && r.diskAvail === null) r.diskAvail = value;
        break;
      case 'node_load1':
        load[0] = value;
        break;
      case 'node_load5':
        load[1] = value;
        break;
      case 'node_load15':
        load[2] = value;
        break;
      case 'node_hwmon_chip_names':
        if (l.chip && l.chip_name) chipNames.set(l.chip, l.chip_name);
        break;
      case 'node_hwmon_temp_celsius':
        if (l.chip) hwmon.push({ chip: l.chip, value });
        break;
      case 'node_thermal_zone_temp':
        zones.push({ type: l.type ?? '', value });
        break;
      case 'node_network_receive_bytes_total':
        if (l.device && !SKIP_IFACE.test(l.device)) netRx += value;
        break;
      case 'node_network_transmit_bytes_total':
        if (l.device && !SKIP_IFACE.test(l.device)) netTx += value;
        break;
      case 'node_os_info':
        r.os = l.pretty_name ?? (l.name && l.version ? `${l.name} ${l.version}` : (l.name ?? null));
        break;
      case 'node_uname_info':
        r.hostname = l.nodename ?? null;
        r.kernel = l.release ?? null;
        r.arch = l.machine ?? null;
        break;
      case 'homebase_rpi_throttled':
        r.throttled = Math.trunc(value);
        break;
    }
  }

  r.cpuBusy = cpuBusy;
  r.cpuTotal = cpuTotal;
  r.cores = cpuIds.size;
  r.netRx = netRx;
  r.netTx = netTx;
  if (load[0] !== null && load[1] !== null && load[2] !== null) r.load = [load[0], load[1], load[2]];

  // CPU temperature: a CPU sensor chip if the machine names one, else the
  // hottest thermal zone (a Pi reports its CPU there).
  const cpuTemps = hwmon.filter((h) => CPU_CHIPS.test(chipNames.get(h.chip) ?? h.chip.replace(/^.*?_/, ''))).map((h) => h.value);
  const zoneTemps = zones.filter((z) => z.type !== 'acpitz' || zones.length === 1).map((z) => z.value);
  const pick = cpuTemps.length > 0 ? cpuTemps : zoneTemps;
  const t = pick.length > 0 ? Math.max(...pick) : null;
  r.tempC = t !== null && t > -40 && t < 150 ? finite(t) : null;
  return r;
}

/** Per-second rate between two counter readings; null across a reboot or a gap. */
export function rate(prev: number, next: number, seconds: number): number | null {
  if (!(seconds > 0) || next < prev) return null;
  return (next - prev) / seconds;
}

/** Throttling flags from vcgencmd's bitmask. */
export function throttleFlags(mask: number): { underVoltageNow: boolean; throttledNow: boolean; underVoltageSinceBoot: boolean; throttledSinceBoot: boolean } {
  return {
    underVoltageNow: (mask & 0x1) !== 0,
    throttledNow: (mask & 0x6) !== 0 || (mask & 0x8) !== 0,
    underVoltageSinceBoot: (mask & 0x10000) !== 0,
    throttledSinceBoot: (mask & 0x60000) !== 0 || (mask & 0x80000) !== 0,
  };
}
