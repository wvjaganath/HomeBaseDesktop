import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { houseAlerts } from '../src/services/house.js';
import { HOUSE_DEFAULTS, HouseSettingsService } from '../src/services/houseSettings.js';
import { MachinesService } from '../src/services/machines.js';
import { parseNodeMetrics, throttleFlags, type NodeReading } from '../src/services/promText.js';
import { RoomsService } from '../src/services/rooms.js';
import { registerUser, testApp } from './helpers.js';

const metrics = (cpuIdle: number, cpuUser: number, rx: number, time: number): string => `# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} ${cpuIdle}
node_cpu_seconds_total{cpu="0",mode="user"} ${cpuUser}
node_cpu_seconds_total{cpu="0",mode="iowait"} 1
node_cpu_seconds_total{cpu="1",mode="idle"} ${cpuIdle}
node_cpu_seconds_total{cpu="1",mode="user"} ${cpuUser}
node_memory_MemTotal_bytes 1.6e+10
node_memory_MemAvailable_bytes 1.1e+10
node_filesystem_size_bytes{device="/dev/sda2",fstype="ext4",mountpoint="/"} 5e+11
node_filesystem_avail_bytes{device="/dev/sda2",fstype="ext4",mountpoint="/"} 2.6e+11
node_filesystem_size_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/run"} 1e+9
node_load1 0.42
node_load5 0.51
node_load15 0.48
node_boot_time_seconds ${time - 86400}
node_time_seconds ${time}
node_hwmon_chip_names{chip="platform_coretemp_0",chip_name="coretemp"} 1
node_hwmon_temp_celsius{chip="platform_coretemp_0",sensor="temp1"} 52
node_hwmon_temp_celsius{chip="platform_coretemp_0",sensor="temp2"} 49
node_hwmon_chip_names{chip="pci0000:00_0000:00:1f_3",chip_name="nvme"} 1
node_hwmon_temp_celsius{chip="pci0000:00_0000:00:1f_3",sensor="temp1"} 61
node_thermal_zone_temp{type="acpitz",zone="0"} 27.8
node_network_receive_bytes_total{device="lo"} 9e9
node_network_receive_bytes_total{device="docker0"} 5e9
node_network_receive_bytes_total{device="enp1s0"} ${rx}
node_network_transmit_bytes_total{device="enp1s0"} 1000
node_os_info{id="ubuntu",name="Ubuntu",pretty_name="Ubuntu 24.04.1 LTS",version="24.04.1 LTS (Noble Numbat)"} 1
node_uname_info{machine="x86_64",nodename="jaganuserver",release="6.8.0-48-generic",sysname="Linux"} 1
some_other_metric{a="b"} 12
`;

describe('node_exporter text', () => {
  it('reads the series the House screens use', () => {
    const r = parseNodeMetrics(metrics(1000, 100, 5000, 1_800_000_000));
    expect(r.cores).toBe(2);
    expect(r.memTotal).toBe(1.6e10);
    expect(r.memAvailable).toBe(1.1e10);
    expect(r.diskSize).toBe(5e11);
    expect(r.diskAvail).toBe(2.6e11);
    expect(r.load).toEqual([0.42, 0.51, 0.48]);
    // The CPU chip (coretemp), not the hotter NVMe drive or the motherboard's acpitz.
    expect(r.tempC).toBe(52);
    // Only real interfaces count towards network traffic.
    expect(r.netRx).toBe(5000);
    expect(r.os).toBe('Ubuntu 24.04.1 LTS');
    expect(r.hostname).toBe('jaganuserver');
    expect(r.throttled).toBeNull();
  });

  it('uses the thermal zone on a Pi and reads its power flags', () => {
    const r = parseNodeMetrics('node_thermal_zone_temp{type="cpu-thermal",zone="0"} 61.3\nhomebase_rpi_throttled 327680\n');
    expect(r.tempC).toBe(61.3);
    expect(r.throttled).toBe(0x50000);
    expect(throttleFlags(0x50000)).toEqual({ underVoltageNow: false, throttledNow: false, underVoltageSinceBoot: true, throttledSinceBoot: true });
  });

  it('ignores junk, huge lines and non-numbers', () => {
    const r = parseNodeMetrics(`node_load1 NaN\nnode_load5 abc\n${'x'.repeat(10_000)}\nnode_memory_MemTotal_bytes 42\n{}\n`);
    expect(r.load).toBeNull();
    expect(r.memTotal).toBe(42);
  });
});

