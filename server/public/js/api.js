// Thin fetch client for the HomeBase server. Same origin as this page (see
// server/src/index.ts static registration), so no CORS handling is needed.

const TOKEN_KEY = 'gym.tokens';

function getTokens() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}

function setTokens(tokens) {
  if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKEN_KEY);
}

function isLoggedIn() {
  return !!getTokens();
}

async function apiLogin(email, password) {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'login_failed');
  setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
  return data.user;
}

function apiLogout() {
  setTokens(null);
}

async function refreshTokens() {
  const tokens = getTokens();
  if (!tokens) return false;
  const res = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken })
  });
  if (!res.ok) { setTokens(null); return false; }
  const data = await res.json();
  setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
  return true;
}

async function authFetch(path, options = {}) {
  const doFetch = () => {
    const tokens = getTokens();
    if (!tokens) throw new Error('not_authenticated');
    return fetch(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.accessToken}`
      }
    });
  };

  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await refreshTokens();
    if (!refreshed) throw new Error('unauthorized');
    res = await doFetch();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request_failed_${res.status}`);
  }
  return res.json();
}

async function apiPull(since) {
  return authFetch(`/sync/pull?since=${since}`, { method: 'GET' });
}

async function apiPush(changes) {
  return authFetch('/sync/push', { method: 'POST', body: JSON.stringify({ changes }) });
}
