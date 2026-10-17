import type { Tab } from './types';

const TABS: Tab[] = ['home', 'flights', 'radar', 'calendar', 'notes', 'reminders', 'fitness', 'nutrition', 'health', 'mirror', 'settings'];

function parse(hash: string): Tab | 'login' | 'kiosk' | 'reset' {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  if (name === 'login' || name === 'kiosk' || name === 'reset') return name;
  return (TABS as string[]).includes(name) ? (name as Tab) : 'home';
}

/** Minimal hash router: #/home, #/flights, #/radar, #/calendar, #/settings. */
class Router {
  route = $state<Tab | 'login' | 'kiosk' | 'reset'>(parse(location.hash));

  constructor() {
    addEventListener('hashchange', () => {
      this.route = parse(location.hash);
    });
  }

  go(route: Tab | 'login'): void {
    if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
    this.route = route;
  }
}

export const router = new Router();