describe('machines', () => {
  let db: DB;
  let settings: HouseSettingsService;
  beforeEach(() => {
    db = openDb(':memory:');
    settings = new HouseSettingsService(db);
    settings.update({ ...HOUSE_DEFAULTS, machines: [{ id: 'm1', name: 'Mini PC', url: 'http://192.168.1.20:9100', kind: 'pc', cockpitUrl: '' }] }, 'test');
  });
  afterEach(() => db.close());

  it('works out CPU and network rates from two readings, then notices it going offline', async () => {
    const replies: Array<NodeReading | Error> = [
      parseNodeMetrics(metrics(1000, 100, 5000, 1_800_000_000)),
      // 30 s later: each CPU did 15 s user + 15 s idle → 50 % busy; 30 kB received.
      parseNodeMetrics(metrics(1015, 115, 35_000, 1_800_000_030)),
      new Error('ECONNREFUSED'),
    ];
    const machines = new MachinesService(settings, undefined, async () => {
      const next = replies.shift();
      if (next instanceof Error || next === undefined) throw next ?? new Error('done');
      return next;
    });
    const t0 = 1_800_000_000_000;
    await machines.pollOnce(t0);
    expect(machines.list(t0)[0]?.cpuPct).toBeNull();
    await machines.pollOnce(t0 + 30_000);
    const m = machines.list(t0 + 30_000)[0];
    expect(m?.online).toBe(true);
    expect(m?.cpuPct).toBe(50);
    expect(m?.netRxBps).toBe(1000);
    expect(m?.uptimeSec).toBe(86_400);
    expect(m?.memUsed).toBe(5e9);
    expect(machines.history().m1).toHaveLength(2);

    await machines.pollOnce(t0 + 60_000);
    // Two minutes after the last answer (the default), it's offline and alerting.
    const later = t0 + 60_000 + 3 * 60_000;
    const off = machines.list(later)[0];
    expect(off?.online).toBe(false);
    expect(off?.offlineSince).not.toBeNull();
    const alerts = houseAlerts(machines.list(later), [], settings.values, 'imperial', later);
    expect(alerts[0]?.level).toBe('red');
    expect(alerts[0]?.text).toContain('Mini PC is unreachable');
  });

  it('drops a machine removed in Settings', async () => {
    const machines = new MachinesService(settings, undefined, async () => parseNodeMetrics(metrics(1, 1, 1, 1)));
    await machines.pollOnce();
    settings.update({ ...HOUSE_DEFAULTS, machines: [] }, 'test');
    expect(machines.list()).toEqual([]);
    expect(machines.history()).toEqual({});
  });
});

describe('room sensors', () => {
  let db: DB;
  let settings: HouseSettingsService;
  const now = 1_800_000_000_000;
  const sec = now / 1000;
  beforeEach(() => {
    db = openDb(':memory:');
    settings = new HouseSettingsService(db);
  });
  afterEach(() => db.close());

  it('stores what the listeners hear, shows only sensors switched on, and keeps 5-minute averages', async () => {
    const answers: Record<string, unknown> = {
      'http://govee:8686': {
        scanning: true,
        sensors: [
          { address: 'a4:c1:38:00:27:62', model: 'H5075', name: 'GVH5075_2762', temperatureC: 21.3, humidity: 44.2, battery: 12, rssi: -80, seenAt: sec - 5 },
          // Too old: ignored.
          { address: 'A4:C1:38:00:00:01', model: 'H5075', temperatureC: 5, seenAt: sec - 3600 },
          // Not a sensor reading at all: ignored.
          { address: 'not-an-address', seenAt: sec },
        ],
      },
      'http://192.168.1.41:8686': {
        scanning: true,
        // The same sensor, heard at the same time with a stronger signal on the Pi.
        sensors: [{ address: 'A4:C1:38:00:27:62', model: 'H5075', temperatureC: 21.5, humidity: 44, battery: 12, rssi: -50, seenAt: sec - 4 }],
      },
    };
    settings.update({ ...HOUSE_DEFAULTS, listeners: ['http://192.168.1.41:8686'] }, 'test');
    const rooms = new RoomsService(db, settings, 'http://govee:8686', undefined, async (url) => answers[url]);
    await rooms.pollOnce(now);

    const all = rooms.all(now);
    expect(all).toHaveLength(1);
    expect(all[0]?.address).toBe('A4:C1:38:00:27:62');
    expect(all[0]?.tempC).toBe(21.5);
    expect(all[0]?.heardBy).toBe('192.168.1.41:8686');
    expect(all[0]?.shown).toBe(false);
    // Not on Home until switched on.
    expect(rooms.summary(now)).toEqual([]);

    expect(rooms.update('A4:C1:38:00:27:62', { name: 'Garage', shown: true })).toBe(true);
    const summary = rooms.summary(now);
    expect(summary[0]?.name).toBe('Garage');
    expect(summary[0]?.spark.filter((v) => v !== null)).toEqual([21.5]);

    const hist = rooms.history('24h', now);
    expect(hist['A4:C1:38:00:27:62']?.[0]?.tempC).toBe(21.5);

    // Battery below the default 15 % → an alert.
    const alerts = houseAlerts([], summary, settings.values, 'imperial', now);
    expect(alerts.map((a) => a.text)).toContain('Garage sensor battery 12%');
    expect(rooms.listenerStatus().map((l) => [l.label, l.ok, l.heard])).toEqual([
      ['This server', true, 1],
      ['192.168.1.41:8686', true, 1],
    ]);
  });

  it('reports a listener that can’t be reached, and stale sensors', async () => {
    const rooms = new RoomsService(db, settings, 'http://govee:8686', undefined, async () => {
      throw new Error('down');
    });
    await rooms.pollOnce(now);
    expect(rooms.listenerStatus()[0]).toMatchObject({ ok: false, error: 'The listener can’t be reached' });

    db.prepare(
      `INSERT INTO room_sensors (address, name, shown, first_seen_at, last_seen_at, temp_c) VALUES ('A4:C1:38:00:00:02', 'Office', 1, ?, ?, 22)`,
    ).run(new Date(now - 3_600_000).toISOString(), new Date(now - 3_600_000).toISOString());
    const s = rooms.summary(now);
    expect(s[0]?.stale).toBe(true);
    expect(houseAlerts([], s, settings.values, 'metric', now)[0]?.text).toBe('Office sensor not heard for 1 h');
  });
});

