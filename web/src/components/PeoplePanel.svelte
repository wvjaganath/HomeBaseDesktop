<script lang="ts">
  import Icon from './Icon.svelte';
  import { ApiError, api } from '../lib/api';

  interface Person {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
    me: boolean;
  }

  let people = $state<Person[]>([]);
  let adding = $state(false);
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let added = $state('');

  async function load(): Promise<void> {
    try {
      people = (await api.get<{ people: Person[] }>('/api/people')).people;
    } catch {
      // Shown as an empty list; the rest of Settings still works.
    }
  }
  $effect(() => {
    void load();
  });

  async function add(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = '';
    added = '';
    try {
      const r = await api.post<{ person: { email: string; displayName: string } }>('/api/people', { email, displayName: name, password });
      added = `${r.person.displayName} can now sign in as ${r.person.email} with the password you set. Ask them to change it in Settings → Account.`;
      name = email = password = '';
      adding = false;
      await load();
    } catch (err) {
      error =
        err instanceof ApiError && err.status === 429
          ? 'Too many new accounts at once. Try again in a few minutes.'
          : err instanceof ApiError && err.detail
            ? err.detail
            : 'Couldn’t add the account.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="card">
  <h2>People</h2>
  <p class="muted">Everyone with a HomeBase account on this hub. Shared notes and reminders go between these accounts.</p>
  <ul class="list">
    {#each people as p (p.id)}
      <li>
        <span class="who">{p.displayName}{#if p.me}<span class="muted you">(you)</span>{/if}</span>
        <span class="muted">{p.email}</span>
      </li>
    {/each}
  </ul>
  {#if added}<p class="ok" role="status">{added}</p>{/if}
  {#if adding}
    <form class="add" onsubmit={add}>
      <div class="grid">
        <label class="field">
          <span>Name</span>
          <input required maxlength="50" autocomplete="off" bind:value={name} />
        </label>
        <label class="field">
          <span>Email</span>
          <input type="email" required autocomplete="off" bind:value={email} />
        </label>
        <label class="field">
          <span>Starting password (10+ characters)</span>
          <input type="password" required minlength="10" maxlength="128" autocomplete="new-password" bind:value={password} />
        </label>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add account'}</button>
        <button class="btn" type="button" onclick={() => { adding = false; error = ''; }}>Cancel</button>
      </div>
    </form>
  {:else}
    <div class="row"><button class="btn" onclick={() => { adding = true; added = ''; }}><Icon name="plus" size={18} /> Add a person</button></div>
  {/if}
  <p class="muted small">Forgotten password? Whoever runs the hub makes a one-time reset link on the PC (deploy/README.md, Accounts).</p>
</section>

<style>
  section {
    padding: 26px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
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
  }
  .list li {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .list li:first-child {
    border-top: 0;
  }
  .who {
    min-width: 160px;
  }
  .you {
    margin-left: 6px;
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
    border-radius: 14px;
    background: var(--surface-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .small {
    font-size: 14px;
  }
  .error {
    color: var(--bad);
  }
  .ok {
    color: var(--accent);
  }
</style>
