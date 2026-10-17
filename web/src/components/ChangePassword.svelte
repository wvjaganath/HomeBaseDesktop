<script lang="ts">
  import { ApiError, api } from '../lib/api';

  let open = $state(false);
  let current = $state('');
  let next = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = '';
    if (next !== confirm) {
      error = 'The two new passwords don’t match.';
      return;
    }
    busy = true;
    try {
      await api.post('/auth/web/password', { currentPassword: current, newPassword: next });
      current = next = confirm = '';
      open = false;
      done = true;
    } catch (err) {
      error =
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : err instanceof ApiError && err.detail
            ? err.detail
            : 'Couldn’t change the password.';
    } finally {
      busy = false;
    }
  }
</script>

{#if done}
  <p class="ok" role="status">Password changed. You stay signed in here; your phones and other browsers will ask for the new password.</p>
{/if}
{#if open}
  <form class="pw" onsubmit={submit}>
    <!-- Lets password managers pair the new password with the right account. -->
    <input class="sr" type="email" autocomplete="username" tabindex="-1" aria-hidden="true" />
    <div class="grid">
      <label class="field">
        <span>Current password</span>
        <input type="password" autocomplete="current-password" required bind:value={current} />
      </label>
      <label class="field">
        <span>New password (10+ characters)</span>
        <input type="password" autocomplete="new-password" required minlength="10" maxlength="128" bind:value={next} />
      </label>
      <label class="field">
        <span>Type the new one again</span>
        <input type="password" autocomplete="new-password" required minlength="10" maxlength="128" bind:value={confirm} />
      </label>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="row">
      <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      <button class="btn" type="button" onclick={() => { open = false; error = ''; }}>Cancel</button>
    </div>
  </form>
{:else}
  <div class="row"><button class="btn" onclick={() => { open = true; done = false; }}>Change password</button></div>
{/if}

<style>
  p {
    margin: 0;
    line-height: 1.5;
  }
  .pw {
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
  .error {
    color: var(--bad);
  }
  .ok {
    color: var(--accent);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
</style>
