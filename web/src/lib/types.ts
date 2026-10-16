// Shapes returned by the hub server (see server/src/services/*).

export type DelayLevel = 'ontime' | 'minor' | 'moderate' | 'major' | 'severe' | 'extreme' | 'unknown';

export interface Airport {
  code: string;
  name: string;
  lat: number | null;
  lon: number | null;
  distance: number | null;
  delay: DelayLevel;
}

export interface Flight {
  callsign: string;
  icao24: string;
  airline: string;
  logoIcao: string;
  flightNumber: string;
  aircraftCode: string;
  aircraftName: string;
  origin: Airport;
  destination: Airport;
  progress: number | null;
  position: {
    lat: number | null;
    lon: number | null;
    altitudeFt: number | null;
    headingDeg: number | null;
    verticalFpm: number | null;
    groundSpeedKt: number | null;
  };
  fromHome: { distance: number | null; direction: string };
  times: {
    scheduledDeparture: number | null;
    actualDeparture: number | null;
    scheduledArrival: number | null;
    estimatedArrival: number | null;
  };
}

export interface DayForecast {
  date: string;
  min: number | null;
  max: number | null;
  code: number | null;
}

export interface TrackerState {
  enabled: boolean;
  reachable: boolean;
  updatedAt: string | null;
  flights: Flight[];
  tracked: { callsign: string; raw: Record<string, unknown> } | null;
  weather: {
    temperature: number | null;
    humidity: number | null;
    code: number | null;
    moonPhase: number | null;
    forecast: DayForecast[];
  } | null;
  sun: { sunrise: string; sunset: string } | null;
  alerts: Array<{ text: string; level: string }>;
}

export interface RadarAircraft {
  hex: string;
  callsign: string;
  registration: string;
  type: string;
  category: string;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  trackDeg: number | null;
  verticalFpm: number | null;
  squawk: string;
  distance: number;
  direction: string;
  trail: Array<[number, number]>;
}

export interface RadarSnapshot {
  enabled: boolean;
  source: string | null;
  updatedAt: string | null;
  home: { lat: number; lon: number };
  radiusNm: number;
  units: 'imperial' | 'metric';
  aircraft: RadarAircraft[];
}

export interface CalendarEvent {
  id: string;
  sourceId: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  color: string;
}

export interface CalendarSource {
  id: string;
  name: string;
  color: string;
  ok: boolean | null;
  error: string | null;
  fetchedAt: string | null;
}

export interface DashboardReminder {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
  shared: boolean;
  repeatRule: string;
}

export interface DashboardNote {
  id: string;
  title: string;
  body: string;
  isChecklist: boolean;
  items: Array<{ id: string; text: string; done: boolean }>;
  shared: boolean;
  updatedAt: string;
}

export interface Lists {
  reminders: { items: DashboardReminder[]; total: number };
  notes: { items: DashboardNote[]; totalPinned: number };
}

export interface HubConfig {
  units: 'imperial' | 'metric';
  timezone: string;
  home: { lat: number; lon: number };
  radarRadiusNm: number;
  trackerEnabled: boolean;
  radarEnabled: boolean;
  calendarColors: string[];
}

export type Tab = 'home' | 'flights' | 'radar' | 'calendar' | 'settings';

export interface DeviceSettings {
  startTab: 'home' | 'flights' | 'radar' | 'calendar';
  autoFocus: boolean;
  boardTheme: 'led' | 'clean';
  night: { enabled: boolean; start: string; end: string; mode: 'dim' | 'black' };
  rotate: { enabled: boolean; tabs: Array<'home' | 'flights' | 'radar' | 'calendar'>; seconds: number };
}

export type Me =
  | { kind: 'user'; user: { id: string; email: string; displayName: string } | null }
  | { kind: 'device'; device: { id: string; name: string; settings: DeviceSettings }; user: { id: string; displayName: string } | null };
