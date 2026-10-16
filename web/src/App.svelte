<script lang="ts">
  import { onMount } from 'svelte';
  import TabBar from './components/TabBar.svelte';
  import { api, ApiError, setSignedOutHandler } from './lib/api';
  import { clock } from './lib/clock.svelte';
  import { setTimezone } from './lib/format';
  import { hub } from './lib/hub.svelte';
  import { router } from './lib/router.svelte';
  import type { DeviceSettings, Me } from './lib/types';
  import CalendarPage from './screens/CalendarPage.svelte';
  import Flights from './screens/Flights.svelte';
  import Home from './screens/Home.svelte';
  import Login from './screens/Login.svelte';
  import Radar from './screens/Radar.svelte';
  import Settings from './screens/Settings.svelte';

  type Phase = 'loading' | 'login' | 'unpaired' | 'ready' | 'offline';
  let phase = $state<Phase>('loading');
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const device = $derived(hub.me?.kind === 'device' ? hub.me.device : null);
  const settings = $derived<DeviceSettings | null>(device?.settings ?? null);
  const route = $derived(router.route === 'kiosk' || router.route === 'login' ? 'home' : router.route);

  async function init(): Promise<void> {
    phase = 'loading';
    try {
      hub.me = await api.get<Me>('/auth/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        phase = router.route === 'kiosk' ? 'unpaired' : 'login';
      } else {
        phase = 'offline';
        setTimeout(() => void init(), 10_000);
      }
      return;
    }
    try {
      await hub.boot();
    } catch {
      phase = 'offline';
      setTimeout(() => void init(), 10_000);
      return;
    }
    if (hub.config) setTimezone(hub.config.timezone);
    phase = 'ready';
    if (hub.me.kind === 'device' && (router.route === 'kiosk' || router.route === 'login')) {
      router.go(hub.me.device.settings.startTab);
    } else if (router.route === 'login' || router.route === 'kiosk') {
      router.go('home');
    }
  }

  onMount(() => {
    clock.start();
    setSignedOutHandler(() => {
      if (hub.me?.kind !== 'device') {
        hub.disconnect();
        hub.me = null;
        phase = 'login';
      }
    });
    void init();
  });

  // Kiosk: rotate between tabs if configured.
  $effect(() => {
    const r = settings?.rotate;
    if (!r?.enabled || r.tabs.length < 2) return;
    const tabs = r.tabs;
    const t = setInterval(() => {
      const i = tabs.indexOf(router.route as (typeof tabs)[number]);
      router.go(tabs[(i + 1) % tabs.length] ?? 'home');
    }, r.seconds * 1000);
    return () => clearInterval(t);
  });

  // Kiosk: night mode (dim or black) between the configured times.
  const nightMode = $derived.by<'dim' | 'black' | null>(() => {
    const n = settings?.night;
    if (!n?.enabled) return null;
    const hhmm = clock.now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: hub.config?.timezone });
    const inWindow = n.start <= n.end ? hhmm >= n.start && hhmm < n.end : hhmm >= n.start || hhmm < n.end;
    return inWindow ? n.mode : null;
  });

  // Kiosk: hide cursor and tab bar when the mouse is idle.
  function poke(): void {
    idle = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = true), 4000);
  }
</script>

<svelte:window onmousemove={poke} ontouchstart={poke} />

{#if phase === 'loading'}
  <div class="center muted">Loading…</div>
{:else if phase === 'login'}
  <Login onSignedIn={() => void init()} />
{:else if phase === 'unpaired'}
  <div class="center">
    <div class="card msg">
      <h1>This screen isn’t connected</h1>
      <p class="muted">Create a screen link in Settings → Screens on a computer, then open it here (or re-run the Pi setup script).</p>
    </div>
  </div>
{:else if phase === 'offline'}
  <div class="center">
    <div class="card msg">
      <h1>Can’t reach the hub</h1>
      <p class="muted">Retrying every 10 seconds…</p>
    </div>
  </div>
{:else}
  <div class="shell" class:kiosk-idle={!!device && idle}>
    <TabBar kiosk={!!device} visible={!device || !idle} />
    <main class="screen">
      {#if route === 'home'}
        <Home autoFocus={settings?.autoFocus ?? true} theme={settings?.boardTheme ?? 'clean'} />
      {:else if route === 'flights'}
        <Flights theme={settings?.boardTheme ?? 'led'} />
      {:else if route === 'radar'}
        <Radar />
      {:else if route === 'calendar'}
        <CalendarPage />
      {:else if route === 'settings' && !device}
        <Settings onSignedOut={() => { hub.disconnect(); hub.me = null; phase = 'login'; }} />
      {:else}
        <Home />
      {/if}
    </main>
  </div>
  {#if nightMode}
    <div class="night" class:black={nightMode === 'black'} aria-hidden="true"></div>
  {/if}
{/if}

<style>
  .shell {
    height: 100%;
    display: flex;
  }
  .screen {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }
  .center {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .msg {
    padding: 36px;
    max-width: 560px;
  }
  .msg h1 {
    margin: 0 0 8px;
  }
  .night {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.7);
    pointer-events: none;
  }
  .night.black {
    background: #000;
  }
</style>
