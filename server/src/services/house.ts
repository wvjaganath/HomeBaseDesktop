import type { EventBus } from '../events.js';
import type { HouseSettingsService } from './houseSettings.js';
import type { MachineStatus, MachinesService } from './machines.js';
import type { RoomsService, RoomSummary } from './rooms.js';

export interface HouseAlert {
  /** Same colours as the tracker's alerts in the bar: red, orange, yellow. */
  level: 'red' | 'orange' | 'yellow';
  text: string;
}

export interface HouseSummary {
  version: number;
  machines: MachineStatus[];
  rooms: RoomSummary[];
  /** Govee listeners are set up (bundled or in Settings). */
  roomsEnabled: boolean;
  /** Sensors heard but not switched on yet (a hint for Settings). */
  newSensors: number;
  alerts: HouseAlert[];
}

type Units = 'imperial' | 'metric';
const temp = (c: number, units: Units): string => (units === 'imperial' ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`);
const minutes = (ms: number): string => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
};

export function houseAlerts(machines: MachineStatus[], rooms: RoomSummary[], settings: HouseSettingsService['values'], units: Units, now = Date.now()): HouseAlert[] {
  const a = settings.alerts;
  const out: HouseAlert[] = [];
  for (const m of machines) {
    if (m.offlineSince && now - Date.parse(m.offlineSince) >= a.offlineMin * 60_000) {
      out.push({ level: 'red', text: `${m.name} is unreachable · ${minutes(now - Date.parse(m.offlineSince))}` });
      continue;
    }
    if (!m.online) continue;
    if (m.tempC !== null && m.tempC >= a.cpuTempMaxC) out.push({ level: 'orange', text: `${m.name} is hot · ${temp(m.tempC, units)}` });
    if (m.diskUsed !== null && m.diskTotal && (m.diskUsed / m.diskTotal) * 100 >= a.diskPct) out.push({ level: 'orange', text: `${m.name} disk ${Math.round((m.diskUsed / m.diskTotal) * 100)}% full` });
    if (m.memUsed !== null && m.memTotal && (m.memUsed / m.memTotal) * 100 >= a.memPct) out.push({ level: 'orange', text: `${m.name} memory ${Math.round((m.memUsed / m.memTotal) * 100)}% used` });
    if (m.power?.underVoltageNow) out.push({ level: 'orange', text: `${m.name} power supply too weak` });
  }
  for (const r of rooms) {
    const name = r.name || r.model || 'Sensor';
    if (r.stale) {
      out.push({ level: 'yellow', text: `${name} sensor not heard for ${minutes(now - Date.parse(r.lastSeenAt))}` });
      continue;
    }
    if (r.tempC !== null && a.roomMaxC !== null && r.tempC > a.roomMaxC) out.push({ level: 'orange', text: `${name} is ${temp(r.tempC, units)}` });
    if (r.tempC !== null && a.roomMinC !== null && r.tempC < a.roomMinC) out.push({ level: 'orange', text: `${name} is ${temp(r.tempC, units)}` });
    if (r.humidity !== null && a.humidityMax !== null && r.humidity > a.humidityMax) out.push({ level: 'yellow', text: `${name} humidity ${Math.round(r.humidity)}%` });
    if (r.battery !== null && r.battery <= a.batteryMin) out.push({ level: 'yellow', text: `${name} sensor battery ${r.battery}%` });
  }
  return out;
}

/** Machines + rooms, pushed to screens (SSE topic "house") whenever either changes. */
export class HouseService {
  private version = 0;

  constructor(
    private readonly settings: HouseSettingsService,
    readonly machines: MachinesService,
    readonly rooms: RoomsService,
    private readonly units: () => Units,
    private readonly bus: EventBus,
  ) {
    const bump = (): void => {
      this.version += 1;
      this.bus.emit('house', { version: this.version });
    };
    machines.onChange(bump);
    rooms.onChange(bump);
  }

  summary(now = Date.now()): HouseSummary {
    const machines = this.machines.list(now);
    const rooms = this.rooms.summary(now);
    const all = this.rooms.enabled ? this.rooms.all(now) : [];
    return {
      version: this.version,
      machines,
      rooms,
      roomsEnabled: this.rooms.enabled,
      newSensors: all.filter((s) => !s.shown).length,
      alerts: houseAlerts(machines, rooms, this.settings.values, this.units(), now),
    };
  }

  start(): void {
    this.machines.start();
    this.rooms.start();
  }

  stop(): void {
    this.machines.stop();
    this.rooms.stop();
  }
}
