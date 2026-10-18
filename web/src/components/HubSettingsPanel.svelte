<script lang="ts">
  import Icon from './Icon.svelte';
  import { ApiError, api } from '../lib/api';
  import { hub } from '../lib/hub.svelte';

  /**
   * The hub's own settings (stored on the hub, applied straight away). Only
   * JWT_SECRET stays in hub.env; Docker-level things (ports, time zone) are in
   * deploy/.env.
   */
  interface Values {
    home: { lat: number; lon: number } | null;
    units: 'imperial' | 'metric';
    allowRegistration: boolean;
    accessTokenTtlMin: number;
    refreshTokenTtlDays: number;
    radarEnabled: boolean;
    radarRadiusNm: number;
    adsbContact: string;
    ledBoardUrl: string;
    backupKeep: number;
    backupHour: number;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
  }
  interface View {
    settings: Values & { cartoApiKeySet: boolean; cartoApiKeyHint: string };
    info: {
      timezone: string;
      trackerLeads: boolean;
      effective: { home: { lat: number; lon: number } | null; homeSource: 'tracker' | 'settings' | null; units: 'imperial' | 'metric' };
      leftoverEnvKeys: string[];
    };
  }

  let view = $state<View | null>(null);
  let form = $state<(Values & { homeText: string }) | null>(null);
  let saved = $state('');
  let newKey = $state('');
  let removeKey = $state(false);
  let busy = $state(false);
  let loadError = $state('');
  let msg = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
  let bad = $state('');

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number): string => new Date(2026, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' });

  function toForm(v: View): Values & { homeText: string } {
    const { cartoApiKeySet: _a, cartoApiKeyHint: _b, ...rest } = v.settings;
    return { ...rest, homeText: rest.home ? `${rest.home.lat}, ${rest.home.lon}` : '' };
  }
  const snapshot = (f: typeof form): string => JSON.stringify(f);
  const dirty = $derived(form !== null && (snapshot(form) !== saved || newKey.trim() !== '' || removeKey));

  async function load(): Promise<void> {
    try {
      const v = await api.get<View>('/api/hub-settings');
      view = v;
      form = toForm(v);
      saved = snapshot(form);
      newKey = '';
      removeKey = false;
      loadError = '';
    } catch (err) {
      loadError = err instanceof ApiError && err.detail ? err.detail : 'Couldn’t load the hub settings.';
    }
  }
  $effect(() => {
    void load();
  });

  function parseHome(text: string): { lat: number; lon: number } | null | 'bad' {
    if (text.trim() === '') return null;
    const parts = text.split(',').map((p) => Number(p.trim()));
    const [lat, lon] = parts;
    if (parts.length !== 2 || lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return 'bad';
    return { lat, lon };
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!form) return;
    msg = null;
    bad = '';
    const home = parseHome(form.homeText);
    if (home === 'bad') {
      msg = { kind: 'err', text: 'Home: use “lat, lon”, like 41.8827, -87.6232' };
      bad = 'home';
      return;
    }
    const { homeText: _h, ...values } = form;
    busy = true;
    try {
      const body = { ...values, home, cartoApiKey: removeKey ? null : newKey.trim() };
      const v = await api.put<View>('/api/hub-settings', body);
      view = v;
      form = toForm(v);
      saved = snapshot(form);
      newKey = '';
      removeKey = false;
      msg = { kind: 'ok', text: '✓ Saved. Changes apply straight away.' };
      // Units, map key and radar state are part of the screens' config.
      void hub.reloadConfig();
    } catch (err) {
      msg = { kind: 'err', text: err instanceof ApiError && err.detail ? err.detail : 'Couldn’t save.' };
      bad = err instanceof ApiError ? (err.field ?? '') : '';
    } finally {
      busy = false;
    }
  }
</script>

<section class="card hub">
  <h2><Icon name="settings" /> Hub</h2>
  <p class="muted">Everything the hub uses, saved on the hub and applied straight away. Only <code>JWT_SECRET</code> stays in <code>hub.env</code>.</p>

  {#if loadError}
    <p class="muted">{loadError}</p>
  {:else if !form || !view}
    <p class="muted">Loading…</p>
  {:else}
    {#if view.info.leftoverEnvKeys.length > 0}
      <div class="note" role="note">
        <strong>Tidy-up:</strong> these lines in <code>deploy/hub.env</code> aren’t used any more (their values were copied here once):
        <code>{view.info.leftoverEnvKeys.join(', ')}</code>. You can delete them; keep <code>JWT_SECRET</code>.
      </div>
    {/if}
    <form class="groups" onsubmit={save}>
      <fieldset>
        <legend>Home &amp; units</legend>
        {#if view.info.trackerLeads}
          <p class="small">
            {#if view.info.effective.homeSource === 'tracker' && view.info.effective.home}
              Home <span class="mono">{view.info.effective.home.lat}, {view.info.effective.home.lon}</span> and {view.info.effective.units} units come from
            {:else}
              Home and units come from
            {/if}
            <a href="#/tracker-settings">Plane tracker → Location</a>, so you only set them once.
          </p>
        {:else}
          <div class="grid">
            <label class="field" class:bad={bad.startsWith('home')}><span>Home (lat, lon)</span><input inputmode="decimal" placeholder="41.8827, -87.6232" bind:value={form.homeText} /></label>
            <label class="field"><span>Units</span><select bind:value={form.units}><option value="imperial">Imperial (mi, ft)</option><option value="metric">Metric (km, m)</option></select></label>
          </div>
        {/if}
        <p class="small muted">Time zone: <span class="mono">{view.info.timezone}</span> (<code>TZ</code> in <code>deploy/.env</code>, shared by every container).</p>
      </fieldset>

      <fieldset>
        <legend>Sign-in</legend>
        <label class="check"><input type="checkbox" bind:checked={form.allowRegistration} /> Anyone on the network can create an account (off: add people below, in People)</label>
        <div class="grid">
          <label class="field" class:bad={bad === 'accessTokenTtlMin'}><span>Sign-in check every (minutes)</span><input type="number" min="1" max="60" bind:value={form.accessTokenTtlMin} /><small>1–60. Shorter means a removed account is locked out sooner.</small></label>
          <label class="field" class:bad={bad === 'refreshTokenTtlDays'}><span>Stay signed in for (days)</span><input type="number" min="1" max="90" bind:value={form.refreshTokenTtlDays} /><small>1–90, for phones and browsers that aren’t used.</small></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Radar &amp; maps</legend>
        <label class="check"><input type="checkbox" bind:checked={form.radarEnabled} /> Show live aircraft on the Radar tab</label>
        <div class="grid">
          <label class="field" class:bad={bad === 'radarRadiusNm'}><span>Radar range (nautical miles)</span><input type="number" min="5" max="100" bind:value={form.radarRadiusNm} /></label>
          <label class="field" class:bad={bad === 'adsbContact'}><span>Contact for the ADS-B feeds</span><input type="text" maxlength="200" autocomplete="off" placeholder="you@example.com" bind:value={form.adsbContact} /><small>Sent to adsb.lol / adsb.fi so they can reach you. Optional.</small></label>
        </div>
        <div class="field" class:bad={bad === 'cartoApiKey'}>
          <span>CARTO map key</span>
          {#if view.settings.cartoApiKeySet && !removeKey}
            <div class="keyrow"><span class="mono">Saved ({view.settings.cartoApiKeyHint})</span><button type="button" class="btn small" onclick={() => (removeKey = true)}>Remove</button></div>
          {:else if removeKey}
            <div class="keyrow"><span class="muted">Will be removed when you save.</span><button type="button" class="btn small" onclick={() => (removeKey = false)}>Undo</button></div>
          {/if}
          <input type="password" autocomplete="off" spellcheck="false" maxlength="200" placeholder={view.settings.cartoApiKeySet ? 'Paste a new key to replace it' : 'Paste your key'} bind:value={newKey} disabled={removeKey} />
          <small>Free, no account: <a href="https://carto.com/basemaps/apikey/" target="_blank" rel="noopener noreferrer">carto.com/basemaps/apikey</a>. Without it the map background says “API KEY REQUIRED”. Stored encrypted on the hub. CARTO’s terms require the maps to load tiles straight from CARTO, so your screens use the key in their tile requests (it’s meant to be used that way). If you limit the key to certain websites in CARTO’s dashboard, add the address you open HomeBase on.</small>
        </div>
      </fieldset>

      <fieldset>
        <legend>LED board</legend>
        <label class="field" class:bad={bad === 'ledBoardUrl'}>
          <span>LED board address (optional)</span>
          <input type="url" autocomplete="off" spellcheck="false" placeholder="http://192.168.1.60:8080" bind:value={form.ledBoardUrl} />
          <small>The board Pi’s home-network address, so its display, panel and Wi-Fi settings appear under <a href="#/tracker-settings?board">Plane tracker → LED board</a>. Use its IP address (names ending in .local usually don’t resolve inside Docker).</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>Backups</legend>
        <div class="grid">
          <label class="field" class:bad={bad === 'backupKeep'}><span>Keep this many nightly backups</span><input type="number" min="0" max="365" bind:value={form.backupKeep} /><small>0 turns nightly backups off.</small></label>
          <label class="field"><span>Back up at</span><select bind:value={form.backupHour}>{#each hours as h (h)}<option value={h}>{hourLabel(h)}</option>{/each}</select></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Advanced</legend>
        <label class="field narrow">
          <span>Log detail</span>
          <select bind:value={form.logLevel}><option value="error">Errors only</option><option value="warn">Warnings</option><option value="info">Normal</option><option value="debug">Debug (troubleshooting)</option></select>
          <small><code>docker compose logs hub</code></small>
        </label>
      </fieldset>

      <div class="row">
        <button class="btn primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save hub settings'}</button>
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
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px 18px;
    align-items: start;
  }
  .field.narrow {
    max-width: 320px;
  }
  .field small,
  .small {
    font-size: 13px;
  }
  .field small {
    color: var(--muted);
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .keyrow {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .note {
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    font-size: 14px;
    line-height: 1.5;
  }
  .bad input {
    border-color: var(--bad);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .msg.ok {
    color: var(--ok);
  }
  .msg.err {
    color: var(--bad);
  }
  code {
    font-family: var(--mono);
    word-break: break-all;
  }
</style>
