# Going live: X login + Supabase + Netlify

The game is a static page plus one Netlify Function (`netlify/functions/api.mts`).
Players **sign in with X** (OAuth 2.0 + PKCE) on that function. Quests, the MARS balance,
achievements, stats and referrals are stored in **Supabase**. Supabase Auth is not used.

```
browser ──▶ /api/auth/login ──▶ x.com (player approves) ──▶ /api/auth/callback
                                                             │  reads @handle + avatar (users/me)
                                                             │  creates/updates the player in Supabase
                                                             └▶ signed session cookie (30 days)
browser ──▶ /api/quest · /api/earn · /api/achievement ──▶ Supabase functions decide the reward
```

Secrets (X client secret, Supabase key, session secret) live only in Netlify environment variables.
The page never sees them, and the Supabase tables are closed to the public API keys.

---

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste [`supabase/migrations/001_mars_mind.sql`](supabase/migrations/001_mars_mind.sql), **Run**.
3. **Project Settings → API Keys**: copy
   - the **Project URL** → `SUPABASE_URL`
   - a **secret** key (`sb_secret_…`) or the legacy **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

Tables: `players`, `quests`, `ledger` (every MARS ever earned, one row per reward).
Row Level Security is on with no policies, and the `mm_*` functions can only be called with the secret key.

## 2. Netlify (first deploy)

1. **Add new site → Import an existing project → GitHub → MarsMindGame**. Build settings come from `netlify.toml`.
2. Note the site address, e.g. `https://marsmind.netlify.app` (or attach your own domain).

## 3. X developer app

In the [X Developer Portal](https://developer.x.com/en/portal/dashboard) → your app → **User authentication settings → Set up / Edit**:

| Setting | Value |
|---|---|
| App permissions | **Read** |
| Type of App | **Web App, Automated App or Bot** (confidential client) |
| Callback URI / Redirect URL | `https://YOUR-SITE/api/auth/callback` |
| Website URL | `https://YOUR-SITE` |

Save, then **Keys and tokens → OAuth 2.0 Client ID and Client Secret** → copy both.

The login reads one endpoint, `GET /2/users/me`, once per sign-in. The app needs X API access for that call.

## 4. Netlify environment variables

**Site configuration → Environment variables → Add a variable**:

| Variable | Required | Value |
|---|:-:|---|
| `X_CLIENT_ID` | ✓ | OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | ✓ | OAuth 2.0 Client Secret |
| `SUPABASE_URL` | ✓ | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | secret / service_role key |
| `SESSION_SECRET` | ✓ | any long random string, e.g. `openssl rand -hex 32` |
| `POST_URL` | ✓ | the post for LIKE / REPOST / COMMENT, e.g. `https://x.com/MarsMindGame/status/123…` |
| `SITE_URL` | if you use a custom domain | the exact address registered as the X callback, e.g. `https://marsmind.gg` |
| `X_HANDLE` | | account for the FOLLOW quest (default `MarsMindGame`) |
| `QUEST_REWARD` | | MARS per quest (default `1000`) |
| `QUEST_DELAY_SEC` | | seconds after opening a quest before it counts (default `5`) |
| `REF_REWARD` | | MARS for the inviter when their invitee finishes all 4 quests (default `0` = off) |

Then **Deploys → Trigger deploy** so the function picks up the variables.

## 5. Check it

Open **`https://YOUR-SITE/api/health`**. It should say `"function": "running"` and list nothing under `missing`.
It also prints the exact `callback_url` to paste into the X app.

- **The page is 404 / not found** → the function wasn't deployed. The site must be **connected to the GitHub repo**
  (Netlify → Site configuration → Build & deploy → Continuous deployment). A drag-and-drop or manual deploy only uploads
  the page, never the `/api` function. Also check that the latest deploy finished (Deploys → the top one is *Published*).
- **`missing` lists variables** → add them, then Deploys → Trigger deploy.

1. Open the site → **START COLONY** → **LOG IN WITH X** → approve on X.
2. You land back on the quests with your @handle. Open all four, wait 5 seconds each: the balance becomes 4,000 MARS.
3. In Supabase → Table Editor: your row in `players`, four rows in `quests`, four in `ledger`.

If the login bounces back with a message, the reason is in the toast. Details are in **Netlify → Logs → Functions**:

| Toast | Usually means |
|---|---|
| Login is not configured on the server yet | a required variable is missing, redeploy after adding it |
| X refused the login | callback URL in the X app ≠ `SITE_URL/api/auth/callback`, or a wrong client secret |
| Could not read your X profile | the app has no API access for `users/me` |
| Could not save your profile | wrong `SUPABASE_URL` / key, or the SQL wasn't run |

## How rewards stay honest

- Every reward goes through Supabase functions. The game only reports what happened; amounts and caps live on the server ([`src/account/rewards.ts`](src/account/rewards.ts)).
- `ledger.award_key` is unique per player, so a quest, an achievement or the same colony event can't pay twice.
- Repeatable rewards (modules, sols, storms…) have a rolling 24-hour cap per player.
- A quest counts only after `QUEST_DELAY_SEC` seconds since the server saw it opened.
- POSTs from other sites are rejected. The session is an HMAC-signed, HttpOnly, Secure, SameSite=Lax cookie.

## Without a server

Opened as a plain file, through `npm run dev`, or inside a Claude artifact, the game finds no `/api` and falls back to
local mode: the player types an @handle and everything is kept in that browser.
