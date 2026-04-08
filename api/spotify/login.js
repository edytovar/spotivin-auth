// /api/spotify/login.js
// Redirects the user to Spotify's authorization page.
// The ESP32 device (or a browser) hits this endpoint to begin the OAuth flow.
//
// Optional query parameter:
//   ?state=<device-import-url>
//   Example: ?state=http://192.168.4.66/spotify/import
//
// If state is provided it is forwarded to Spotify as-is.
// Spotify will echo it back to /api/spotify/callback, where it is validated
// and used as the return redirect target after a successful token exchange.

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
].join(' ');

export default function handler(req, res) {
  // CORS headers — allows ESP32 / local clients to reach this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } = process.env;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_REDIRECT_URI) {
    console.error('[spotivin-auth] Missing env vars: SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI');
    return res.status(500).json({
      error: 'Server misconfiguration: missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI',
    });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
  });

  // Forward device return URL as OAuth state so Spotify echoes it back to callback
  const { state } = req.query;
  if (state && typeof state === 'string' && state.trim() !== '') {
    params.set('state', state.trim());
    console.log('[spotivin-auth] Login: state forwarded to Spotify —', state.trim());
  } else {
    console.log('[spotivin-auth] Login: no state provided — manual import mode will be used after auth');
  }

  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

  console.log('[spotivin-auth] Redirecting to Spotify authorization page');
  res.redirect(302, authUrl);
}
