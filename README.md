# Rabbi Joey Soffer Shiurim

A private, local-first podcast player with automatic RSS refresh, natural filename sorting, search, playback progress, resume, speed controls, and keyboard shortcuts.

## Run

1. Install Node.js 18 or newer.
2. Run `npm start` in this folder.
3. Open `http://localhost:4173`.

Your subscriptions and playback history stay in your browser on this device.

## Install on iPhone, iPad, or Android

The app must be hosted on an HTTPS website for installation on a phone.

- **iPhone/iPad:** Open it in Safari, tap Share, then **Add to Home Screen**.
- **Android:** Open it in Chrome, open the menu, then choose **Install app**.

The interface and saved episode library remain available offline. Refreshing feeds and streaming audio require an internet connection.

## SoundCloud complete catalog

Set these environment variables on the server (for example, in Render):

- `SOUNDCLOUD_CLIENT_ID`
- `SOUNDCLOUD_CLIENT_SECRET`
- `SOUNDCLOUD_USER_ID` (optional; defaults to `1044681742`)

The Client Secret must stay on the server and must never be committed to GitHub. When credentials are configured, the app retrieves every available track through paginated SoundCloud API requests. The RSS feed remains the automatic fallback.
