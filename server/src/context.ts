import type { FastifyBaseLogger } from 'fastify';
import { AuthService } from './auth.js';
import type { DB } from './db.js';
import type { Env } from './env.js';
import { EventBus } from './events.js';
import { BackupService } from './services/backup.js';
import { SecretBox } from './security/secretBox.js';
import { CalendarService } from './services/calendar.js';
import { HomeLocation } from './services/home.js';
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
  /** Home for the radar and maps: hub.env, else the plane tracker's settings. */
  home: HomeLocation;
  radar: RadarService;
  routes: RouteLookupService;
  calendar: CalendarService;
  backup: BackupService;
}

export function createContext(env: Env, db: DB, log: FastifyBaseLogger): AppContext {
  const bus = new EventBus();
  const secretBox = new SecretBox(env.SECRETS_KEY, env.JWT_SECRET);
  const home = new HomeLocation(env, log.child({ svc: 'home' }));
  return {
    env,
    db,
    bus,
    auth: new AuthService(db, env),
    secretBox,
    tracker: new TrackerService(env, bus, log.child({ svc: 'tracker' })),
    home,
    radar: new RadarService(env, bus, log.child({ svc: 'radar' }), home),
    routes: new RouteLookupService(env),
    calendar: new CalendarService(db, secretBox, bus, log.child({ svc: 'calendar' })),
    backup: new BackupService(db, env, log.child({ svc: 'backup' })),
  };
}
