<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, api } from '../lib/api';

  /** Opened from a one-time link made on the PC: #/reset?t=hbr_… */
  let { onDone }: { onDone: () => void } = $props();

  let token = $state('');
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state('');
  let doneEmail = $state<string | null>(null);

  onMount(() => {
    token = new URLSearchParams(location.hash.split('?')[1] ?? '').get('t') ?? '';
    // Keep the token out of the address bar (and so out of history/screenshots).
    history.replaceState(null, '', `${location.pathname}#/reset`);
  });

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = '';
    if (password !== confirm) {
      error = 'The two passwords don’t match.';
      return;
    }
    busy = true;
    try {
      const r = await api.post<{ ok: true; email: string }>('/auth/web/reset', { token, newPassword: password });
      doneEmail = r.email;
      password = confirm = '';
    } catch (err) {
      error =
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : err instanceof ApiError && err.detail
            ? err.detail
            : 'Couldn’t reset the password. Is the hub running?';
    } finally {
      busy = false;
    }
  }
</script>

<main class="login">
  {#if doneEmail !== null}
    <div class="card box">
      <h1>Password changed</h1>
      <p class="muted">Sign in{doneEmail ? ` as ${doneEmail}` : ''} with your new password. Phones and other browsers were signed out and need it too.</p>
      <button class="btn primary" onclick={onDone}>Go to sign in</button>
    </div>
  {:else if !token}
    <div class="card box">
      <h1>Reset link missing</h1>
      <p class="muted">Open the full link you were given (it ends with a long code), or ask for a new one.</p>
      <button class="btn" onclick={onDone}>Back to sign in</button>
    </div>
  {:else}
    <form class="card box" onsubmit={submit}>
      <h1>Choose a new password</h1>
      <p class="muted">At least 10 characters. This link works once.</p>
      <label class="field">
        <span>New password</span>
        <input type="password" autocomplete="new-password" required minlength="10" maxlength="128" bind:value={password} />
      </label>
      <label class="field">
        <span>Type it again</span>
        <input type="password" autocomplete="new-password" required minlength="10" maxlength="128" bind:value={confirm} />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
      <button class="link" type="button" onclick={onDone}>Back to sign in</button>
    </form>
  {/if}
</main>

<style>
  .login {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .box {
    width: min(420px, 100%);
    padding: 36px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
  .error {
    color: var(--bad);
  }
  .link {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
</style>
