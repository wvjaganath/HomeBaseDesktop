<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import StatusPanel from '../components/StatusPanel.svelte';
  import { ApiError, api } from '../lib/api';
  import { hub } from '../lib/hub.svelte';
  import { sync } from '../lib/sync.svelte';
  import type { CalendarSource, DeviceSettings } from '../lib/types';

  let { onSignedOut }: { onSignedOut: () => void } = $props();

  interface Device {
    id: string;
    name: string;
    settings: DeviceSettings;
    createdAt: string;
    lastUsedAt: string | null;
  }

  let sources = $state<CalendarSource[]>([]);
  let devices = $state<Device[]>([]);
  let calName = $state('');
  let calUrl = $state('');
  let calColor = $state('#2DD4BF');
  let calError = $state('');
  let calBusy = $state(false);
  let screenName = $state('');
  let newPairUrl = $state('');
  let message = $state('');

  const colors = $derived(hub.config?.calendarColors ?? ['#2DD4BF']);

  async function load(): Promise<void> {
    const [c, d] = await Promise.all([
      api.get<{ sources: CalendarSource[] }>('/api/calendars'),
      api.get<{ devices: Device[] }>('/api/devices'),
    ]);
    sources = c.sources;
    devices = d.devices;
  }
  $effect(() => {
    void load();
  });

  async function addCalendar(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    calBusy = true;
    calError = '';
    try {
      await api.post('/api/calendars', { name: calName, url: calUrl, color: calColor });
      calName = '';
      calUrl = '';
      await load();
    } catch (err) {
      calError =
        err instanceof ApiError && err.code === 'invalid_input'
          ? 'That doesn’t look like a Google Calendar “Secret address in iCal format”.'
          : err instanceof ApiError && err.code === 'too_many_calendars'
            ? 'You can add up to 12 calendars.'
            : 'Could not add the calendar.';
    } finally {
      calBusy = false;
    }
  }

  async function removeCalendar(id: string): Promise<void> {
    await api.del(`/api/calendars/${id}`);
    await load();
  }

  async function addScreen(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const res = await api.post<{ id: string; pairPath: string }>('/api/devices', { name: screenName });
    newPairUrl = `${location.origin}${res.pairPath}`;
    screenName = '';
    await load();
  }

  async function saveScreen(d: Device): Promise<void> {
    await api.patch(`/api/devices/${d.id}`, { name: d.name, settings: d.settings });
    message = `Saved “${d.name}”. The screen updates within a few seconds.`;
  }

  async function reloadScreen(d: Device): Promise<void> {
    await api.post(`/api/devices/${d.id}/reload`);
    message = `Reload sent to “${d.name}”.`;
  }

  async function revokeScreen(d: Device): Promise<void> {
    await api.del(`/api/devices/${d.id}`);
    message = `“${d.name}” was disconnected. It needs a new link to show anything.`;
    await load();
  }

  async function copyPair(): Promise<void> {
    try {
      await navigator.clipboard.writeText(newPairUrl);
      message = 'Link copied.';
    } catch {
      message = 'Copy failed; select the link and copy it manually.';
    }
  }

  let exporting = $state(false);
  /** A JSON copy of everything this account can see (the server DB is the real backup). */
  async function exportData(): Promise<void> {
    if (hub.me?.kind !== 'user' || !hub.me.user) return;
    exporting = true;
    try {
      await sync.ensure(hub.me.user.id);
      await sync.pull();
      const data = {
        exportedAt: new Date().toISOString(),
        account: { email: hub.me.user.email, displayName: hub.me.user.displayName },
        collections: Object.fromEntries(Object.entries($state.snapshot(sync.items)).map(([c, items]) => [c, Object.values(items)])),
        shares: Object.values($state.snapshot(sync.shares)),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `homebase-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      message = 'Export downloaded.';
    } catch {
      message = 'Export failed. Is the hub reachable?';
    } finally {
      exporting = false;
    }
  }

  async function signOut(): Promise<void> {
    await api.post('/auth/web/logout').catch(() => {});
    onSignedOut();
  }

  const tabs = ['home', 'flights', 'radar', 'calendar', 'mirror'] as const;
</script>

<div class="settings">
  <h1>Settings</h1>
  {#if message}<p class="toast" role="status">{message}</p>{/if}

  <section class="card">
    <h2><Icon name="calendar" /> Google calendars</h2>
    <p class="muted">
      In Google Calendar on a computer: Settings → pick the calendar → <em>Integrate calendar</em> → copy
      <strong>Secret address in iCal format</strong>. It’s read-only and stored encrypted on the hub; it never leaves the server.
    </p>
    <ul class="list">
      {#each sources as s (s.id)}
        <li>
          <span class="dot" style:background={s.color}></span>
          <span class="grow">{s.name}</span>
          <span class="muted small">{s.ok === false ? `Error: ${s.error ?? 'refresh failed'}` : s.fetchedAt ? 'Synced' : 'Pending'}</span>
          <button class="btn danger" onclick={() => removeCalendar(s.id)} aria-label={`Remove ${s.name}`}><Icon name="trash" size={18} /></button>
        </li>
      {:else}
        <li class="muted">No calendars yet.</li>
      {/each}
    </ul>
    <form class="row" onsubmit={addCalendar}>
      <label class="field"><span>Name</span><input required maxlength="60" bind:value={calName} placeholder="Family" /></label>
      <label class="field grow"><span>Secret iCal address</span><input required type="url" bind:value={calUrl} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off" /></label>
      <fieldset class="colors">
        <legend class="muted small">Colour</legend>
        {#each colors as c (c)}
          <label class="swatch" style:background={c} class:picked={calColor === c}>
            <input type="radio" name="calcolor" value={c} bind:group={calColor} class="sr-only" />
            <span class="sr-only">{c}</span>
          </label>
        {/each}
      </fieldset>
      <button class="btn primary" type="submit" disabled={calBusy}>Add</button>
    </form>
    {#if calError}<p class="error" role="alert">{calError}</p>{/if}
  </section>

  <section class="card">
    <h2><Icon name="monitor" /> Screens</h2>
    <p class="muted">Each wall/desk screen gets its own read-only link. Open it once on the Pi (the setup script does this for you).</p>
    <form class="row" onsubmit={addScreen}>
      <label class="field grow"><span>New screen name</span><input required maxlength="40" bind:value={screenName} placeholder="Kitchen" /></label>
      <button class="btn primary" type="submit">Create link</button>
    </form>
    {#if newPairUrl}
      <div class="pair">
        <p><strong>Pairing link</strong> (shown once; treat it like a password):</p>
        <code>{newPairUrl}</code>
        <div class="row"><button class="btn" onclick={copyPair}>Copy</button><button class="btn" onclick={() => (newPairUrl = '')}>Done</button></div>
        <p class="muted small">On the Pi: <code>sudo bash setup-pi.sh{newPairUrl.startsWith('https:') ? ' --ca homebase-ca.crt' : ''} "{newPairUrl}"</code></p>
      </div>
    {/if}

    {#each devices as d (d.id)}
      <div class="device">
        <div class="row">
          <label class="field grow"><span>Name</span><input bind:value={d.name} maxlength="40" /></label>
          <span class="muted small">{d.lastUsedAt ? `Last seen ${new Date(d.lastUsedAt).toLocaleString()}` : 'Never connected'}</span>
        </div>
        <div class="row wrap">
          <label class="field"><span>Start on</span>
            <select bind:value={d.settings.startTab}>{#each tabs as t (t)}<option value={t}>{t}</option>{/each}</select>
          </label>
          <label class="field"><span>Flight board style</span>
            <select bind:value={d.settings.boardTheme}><option value="led">Classic LED</option><option value="clean">Clean</option></select>
          </label>
          <label class="check"><input type="checkbox" bind:checked={d.settings.autoFocus} /> Show plane full-size when overhead</label>
        </div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" bind:checked={d.settings.night.enabled} /> Night mode</label>
          <label class="field"><span>From</span><input type="time" bind:value={d.settings.night.start} /></label>
          <label class="field"><span>To</span><input type="time" bind:value={d.settings.night.end} /></label>
          <label class="field"><span>Style</span>
            <select bind:value={d.settings.night.mode}><option value="dim">Dim</option><option value="black">Screen off (black)</option></select>
          </label>
        </div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" bind:checked={d.settings.rotate.enabled} /> Rotate tabs every</label>
          <label class="field"><span>Seconds</span><input type="number" min="15" max="3600" bind:value={d.settings.rotate.seconds} /></label>
          {#each tabs as t (t)}
            <label class="check"><input type="checkbox" value={t} bind:group={d.settings.rotate.tabs} /> {t}</label>
          {/each}
        </div>
        <div class="row">
          <button class="btn primary" onclick={() => saveScreen(d)}>Save</button>
          <button class="btn" onclick={() => reloadScreen(d)}><Icon name="reload" size={18} /> Reload screen</button>
          <button class="btn danger" onclick={() => revokeScreen(d)}>Disconnect</button>
        </div>
      </div>
    {/each}
  </section>

  <StatusPanel />

  <section class="card">
    <h2>Account</h2>
    <p class="muted">Signed in as {hub.me?.kind === 'user' ? hub.me.user?.email : ''}.</p>
    <div class="row">
      <button class="btn" disabled={exporting} onclick={exportData}>{exporting ? 'Preparing…' : 'Download my data (JSON)'}</button>
      <button class="btn" onclick={() => { sync.reset(); void signOut(); }}><Icon name="logout" size={18} /> Sign out</button>
    </div>
  </section>
</div>

<style>
  .settings {
    height: 100%;
    overflow-y: auto;
    padding: 32px 40px 60px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 1100px;
  }
  h1 {
    margin: 0;
    font-size: 34px;
  }
  section {
    padding: 26px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .list li,
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .row {
    align-items: flex-end;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .small {
    font-size: 14px;
  }
  .colors {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid transparent;
  }
  .swatch.picked {
    border-color: var(--text);
  }
  .pair {
    padding: 16px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px dashed var(--line-2);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  code {
    font-family: var(--mono);
    word-break: break-all;
    color: var(--text-2);
  }
  .device {
    padding: 18px;
    border-radius: 14px;
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  .error {
    color: var(--bad);
  }
  .toast {
    padding: 12px 16px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
</style>
