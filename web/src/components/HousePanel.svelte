<script lang="ts">
  import Icon from './Icon.svelte';
  import { ApiError, api } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { ago, fromUnits, temperature, toUnits } from '../lib/format';
  import type { HouseSettings, HouseSettingsView, MachineConfig, RoomSensor } from '../lib/types';

  /**
   * Settings → House: machines (node_exporter), Govee sensors heard over
   * Bluetooth, and when to warn. Saved on the hub like the other settings.
   */
  let view = $state<HouseSettingsView | null>(null);
  let form = $state<HouseSettings | null>(null);
  /** Alert temperatures in the hub's units while editing. */
  let temps = $state({ cpuMax: 158, roomMax: '' as number | '', roomMin: '' as number | '' });
  let saved = $state('');
  let busy = $state(false);
  let loadError = $state('');
  let msg = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
  let bad = $state('');
  let tests = $state<Record<string, { ok: boolean; text: string } | 'busy'>>({});
  let names = $state<Record<string, string>>({});

  const units = $derived(view?.units ?? 'imperial');
  const deg = $derived(units === 'imperial' ? '°F' : '°C');

  const snapshot = (): string => JSON.stringify({ form, temps });
  const dirty = $derived(form !== null && snapshot() !== saved);

  function adopt(v: HouseSettingsView): void {
    view = v;
    form = structuredClone($state.snapshot(v.settings)) as HouseSettings;
    const a = v.settings.alerts;
    temps = {
      cpuMax: toUnits(a.cpuTempMaxC, v.units),
      roomMax: a.roomMaxC === null ? '' : toUnits(a.roomMaxC, v.units),
      roomMin: a.roomMinC === null ? '' : toUnits(a.roomMinC, v.units),
    };
    names = Object.fromEntries(v.sensors.map((s) => [s.address, s.name]));
    saved = snapshot();
  }

  async function load(): Promise<void> {
    try {
      adopt(await api.get<HouseSettingsView>('/api/house-settings'));
      loadError = '';
    } catch (err) {
      loadError = err instanceof ApiError && err.detail ? err.detail : 'Couldn’t load the house settings.';
    }
  }
  $effect(() => {
    void load();
  });

  function addMachine(): void {
    if (!form) return;
    const id = crypto.randomUUID();
    form.machines.push({ id, name: form.machines.length === 0 ? 'Mini PC' : '', url: 'http://', kind: form.machines.length === 0 ? 'pc' : 'pi', cockpitUrl: '' });
  }
  function removeMachine(m: MachineConfig): void {
    if (form) form.machines = form.machines.filter((x) => x.id !== m.id);
  }

  async function test(m: MachineConfig): Promise<void> {
    tests[m.id] = 'busy';
    try {
      const r = await api.post<{ ok: boolean; message?: string; os?: string | null; hostname?: string | null; cores?: number; tempC?: number | null; hasPower?: boolean }>('/api/house-settings/test-machine', { url: m.url.trim() });
      tests[m.id] = r.ok
        ? { ok: true, text: `Reached it · ${[r.os ?? r.hostname, r.cores ? `${r.cores} cores` : null, r.tempC !== null && r.tempC !== undefined ? temperature(r.tempC, units, 0, true) : null].filter(Boolean).join(' · ')}${m.kind === 'pi' && !r.hasPower ? ' · power check not set up (optional)' : ''}` }
        : { ok: false, text: r.message ?? 'Couldn’t reach it.' };
    } catch (err) {
      tests[m.id] = { ok: false, text: err instanceof ApiError && err.detail ? err.detail : 'Couldn’t reach it.' };
    }
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!form) return;
    msg = null;
    bad = '';
    busy = true;
    try {
      const body: HouseSettings = {
        ...form,
        machines: form.machines.map((m) => ({ ...m, name: m.name.trim(), url: m.url.trim(), cockpitUrl: m.cockpitUrl.trim() })),
        listeners: form.listeners.map((l) => l.trim()).filter((l) => l !== '' && l !== 'http://'),
        alerts: {
          ...form.alerts,
          cpuTempMaxC: fromUnits(Number(temps.cpuMax), units),
          roomMaxC: temps.roomMax === '' ? null : fromUnits(Number(temps.roomMax), units),
          roomMinC: temps.roomMin === '' ? null : fromUnits(Number(temps.roomMin), units),
          humidityMax: form.alerts.humidityMax === null || (form.alerts.humidityMax as unknown) === '' ? null : Number(form.alerts.humidityMax),
        },
      };
      adopt(await api.put<HouseSettingsView>('/api/house-settings', body));
      msg = { kind: 'ok', text: '✓ Saved. The hub starts reading the new machines straight away.' };
    } catch (err) {
      msg = { kind: 'err', text: err instanceof ApiError && err.detail ? err.detail : 'Couldn’t save.' };
      bad = err instanceof ApiError ? (err.field ?? '') : '';
    } finally {
      busy = false;
    }
  }

  async function patchSensor(s: RoomSensor, patch: { name?: string; shown?: boolean }): Promise<void> {
    try {
      const v = await api.patch<HouseSettingsView>(`/api/house/sensors/${encodeURIComponent(s.address)}`, patch);
      if (view) view.sensors = v.sensors;
      names[s.address] = v.sensors.find((x) => x.address === s.address)?.name ?? names[s.address] ?? '';
    } catch {
      msg = { kind: 'err', text: 'Couldn’t update that sensor.' };
    }
  }
  async function forget(s: RoomSensor): Promise<void> {
    if (!confirm(`Forget ${s.name || s.address} and its history? It reappears (switched off) if it's heard again.`)) return;
    try {
      const v = await api.del<HouseSettingsView>(`/api/house/sensors/${encodeURIComponent(s.address)}`);
      if (view) view.sensors = v.sensors;
    } catch {
      msg = { kind: 'err', text: 'Couldn’t forget that sensor.' };
    }
  }
  const signal = (rssi: number | null): string => (rssi === null ? '—' : rssi >= -65 ? 'Strong' : rssi >= -80 ? 'Good' : 'Weak');
