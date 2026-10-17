<script lang="ts">
  import BarChart from '../components/BarChart.svelte';
  import Icon from '../components/Icon.svelte';
  import RecordMap, { RANK_COLORS } from '../components/RecordMap.svelte';
  import { ApiError, api } from '../lib/api';
  import { distUnit, fmtInt, shortTime } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import type { ApiCall, DayDetail, DaySummary, FlightRecord, RouteResult, TrackedLeg, TrackedState } from '../lib/types';

  /**
   * The plane tracker's own pages, rebuilt in HomeBase: flight stats, closest
   * and farthest records with maps, tracking a flight, and the API call log.
   * The data lives with the tracker; the hub reads it and checks every field.
   */
  type Tab = 'stats' | 'records' | 'track' | 'log';
  const TABS: Array<{ id: Tab; label: string; people?: true }> = [
    { id: 'stats', label: 'Stats' },
    { id: 'records', label: 'Closest & farthest' },
    { id: 'track', label: 'Track a flight' },
    { id: 'log', label: 'API calls', people: true },
  ];
  const kiosk = $derived(hub.isKiosk);
  const tabs = $derived(TABS.filter((t) => !(kiosk && t.people)));
  const fromHash = (): Tab => {
    const sub = location.hash.split('/')[2]?.split('?')[0] ?? '';
    return (TABS.some((t) => t.id === sub) ? sub : 'stats') as Tab;
  };
  let tab = $state<Tab>(fromHash());
  $effect(() => {
    const on = (): void => {
      tab = fromHash();
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  });

  const units = $derived(hub.config?.units ?? 'imperial');
  const unit = $derived(distUnit(units));
  const home = $derived(hub.config?.home ?? { lat: 0, lon: 0 });
  const why = (err: unknown, fallback: string): string => (err instanceof ApiError && err.detail ? err.detail : fallback);
  const dist = (v: number | null): string => (v === null ? '—' : `${v < 10 ? v.toFixed(2) : fmtInt(v)} ${unit}`);
  const dayLabel = (ymd: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string => {
    const [y = 0, m = 1, d = 1] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', opts);
  };
  const when = (unix: number | null): string => {
    if (!unix) return '—';
    const d = new Date(unix * 1000);
    return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: hub.config?.timezone })} · ${shortTime(d)}`;
  };

  // ---------------- Stats ----------------
  let days = $state<DaySummary[] | null>(null);
  let usage = $state<Record<string, number | string>>({});
  let statsErr = $state('');
  let pickedDay = $state('');
  let detail = $state<DayDetail | null>(null);
  let detailErr = $state('');

  async function loadStats(): Promise<void> {
    statsErr = '';
    try {
      const r = await api.get<{ days: DaySummary[]; usage: Record<string, number | string> }>('/api/tracker/stats');
      days = r.days;
      usage = r.usage;
      if (!pickedDay || !r.days.some((d) => d.date === pickedDay)) pickedDay = r.days.at(-1)?.date ?? '';
    } catch (err) {
      statsErr = why(err, 'Couldn’t load the flight stats.');
    }
  }
  $effect(() => {
    const day = pickedDay;
    if (!day) {
      detail = null;
      return;
    }
    detailErr = '';
    api
      .get<DayDetail>(`/api/tracker/stats/${day}`)
      .then((d) => {
        if (pickedDay === day) detail = d;
      })
      .catch((err: unknown) => {
        if (pickedDay === day) {
          detail = null;
          detailErr = why(err, 'Couldn’t load that day.');
        }
      });
  });

  const totals = $derived.by(() => {
    const list = days ?? [];
    const last = (n: number): number => list.slice(-n).reduce((a, d) => a + d.count, 0);
    const busiest = list.reduce<DaySummary | null>((b, d) => (b === null || d.count > b.count ? d : b), null);
    const latest = list.at(-1);
    return { today: latest?.count ?? 0, latest: latest?.date ?? '', week: last(7), month: last(30), all: last(list.length), busiest, logged: list.length };
  });
  const dailyBars = $derived((days ?? []).slice(-30).map((d) => ({ key: d.date, label: dayLabel(d.date), value: d.count })));
  const hourBars = $derived.by(() => {
    const d = (days ?? []).find((x) => x.date === pickedDay);
    return (d?.byHour ?? Array<number>(24).fill(0)).map((v, h) => ({ key: String(h), label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`, value: v }));
  });
  const num = (k: string): number => (typeof usage[k] === 'number' ? usage[k] : 0);
  const since = (k: string): string => {
    const v = usage[`${k}_period_start`];
    return typeof v === 'string' ? `since ${dayLabel(v)}` : 'this period';
  };

  // ---------------- Records ----------------
  let closest = $state<FlightRecord[] | null>(null);
  let farthest = $state<FlightRecord[] | null>(null);
  let recErr = $state('');
  let pickClose = $state<string | null>(null);
  let pickFar = $state<string | null>(null);
  async function loadRecords(): Promise<void> {
    recErr = '';
    try {
      const r = await api.get<{ closest: FlightRecord[]; farthest: FlightRecord[] }>('/api/tracker/records');
      closest = r.closest;
      farthest = r.farthest;
    } catch (err) {
      recErr = why(err, 'Couldn’t load the records.');
    }
  }

  // ---------------- Track a flight ----------------
  let tracked = $state<TrackedState | null>(null);
  let trackedLoaded = $state(false);
  let trackErr = $state('');
  let callsign = $state('');
  let looking = $state(false);
  let legs = $state<TrackedLeg[] | null>(null);
  let legsFor = $state('');
  let lookMsg = $state<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  let saving = $state(false);
  let rOrigin = $state('');
  let rDest = $state('');
  let routeBusy = $state(false);
  let routes = $state<RouteResult[] | null>(null);
  let routeMsg = $state('');

  async function loadTracked(): Promise<void> {
    try {
      tracked = (await api.get<{ tracked: TrackedState | null }>('/api/tracker/tracked')).tracked;
      trackErr = '';
    } catch (err) {
      trackErr = why(err, 'Couldn’t read the tracked flight.');
    } finally {
      trackedLoaded = true;
    }
  }
  async function lookup(cs = callsign): Promise<void> {
    const c = cs.trim().toUpperCase();
    if (!c) return;
    callsign = c;
    looking = true;
    legs = null;
    lookMsg = { kind: 'info', text: `Looking up ${c}…` };
    try {
      const r = await api.post<{ found: boolean; summary: string; legs: TrackedLeg[] }>('/api/tracker/tracked/lookup', { callsign: c });
      legs = r.found ? r.legs : null;
      legsFor = c;
      lookMsg = { kind: r.found ? 'ok' : 'err', text: r.summary || (r.found ? '' : `${c} not found`) };
    } catch (err) {
      lookMsg = { kind: 'err', text: why(err, 'The lookup failed.') };
    } finally {
      looking = false;
    }
  }
  async function track(leg: number): Promise<void> {
    saving = true;
    try {
      const r = await api.post<{ message: string }>('/api/tracker/tracked', { callsign: legsFor, leg });
      lookMsg = { kind: 'ok', text: r.message || `Now tracking ${legsFor}.` };
      legs = null;
      await loadTracked();
    } catch (err) {
      lookMsg = { kind: 'err', text: why(err, 'Couldn’t start tracking.') };
    } finally {
      saving = false;
    }
  }
  async function stopTracking(): Promise<void> {
    saving = true;
    try {
      await api.del('/api/tracker/tracked');
      lookMsg = { kind: 'ok', text: 'Tracking cleared.' };
      await loadTracked();
    } catch (err) {
      trackErr = why(err, 'Couldn’t clear tracking.');
    } finally {
      saving = false;
    }
  }
  async function searchRoute(): Promise<void> {
    routeBusy = true;
    routes = null;
    routeMsg = '';
    try {
      const r = await api.post<{ found: boolean; error: string; flights: RouteResult[] }>('/api/tracker/route-search', { origin: rOrigin, destination: rDest });
      routes = r.flights;
      if (!r.found) routeMsg = r.error ? `Search failed: ${r.error}` : 'No flights found on that route in the last 12 hours or next 6.';
    } catch (err) {
      routeMsg = why(err, 'The search failed.');
    } finally {
      routeBusy = false;
    }
  }
  const progress = $derived.by(() => {
    const l = tracked?.live;
    if (!l || l.totalDistance === null || l.distanceRemaining === null || l.totalDistance <= 0) return null;
    return Math.max(0, Math.min(1, 1 - l.distanceRemaining / l.totalDistance));
  });

  // ---------------- API log ----------------
  let calls = $state<ApiCall[] | null>(null);
  let logErr = $state('');
  let source = $state('all');
  const sources = $derived([...new Set((calls ?? []).map((c) => c.source))].sort());
  const shown = $derived((calls ?? []).filter((c) => source === 'all' || c.source === source));
  async function loadLog(): Promise<void> {
    logErr = '';
    try {
      calls = (await api.get<{ calls: ApiCall[] }>('/api/tracker/api-log')).calls;
    } catch (err) {
      logErr = why(err, 'Couldn’t load the API log.');
    }
  }

  // Load what the open tab needs; keep the tracked flight fresh while it's open.
  $effect(() => {
    if (tab === 'stats') void loadStats();
    else if (tab === 'records') void loadRecords();
    else if (tab === 'log') void loadLog();
    else {
      void loadTracked();
      const t = setInterval(() => void loadTracked(), 30_000);
      return () => clearInterval(t);
    }
    return undefined;
  });
