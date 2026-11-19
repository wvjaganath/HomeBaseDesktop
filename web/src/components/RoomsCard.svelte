<script lang="ts">
  import { temperature } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import Icon from './Icon.svelte';
  import Sparkline from './Sparkline.svelte';

  /** Govee room sensors on Home: temperature, humidity and the last 24 hours. */
  let { max = 4, compact = false }: { max?: number; compact?: boolean } = $props();

  const units = $derived(hub.config?.units ?? 'imperial');
  const house = $derived(hub.house);
  const rooms = $derived((house?.rooms ?? []).slice(0, max));
  const lowBattery = 15;
  const w = $derived(hub.tracker?.weather ?? null);
</script>

<section class="card rooms" class:compact aria-label="Rooms">
  <header>
    <span class="label"><Icon name="therm" size={20} />Rooms</span>
    {#if w && w.temperature !== null}<span class="outside">Outside {Math.round(w.temperature)}°{w.humidity !== null ? ` · ${Math.round(w.humidity)}%` : ''}</span>{/if}
  </header>
  {#if rooms.length > 0}
    <div class="grid" class:three={rooms.length > 4}>
      {#each rooms as r (r.address)}
        <div class="room" class:alert={r.stale || (r.battery !== null && r.battery <= lowBattery)}>
          <span class="n">
            <span class="nm">{r.name || r.model || 'Sensor'}</span>
            {#if r.stale}<span class="warn">No signal</span>{:else if r.battery !== null && r.battery <= lowBattery}<span class="warn"><Icon name="battery" size={14} />{r.battery}%</span>{/if}
          </span>
          <span class="v">
            <span class="tp" class:dim={r.stale}>{temperature(r.tempC, units)}</span>
            {#if r.humidity !== null}<span class="hm">{Math.round(r.humidity)}%</span>{/if}
          </span>
          {#if !compact}
            <span class="sp"><Sparkline values={r.spark.map((v) => (v === null ? null : units === 'imperial' ? (v * 9) / 5 + 32 : v))} color="#fda4af" height={26} /></span>
          {/if}
        </div>
      {/each}
    </div>
  {:else if !house?.roomsEnabled}
    <p class="muted">Room sensors aren’t set up yet. See Settings → House.</p>
  {:else if (house.newSensors ?? 0) > 0}
    <p class="muted">{house.newSensors} sensor{house.newSensors === 1 ? '' : 's'} heard. Name {house.newSensors === 1 ? 'it' : 'them'} and switch {house.newSensors === 1 ? 'it' : 'them'} on in Settings → House.</p>
  {:else}
    <p class="muted">Listening for Govee sensors over Bluetooth…</p>
  {/if}
</section>

<style>
  .rooms {
    min-height: 0;
    overflow: hidden;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .label {
    color: #fda4af;
  }
  .outside {
    font-size: 15px;
    color: var(--muted);
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: minmax(0, 1fr);
    gap: 12px;
  }
  .grid.three {
    grid-template-columns: repeat(3, 1fr);
  }
  .room {
    min-height: 0;
    overflow: hidden;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 11px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .room.alert {
    border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
  }
  .n {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    color: var(--muted);
  }
  .nm {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 700;
    color: var(--warn);
    flex: none;
  }
  .v {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .tp {
    font-size: 36px;
    font-weight: 650;
    letter-spacing: -1px;
    font-variant-numeric: tabular-nums;
  }
  .compact .tp {
    font-size: 26px;
  }
  .tp.dim {
    color: var(--muted);
  }
  .hm {
    font-size: 19px;
    font-weight: 600;
    color: var(--blue);
    font-variant-numeric: tabular-nums;
  }
  .sp {
    margin-top: auto;
  }
  p {
    margin: 0;
    font-size: 17px;
    line-height: 1.45;
  }
</style>
