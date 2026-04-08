// /api/spotify/login.js
// Redirects the user to Spotify's authorization page.
// The ESP32 device (or a browser) hits this endpoint to begin the OAuth flow.

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

  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

  console.log('[spotivin-auth] Redirecting to Spotify authorization page');
  res.redirect(302, authUrl);
}
