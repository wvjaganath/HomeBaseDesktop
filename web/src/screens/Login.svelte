<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, api } from '../lib/api';

  let { onSignedIn }: { onSignedIn: () => void } = $props();

  type Mode = 'signin' | 'register' | 'forgot';
  let mode = $state<Mode>('signin');
  let registration = $state(false);
  let email = $state('');
  let name = $state('');
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state('');

  onMount(() => {
    api
      .get<{ registration: boolean }>('/auth/web/options')
      .then((o) => (registration = o.registration))
      .catch(() => {});
  });

  function show(m: Mode): void {
    mode = m;
    error = '';
    password = confirm = '';
  }

  function message(err: unknown, fallback: string): string {
    if (err instanceof ApiError && err.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (err instanceof ApiError && err.detail) return err.detail;
    return fallback;
  }

  async function signIn(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await api.post('/auth/web/login', { email, password });
      password = '';
      onSignedIn();
    } catch (err) {
      error = err instanceof ApiError && err.status === 401 ? 'Email or password is incorrect.' : message(err, 'Could not sign in. Is the hub running?');
    } finally {
      busy = false;
    }
  }

  async function register(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = '';
    if (password !== confirm) {
      error = 'The two passwords don’t match.';
      return;
    }
    busy = true;
    try {
      await api.post('/auth/web/register', { email, displayName: name, password });
      password = confirm = '';
      onSignedIn();
    } catch (err) {
      error = err instanceof ApiError && err.status === 403 ? 'New accounts are turned off on this hub.' : message(err, 'Could not create the account.');
    } finally {
      busy = false;
    }
  }
</script>

<main class="login">
  {#if mode === 'signin'}
    <form class="card box" onsubmit={signIn}>
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
      <div class="links">
        <button class="link" type="button" onclick={() => show('forgot')}>Forgot password?</button>
        <button class="link" type="button" onclick={() => show('register')}>Create an account</button>
      </div>
    </form>
  {:else if mode === 'register'}
    {#if registration}
      <form class="card box" onsubmit={register}>
        <h1>Create an account</h1>
        <label class="field">
          <span>Name</span>
          <input autocomplete="name" required maxlength="50" bind:value={name} />
        </label>
        <label class="field">
          <span>Email</span>
          <input type="email" autocomplete="username" required bind:value={email} />
        </label>
        <label class="field">
          <span>Password (10+ characters)</span>
          <input type="password" autocomplete="new-password" required minlength="10" maxlength="128" bind:value={password} />
        </label>
        <label class="field">
          <span>Type it again</span>
          <input type="password" autocomplete="new-password" required minlength="10" maxlength="128" bind:value={confirm} />
        </label>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <button class="link" type="button" onclick={() => show('signin')}>Back to sign in</button>
      </form>
    {:else}
      <div class="card box">
        <h1>New accounts</h1>
        <p class="muted">Sign-up is turned off on this hub, so only people who already have an account can add one.</p>
        <p class="muted">Ask someone in the house to open <strong>Settings → People → Add a person</strong>, or whoever runs the hub can use the <code>users</code> command on the PC (deploy/README.md).</p>
        <button class="btn" onclick={() => show('signin')}>Back to sign in</button>
      </div>
    {/if}
  {:else}
    <div class="card box">
      <h1>Forgot your password?</h1>
      <p class="muted">HomeBase doesn’t send email, so a reset link comes from the PC that runs the hub. Whoever looks after it runs:</p>
      <pre><code>docker compose exec hub node dist/scripts/users.js reset-link {email || 'you@example.com'}</code></pre>
      <p class="muted">and gives you the link it prints. Open it here to choose a new password. It works once, for 30 minutes.</p>
      <p class="muted">Still signed in somewhere? Change it in <strong>Settings → Account</strong> instead.</p>
      <button class="btn" onclick={() => show('signin')}>Back to sign in</button>
    </div>
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
    width: min(460px, 100%);
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
    line-height: 1.5;
  }
  .error {
    color: var(--bad);
  }
  .links {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .link {
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .link:first-child {
    align-self: flex-start;
  }
  pre {
    margin: 0;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    white-space: pre-wrap;
    word-break: break-all;
  }
  code {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--text-2);
  }
</style>
