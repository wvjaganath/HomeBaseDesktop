import type { FastifyBaseLogger } from 'fastify';
import { AuthService } from './auth.js';
import type { DB } from './db.js';
import type { Env } from './env.js';
import { EventBus } from './events.js';
import { BackupService } from './services/backup.js';
import { SecretBox } from './security/secretBox.js';
import { CalendarService } from './services/calendar.js';
import { HomeLocation } from './services/home.js';
import { HubSettingsService, type HubSettings } from './services/hubSettings.js';
import { RadarService } from './services/radar.js';
import { RouteLookupService } from './services/routeLookup.js';
import { TrackerService } from './services/tracker.js';

/** Everything route handlers need, created once per server instance. */
export interface AppContext {
  env: Env;
  db: DB;
  bus: EventBus;
  auth: AuthService;
  secretBox: SecretBox;
  tracker: TrackerService;
  /** The hub's settings (Settings in the browser), stored in the database. */
  settings: HubSettingsService;
  /** Home and units: the plane tracker's Location settings, else Settings → General. */
  home: HomeLocation;
  radar: RadarService;
  routes: RouteLookupService;
  calendar: CalendarService;
  backup: BackupService;
}

export function createContext(env: Env, db: DB, log: FastifyBaseLogger): AppContext {
  const bus = new EventBus();
  const secretBox = new SecretBox(env.SECRETS_KEY, env.JWT_SECRET);
  const settings = new HubSettingsService(db, secretBox, env, log.child({ svc: 'settings' }));
  const view = (): HubSettings => settings.values;
  const home = new HomeLocation(env, log.child({ svc: 'home' }), view);
  const routes = new RouteLookupService(env, view);
  // Routes the tracker's lookup couldn't find come from adsbdb's schedule data.
  const tracker = new TrackerService(env, bus, log.child({ svc: 'tracker' }), { routes, units: () => home.units });
  return {
    env,
    db,
    bus,
    auth: new AuthService(db, env, view),
    secretBox,
    settings,
    tracker,
    home,
    // Each radar plane's from/to: the tracker's route in the box, else adsbdb's usual route when it fits.
    radar: new RadarService(env, bus, log.child({ svc: 'radar' }), home, view, { routes, trackerFlights: () => tracker.snapshot.state.flights }),
    routes,
    calendar: new CalendarService(db, secretBox, bus, log.child({ svc: 'calendar' })),
    backup: new BackupService(db, env, log.child({ svc: 'backup' }), view),
  };
}
