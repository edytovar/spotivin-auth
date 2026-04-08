// /api/spotify/callback.js
// Spotify redirects here after the user approves access.
// This route exchanges the authorization code for tokens — entirely server-side.
// The client_secret is NEVER exposed to the browser or the ESP32.
//
// Automatic handoff (state present + valid):
//   After a successful token exchange the browser is redirected to the device
//   import URL with token data appended as query parameters:
//
//     http://192.168.4.66/spotify/import
//       ?access_token=<token>
//       &refresh_token=<token>
//       &expires_in=3600
//
//   The page shown before the redirect also displays all tokens as a manual
//   fallback in case the device is unreachable.
//
// Manual fallback (state absent or invalid):
//   The original success page is shown so the user can copy the token bundle.

export default async function handler(req, res) {
  // CORS headers — allows ESP32 / local clients to reach this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { code, error, state } = req.query;

  // Spotify returns ?error=access_denied when the user cancels
  if (error) {
    console.error(`[spotivin-auth] Spotify returned an error: ${error}`);
    return res.status(400).send(renderError(`Spotify authorization failed: ${error}`));
  }

  if (!code) {
    console.error('[spotivin-auth] No authorization code in callback query');
    return res.status(400).send(renderError('No authorization code received from Spotify.'));
  }

  // Validate the optional state return URL before touching credentials
  const stateResult = validateReturnUrl(state);
  if (!state) {
    console.log('[spotivin-auth] Callback: no state parameter — manual import mode');
  } else if (stateResult.valid) {
    console.log('[spotivin-auth] Callback: state accepted, redirect target:', stateResult.url.href);
  } else {
    console.warn('[spotivin-auth] Callback: state rejected —', stateResult.reason, '| raw:', state);
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

  // --- Automatic handoff path ---
  if (stateResult.valid) {
    // Append tokens as query parameters to the device import URL
    const deviceUrl = new URL(stateResult.url.href);
    deviceUrl.searchParams.set('access_token', access_token);
    deviceUrl.searchParams.set('refresh_token', refresh_token);
    deviceUrl.searchParams.set('expires_in', String(expires_in));
    const deviceUrlString = deviceUrl.toString();

    console.log(
      '[spotivin-auth] Auto-handoff: redirecting browser to',
      stateResult.url.hostname + stateResult.url.pathname
    );

    return res.status(200).send(
      renderSuccessWithRedirect(access_token, refresh_token, expires_in, jsonBundle, deviceUrlString)
    );
  }

  // --- Manual fallback path ---
  return res.status(200).send(renderSuccess(access_token, refresh_token, expires_in, jsonBundle));
}

// ---------------------------------------------------------------------------
// State / return URL validation
// ---------------------------------------------------------------------------
//
// Rules:
//   1. Must be a non-empty string
//   2. Must be a parseable absolute URL
//   3. Protocol must be http: or https: (blocks javascript:, data:, etc.)
//   4. Hostname must not equal this Vercel deployment (prevents redirect loops)
//      Vercel sets VERCEL_URL automatically, e.g. "spotivin-auth.vercel.app"

function validateReturnUrl(raw) {
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, reason: 'no state provided' };
  }

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { valid: false, reason: 'state is not a parseable URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, reason: `disallowed protocol: ${url.protocol}` };
  }

  // Prevent self-referential redirects back to this deployment
  const vercelHost = process.env.VERCEL_URL; // set automatically by Vercel
  if (vercelHost && url.hostname === vercelHost) {
    return { valid: false, reason: 'state points back to this Vercel deployment' };
  }

  return { valid: true, url };
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

// Escape a string for safe embedding inside a JS template literal (`...`)
function escapeJsTemplate(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

// Automatic redirect page — shown when a valid state return URL is present.
// Tokens are displayed immediately as a manual fallback.
// Browser is redirected to the device URL after a 2-second countdown.
function renderSuccessWithRedirect(access_token, refresh_token, expires_in, jsonBundle, deviceUrl) {
  const safeDeviceUrl  = escapeHtml(deviceUrl);   // safe for HTML attributes
  const jsDeviceUrl    = JSON.stringify(deviceUrl); // safe for JS assignment
  const escapedBundle  = escapeJsTemplate(jsonBundle);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SpotiVin — Sending to Device</title>
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
    p.subtitle { color: #888; font-size: 14px; margin-bottom: 20px; }
    .redirect-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #0f2318;
      border: 1px solid #1db954;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 13px;
      color: #1db954;
      margin-bottom: 24px;
    }
    .redirect-banner .dot {
      width: 8px; height: 8px;
      background: #1db954;
      border-radius: 50%;
      flex-shrink: 0;
      animation: pulse 1s ease-in-out infinite;
    }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
    .redirect-banner a { color: #1db954; font-weight: 600; }
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
    .btn-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    .copy-btn {
      display: inline-flex;
      align-items: center;
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
    .device-btn {
      display: inline-flex;
      align-items: center;
      background: #2a2a2a;
      color: #e8e8e8;
      border: 1px solid #3a3a3a;
      border-radius: 8px;
      padding: 12px 22px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: border-color 0.15s, color 0.15s;
    }
    .device-btn:hover { border-color: #1db954; color: #1db954; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">SpotiVin</span>
    <h1>Authorization successful</h1>
    <p class="subtitle">Tokens exchanged. Sending to your device&hellip;</p>

    <div class="redirect-banner">
      <span class="dot"></span>
      <span>
        Redirecting to device in <strong id="cd">2</strong>s
        &mdash; or <a href="${safeDeviceUrl}">go now</a>
      </span>
    </div>

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

    <div class="btn-row">
      <button class="copy-btn" onclick="copyBundle(this)">Copy JSON Token Bundle</button>
      <a class="device-btn" href="${safeDeviceUrl}">Go to device &rarr;</a>
    </div>
  </div>

  <script>
    const deviceUrl = ${jsDeviceUrl};
    const bundle    = \`${escapedBundle}\`;

    // 2-second countdown then redirect
    let secs = 2;
    const cdEl   = document.getElementById('cd');
    const ticker = setInterval(() => {
      secs -= 1;
      if (secs <= 0) {
        clearInterval(ticker);
        window.location.href = deviceUrl;
      } else {
        cdEl.textContent = secs;
      }
    }, 1000);

    function copyBundle(btn) {
      navigator.clipboard.writeText(bundle).then(() => {
        markCopied(btn);
      }).catch(() => {
        // Fallback for browsers without clipboard API
        const ta = document.createElement('textarea');
        ta.value = bundle;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        markCopied(btn);
      });
    }
    function markCopied(btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy JSON Token Bundle';
        btn.classList.remove('copied');
      }, 2500);
    }
  </script>
</body>
</html>`;
}

// Manual fallback page — shown when no valid state is present.
// Unchanged from the original success page behavior.
function renderSuccess(access_token, refresh_token, expires_in, jsonBundle) {
  const escapedBundle = escapeJsTemplate(jsonBundle);

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
    <p class="subtitle">Copy the token bundle below and import it on your SpotiVin device.</p>

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
      <strong>Next step:</strong> Paste the JSON bundle into the manual import
      field on your SpotiVin device. The <em>access_token</em> expires in ~1 hour
      — the device uses the <em>refresh_token</em> to renew it automatically.
    </div>
  </div>

  <script>
    const bundle = \`${escapedBundle}\`;
    function copyBundle(btn) {
      navigator.clipboard.writeText(bundle).then(() => {
        markCopied(btn);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = bundle;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        markCopied(btn);
      });
    }
    function markCopied(btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy JSON Token Bundle';
        btn.classList.remove('copied');
      }, 2500);
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
