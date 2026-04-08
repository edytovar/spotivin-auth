# SpotiVin Auth Bridge

Minimal Vercel-hosted Spotify OAuth bridge for the SpotiVin ESP32 project.

## What it does
- Starts Spotify Authorization Code Flow
- Receives the Spotify callback on Vercel
- Exchanges the auth code for access + refresh tokens
- Shows the token bundle in a copy-friendly success page for manual paste into SpotiVin

## Required Vercel environment variables
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
- `SPOTIFY_SCOPES` (optional)

Recommended `SPOTIFY_REDIRECT_URI`:
`https://YOUR-PROJECT.vercel.app/api/spotify/callback`

Example scopes if you want to set them explicitly:
`user-read-playback-state user-modify-playback-state user-read-currently-playing streaming`

## Routes
- `/api/spotify/login` - starts auth flow
- `/api/spotify/callback` - Spotify redirect target
- `/api/spotify/refresh` - refresh helper if you want to test refresh flow later
- `/api/health` - simple sanity check

## Local notes
This repo is intended mainly for Vercel deployment. For local testing, set matching env vars in `.env.local` and run with any local serverless-compatible workflow you prefer.
