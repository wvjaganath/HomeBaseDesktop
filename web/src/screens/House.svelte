<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import { api } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { ago, rateLabel, temperature, uptime, usedOf } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import type { HouseHistory, MachinePoint, MachineStatus } from '../lib/types';

  /** House: every room sensor with its history, and every machine in detail. */
  type Range = '24h' | '7d' | '30d';
  let range = $state<Range>('24h');
  let history = $state<HouseHistory | null>(null);

  const units = $derived(hub.config?.units ?? 'imperial');
  const house = $derived(hub.house);
  const toUnits = (c: number | null): number | null => (c === null ? null : units === 'imperial' ? (c * 9) / 5 + 32 : c);

  // Refetch when the range changes, and as new readings arrive (at most every 15 s).
  let lastFetch = 0;
  $effect(() => {
    const r = range;
    void house?.version;
    const now = Date.now();
    if (history?.range === r && now - lastFetch < 15_000) return;
    lastFetch = now;
    let alive = true;
    api
      .get<HouseHistory>(`/api/house/history?range=${r}`)
      .then((h) => {
        if (alive) history = h;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  function roomSeries(address: string): { temp: Array<number | null>; hum: Array<number | null> } {
    const pts = history?.rooms[address] ?? [];
    return { temp: pts.map((p) => toUnits(p.tempC)), hum: pts.map((p) => p.humidity) };
  }
  function range24(address: string): string {
    const pts = (history?.rooms[address] ?? []).map((p) => p.tempC).filter((v): v is number => v !== null);
    if (pts.length === 0) return '—';
    return `${temperature(Math.min(...pts), units)} – ${temperature(Math.max(...pts), units)}`;
  }
  function humRange(address: string): string {
    const pts = (history?.rooms[address] ?? []).map((p) => p.humidity).filter((v): v is number => v !== null);
    return pts.length ? `${Math.min(...pts)}–${Math.max(...pts)}%` : '';
  }
  const series = (id: string, key: keyof Omit<MachinePoint, 't'>): Array<number | null> =>
    (history?.machines[id] ?? []).map((p) => (key === 'tempC' ? toUnits(p.tempC) : p[key]));

  function gauges(m: MachineStatus): Array<{ label: string; value: string; key: keyof Omit<MachinePoint, 't'>; warn: boolean }> {
    const memPct = m.memUsed !== null && m.memTotal ? (m.memUsed / m.memTotal) * 100 : null;
    const diskPct = m.diskUsed !== null && m.diskTotal ? (m.diskUsed / m.diskTotal) * 100 : null;
    return [
      { label: 'CPU', value: m.cpuPct === null ? '—' : `${Math.round(m.cpuPct)}%`, key: 'cpu', warn: (m.cpuPct ?? 0) >= 85 },
      { label: 'Memory', value: usedOf(m.memUsed, m.memTotal), key: 'mem', warn: (memPct ?? 0) >= 85 },
      { label: 'Disk', value: usedOf(m.diskUsed, m.diskTotal), key: 'disk', warn: (diskPct ?? 0) >= 85 },
      { label: 'CPU temp', value: temperature(m.tempC, units, 0, true), key: 'tempC', warn: (m.tempC ?? 0) >= 75 },
    ];
  }
  function powerText(m: MachineStatus): string | null {
    if (!m.power) return null;
    if (m.power.underVoltageNow) return 'Power supply too weak right now';
    if (m.power.throttledNow) return 'Slowed down (heat or power) right now';
    if (m.power.underVoltageSinceBoot) return 'Power supply dipped since the last restart';
    if (m.power.throttledSinceBoot) return 'Slowed down at some point since the last restart';
    return 'OK, no power or heat problems';
  }
</script>

<div class="page">
  <header class="top">
    <h1>House</h1>
    <div class="seg" role="group" aria-label="Rooms history range">
      {#each ['24h', '7d', '30d'] as const as r (r)}
        <button class:on={range === r} onclick={() => (range = r)}>{r === '24h' ? '24 h' : r === '7d' ? '7 days' : '30 days'}</button>
      {/each}
    </div>
  </header>

  <h2 class="sect"><Icon name="therm" size={18} />Rooms</h2>
  {#if (house?.rooms.length ?? 0) > 0}
    <div class="rooms">
      {#each house?.rooms ?? [] as r (r.address)}
        {@const s = roomSeries(r.address)}
        <section class="card room" class:alert={r.stale || (r.battery !== null && r.battery <= 15)}>
          <div class="rt"><b>{r.name || r.model || 'Sensor'}</b><span class:warn={r.battery !== null && r.battery <= 15}>{r.battery !== null ? `Battery ${r.battery}%` : ''}</span></div>
          <div class="vals"><span class="tp">{temperature(r.tempC, units)}</span>{#if r.humidity !== null}<span class="hm">{Math.round(r.humidity)}%</span>{/if}</div>
          <Sparkline values={s.temp} color="#fda4af" height={56} label={`${r.name} temperature`} />
          <Sparkline values={s.hum} color="#60a5fa" height={30} label={`${r.name} humidity`} />
          <div class="mm"><span>{range24(r.address)}</span><span>{humRange(r.address)}</span></div>
          <div class="foot"><span class:warn={r.stale}>{r.stale ? 'Not heard for ' + ago(r.lastSeenAt, clock.now).replace(' ago', '') : `Updated ${ago(r.lastSeenAt, clock.now)}`}</span><span>{r.model ?? ''}</span></div>
        </section>
      {/each}
    </div>
  {:else}
    <p class="hint muted">
      {#if !house?.roomsEnabled}Room sensors aren’t set up yet: see Settings → House for the Bluetooth listener.{:else if (house.newSensors ?? 0) > 0}{house.newSensors} sensor{house.newSensors === 1 ? '' : 's'} heard: name {house.newSensors === 1 ? 'it' : 'them'} and switch {house.newSensors === 1 ? 'it' : 'them'} on in Settings → House.{:else}Listening for Govee sensors over Bluetooth…{/if}
    </p>
  {/if}

  <h2 class="sect"><Icon name="server" size={18} />Machines <span class="note">last hour, from node_exporter on each machine</span></h2>
  {#if (house?.machines.length ?? 0) > 0}
    <div class="machines">
      {#each house?.machines ?? [] as m (m.id)}
        <section class="card mach">
          <div class="hd">
            <span class="ico"><Icon name={m.kind === 'pi' ? 'board' : 'monitor'} size={20} /></span>
            <div class="who"><b>{m.name}</b><span>{m.os ?? m.host}</span></div>
            {#if m.online}<span class="st ok"><i></i>Online · {uptime(m.uptimeSec)}</span>{:else if m.lastSeenAt === null && !m.error}<span class="st"><i></i>Checking…</span>{:else}<span class="st bad"><i></i>Offline</span>{/if}
          </div>
          {#if m.online}
            <div class="g4">
              {#each gauges(m) as g (g.label)}
                <div class="gm">
                  <span class="l">{g.label}</span>
                  <b class:warn={g.warn}>{g.value}</b>
                  <Sparkline values={series(m.id, g.key)} color={g.warn ? '#facc15' : '#2dd4bf'} height={24} />
                </div>
              {/each}
            </div>
            <dl class="kv">
              <dt>Address</dt><dd>{m.host}</dd>
              <dt>System</dt><dd>{[m.os, m.cores ? `${m.cores} cores` : null, m.arch].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Load (1/5/15 min)</dt><dd>{m.load ? m.load.map((v) => v.toFixed(2)).join('  ') : '—'}</dd>
              <dt>Network ↓ / ↑</dt><dd>{rateLabel(m.netRxBps)} / {rateLabel(m.netTxBps)}</dd>
              {#if powerText(m)}<dt>Power</dt><dd class:warn={m.power?.underVoltageNow || m.power?.throttledNow || m.power?.underVoltageSinceBoot || m.power?.throttledSinceBoot}>{powerText(m)}</dd>{/if}
            </dl>
          {:else}
            <p class="err">{m.error ?? 'Waiting for the first reading.'}</p>
            {#if m.lastSeenAt}<p class="muted small">Last seen {ago(m.lastSeenAt, clock.now)}.</p>{/if}
          {/if}
          {#if m.cockpitUrl && !hub.isKiosk}
            <a class="btn small-btn" href={m.cockpitUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} />Open Cockpit</a>
          {/if}
        </section>
      {/each}
    </div>
  {:else}
    <p class="hint muted">Add the mini PC and the Pis in Settings → House (each needs node_exporter installed).</p>
  {/if}
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    padding: 34px 44px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    margin: 0;
    font-size: 40px;
    font-weight: 650;
  }
  .seg {
    display: flex;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 3px;
  }
  .seg button {
    padding: 7px 16px;
    border-radius: 9px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--line-2);
  }
  .sect {
    margin: 6px 0 0;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .note {
    letter-spacing: 0;
    text-transform: none;
    font-weight: 500;
    color: var(--faint);
  }
  .rooms {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 18px;
  }
  .room {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .room.alert {
    border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
  }
  .rt {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 17px;
  }
  .rt span {
    font-size: 13px;
    color: var(--muted);
  }
  .vals {
    display: flex;
    align-items: baseline;
    gap: 16px;
  }
  .tp {
    font-size: 48px;
    font-weight: 650;
    letter-spacing: -1.5px;
    font-variant-numeric: tabular-nums;
  }
  .hm {
    font-size: 24px;
    font-weight: 600;
    color: var(--blue);
  }
  .mm,
  .foot {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: var(--muted);
  }
  .foot {
    font-size: 13px;
    color: var(--faint);
  }
  .warn {
    color: var(--warn) !important;
  }
  .machines {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 18px;
  }
  .mach {
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hd {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .ico {
    width: 40px;
    height: 40px;
    border-radius: 11px;
    display: grid;
    place-items: center;
    background: #0e2a27;
    color: var(--accent);
    flex: none;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .who b {
    font-size: 22px;
  }
  .who span {
    font-size: 14px;
    color: var(--muted);
  }
  .st {
    margin-left: auto;
    font-size: 14px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    white-space: nowrap;
  }
  .st i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: currentColor;
  }
  .st.ok {
    color: var(--ok);
  }
  .st.bad {
    color: var(--bad);
  }
  .g4 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .gm {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .gm .l {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .gm b {
    font-size: 22px;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .kv {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    font-size: 14px;
  }
  .kv dt {
    color: var(--muted);
  }
  .kv dd {
    margin: 0;
    text-align: right;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .err {
    margin: 0;
    font-size: 15px;
    color: var(--bad);
  }
  .small {
    margin: 0;
    font-size: 13px;
  }
  .small-btn {
    align-self: flex-start;
    min-height: 38px;
    font-size: 14px;
  }
  .hint {
    margin: 0;
    font-size: 17px;
  }
</style>
