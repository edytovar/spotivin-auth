// /api/spotify/callback.js
// Spotify redirects here after the user approves access.
// This route exchanges the authorization code for tokens — entirely server-side.
// The client_secret is NEVER exposed to the browser or ESP32.

export default async function handler(req, res) {
  // CORS headers — allows ESP32 / local clients to reach this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { code, error } = req.query;

  // Spotify returns ?error=access_denied if the user cancels
  if (error) {
    console.error(`[spotivin-auth] Spotify returned an error: ${error}`);
    return res.status(400).send(renderError(`Spotify authorization failed: ${error}`));
  }

  if (!code) {
    console.error('[spotivin-auth] No authorization code in callback query');
    return res.status(400).send(renderError('No authorization code received from Spotify.'));
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } = process.env;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REDIRECT_URI) {
    console.error('[spotivin-auth] Missing one or more required environment variables');
    return res.status(500).send(renderError('Server misconfiguration: missing environment variables.'));
  }

  // Exchange the authorization code for access + refresh tokens
  console.log('[spotivin-auth] Exchanging authorization code for tokens...');

  let tokenData;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: SPOTIFY_CLIENT_ID,
      client_secret: SPOTIFY_CLIENT_SECRET, // server-side only — never sent to browser
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    tokenData = await response.json();

    if (!response.ok) {
      console.error('[spotivin-auth] Token exchange failed:', tokenData);
      return res.status(502).send(
        renderError(`Token exchange failed: ${tokenData.error_description || tokenData.error || 'Unknown error'}`)
      );
    }
  } catch (err) {
    console.error('[spotivin-auth] Network error during token exchange:', err.message);
    return res.status(502).send(renderError('Network error while contacting Spotify. Try again.'));
  }

  const { access_token, refresh_token, expires_in } = tokenData;

  console.log('[spotivin-auth] Token exchange successful. expires_in:', expires_in);

  const jsonBundle = JSON.stringify({ access_token, refresh_token, expires_in }, null, 2);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderSuccess(access_token, refresh_token, expires_in, jsonBundle));
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function renderSuccess(access_token, refresh_token, expires_in, jsonBundle) {
  // JSON bundle is embedded as a JS string literal — safely escaped
  const escapedBundle = jsonBundle
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SpotiVin — Authorization Successful</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d0d0d;
      color: #e8e8e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 32px;
      max-width: 620px;
      width: 100%;
    }
    .badge {
      display: inline-block;
      background: #1db954;
      color: #000;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 16px;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p.subtitle { color: #888; font-size: 14px; margin-bottom: 28px; }
    .field { margin-bottom: 20px; }
    .field label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 6px;
    }
    .field .value {
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px;
      font-family: 'SFMono-Regular', Consolas, monospace;
      word-break: break-all;
      color: #c8f7c5;
    }
    .field .value.muted { color: #aaa; }
    .copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 24px;
      background: #1db954;
      color: #000;
      border: none;
      border-radius: 8px;
      padding: 12px 22px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
    }
    .copy-btn:hover { background: #17a34a; }
    .copy-btn.copied { background: #2a2a2a; color: #1db954; }
    .note {
      margin-top: 24px;
      padding: 14px;
      background: #111;
      border-left: 3px solid #1db954;
      border-radius: 4px;
      font-size: 13px;
      color: #888;
      line-height: 1.6;
    }
    .note strong { color: #e8e8e8; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">SpotiVin</span>
    <h1>Authorization successful</h1>
    <p class="subtitle">Copy the token bundle below and flash it to your ESP32 device.</p>

    <div class="field">
      <label>Access Token</label>
      <div class="value">${escapeHtml(access_token)}</div>
    </div>

    <div class="field">
      <label>Refresh Token</label>
      <div class="value">${escapeHtml(refresh_token)}</div>
    </div>

    <div class="field">
      <label>Expires In (seconds)</label>
      <div class="value muted">${expires_in}</div>
    </div>

    <button class="copy-btn" onclick="copyBundle(this)">
      Copy JSON Token Bundle
    </button>

    <div class="note">
      <strong>Next step:</strong> Paste the JSON bundle into your ESP32 firmware or
      NVS flash tool. The <em>access_token</em> expires in ~1 hour — your device
      should use the <em>refresh_token</em> to obtain a new one automatically.
    </div>
  </div>

  <script>
    const bundle = \`${escapedBundle}\`;
    function copyBundle(btn) {
      navigator.clipboard.writeText(bundle).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy JSON Token Bundle';
          btn.classList.remove('copied');
        }, 2500);
      }).catch(() => {
        // Fallback for browsers without clipboard API
        const ta = document.createElement('textarea');
        ta.value = bundle;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy JSON Token Bundle';
          btn.classList.remove('copied');
        }, 2500);
      });
    }
  </script>
</body>
</html>`;
}

function renderError(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SpotiVin — Authorization Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d0d0d;
      color: #e8e8e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #3a1a1a;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
    }
    .badge {
      display: inline-block;
      background: #c0392b;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 16px;
    }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
    p { color: #888; font-size: 14px; line-height: 1.6; }
    a { color: #1db954; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Error</span>
    <h1>Authorization failed</h1>
    <p>${escapeHtml(message)}</p>
    <p style="margin-top:16px;">
      <a href="/api/spotify/login">Try again &rarr;</a>
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