describe('house routes', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('needs a signed-in person to read or change anything', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/house' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/house-settings', payload: HOUSE_DEFAULTS })).statusCode).toBe(401);
  });

  it('accepts home-network machine addresses only', async () => {
    const a = await registerUser(app, 'a@example.com');
    const put = (machines: unknown[]) =>
      app.inject({ method: 'PUT', url: '/api/house-settings', headers: { authorization: `Bearer ${a.accessToken}` }, payload: { ...HOUSE_DEFAULTS, machines } });
    const machine = (url: string) => ({ id: randomUUID(), name: 'PC', url, kind: 'pc', cockpitUrl: '' });

    for (const bad of ['http://8.8.8.8:9100', 'http://127.0.0.1:9100', 'http://169.254.169.254', 'http://example.com:9100', 'file:///etc/passwd', 'http://192.168.1.20:9100/metrics']) {
      expect((await put([machine(bad)])).statusCode, bad).toBe(400);
    }
    const ok = await put([machine('http://192.168.1.20:9100'), machine('http://kiosk-pi.local:9100')]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ settings: { machines: unknown[] } }>().settings.machines).toHaveLength(2);

    const summary = await app.inject({ method: 'GET', url: '/api/house', headers: { authorization: `Bearer ${a.accessToken}` } });
    expect(summary.json<{ machines: Array<{ name: string; online: boolean }> }>().machines.map((m) => [m.name, m.online])).toEqual([
      ['PC', false],
      ['PC', false],
    ]);
  });

  it('renames and forgets sensors', async () => {
    const a = await registerUser(app, 'a@example.com');
    const db = app.ctx.db;
    db.prepare(`INSERT INTO room_sensors (address, first_seen_at, last_seen_at) VALUES ('A4:C1:38:00:00:09', ?, ?)`).run(new Date().toISOString(), new Date().toISOString());
    const auth = { authorization: `Bearer ${a.accessToken}` };
    const patch = await app.inject({ method: 'PATCH', url: '/api/house/sensors/A4:C1:38:00:00:09', headers: auth, payload: { name: 'Bedroom', shown: true } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<{ sensors: Array<{ name: string; shown: boolean }> }>().sensors[0]).toMatchObject({ name: 'Bedroom', shown: true });
    expect((await app.inject({ method: 'PATCH', url: '/api/house/sensors/ZZ:C1:38:00:00:09', headers: auth, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/house/sensors/A4:C1:38:00:00:09', headers: auth, payload: { shown: 'yes' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/house/sensors/A4:C1:38:00:00:09', headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/house/sensors/A4:C1:38:00:00:09', headers: auth })).statusCode).toBe(404);
  });
});
