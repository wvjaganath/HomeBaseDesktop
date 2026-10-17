import { api, refreshSession } from './api';
import { sync } from './sync.svelte';
import type { HubConfig, Lists, Me, RadarSnapshot, TrackerState } from './types';

/**
 * Global reactive state, fed by one Server-Sent Events connection.
 * Screens read from here; nothing polls the server.
 */
class Hub {
  me = $state<Me | null>(null);
  config = $state<HubConfig | null>(null);
  tracker = $state<TrackerState | null>(null);
  radar = $state<RadarSnapshot | null>(null);
  lists = $state<Lists | null>(null);
  /** Bumped when calendar data changed server-side; calendar views refetch. */
  calendarVersion = $state(0);
  connected = $state(false);

  private es: EventSource | null = null;
  private backoff = 1_000;
  private wantRadar = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  get isKiosk(): boolean {
    return this.me?.kind === 'device';
  }

  async boot(): Promise<void> {
    const [config, lists] = await Promise.all([api.get<HubConfig>('/api/config'), api.get<Lists>('/api/lists')]);
    this.config = config;
    this.lists = lists;
    this.connect();
  }

  /** Radar data is heavier; only stream it while a radar view is mounted. */
  setRadarInterest(on: boolean): void {
    if (on === this.wantRadar) return;
    this.wantRadar = on;
    this.connect();
  }

  async refreshLists(): Promise<void> {
    this.lists = await api.get<Lists>('/api/lists');
  }

  private connect(): void {
    this.es?.close();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const topics = ['tracker', 'items', 'calendar', ...(this.wantRadar ? ['radar'] : [])].join(',');
    const es = new EventSource(`/api/stream?topics=${topics}`);
    this.es = es;

    es.addEventListener('open', () => {
      this.connected = true;
      this.backoff = 1_000;
    });
    es.addEventListener('tracker', (e) => {
      this.tracker = (JSON.parse((e as MessageEvent<string>).data) as { state: TrackerState }).state;
    });
    es.addEventListener('radar', (e) => {
      this.radar = (JSON.parse((e as MessageEvent<string>).data) as { data: RadarSnapshot }).data;
    });
    es.addEventListener('items', () => {
      void this.refreshLists();
      // Editing tabs hold a full copy of the user's data; keep it current.
      if (sync.loaded) void sync.pull().catch(() => undefined);
    });
    es.addEventListener('calendar', () => {
      this.calendarVersion += 1;
    });
    es.addEventListener('device', (e) => {
      const { action } = JSON.parse((e as MessageEvent<string>).data) as { action: string };
      if (action === 'reload') location.reload();
      if (action === 'settings') void this.reloadMe();
      if (action === 'revoked') location.reload();
    });
    es.addEventListener('error', () => {
      this.connected = false;
      if (es.readyState !== EventSource.CLOSED) return; // browser is retrying by itself
      // Closed (e.g. 401 after the access cookie expired): refresh, then reconnect.
      this.reconnectTimer = setTimeout(() => {
        void (async () => {
          if (this.me?.kind === 'user') await refreshSession();
          this.connect();
        })();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    });
  }

  async reloadMe(): Promise<void> {
    this.me = await api.get<Me>('/auth/me');
  }

  disconnect(): void {
    this.es?.close();
    this.es = null;
  }
}

export const hub = new Hub();