</script>

<section class="card house">
  <h2><Icon name="house" /> House</h2>
  <p class="muted">Your machines and room sensors, shown on Home and in the House tab. Everything here stays on your home network.</p>

  {#if loadError}
    <p class="muted">{loadError}</p>
  {:else if !form || !view}
    <p class="muted">Loading…</p>
  {:else}
    <form class="groups" onsubmit={save}>
      <fieldset>
        <legend>Machines</legend>
        <p class="small muted">
          Each machine runs <b>node_exporter</b>, a small read-only stats service. On Ubuntu Server and Raspberry Pi OS:
          <code>sudo apt install prometheus-node-exporter</code>. The hub reads <code>/metrics</code> on port 9100. Use each machine’s home-network IP address, including this server’s own.
        </p>
        {#each form.machines as m, i (m.id)}
          {@const t = tests[m.id]}
          <div class="machine" class:bad={bad.startsWith(`machines.${i}`)}>
            <div class="grid4">
              <label class="field"><span>Name</span><input type="text" maxlength="40" placeholder="Kiosk Pi" bind:value={m.name} /></label>
              <label class="field"><span>Address (node_exporter)</span><input type="url" autocomplete="off" spellcheck="false" placeholder="http://192.168.1.20:9100" bind:value={m.url} /></label>
              <label class="field"><span>Kind</span><select bind:value={m.kind}><option value="pc">Computer</option><option value="pi">Raspberry Pi</option></select></label>
              <label class="field"><span>Cockpit link (optional)</span><input type="url" autocomplete="off" spellcheck="false" placeholder="https://192.168.1.20:9090" bind:value={m.cockpitUrl} /></label>
            </div>
            <div class="row">
              <button type="button" class="btn small" disabled={t === 'busy' || m.url.trim().length < 10} onclick={() => void test(m)}>{t === 'busy' ? 'Testing…' : 'Test'}</button>
              {#if t && t !== 'busy'}<span class="msg" class:ok={t.ok} class:err={!t.ok}>{t.text}</span>{/if}
              <button type="button" class="btn small danger push" onclick={() => removeMachine(m)}><Icon name="trash" size={16} /> Remove</button>
            </div>
          </div>
        {/each}
        <button type="button" class="btn small add" disabled={form.machines.length >= 12} onclick={addMachine}><Icon name="plus" size={16} /> Add a machine</button>
        <label class="field narrow"><span>Read them every</span><select bind:value={form.pollSec}>{#each [10, 15, 30, 60] as s (s)}<option value={s}>{s} seconds</option>{/each}</select></label>
      </fieldset>

      <fieldset>
        <legend>Room sensors (Govee, over Bluetooth)</legend>
        <div class="listeners">
          {#each view.listeners as l (l.label)}
            <div class="lst">
              <span class="dot" class:ok={l.ok && l.scanning !== false}></span>
              <b>{l.label}</b>
              <span class="muted">
                {#if !l.ok}{l.error ?? 'Not answering'}{:else if l.scanning === false}Bluetooth isn’t scanning: {l.error ?? 'check the listener’s log'}{:else}Listening{l.adapter ? ` on ${l.adapter}` : ''} · {l.heard} sensor{l.heard === 1 ? '' : 's'} heard{/if}
              </span>
            </div>
          {:else}
            <p class="small muted">No Bluetooth listener yet. On this server: set <code>COMPOSE_PROFILES=govee</code>, <code>GOVEE_URL=http://govee:8686</code> and <code>BLUETOOTH_GID</code> in <code>deploy/.env</code>, then run <code>./deploy/update.sh</code> (see deploy/README.md, Room sensors).</p>
          {/each}
        </div>
        <label class="field" class:bad={bad.startsWith('listeners')}>
          <span>More listeners (optional, one per line)</span>
          <textarea rows="2" spellcheck="false" placeholder="http://192.168.1.41:8686" value={form.listeners.join('\n')} oninput={(e) => form && (form.listeners = (e.currentTarget as HTMLTextAreaElement).value.split('\n'))}></textarea>
          <small>For sensors too far from this server: run the same listener on a Pi near them (deploy/README.md) and add its address here.</small>
        </label>

        {#if view.sensors.length > 0}
          <div class="sensors">
            <div class="sh"><span>Name on Home</span><span>Sensor</span><span>Now</span><span>Signal</span><span>Battery</span><span>Show</span><span></span></div>
            {#each view.sensors as s (s.address)}
              <div class="sr" class:off={!s.shown}>
                <input type="text" maxlength="40" placeholder={s.shown ? 'Name it' : 'New sensor: name it'} bind:value={names[s.address]} onchange={() => void patchSensor(s, { name: names[s.address] ?? '' })} aria-label={`Name for ${s.address}`} />
                <span class="mono small">{s.model ?? '?'} · {s.address}</span>
                <span class="small">{temperature(s.tempC, units)}{s.humidity !== null ? ` · ${Math.round(s.humidity)}%` : ''}<br /><span class="muted">{ago(s.lastSeenAt, clock.now)}</span></span>
                <span class="small" class:warn={signal(s.rssi) === 'Weak'}>{signal(s.rssi)}</span>
                <span class="small" class:warn={s.battery !== null && s.battery <= form.alerts.batteryMin}>{s.battery === null ? '—' : `${s.battery}%`}</span>
                <label class="switch" aria-label={`Show ${s.name || s.address} on Home`}><input type="checkbox" checked={s.shown} onchange={(e) => void patchSensor(s, { shown: (e.currentTarget as HTMLInputElement).checked })} /></label>
                <button type="button" class="btn small icon" title="Forget this sensor" aria-label={`Forget ${s.address}`} onclick={() => void forget(s)}><Icon name="trash" size={16} /></button>
              </div>
            {/each}
          </div>
          <p class="small muted">Sensors show on Home once switched on, so a neighbour’s sensor never does. Names save as soon as you leave the box.</p>
        {:else if view.listeners.length > 0}
          <p class="small muted">No sensors heard yet. Govee thermometers broadcast every few seconds; they need to be within a room or two of the listener.</p>
        {/if}
      </fieldset>

      <fieldset>
        <legend>Warn me (alert bar) when</legend>
        <div class="grid">
          <label class="field"><span>A machine doesn’t answer for (minutes)</span><input type="number" min="1" max="60" bind:value={form.alerts.offlineMin} /></label>
          <label class="field"><span>CPU temperature is above ({deg})</span><input type="number" bind:value={temps.cpuMax} /><small>Raspberry Pis slow themselves down at about {units === 'imperial' ? '176°F' : '80°C'}.</small></label>
          <label class="field"><span>Disk is fuller than (%)</span><input type="number" min="50" max="99" bind:value={form.alerts.diskPct} /></label>
          <label class="field"><span>Memory is fuller than (%)</span><input type="number" min="50" max="99" bind:value={form.alerts.memPct} /></label>
          <label class="field"><span>A room is warmer than ({deg})</span><input type="number" placeholder="Off" bind:value={temps.roomMax} /><small>Leave empty for no alert.</small></label>
          <label class="field"><span>A room is colder than ({deg})</span><input type="number" placeholder="Off" bind:value={temps.roomMin} /><small>Leave empty for no alert.</small></label>
          <label class="field"><span>Humidity is above (%)</span><input type="number" min="30" max="100" placeholder="Off" bind:value={form.alerts.humidityMax} /></label>
          <label class="field"><span>A sensor battery is below (%)</span><input type="number" min="0" max="50" bind:value={form.alerts.batteryMin} /></label>
          <label class="field"><span>A sensor isn’t heard for (minutes)</span><input type="number" min="5" max="240" bind:value={form.alerts.sensorStaleMin} /></label>
        </div>
      </fieldset>

      <div class="row">
        <button class="btn primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save house settings'}</button>
        <button type="button" class="btn" disabled={busy || !dirty} onclick={() => void load()}>Undo changes</button>
        {#if msg}<span class={`msg ${msg.kind}`} role="status">{msg.text}</span>{:else if dirty}<span class="msg muted">Unsaved changes</span>{/if}
      </div>
    </form>
  {/if}
</section>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  fieldset {
    margin: 0;
    padding: 16px 18px 18px;
    border: 1px solid var(--line);
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  legend {
    padding: 0 6px;
    font-weight: 600;
    font-size: 17px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 14px 18px;
    align-items: start;
  }
  .grid4 {
    display: grid;
    grid-template-columns: 1fr 1.4fr 0.8fr 1.4fr;
    gap: 12px;
  }
  @media (max-width: 900px) {
    .grid4 {
      grid-template-columns: 1fr 1fr;
    }
  }
  .machine {
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .machine.bad {
    border-color: var(--bad);
  }
  .field.narrow {
    max-width: 240px;
  }
  .field small,
  .small {
    font-size: 13px;
  }
  .field small {
    color: var(--muted);
  }
  textarea {
    font-family: var(--mono);
    font-size: 14px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .push {
    margin-left: auto;
  }
  .add {
    align-self: flex-start;
  }
  .msg.ok {
    color: var(--ok);
  }
  .msg.err {
    color: var(--bad);
  }
  .msg {
    font-size: 14px;
  }
  .listeners {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lst {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--bad);
    flex: none;
  }
  .dot.ok {
    background: var(--ok);
  }
  .sensors {
    display: flex;
    flex-direction: column;
  }
  .sh,
  .sr {
    display: grid;
    grid-template-columns: minmax(150px, 1.3fr) minmax(170px, 1.4fr) 1fr 70px 70px 54px 44px;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }
  .sh {
    border-top: none;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .sr.off {
    color: var(--muted);
  }
  .sr input[type='text'] {
    min-width: 0;
  }
  .mono {
    font-family: var(--mono);
    color: var(--faint);
    word-break: break-all;
  }
  .warn {
    color: var(--warn);
  }
  .switch input {
    width: 20px;
    height: 20px;
  }
  .icon {
    padding: 0 10px;
  }
  code {
    font-family: var(--mono);
    word-break: break-all;
  }
</style>
