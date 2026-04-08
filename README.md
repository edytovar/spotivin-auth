# spotivin-auth

Vercel serverless OAuth bridge for **SpotiVin** — an ESP32-based Spotify controller.

Because the ESP32 cannot host an HTTPS server itself, this project acts as the secure middleman:

1. The user opens `/api/spotify/login` in a browser
2. Spotify redirects back to `/api/spotify/callback` on this Vercel deployment
3. The callback exchanges the code for tokens **server-side** (your secret never leaves the server)
4. A success page displays the token bundle so you can copy it to your ESP32

---

## Project structure

```
spotivin-auth/
├── api/
│   └── spotify/
│       ├── login.js       ← starts the OAuth flow
│       └── callback.js    ← exchanges code for tokens, shows success page
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

## 4. Authorize and get tokens

1. Open a browser and navigate to:

```
https://spotivin-auth.vercel.app/api/spotify/login
```

2. Log in with your Spotify account and click **Agree**.
3. You will be redirected back to the success page which shows:
   - `access_token`
   - `refresh_token`
   - `expires_in` (seconds, typically 3600)
4. Click **Copy JSON Token Bundle** to copy the JSON object.

---

## 5. Using tokens on your ESP32

### Flashing tokens

Paste the JSON bundle into your firmware or NVS provisioning tool. Store both tokens in NVS (non-volatile storage).

### Making API calls

Use the `access_token` as a Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Example — get currently playing track:

```
GET https://api.spotify.com/v1/me/player/currently-playing
Authorization: Bearer <access_token>
```

### Refreshing tokens

The `access_token` expires after ~1 hour (`expires_in` seconds). When it expires, your ESP32 should POST to Spotify directly to refresh it:

```
POST https://accounts.spotify.com/api/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<your_refresh_token>
&client_id=<SPOTIFY_CLIENT_ID>
&client_secret=<SPOTIFY_CLIENT_SECRET>
```

> For production ESP32 firmware, consider proxying the refresh call through another Vercel route so the `client_secret` stays off-device.

---

## Security notes

- `SPOTIFY_CLIENT_SECRET` is used **only inside the serverless callback** — it is never sent to the browser or the ESP32.
- Tokens are shown once in the browser and never stored on the server.
- All communication uses HTTPS (enforced by Vercel).

---

## Scopes granted

| Scope | Purpose |
|---|---|
| `user-read-playback-state` | Read current playback device, track, and state |
| `user-modify-playback-state` | Play, pause, skip, set volume |
| `user-read-currently-playing` | Read the currently playing track |
| `streaming` | Use Spotify Connect / Web Playback SDK |
