<script lang="ts">
  import { ApiError, api } from '../lib/api';

  let { onSignedIn }: { onSignedIn: () => void } = $props();
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await api.post('/auth/web/login', { email, password });
      password = '';
      onSignedIn();
    } catch (err) {
      error =
        err instanceof ApiError && err.status === 401
          ? 'Email or password is incorrect.'
          : err instanceof ApiError && err.status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : 'Could not sign in. Is the hub running?';
    } finally {
      busy = false;
    }
  }
</script>

<main class="login">
  <form class="card" onsubmit={submit}>
    <img src="/icons/icon.svg" alt="" width="56" height="56" />
    <h1>HomeBase</h1>
    <p class="muted">Sign in with your HomeBase account.</p>
    <label class="field">
      <span>Email</span>
      <input type="email" autocomplete="username" required bind:value={email} />
    </label>
    <label class="field">
      <span>Password</span>
      <input type="password" autocomplete="current-password" required minlength="10" bind:value={password} />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>
</main>

<style>
  .login {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  form {
    width: min(420px, 100%);
    padding: 36px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 32px;
  }
  p {
    margin: 0;
  }
  .error {
    color: var(--bad);
  }
</style>
