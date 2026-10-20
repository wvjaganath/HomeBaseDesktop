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
  /** tracker = its FR24/AirLabs/FlightAware lookup; schedule = adsbdb's usual route for the callsign. */
  routeSource: 'tracker' | 'schedule' | null;
  /** More from FR24's flight summary (when the tracker's lookup found it there). */
  extra?: { registration: string; runwayTakeoff: string; diverted: boolean; plannedDestination: string; tripKm: number | null } | null;
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
  /** fr24 = the tracker's FR24 route (in the box); schedule = adsbdb's usual route, shown only when the plane fits it. */
  route?: { from: string; to: string; source: 'fr24' | 'schedule' } | null;
}

export interface RadarSnapshot {
  enabled: boolean;
  off?: 'disabled' | 'no_home' | null;
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
  /** The tracker runs on this server (docker compose). */
  trackerBundled?: boolean;
  /** Why the radar is off, if it is. */
  radarOff?: 'disabled' | 'no_home' | null;
  /** A CARTO key is saved (map tiles without the "API KEY REQUIRED" stamp). */
  mapKey?: boolean;
  /** CARTO tile address (with the key when saved); tiles load straight from CARTO. */
  mapTileUrl?: string;
  homeSource?: 'tracker' | 'settings' | null;
  radarEnabled: boolean;
  mirrorEnabled: boolean;
  calendarColors: string[];
}

export type Tab =
  | 'home'
  | 'flights'
  | 'radar'
  | 'calendar'
  | 'notes'
  | 'reminders'
  | 'fitness'
  | 'nutrition'
  | 'health'
  | 'mirror'
  | 'settings';

export interface DeviceSettings {
  startTab: 'home' | 'flights' | 'radar' | 'calendar' | 'mirror';
  autoFocus: boolean;
  boardTheme: 'led' | 'clean';
  night: { enabled: boolean; start: string; end: string; mode: 'dim' | 'black' };
  rotate: { enabled: boolean; tabs: Array<'home' | 'flights' | 'radar' | 'calendar' | 'mirror'>; seconds: number };
}

export type Me =
  | { kind: 'user'; user: { id: string; email: string; displayName: string } | null }
  | { kind: 'device'; device: { id: string; name: string; settings: DeviceSettings }; user: { id: string; displayName: string } | null };

// ---- Plane tracker stats, records and tracking (/api/tracker/*) ----
export interface DaySummary {
  date: string;
  count: number;
  byHour: number[];
  firstSeen: string;
  lastSeen: string;
}
export interface DayDetail {
  date: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  flights: Array<{ callsign: string; time: string; hour: number; origin: string; destination: string; aircraft: string }>;
}
export interface FlightRecord {
  callsign: string;
  airline: string;
  aircraft: string;
  origin: { code: string; lat: number | null; lon: number | null; distance: number | null };
  destination: { code: string; lat: number | null; lon: number | null; distance: number | null };
  seen: string;
  distance: number | null;
  direction: string;
  altitudeFt: number | null;
  plane: { lat: number | null; lon: number | null };
  farthest: { from: 'origin' | 'destination'; distance: number | null } | null;
  trail: Array<[number, number]>;
}
export interface ApiCall {
  time: string;
  source: string;
  callsign: string;
  route: string;
  totals: string;
}
export interface TrackedLeg {
  flightId: string;
  airline: string;
  origin: string;
  destination: string;
  aircraft: string;
  registration: string;
  live: boolean;
  status: string;
  scheduledDeparture: number | null;
  scheduledArrival: number | null;
}
export interface TrackedState {
  callsign: string;
  airline: string;
  aircraft: string;
  origin: { code: string; lat: number | null; lon: number | null };
  destination: { code: string; lat: number | null; lon: number | null };
  scheduledDeparture: number | null;
  scheduledArrival: number | null;
  live: null | {
    lat: number | null;
    lon: number | null;
    altitudeFt: number | null;
    groundSpeedKt: number | null;
    headingDeg: number | null;
    verticalFpm: number | null;
    departed: number | null;
    eta: number | null;
    timeRemaining: string;
    distanceRemaining: number | null;
    totalDistance: number | null;
  };
}
export interface RouteResult {
  callsign: string;
  number: string;
  airline: string;
  departure: string;
  live: boolean;
  status: string;
}
