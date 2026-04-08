# spotivin-auth

Vercel serverless OAuth bridge for **SpotiVin** — an ESP32-based Spotify controller.

Because the ESP32 cannot host an HTTPS server itself, this project acts as the secure middleman:

1. The ESP32 firmware opens a browser to `/api/spotify/login?state=<device-import-url>`
2. The user logs in and approves access on Spotify
3. Spotify redirects back to `/api/spotify/callback` with an authorization code and the echoed state
4. The callback exchanges the code for tokens **server-side** (your secret never leaves the server)
5. The browser is automatically redirected to the device import URL with tokens as query parameters
6. The device reads those parameters and stores the tokens in NVS

If no `state` was provided, or state is invalid, a manual success page is shown instead.

---

## Project structure

```
spotivin-auth/
├── api/
│   └── spotify/
│       ├── login.js       ← starts the OAuth flow, forwards state to Spotify
│       └── callback.js    ← exchanges code for tokens, redirects to device
└── package.json
```

---

## 1. Deploy to Vercel

### Prerequisites

- A free [Vercel account](https://vercel.com/signup)
- [Node.js 18+](https://nodejs.org) installed locally
- The [Vercel CLI](https://vercel.com/docs/cli) (optional but handy)

### Option A — Deploy via Vercel dashboard (easiest)

1. Push this folder to a GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Leave all build settings at their defaults — Vercel auto-detects serverless functions inside `/api`.
4. Click **Deploy**.

### Option B — Deploy via Vercel CLI

```bash
npm i -g vercel
cd spotivin-auth
vercel
```

Follow the prompts. Your project will be live at something like:

```
https://spotivin-auth.vercel.app
```

---

## 2. Add environment variables

In your Vercel project dashboard go to **Settings → Environment Variables** and add:

| Variable | Description |
|---|---|
| `SPOTIFY_CLIENT_ID` | From your Spotify app dashboard |
| `SPOTIFY_CLIENT_SECRET` | From your Spotify app dashboard — **never put this in frontend code** |
| `SPOTIFY_REDIRECT_URI` | Must match exactly what you register in the Spotify dashboard (see below) |

Example value for `SPOTIFY_REDIRECT_URI`:

```
https://spotivin-auth.vercel.app/api/spotify/callback
```

Replace `spotivin-auth` with your actual Vercel project subdomain if it differs.

---

## 3. Configure the Spotify Developer Dashboard

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Open your app (or create one — it's free)
3. Click **Edit Settings**
4. Under **Redirect URIs**, add:

```
https://spotivin-auth.vercel.app/api/spotify/callback
```

> The URI must match `SPOTIFY_REDIRECT_URI` **exactly** — same scheme, host, path, and no trailing slash.

5. Save. Spotify rejects the OAuth flow if the redirect URI doesn't match.

---

## 4. Automatic token handoff to the device

### How it works

The login URL accepts an optional `state` query parameter containing the device's
import endpoint. Spotify echoes this value back to the callback unchanged, where
it is validated and used as the redirect target.

**Step 1 — ESP32 firmware opens this URL in a browser:**

```
https://spotivin-auth.vercel.app/api/spotify/login?state=http://192.168.4.66/spotify/import
```

**Step 2 — User logs in and approves on Spotify.**

**Step 3 — Callback exchanges the code and redirects the browser to:**

```
http://192.168.4.66/spotify/import?access_token=BQ...&refresh_token=AQ...&expires_in=3600
```

All three token fields are always present in the redirect.

**Step 4 — ESP32 `/spotify/import` handler reads the query parameters:**

```cpp
String access_token  = server.arg("access_token");
String refresh_token = server.arg("refresh_token");
int    expires_in    = server.arg("expires_in").toInt();
```

Store them in NVS and respond with a confirmation page.

### Redirect page shown to the user

Before the browser redirects, a page is displayed that:
- Shows all three token values (manual fallback)
- Has a 2-second countdown before automatic redirect
- Has a **Go to device** button to redirect immediately
- Has a **Copy JSON Token Bundle** button for manual import

If the device is unreachable, the user still has the tokens on screen and can copy
and import them manually.

### Token bundle format (manual import fallback)

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600
}
```

---

## 5. State parameter validation rules

The `state` value is validated in the callback before any redirect occurs:

| Check | Behaviour on failure |
|---|---|
| Must be a non-empty string | Falls back to manual success page |
| Must be a parseable absolute URL | Falls back to manual success page, warning logged |
| Protocol must be `http:` or `https:` | Rejected, warning logged |
| Must not point back to this Vercel deployment | Rejected, warning logged |

Validation failures are always logged in Vercel function logs with the reason and the raw value received.

---

## 6. Manual import (no state / fallback)

If `/api/spotify/login` is opened **without** a `state` parameter, or if the state
fails validation, the callback shows the original manual success page after a
successful token exchange. The user copies the JSON token bundle and pastes it
into the SpotiVin device's manual import field.

---

## 7. Using tokens on the device

### Making Spotify API calls

Use the `access_token` as a Bearer token in the `Authorization` header:

```
GET https://api.spotify.com/v1/me/player/currently-playing
Authorization: Bearer <access_token>
```

### Refreshing tokens

The `access_token` expires after ~1 hour (`expires_in` seconds). When it expires,
POST to Spotify to refresh it:

```
POST https://accounts.spotify.com/api/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<your_refresh_token>
&client_id=<SPOTIFY_CLIENT_ID>
&client_secret=<SPOTIFY_CLIENT_SECRET>
```

> For production firmware, consider proxying the refresh call through an additional
> Vercel route so the `client_secret` stays off-device entirely.

---

## Scopes granted

| Scope | Purpose |
|---|---|
| `user-read-playback-state` | Read current playback device, track, and state |
| `user-modify-playback-state` | Play, pause, skip, set volume |
| `user-read-currently-playing` | Read the currently playing track |
| `streaming` | Use Spotify Connect / Web Playback SDK |

---

## Security notes

- `SPOTIFY_CLIENT_SECRET` is used **only inside the serverless callback** — it is never sent to the browser or the ESP32.
- Tokens are never stored on the server — they are passed directly to the browser and from there to the device.
- The `state` return URL is validated before use — only `http:` and `https:` URLs are accepted, and self-referential redirects back to Vercel are blocked.
- All communication between browser and Vercel uses HTTPS (enforced by Vercel). The final redirect to the ESP32 is HTTP on the local network, which is acceptable since both the browser and device are on the same LAN.

---

## Known limitations

- The redirect URL containing tokens can be ~400–450 characters long. Ensure the
  ESP32 firmware's HTTP server argument buffer is large enough to parse them.
- If the user's phone browser is on mobile data instead of the device's Wi-Fi AP,
  the automatic redirect to a local IP will fail. In that case the user falls back
  to the manual copy-and-import flow shown on the same page.
- The `state` parameter is not signed or encrypted. It is validated for safety
  (scheme, self-referential check) but is not authenticated.
