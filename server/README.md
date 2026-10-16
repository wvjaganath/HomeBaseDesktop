# HomeBase server

Standalone sync + accounts server for the HomeBase iOS app. This folder is fully self-contained — copy it anywhere (e.g. your home server), and run:

```bash
npm install
cp .env.example .env       # then set JWT_SECRET (openssl rand -hex 32)
npm start                  # listens on 0.0.0.0:3000
```

Requires Node 18+. The SQLite database file (`homebase.db`) is created next to it on first run — back that single file up and you've backed up everything.

## Setup order

1. Start the server with `ALLOW_REGISTRATION=true`.
2. Register both accounts from the app (Settings → Account).
3. Set `ALLOW_REGISTRATION=false` in `.env` and restart. No one else can ever register.

## Security posture

- Passwords hashed with argon2id; refresh tokens stored hashed, rotated on every use, with reuse detection that revokes the whole session chain.
- Short-lived (15 min) JWT access tokens; tight rate limits on `/auth/*` (5/min/IP), global limit elsewhere.
- Every route validates input with zod and checks ownership/share permissions server-side.
- **LAN only. Never port-forward this to the internet.**

## API

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | Reachability probe |
| POST | `/auth/register` | — | Create account (when enabled) |
| POST | `/auth/login` | — | Returns access + refresh tokens |
| POST | `/auth/refresh` | — | Rotate refresh token |
| POST | `/auth/logout` | — | Revoke session chain |
| GET | `/users` | Bearer | The two accounts (for the share picker) |
| POST | `/sync/push` | Bearer | Batched upserts, LWW by `updatedAt` |
| GET | `/sync/pull?since=N` | Bearer | Delta changes you own or shared with you |
| POST | `/shares` | Bearer | Share a note/reminder with the other account |
| DELETE | `/shares/:id` | Bearer | Unshare |