</script>

<div class="page planelog">
  <div class="page-head">
    <a class="btn icon ghost" href="#/flights" aria-label="Back to Flights"><Icon name="left" /></a>
    <h1>Plane tracker</h1>
    {#if !kiosk}<a class="btn small push" href="#/tracker-settings"><Icon name="settings" size={16} /> Settings</a>{/if}
  </div>
  <div class="seg" role="tablist" aria-label="Plane tracker pages">
    {#each tabs as t (t.id)}
      <a role="tab" class="tabbtn" class:on={tab === t.id} aria-selected={tab === t.id} href={`#/tracker/${t.id}`}>{t.label}</a>
    {/each}
  </div>

  {#if tab === 'stats'}
    {#if statsErr}
      <section class="card section"><p class="muted">{statsErr}</p><div class="row"><button class="btn" onclick={() => void loadStats()}><Icon name="reload" size={18} /> Try again</button></div></section>
    {:else if !days}
      <p class="muted">Loading…</p>
    {:else if days.length === 0}
      <section class="card section"><h2>No flights logged yet</h2><p class="muted">The tracker counts every flight it sees over home. Check back after the first one passes.</p></section>
    {:else}
      <div class="tiles">
        <div class="card tile"><span class="k">{totals.latest ? dayLabel(totals.latest, { weekday: 'long' }) : 'Today'}</span><span class="v">{fmtInt(totals.today)}</span><span class="s">flights overhead</span></div>
        <div class="card tile"><span class="k">Last 7 days</span><span class="v">{fmtInt(totals.week)}</span></div>
        <div class="card tile"><span class="k">Last 30 days</span><span class="v">{fmtInt(totals.month)}</span></div>
        <div class="card tile"><span class="k">All logged</span><span class="v">{fmtInt(totals.all)}</span><span class="s">over {totals.logged} day{totals.logged === 1 ? '' : 's'}</span></div>
        {#if totals.busiest}<div class="card tile"><span class="k">Busiest day</span><span class="v">{fmtInt(totals.busiest.count)}</span><span class="s">{dayLabel(totals.busiest.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>{/if}
      </div>

      <section class="card section">
        <h2>Flights per day</h2>
        <BarChart bars={dailyBars} label="Flights over home per day, last 30 days" unit="flights" height={240} />
      </section>

      <section class="card section">
        <div class="row between">
          <h2>By hour</h2>
          <label class="inline">
            <span class="muted">Day</span>
            <select bind:value={pickedDay}>
              {#each [...days].reverse() as d (d.date)}<option value={d.date}>{dayLabel(d.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} ({d.count})</option>{/each}
            </select>
          </label>
        </div>
        <BarChart bars={hourBars} label={`Flights by hour on ${pickedDay}`} unit="flights" height={200} color="#2dd4bf" />
        {#if detailErr}
          <p class="muted">{detailErr}</p>
        {:else if detail}
          <p class="muted small">{detail.count} flight{detail.count === 1 ? '' : 's'}{detail.firstSeen ? ` · first ${detail.firstSeen.slice(0, 5)}, last ${detail.lastSeen.slice(0, 5)}` : ''}</p>
          {#if detail.flights.length}
            <div class="tablewrap">
              <table>
                <thead><tr><th>Time</th><th>Flight</th><th>Route</th><th>Aircraft</th></tr></thead>
                <tbody>
                  {#each [...detail.flights].sort((a, b) => b.time.localeCompare(a.time)) as f, i (`${f.callsign}-${i}`)}
                    <tr><td class="mono">{f.time.slice(0, 5)}</td><td class="mono">{f.callsign}</td><td>{f.origin || '?'} → {f.destination || '?'}</td><td class="muted">{f.aircraft || '—'}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}
      </section>

      <section class="card section">
        <h2>API usage</h2>
        <div class="tiles">
          <div class="tile plain"><span class="k">AirLabs</span><span class="v">{fmtInt(num('AirLabs'))}</span><span class="s">calls {since('AirLabs')}</span></div>
          <div class="tile plain"><span class="k">FlightAware</span><span class="v">${num('FlightAware').toFixed(2)}</span><span class="s">spent {since('FlightAware')}</span></div>
          <div class="tile plain"><span class="k">FR24</span><span class="v">{fmtInt(num('FR24'))}</span><span class="s">credits {since('FR24')}</span></div>
        </div>
      </section>
    {/if}
  {:else if tab === 'records'}
    {#if recErr}
      <section class="card section"><p class="muted">{recErr}</p><div class="row"><button class="btn" onclick={() => void loadRecords()}><Icon name="reload" size={18} /> Try again</button></div></section>
    {:else if !closest || !farthest}
      <p class="muted">Loading…</p>
    {:else}
      <section class="card section">
        <h2>Closest to home</h2>
        {#if closest.length === 0}
          <p class="muted">None yet. The closest passes are kept here (Settings → Flights → Max closest flights).</p>
        {:else}
          <RecordMap records={closest} mode="closest" {home} selected={pickClose} />
          <ol class="recs">
            {#each closest as r, i (r.callsign)}
              <li>
                <button class="rec" class:on={pickClose === r.callsign} aria-pressed={pickClose === r.callsign} onclick={() => (pickClose = pickClose === r.callsign ? null : r.callsign)}>
                  <span class="rank" style:box-shadow={`inset 0 0 0 3px ${RANK_COLORS[i % RANK_COLORS.length] ?? '#3987e5'}`}>{i + 1}</span>
                  <span class="grow"><strong class="mono">{r.callsign}</strong> <span class="muted">{r.airline}</span><br /><span>{r.origin.code || '?'} → {r.destination.code || '?'}</span> <span class="muted">· {r.aircraft || 'Unknown type'}</span></span>
                  <span class="right"><strong>{dist(r.distance)}</strong> {r.direction}<br /><span class="muted small">{r.altitudeFt === null ? '' : `${fmtInt(r.altitudeFt)} ft · `}{r.seen}</span></span>
                </button>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
      <section class="card section">
        <h2>Farthest origins &amp; destinations</h2>
        {#if farthest.length === 0}
          <p class="muted">None yet. The flights from (or to) the farthest airports are kept here.</p>
        {:else}
          <RecordMap records={farthest} mode="farthest" {home} selected={pickFar} />
          <ol class="recs">
            {#each farthest as r, i (r.callsign + i)}
              {@const fromOrigin = r.farthest?.from !== 'destination'}
              <li>
                <button class="rec" class:on={pickFar === r.callsign} aria-pressed={pickFar === r.callsign} onclick={() => (pickFar = pickFar === r.callsign ? null : r.callsign)}>
                  <span class="rank" style:box-shadow={`inset 0 0 0 3px ${RANK_COLORS[i % RANK_COLORS.length] ?? '#3987e5'}`}>{i + 1}</span>
                  <span class="grow"><strong class="mono">{r.callsign}</strong> <span class="muted">{r.airline}</span><br /><span>{r.origin.code || '?'} → {r.destination.code || '?'}</span> <span class="muted">· {fromOrigin ? 'from' : 'to'} {fromOrigin ? r.origin.code : r.destination.code}</span></span>
                  <span class="right"><strong>{dist(r.farthest?.distance ?? null)}</strong><br /><span class="muted small">{r.seen}</span></span>
                </button>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    {/if}
  {:else if tab === 'track'}
    <section class="card section">
      <h2>Tracked flight</h2>
      {#if trackErr}
        <p class="muted">{trackErr}</p>
      {:else if !trackedLoaded}
        <p class="muted">Loading…</p>
      {:else if !tracked}
        <p class="muted">Nothing tracked. Look a flight up below and the tracker follows it (and the LED board shows it) until it lands.</p>
      {:else}
        <div class="trk">
          <div class="trk-head">
            <span class="tag" class:live={!!tracked.live}>{tracked.live ? 'Airborne' : 'Scheduled'}</span>
            <strong class="mono big">{tracked.callsign}</strong>
            <span class="muted">{tracked.airline}{tracked.aircraft ? ` · ${tracked.aircraft}` : ''}</span>
          </div>
          <div class="route">
            <span class="code">{tracked.origin.code || '?'}</span>
            <div class="bar" role="progressbar" aria-label="Flight progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}>
              <span style:width={`${Math.round((progress ?? 0) * 100)}%`}></span>
            </div>
            <span class="code">{tracked.destination.code || '?'}</span>
          </div>
          <div class="tiles">
            <div class="tile plain"><span class="k">Departs</span><span class="v small">{when(tracked.live?.departed ?? tracked.scheduledDeparture)}</span></div>
            <div class="tile plain"><span class="k">{tracked.live ? 'Arrives (est.)' : 'Arrives'}</span><span class="v small">{when(tracked.live?.eta ?? tracked.scheduledArrival)}</span></div>
            {#if tracked.live}
              <div class="tile plain"><span class="k">Remaining</span><span class="v small">{tracked.live.timeRemaining || '—'}</span><span class="s">{dist(tracked.live.distanceRemaining)}</span></div>
              <div class="tile plain"><span class="k">Altitude</span><span class="v small">{fmtInt(tracked.live.altitudeFt)} ft</span><span class="s">{fmtInt(tracked.live.groundSpeedKt)} kt</span></div>
            {/if}
          </div>
          {#if !kiosk}<div class="row"><button class="btn danger" disabled={saving} onclick={stopTracking}><Icon name="close" size={18} /> Stop tracking</button></div>{/if}
        </div>
      {/if}
    </section>

    {#if !kiosk}
      <section class="card section">
        <h2>Track a flight</h2>
        <p class="muted small">Looks the flight up with the tracker’s API sources (uses API credits), then you pick the leg.</p>
        <form class="row" onsubmit={(e) => { e.preventDefault(); void lookup(); }}>
          <label class="field grow"><span>Callsign or flight number</span><input class="upper mono" maxlength="10" autocomplete="off" spellcheck="false" placeholder="UAL1234" bind:value={callsign} /></label>
          <button class="btn primary" disabled={looking || !callsign.trim()}><Icon name="search" size={18} /> {looking ? 'Looking up…' : 'Look up'}</button>
        </form>
        {#if lookMsg}<p class={`msg ${lookMsg.kind}`} role="status">{lookMsg.text}</p>{/if}
        {#if legs && legs.length}
          <ul class="legs">
            {#each legs as l, i (i)}
              <li>
                <span class="grow"><strong>{l.origin || '?'} → {l.destination || '?'}</strong> <span class="muted">{l.airline}{l.aircraft ? ` · ${l.aircraft}` : ''}{l.registration ? ` · ${l.registration}` : ''}</span><br /><span class="muted small">{l.status} · departs {when(l.scheduledDeparture)}</span></span>
                <button class="btn" disabled={saving} onclick={() => void track(i)}>Track this</button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="card section">
        <h2>Find a flight by route</h2>
        <p class="muted small">Flights between two airports from 12 hours ago to 6 hours ahead. Needs an FR24 key in the tracker settings.</p>
        <form class="row" onsubmit={(e) => { e.preventDefault(); void searchRoute(); }}>
          <label class="field"><span>From</span><input class="upper mono" maxlength="4" autocomplete="off" placeholder="ORD" bind:value={rOrigin} /></label>
          <label class="field"><span>To</span><input class="upper mono" maxlength="4" autocomplete="off" placeholder="SFO" bind:value={rDest} /></label>
          <button class="btn" disabled={routeBusy || !rOrigin.trim() || !rDest.trim()}><Icon name="search" size={18} /> {routeBusy ? 'Searching…' : 'Search'}</button>
        </form>
        {#if routeMsg}<p class="msg err" role="status">{routeMsg}</p>{/if}
        {#if routes && routes.length}
          <ul class="legs">
            {#each routes as f (f.callsign + f.departure)}
              <li>
                <span class="grow"><strong class="mono">{f.callsign}</strong>{f.number ? ` (${f.number})` : ''} <span class="muted">{f.airline}</span><br /><span class="muted small">{f.status}{f.departure ? ` · ${new Date(f.departure.endsWith('Z') ? f.departure : `${f.departure}Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span></span>
                <button class="btn" disabled={looking} onclick={() => void lookup(f.callsign)}>Look up</button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {:else if tab === 'log'}
    <section class="card section">
      <div class="row between">
        <h2>API calls</h2>
        <div class="row">
          {#if calls && sources.length > 1}
            <label class="inline"><span class="muted">Source</span>
              <select bind:value={source}><option value="all">All</option>{#each sources as s (s)}<option value={s}>{s}</option>{/each}</select>
            </label>
          {/if}
          <button class="btn small" onclick={() => void loadLog()}><Icon name="reload" size={16} /> Refresh</button>
        </div>
      </div>
      <p class="muted small">Every route lookup the tracker paid for, newest first (last 1,000). Running totals: AL = AirLabs calls, FA = FlightAware spend, FR = FR24 credits.</p>
      {#if logErr}
        <p class="muted">{logErr}</p>
      {:else if !calls}
        <p class="muted">Loading…</p>
      {:else if shown.length === 0}
        <p class="muted">No API calls logged yet.</p>
      {:else}
        <div class="tablewrap">
          <table>
            <thead><tr><th>Time</th><th>Source</th><th>Flight</th><th>Route</th><th>Totals</th></tr></thead>
            <tbody>
              {#each shown as c, i (`${c.time}-${i}`)}
                <tr><td class="mono">{c.time}</td><td>{c.source}</td><td class="mono">{c.callsign}</td><td>{c.route}</td><td class="mono muted">{c.totals}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .seg {
    align-self: flex-start;
  }
  .tabbtn {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 10px;
    color: var(--muted);
    font-weight: 600;
    text-decoration: none;
  }
  .tabbtn.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--line-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }
  .row.between {
    justify-content: space-between;
    align-items: center;
  }
  .section h2 {
    margin: 0;
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .inline select {
    min-height: 40px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    color: var(--text);
    font-size: 15px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
  }
  .tile {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tile.plain {
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .tile .k {
    color: var(--muted);
    font-size: 14px;
  }
  .tile .v {
    font-size: 30px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .tile .v.small {
    font-size: 17px;
  }
  .tile .s {
    color: var(--muted);
    font-size: 13px;
  }
  .small {
    font-size: 13px;
  }
  .tablewrap {
    overflow-x: auto;
    max-height: 520px;
    overflow-y: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 15px;
  }
  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  th {
    color: var(--muted);
    font-weight: 600;
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  .recs,
  .legs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rec {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  .rec.on {
    border-color: var(--line-2);
    background: var(--surface-2);
  }
  .rank {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    font-weight: 700;
    flex: none;
  }
  .right {
    text-align: right;
  }
  .legs li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .trk {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .trk-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
  }
  .big {
    font-size: 26px;
  }
  .tag {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .tag.live {
    color: var(--ok);
  }
  .route {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .code {
    font-size: 24px;
    font-weight: 700;
    font-family: var(--mono, monospace);
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: #3987e5;
    border-radius: 3px;
  }
  .msg {
    margin: 0;
  }
  .msg.ok {
    color: var(--ok);
  }
  .msg.err {
    color: var(--bad);
  }
  .msg.info {
    color: var(--muted);
  }
  .upper {
    text-transform: uppercase;
  }
  @media (max-width: 700px) {
    .rec .right {
      display: none;
    }
  }
</style>
