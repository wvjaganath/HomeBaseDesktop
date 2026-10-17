<script lang="ts">
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import { ApiError, api } from '../lib/api';

  /**
   * The LED plane tracker's settings (the same sections, fields and options as
   * its own /config page), saved on the tracker through the hub.
   */
  type Json = Record<string, unknown>;
  const SOURCES = [
    { id: 'AirLabs', label: 'AirLabs', hint: 'Free tier 1,000 calls/month — requires API key' },
    { id: 'FlightAware', label: 'FlightAware', hint: 'Free $5 credit ~1,000 calls/month — requires API key' },
    { id: 'FR24', label: 'FR24', hint: 'Paid — 1 credit per flight, most reliable fallback' },
  ] as const;
  type SourceId = (typeof SOURCES)[number]['id'];

  interface Form {
    journey_code: string;
    clock_format: string;
    temperature_units: string;
    distance_units: string;
    speed_units: string;
    location_home: string;
    temperature_location: string;
    zone_tl: string;
    zone_br: string;
    brightness: number;
    brightness_night: number;
    night_brightness: boolean;
    night_start: string;
    night_end: string;
    gpio_slowdown: number;
    hat_pwm_enabled: boolean;
    led_rgb_sequence: string;
    forecast_days: number;
    forecast_mode: string;
    forecast_hourly_start: string;
    forecast_hourly_end: string;
    min_altitude: number;
    max_farthest: number;
    max_closest: number;
    email: string;
    blocked_callsigns: string;
    airport_status_list: string;
    weather_alerts_enabled: boolean;
    iss_alerts_enabled: boolean;
    stats_log_days: string;
    master_tracker: string;
    other_tracker_hostnames: string;
    order: SourceId[];
    enabled: Record<SourceId, boolean>;
    airlabs_reset_day: number;
    flightaware_reset_day: number;
    fr24_reset_day: number;
    tomorrow_api_key: string;
    flightradar24_key: string;
    opensky_client_id: string;
    opensky_client_secret: string;
    airlabs_api_keys: string[];
    flightaware_api_keys: string[];
    flightaware_monthly_limit: number;
  }

  let phase = $state<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');
  let loadError = $state('');
  let form = $state<Form | null>(null);
  let saved = $state('');
  let busy = $state(false);
  let status = $state<{ kind: 'ok' | 'err' | ''; text: string }>({ kind: '', text: '' });
  let badField = $state('');
  let confirmRestart = $state(false);

  const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const pair = (a: unknown, b: unknown): string => (a || b ? `${String(a ?? '')}, ${String(b ?? '')}` : '');

  /** Tracker files → form, with the same defaults as the tracker's page. */
  function toForm(cfg: Json, sec: Json): Form {
    const loc = obj(cfg.location);
    const disp = obj(cfg.display);
    const flt = obj(cfg.flights);
    const ms = obj(cfg.master_slave);
    const apis = obj(cfg.api_sources);
    const zone = obj(loc.zone_home);
    const legacyReset = num(apis.reset_day, 1);
    const savedOrder = strs(apis.order).filter((s): s is SourceId => SOURCES.some((x) => x.id === s));
    const order = [...new Set([...savedOrder, ...SOURCES.map((s) => s.id)])];
    const en = obj(apis.enabled);
    const home = Array.isArray(loc.location_home) ? (loc.location_home as unknown[]) : [];
    return {
      journey_code: str(loc.journey_code, 'ORD'),
      clock_format: str(loc.clock_format, '12hr'),
      temperature_units: str(loc.temperature_units, 'imperial'),
      distance_units: str(loc.distance_units, 'imperial'),
      speed_units: str(loc.speed_units, 'imperial'),
      location_home: home.length ? home.join(', ') : '',
      temperature_location: str(loc.temperature_location),
      zone_tl: pair(zone.tl_y, zone.tl_x),
      zone_br: pair(zone.br_y, zone.br_x),
      brightness: num(disp.brightness, 100),
      brightness_night: num(disp.brightness_night, 50),
      night_brightness: bool(disp.night_brightness, false),
      night_start: str(disp.night_start, '22:00'),
      night_end: str(disp.night_end, '06:00'),
      gpio_slowdown: num(disp.gpio_slowdown, 2),
      hat_pwm_enabled: bool(disp.hat_pwm_enabled, false),
      led_rgb_sequence: str(disp.led_rgb_sequence, 'RGB'),
      forecast_days: num(disp.forecast_days, 3),
      forecast_mode: str(disp.forecast_mode, 'daily'),
      forecast_hourly_start: str(disp.forecast_hourly_start, '05:00'),
      forecast_hourly_end: str(disp.forecast_hourly_end, '09:00'),
      min_altitude: num(flt.min_altitude, 2600),
      max_farthest: num(flt.max_farthest, 3),
      max_closest: num(flt.max_closest, 3),
      email: str(flt.email),
      blocked_callsigns: strs(flt.blocked_callsigns).join(', '),
      airport_status_list: str(flt.airport_status_list),
      weather_alerts_enabled: flt.weather_alerts_enabled !== false,
      iss_alerts_enabled: flt.iss_alerts_enabled !== false,
      stats_log_days: num(obj(cfg.stats).stats_log_days, 0) ? String(obj(cfg.stats).stats_log_days) : '',
      master_tracker: str(ms.master_tracker),
      other_tracker_hostnames: strs(ms.other_tracker_hostnames).join(', '),
      order,
      enabled: { AirLabs: en.AirLabs !== false, FlightAware: en.FlightAware !== false, FR24: en.FR24 !== false },
      airlabs_reset_day: num(apis.airlabs_reset_day, legacyReset),
      flightaware_reset_day: num(apis.flightaware_reset_day, legacyReset),
      fr24_reset_day: num(apis.fr24_reset_day, legacyReset),
      tomorrow_api_key: str(sec.tomorrow_api_key),
      flightradar24_key: str(sec.flightradar24_key),
      opensky_client_id: str(sec.opensky_client_id),
      opensky_client_secret: str(sec.opensky_client_secret),
      airlabs_api_keys: strs(sec.airlabs_api_keys).length ? strs(sec.airlabs_api_keys) : [''],
      flightaware_api_keys: strs(sec.flightaware_api_keys).length ? strs(sec.flightaware_api_keys) : [''],
      flightaware_monthly_limit: num(sec.flightaware_monthly_limit, 4),
    };
  }

  const latlon = (s: string): [number, number] => {
    const [a = NaN, b = NaN] = s.split(',').map((p) => Number(p.trim()));
    return [a, b];
  };
  const list = (s: string, upper = true): string[] =>
    s
      .split(',')
      .map((p) => (upper ? p.trim().toUpperCase() : p.trim()))
      .filter(Boolean);

  /** Form → the exact payload the tracker's page sends. */
  function toPayload(f: Form): Json {
    const [tl_y, tl_x] = latlon(f.zone_tl);
    const [br_y, br_x] = latlon(f.zone_br);
    return {
      config: {
        location: {
          journey_code: f.journey_code.trim().toUpperCase(),
          clock_format: f.clock_format,
          temperature_units: f.temperature_units,
          distance_units: f.distance_units,
          speed_units: f.speed_units,
          location_home: latlon(f.location_home),
          temperature_location: f.temperature_location.trim(),
          zone_home: { tl_y, tl_x, br_y, br_x },
        },
        display: {
          brightness: Math.round(f.brightness),
          brightness_night: Math.round(f.brightness_night),
          night_brightness: f.night_brightness,
          night_start: f.night_start,
          night_end: f.night_end,
          gpio_slowdown: Number(f.gpio_slowdown),
          hat_pwm_enabled: f.hat_pwm_enabled,
          led_rgb_sequence: f.led_rgb_sequence,
          forecast_days: Math.round(f.forecast_days),
          forecast_mode: f.forecast_mode,
          forecast_hourly_start: f.forecast_hourly_start,
          forecast_hourly_end: f.forecast_hourly_end,
        },
        flights: {
          min_altitude: Math.round(f.min_altitude),
          max_farthest: Math.round(f.max_farthest),
          max_closest: Math.round(f.max_closest),
          email: f.email.trim(),
          blocked_callsigns: list(f.blocked_callsigns),
          airport_status_list: list(f.airport_status_list).join(', '),
          weather_alerts_enabled: f.weather_alerts_enabled,
          iss_alerts_enabled: f.iss_alerts_enabled,
        },
        stats: { stats_log_days: Math.max(0, Math.round(Number(f.stats_log_days) || 0)) },
        master_slave: { master_tracker: f.master_tracker.trim(), other_tracker_hostnames: list(f.other_tracker_hostnames, false) },
        api_sources: {
          order: f.order,
          enabled: f.enabled,
          airlabs_reset_day: Math.round(f.airlabs_reset_day) || 1,
          flightaware_reset_day: Math.round(f.flightaware_reset_day) || 1,
          fr24_reset_day: Math.round(f.fr24_reset_day) || 1,
        },
      },
      secrets: {
        tomorrow_api_key: f.tomorrow_api_key.trim(),
        opensky_client_id: f.opensky_client_id.trim(),
        opensky_client_secret: f.opensky_client_secret.trim(),
        airlabs_api_keys: f.airlabs_api_keys.map((k) => k.trim()).filter(Boolean),
        flightaware_api_keys: f.flightaware_api_keys.map((k) => k.trim()).filter(Boolean),
        flightaware_monthly_limit: Number(f.flightaware_monthly_limit) || 0,
        flightradar24_key: f.flightradar24_key.trim(),
      },
    };
  }

  const dirty = $derived(form !== null && JSON.stringify(form) !== saved);

  async function load(): Promise<void> {
    status = { kind: '', text: '' };
    badField = '';
    try {
      const r = await api.get<{ configured: boolean; config?: Json; secrets?: Json }>('/api/tracker-admin/settings');
      if (!r.configured) {
        phase = 'unconfigured';
        return;
      }
      form = toForm(r.config ?? {}, r.secrets ?? {});
      saved = JSON.stringify(form);
      phase = 'ready';
    } catch (err) {
      loadError = err instanceof ApiError && err.detail ? err.detail : 'Couldn’t load the tracker settings.';
      phase = 'error';
    }
  }

  async function save(): Promise<void> {
    if (!form) return;
    busy = true;
    status = { kind: '', text: '' };
    badField = '';
    try {
      await api.put('/api/tracker-admin/settings', toPayload(form));
      status = { kind: 'ok', text: '✓ Saved on the tracker and applied. LED RGB order and GPIO changes need a restart.' };
      await load();
      status = { kind: 'ok', text: '✓ Saved on the tracker and applied. LED RGB order and GPIO changes need a restart.' };
      void loadStatus();
    } catch (err) {
      if (err instanceof ApiError) {
        status = { kind: 'err', text: err.detail ?? 'Couldn’t save.' };
        badField = err.field ?? '';
        if (badField) document.getElementById(`f-${badField.split('.').pop() ?? ''}`)?.focus();
      } else status = { kind: 'err', text: 'Couldn’t save. Is the hub running?' };
    } finally {
      busy = false;
    }
  }

  async function restart(): Promise<void> {
    confirmRestart = false;
    status = { kind: '', text: 'Restarting…' };
    try {
      await api.post('/api/tracker-admin/restart', {});
      status = { kind: 'ok', text: '✓ Restarting — the LED display goes dark for a few seconds.' };
      setTimeout(() => void loadStatus(), 10_000);
    } catch (err) {
      status = { kind: 'err', text: err instanceof ApiError && err.detail ? err.detail : 'Couldn’t restart the tracker.' };
    }
  }

  function move(id: SourceId, dir: -1 | 1): void {
    if (!form) return;
    const i = form.order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= form.order.length) return;
    const next = [...form.order];
    [next[i], next[j]] = [next[j] as SourceId, next[i] as SourceId];
    form.order = next;
  }

  // ---- System status & API usage --------------------------------------------
  interface Sys {
    cpu_temp_c: number | null;
    uptime_secs: number | null;
    service_uptime_secs: number | null;
    load_avg: number[] | null;
  }
  let sys = $state<Sys | null>(null);
  let usage = $state<Json | null>(null);
  let statusError = $state(false);
  async function loadStatus(): Promise<void> {
    try {
      const r = await api.get<{ system: Sys | null; usage: Json | null }>('/api/tracker-admin/status');
      sys = r.system;
      usage = r.usage;
      statusError = false;
    } catch {
      statusError = true;
    }
  }
  const dur = (secs: number | null | undefined): string => {
    if (!secs) return '—';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const period = (key: string): string => str(usage?.[`${key}_period_start`] ?? usage?.month).slice(0, 7);

  // ---- Wi-Fi -------------------------------------------------------------
  interface Net {
    ssid: string;
    signal: number;
    security: string;
    active: boolean;
  }
  let wifi = $state<{ connected_ssid: string | null; ip_address: string; networks: Net[] } | null>(null);
  let wifiErr = $state('');
  let scanning = $state(false);
  let scanned = $state<Net[] | null>(null);
  let wSsid = $state('');
  let wPass = $state('');
  let wWarn = $state(false);
  let wBusy = $state(false);
  let wResult = $state<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const bars = (p: number): string => (p >= 80 ? '▂▄▆█' : p >= 55 ? '▂▄▆·' : p >= 30 ? '▂▄··' : p >= 10 ? '▂···' : '····');
  const secured = (n: Net): boolean => Boolean(n.security) && n.security !== '--';

  async function loadWifi(): Promise<void> {
    try {
      const r = await api.get<{ wifi: { connected_ssid?: string | null; ip_address?: string; networks?: Net[]; error?: string } }>('/api/tracker-admin/wifi');
      if (r.wifi.error) throw new Error(r.wifi.error);
      wifi = { connected_ssid: r.wifi.connected_ssid ?? null, ip_address: r.wifi.ip_address ?? '', networks: r.wifi.networks ?? [] };
      wifiErr = '';
    } catch {
      wifiErr = 'Couldn’t read the tracker’s Wi-Fi status.';
    }
  }
  async function scan(): Promise<void> {
    scanning = true;
    try {
      const r = await api.post<{ scan: { networks?: Net[]; error?: string } }>('/api/tracker-admin/wifi/scan', {});
      if (r.scan.error) throw new Error(r.scan.error);
      scanned = r.scan.networks ?? [];
    } catch (err) {
      wResult = { kind: 'err', text: `Scan failed: ${err instanceof ApiError && err.detail ? err.detail : err instanceof Error ? err.message : 'error'}` };
    } finally {
      scanning = false;
    }
  }
  function pick(n: Net): void {
    wSsid = n.ssid;
    wPass = '';
    wWarn = false;
    wResult = secured(n) ? { kind: 'info', text: `Selected ${n.ssid}. Enter its password below and choose Connect.` } : null;
    if (secured(n)) setTimeout(() => document.getElementById('wifi-pass')?.focus(), 0);
    else void connect();
  }
  async function connect(confirmed = false): Promise<void> {
    if (!wSsid.trim()) {
      wResult = { kind: 'err', text: 'Enter a network name (SSID).' };
      return;
    }
    if (!confirmed && wSsid.trim() !== wifi?.connected_ssid) {
      wWarn = true;
      return;
    }
    wWarn = false;
    wBusy = true;
    wResult = { kind: 'info', text: `Connecting the tracker to ${wSsid}… (up to 30 seconds)` };
    try {
      const r = await api.post<{ success?: boolean; switched?: boolean; message?: string; error?: string }>('/api/tracker-admin/wifi/connect', {
        ssid: wSsid.trim(),
        password: wPass,
      });
      wPass = '';
      wResult = r.success ? { kind: 'ok', text: r.message ?? `Connected to ${wSsid}` } : { kind: 'err', text: r.error ?? 'Connection failed' };
      if (r.success && !r.switched) void loadWifi();
    } catch (err) {
      wResult = { kind: 'err', text: err instanceof ApiError && err.detail ? err.detail : 'Connection failed.' };
    } finally {
      wBusy = false;
    }
  }

  $effect(() => {
    void load();
    void loadStatus();
    void loadWifi();
  });

  const bad = (k: string): boolean => badField.endsWith(`.${k}`);
</script>

<div class="screen-wrap">
<div class="page tracker">
  <div class="page-head">
    <a class="btn icon ghost" href="#/settings" aria-label="Back to Settings"><Icon name="left" /></a>
    <h1>Plane tracker</h1>
    <span class="muted">Settings for the LED tracker Pi, saved on the tracker itself</span>
  </div>

  {#if phase === 'loading'}
    <p class="muted">Loading the tracker’s settings…</p>
  {:else if phase === 'unconfigured'}
    <section class="card section">
      <h2>The hub doesn’t know where the tracker is</h2>
      <p class="muted">Set <code>TRACKER_URL</code> in <code>deploy/hub.env</code> to the tracker’s address (for example <code>http://192.168.1.60:8080</code>), then run <code>docker compose up -d hub</code>.</p>
    </section>
  {:else if phase === 'error'}
    <section class="card section">
      <h2>Couldn’t reach the plane tracker</h2>
      <p class="muted">{loadError}</p>
      <p class="muted">Check that the LED Pi is on and its address in <code>TRACKER_URL</code> is right.</p>
      <div class="row"><button class="btn" onclick={() => { phase = 'loading'; void load(); }}><Icon name="reload" size={18} /> Try again</button></div>
    </section>
  {:else if form}
    <details class="card group" open>
      <summary>System status &amp; API usage</summary>
      {#if statusError || !sys}
        <p class="muted">{statusError ? 'Couldn’t load the tracker’s status.' : 'Loading…'}</p>
      {:else}
        {@const t = sys.cpu_temp_c}
        {@const al = Number(usage?.AirLabs ?? 0)}
        {@const fa = Number(usage?.FlightAware ?? 0)}
        {@const fr = Number(usage?.FR24 ?? 0)}
        <div class="stat-grid">
          <div class="stat"><span class="k">Pi uptime</span><span class="v">{dur(sys.uptime_secs)}</span></div>
          <div class="stat"><span class="k">Service uptime</span><span class="v">{dur(sys.service_uptime_secs)}</span></div>
          <div class="stat" class:warn={t !== null && t >= 70}>
            <span class="k">CPU temp</span>
            <span class="v">{t === null ? '—' : `${t}°C`}</span>
            <span class="s">{t === null ? '' : `${((t * 9) / 5 + 32).toFixed(1)}°F`}{t !== null && t >= 70 ? ' · running hot' : ''}</span>
          </div>
          <div class="stat" class:warn={al >= 900}>
            <span class="k">AirLabs {period('AirLabs')}</span>
            <span class="v">{al.toLocaleString()}</span>
            <span class="s">of 1,000 calls{al >= 900 ? ' · nearly used up' : ''}</span>
          </div>
          <div class="stat" class:warn={fa >= 4.5}>
            <span class="k">FlightAware {period('FlightAware')}</span>
            <span class="v">${fa.toFixed(2)}</span>
            <span class="s">of $5.00{fa >= 4.5 ? ' · nearly used up' : ''}</span>
          </div>
          <div class="stat"><span class="k">FR24 {period('FR24')}</span><span class="v">{fr.toLocaleString()}</span><span class="s">credits</span></div>
          <div class="stat">
            <span class="k">Load average</span>
            <span class="v small">{sys.load_avg ? sys.load_avg.map((v) => v.toFixed(2)).join(' / ') : '—'}</span>
            <span class="s">1 / 5 / 15 min</span>
          </div>
        </div>
      {/if}
    </details>

    <details class="card group" open>
      <summary>Location &amp; zone</summary>
      <div class="grid">
        <label class="field" class:bad={bad('journey_code')}>
          <span>Home airport code</span>
          <input id="f-journey_code" maxlength="4" class="upper" bind:value={form.journey_code} />
          <small>Your nearest major airport ICAO code</small>
        </label>
        <label class="field">
          <span>Clock format</span>
          <select bind:value={form.clock_format}><option value="12hr">12hr</option><option value="24hr">24hr</option></select>
        </label>
        <label class="field">
          <span>Temperature units</span>
          <select bind:value={form.temperature_units}><option value="imperial">Imperial (°F)</option><option value="metric">Metric (°C)</option></select>
        </label>
        <label class="field">
          <span>Distance units</span>
          <select bind:value={form.distance_units}><option value="imperial">Imperial (mi)</option><option value="metric">Metric (km)</option><option value="nautical">Nautical (nm)</option></select>
        </label>
        <label class="field">
          <span>Speed units</span>
          <select bind:value={form.speed_units}><option value="imperial">Imperial (mph)</option><option value="metric">Metric (km/h)</option><option value="knots">Knots (kts)</option></select>
        </label>
        <label class="field" class:bad={bad('location_home') || badField.includes('location_home')}>
          <span>Home lat, lon</span>
          <input id="f-location_home" inputmode="decimal" bind:value={form.location_home} placeholder="41.882772, -87.623225" />
          <small>e.g. 41.882772, -87.623225</small>
        </label>
        <label class="field" class:bad={bad('temperature_location')}>
          <span>Temperature location (lat, lon)</span>
          <input id="f-temperature_location" inputmode="decimal" bind:value={form.temperature_location} />
          <small>Same as home lat, lon usually</small>
        </label>
        <label class="field" class:bad={badField.includes('zone_home.tl')}>
          <span>Top-left zone (lat, lon)</span>
          <input id="f-tl_y" inputmode="decimal" bind:value={form.zone_tl} placeholder="41.921086, -87.694973" />
        </label>
        <label class="field" class:bad={badField.includes('zone_home.br')}>
          <span>Bottom-right zone (lat, lon)</span>
          <input id="f-br_y" inputmode="decimal" bind:value={form.zone_br} placeholder="41.849068, -87.548980" />
        </label>
      </div>
    </details>

    <details class="card group" open>
      <summary>Display</summary>
      <div class="grid">
        <label class="field" class:bad={bad('brightness')}><span>Brightness (day) %</span><input id="f-brightness" type="number" min="0" max="100" bind:value={form.brightness} /></label>
        <label class="field" class:bad={bad('brightness_night')}><span>Brightness (night) %</span><input id="f-brightness_night" type="number" min="0" max="100" bind:value={form.brightness_night} /></label>
        <label class="check"><input type="checkbox" bind:checked={form.night_brightness} /> Enable night dimming</label>
        <label class="field" class:bad={bad('night_start')}><span>Night start</span><input id="f-night_start" type="time" bind:value={form.night_start} /></label>
        <label class="field" class:bad={bad('night_end')}><span>Night end</span><input id="f-night_end" type="time" bind:value={form.night_end} /></label>
        <label class="field">
          <span>GPIO slowdown</span>
          <select bind:value={form.gpio_slowdown}>
            <option value={1}>1 — Pi Zero / Pi 4</option>
            <option value={2}>2 — Pi 3</option>
            <option value={3}>3 — Pi 5</option>
            {#if ![1, 2, 3].includes(form.gpio_slowdown)}<option value={form.gpio_slowdown}>{form.gpio_slowdown} (current)</option>{/if}
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={form.hat_pwm_enabled} /> HAT PWM enabled (soldered bridge)</label>
        <label class="field">
          <span>LED RGB order</span>
          <select bind:value={form.led_rgb_sequence}>
            <option value="RGB">RGB (most panels)</option>
            <option value="RBG">RBG (some panels)</option>
            <option value="GRB">GRB</option>
            <option value="GBR">GBR</option>
            <option value="BRG">BRG</option>
            <option value="BGR">BGR</option>
          </select>
          <small>Change if colours look wrong — requires a restart</small>
        </label>
        <label class="field" class:bad={bad('forecast_days')}><span>Forecast days</span><input id="f-forecast_days" type="number" min="1" max="5" bind:value={form.forecast_days} /></label>
        <label class="field">
          <span>Forecast mode</span>
          <select bind:value={form.forecast_mode}>
            <option value="daily">3-day (daily)</option>
            <option value="hourly">Time of day (hourly)</option>
            <option value="scheduled">Hourly in window, else 3-day</option>
          </select>
        </label>
        <label class="field" class:bad={bad('forecast_hourly_start')}><span>Hourly window start</span><input id="f-forecast_hourly_start" type="time" bind:value={form.forecast_hourly_start} /></label>
        <label class="field" class:bad={bad('forecast_hourly_end')}><span>Hourly window end</span><input id="f-forecast_hourly_end" type="time" bind:value={form.forecast_hourly_end} /></label>
      </div>
    </details>

    <details class="card group" open>
      <summary>Flights</summary>
      <div class="grid">
        <label class="field" class:bad={bad('min_altitude')}>
          <span>Min altitude (ft)</span>
          <input id="f-min_altitude" type="number" min="0" step="100" bind:value={form.min_altitude} />
          <small>Filter out low GA traffic</small>
        </label>
        <label class="field" class:bad={bad('max_farthest')}><span>Max farthest flights</span><input id="f-max_farthest" type="number" min="1" max="10" bind:value={form.max_farthest} /></label>
        <label class="field" class:bad={bad('max_closest')}><span>Max closest flights</span><input id="f-max_closest" type="number" min="1" max="10" bind:value={form.max_closest} /></label>
        <label class="field" class:bad={bad('email')}>
          <span>Alert email</span>
          <input id="f-email" type="email" autocomplete="off" bind:value={form.email} />
          <small>Leave blank to disable email alerts</small>
        </label>
        <label class="field wide" class:bad={badField.includes('blocked_callsigns')}>
          <span>Blocked callsigns</span>
          <input id="f-blocked_callsigns" class="upper" spellcheck="false" autocomplete="off" placeholder="N12345, UAL1234, …" bind:value={form.blocked_callsigns} />
          <small>Comma-separated. Matching planes are ignored before any API lookup.</small>
        </label>
        <label class="field wide" class:bad={bad('airport_status_list')}>
          <span>Airport status watch list</span>
          <input id="f-airport_status_list" class="upper" spellcheck="false" autocomplete="off" placeholder="ORD, MDW, LAX, …" bind:value={form.airport_status_list} />
          <small>Comma-separated IATA codes. FAA delay/ground stop alerts shown on the clock. Leave blank to disable.</small>
        </label>
        <label class="check wide"><input type="checkbox" bind:checked={form.weather_alerts_enabled} /> Enable NWS weather alerts (US only, no key required)</label>
        <label class="check wide"><input type="checkbox" bind:checked={form.iss_alerts_enabled} /> Enable ISS pass alerts (no key required)</label>
      </div>
    </details>

    <details class="card group" open>
      <summary>Stats logging</summary>
      <div class="grid">
        <label class="field" class:bad={bad('stats_log_days')}>
          <span>Flight log retention (days)</span>
          <input id="f-stats_log_days" type="number" min="0" bind:value={form.stats_log_days} />
          <small>Days of flight history to keep. Leave blank to keep forever.</small>
        </label>
      </div>
    </details>

    <details class="card group" open>
      <summary>Master / slave</summary>
      <div class="grid">
        <label class="field" class:bad={bad('master_tracker')}>
          <span>Master tracker hostname</span>
          <input id="f-master_tracker" spellcheck="false" autocomplete="off" bind:value={form.master_tracker} />
          <small>Leave blank if this is the master</small>
        </label>
        <label class="field" class:bad={badField.includes('other_tracker_hostnames')}>
          <span>Other tracker hostnames</span>
          <input id="f-other_tracker_hostnames" spellcheck="false" autocomplete="off" bind:value={form.other_tracker_hostnames} />
          <small>Comma-separated slave hostnames</small>
        </label>
      </div>
    </details>

    <details class="card group" open>
      <summary>API sources &amp; order</summary>
      <div class="two">
        <div class="col">
          <p class="muted">Enable sources and set the priority order. OpenSky provides position data only.</p>
          <ol class="sources">
            {#each form.order as id, i (id)}
              {@const src = SOURCES.find((s) => s.id === id)}
              <li>
                <span class="num">{i + 1}</span>
                <input type="checkbox" aria-label={`Use ${id}`} bind:checked={form.enabled[id]} />
                <div class="grow">
                  <div>{src?.label ?? id}</div>
                  <small class="muted">{src?.hint ?? ''}</small>
                </div>
                <button class="btn icon small" aria-label={`Move ${id} up`} disabled={i === 0} onclick={() => move(id, -1)}><Icon name="up" size={18} /></button>
                <button class="btn icon small" aria-label={`Move ${id} down`} disabled={i === form.order.length - 1} onclick={() => move(id, 1)}><Icon name="down" size={18} /></button>
              </li>
            {/each}
          </ol>
        </div>
        <div class="col">
          <label class="field" class:bad={bad('tomorrow_api_key')}><span>Tomorrow.io weather key</span><input id="f-tomorrow_api_key" class="mono" spellcheck="false" autocomplete="off" bind:value={form.tomorrow_api_key} /></label>
          <label class="field" class:bad={bad('flightradar24_key')}><span>FR24 API key (official/paid)</span><input id="f-flightradar24_key" class="mono" spellcheck="false" autocomplete="off" bind:value={form.flightradar24_key} /></label>
          <label class="field" class:bad={bad('opensky_client_id')}><span>OpenSky client ID</span><input id="f-opensky_client_id" class="mono" spellcheck="false" autocomplete="off" bind:value={form.opensky_client_id} /></label>
          <label class="field" class:bad={bad('opensky_client_secret')}><span>OpenSky client secret</span><input id="f-opensky_client_secret" class="mono" spellcheck="false" autocomplete="off" bind:value={form.opensky_client_secret} /></label>
          {#each [['airlabs_api_keys', 'AirLabs API keys'], ['flightaware_api_keys', 'FlightAware API keys']] as const as [key, label] (key)}
            <div class="field" class:bad={badField.includes(key)}>
              <span>{label}</span>
              {#each form[key] as _, i (i)}
                <div class="keyrow">
                  <input class="mono grow" spellcheck="false" autocomplete="off" placeholder={`Key ${i + 1}`} aria-label={`${label} ${i + 1}`} bind:value={form[key][i]} />
                  <button class="btn icon small" aria-label="Remove key" onclick={() => form && (form[key] = form[key].filter((__, j) => j !== i))}><Icon name="minus" size={18} /></button>
                </div>
              {/each}
              <button class="btn small" onclick={() => form && (form[key] = [...form[key], ''])}><Icon name="plus" size={16} /> Add key</button>
            </div>
          {/each}
          <label class="field" class:bad={bad('flightaware_monthly_limit')}><span>FlightAware monthly $ limit per key</span><input id="f-flightaware_monthly_limit" type="number" step="0.5" min="0" bind:value={form.flightaware_monthly_limit} /></label>
          <label class="field" class:bad={bad('airlabs_reset_day')}><span>AirLabs billing reset day</span><input id="f-airlabs_reset_day" type="number" min="1" max="31" bind:value={form.airlabs_reset_day} /><small>Day of month your AirLabs subscription renews (1–31)</small></label>
          <label class="field" class:bad={bad('flightaware_reset_day')}><span>FlightAware billing reset day</span><input id="f-flightaware_reset_day" type="number" min="1" max="31" bind:value={form.flightaware_reset_day} /><small>Day of month your FlightAware subscription renews (1–31)</small></label>
          <label class="field" class:bad={bad('fr24_reset_day')}><span>FR24 billing reset day</span><input id="f-fr24_reset_day" type="number" min="1" max="31" bind:value={form.fr24_reset_day} /><small>Day of month your FR24 subscription renews (1–31)</small></label>
          <p class="muted small">Saved keys show masked (first and last 4 characters). Leave them as they are to keep them; type a new one to replace it.</p>
        </div>
      </div>
    </details>

    <details class="card group" open>
      <summary>Wi-Fi</summary>
      {#if wifiErr}
        <p class="muted">{wifiErr}</p>
      {:else if wifi}
        <div class="stat-grid">
          <div class="stat"><span class="k">Status</span><span class="v small" class:okc={!!wifi.connected_ssid}>{wifi.connected_ssid ? 'Connected' : 'Not connected'}</span></div>
          <div class="stat"><span class="k">Network</span><span class="v small">{wifi.connected_ssid ?? '—'}</span></div>
          <div class="stat"><span class="k">IP address</span><span class="v small mono">{wifi.ip_address || '—'}</span></div>
          <div class="stat">
            <span class="k">Signal</span>
            {#if wifi.networks.find((n) => n.active)}
              {@const cur = wifi.networks.find((n) => n.active)}
              <span class="v small"><span class="mono" aria-hidden="true">{bars(cur?.signal ?? 0)}</span> {cur?.signal}%</span>
            {:else}<span class="v small">—</span>{/if}
          </div>
        </div>
      {:else}
        <p class="muted">Loading…</p>
      {/if}
      <div class="row"><button class="btn" disabled={scanning} onclick={scan}><Icon name="reload" size={18} /> {scanning ? 'Scanning…' : 'Scan for networks'}</button>{#if scanned}<span class="muted">{scanned.length} networks found</span>{/if}</div>
      {#if scanned && scanned.length}
        <ul class="nets">
          {#each scanned as n (n.ssid)}
            <li>
              <button class="net" class:active={n.active} disabled={n.active || wBusy} onclick={() => pick(n)}>
                <span class="mono" aria-hidden="true">{bars(n.signal)}</span>
                <span class="grow">{n.ssid}{n.active ? ' ✓' : ''}</span>
                <span class="muted">{secured(n) ? 'Secured' : 'Open'} · {n.signal}%</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="grid">
        <label class="field"><span>Network name (SSID)</span><input autocomplete="off" spellcheck="false" maxlength="32" bind:value={wSsid} /></label>
        <label class="field"><span>Password</span><input id="wifi-pass" type="password" autocomplete="off" maxlength="63" bind:value={wPass} /></label>
      </div>
      <div class="row"><button class="btn" disabled={wBusy} onclick={() => void connect()}>Connect the tracker</button></div>
      {#if wWarn}
        <div class="warnbox" role="alert">
          <p><strong>This moves the tracker to a different network.</strong> If the new network gives it a different address, HomeBase loses it until you update <code>TRACKER_URL</code> in hub.env.</p>
          <div class="row"><button class="btn primary" onclick={() => void connect(true)}>Connect anyway</button><button class="btn" onclick={() => (wWarn = false)}>Cancel</button></div>
        </div>
      {/if}
      {#if wResult}<p class={`wres ${wResult.kind}`} role="status">{wResult.text}</p>{/if}
    </details>

  {/if}
</div>
{#if phase === 'ready' && form}
  <div class="actions">
    <button class="btn primary" disabled={busy || !dirty} onclick={save}>{busy ? 'Saving…' : 'Save & apply'}</button>
    <button class="btn" disabled={busy} onclick={() => void load()}>Reload</button>
    <button class="btn danger" onclick={() => (confirmRestart = true)}><Icon name="reload" size={18} /> Restart tracker</button>
    {#if status.text}<span class={`msg ${status.kind}`} role="status">{status.text}</span>{:else if dirty}<span class="msg muted">Unsaved changes</span>{/if}
  </div>
{/if}
</div>

<Dialog bind:open={confirmRestart} title="Restart the plane tracker?" width={460}>
  <p class="muted">The LED display goes dark for a few seconds while the tracker app restarts.</p>
  <div class="row end">
    <button class="btn" onclick={() => (confirmRestart = false)}>Cancel</button>
    <button class="btn danger" onclick={restart}>Restart</button>
  </div>
</Dialog>

<style>
  .screen-wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tracker {
    flex: 1;
    min-height: 0;
    height: auto;
  }
  .group {
    padding: 0;
  }
  .group > summary {
    padding: 20px 24px;
    font-size: 20px;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .group > summary::-webkit-details-marker {
    display: none;
  }
  .group > summary::before {
    content: '▸';
    color: var(--muted);
    transition: transform 0.15s;
  }
  .group[open] > summary::before {
    transform: rotate(90deg);
  }
  .group > :not(summary) {
    margin: 0 24px 20px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px 18px;
    align-items: start;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 24px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .field small {
    color: var(--faint);
    font-size: 13px;
  }
  .field.bad input {
    border-color: var(--bad);
  }
  .upper {
    text-transform: uppercase;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    color: var(--text-2);
    align-self: end;
  }
  .check input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .sources {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sources li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
  }
  .sources input[type='checkbox'] {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .num {
    width: 22px;
    text-align: center;
    font-weight: 700;
    color: var(--accent);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .keyrow {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .keyrow input {
    min-height: 44px;
    padding: 0 14px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    color: var(--text);
    font-size: 15px;
  }
  .mono {
    font-family: var(--mono);
  }
  .small {
    font-size: 14px;
  }
  .v.small {
    font-size: 19px;
  }
  .stat.warn {
    border-color: var(--bad);
  }
  .stat.warn .v,
  .stat.warn .s {
    color: var(--bad);
  }
  .okc {
    color: var(--ok);
  }
  .nets {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 640px;
  }
  .net {
    width: 100%;
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .net.active {
    border-color: var(--accent);
    cursor: default;
  }
  .warnbox {
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--warn);
    background: color-mix(in srgb, var(--warn) 8%, transparent);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .warnbox p,
  .wres {
    margin: 0;
  }
  .wres.ok {
    color: var(--ok);
  }
  .wres.err {
    color: var(--bad);
  }
  .wres.info {
    color: var(--text-2);
  }
  .actions {
    flex: none;
    padding: 14px 36px;
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    background: var(--bg-deep);
    border-top: 1px solid var(--line-2);
  }
  .msg.ok {
    color: var(--ok);
  }
  .msg.err {
    color: var(--bad);
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .row.end {
    justify-content: flex-end;
  }
  code {
    font-family: var(--mono);
    color: var(--text-2);
  }
</style>
