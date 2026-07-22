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

## Automatic folders

Repeated series titles are grouped into folders using their shared leading name (for example, `Zevachim Daf 84` is placed in `Zevachim`). Unique episode titles stay on the main library page. Each folder supports search and all date, filename, and title sort choices.

Search always runs across the complete loaded catalog and displays matching episodes directly, regardless of their normal folder. The refresh status identifies whether the complete SoundCloud API catalog loaded or the app had to use the 500-item RSS fallback.

For maximum playback compatibility, complete-catalog metadata is combined with the RSS feed on every refresh. The latest RSS episodes retain their direct MP3 enclosure URLs, while older API-only episodes use SoundCloud's authenticated stream resolver.

Folder names are the first two words of each episode title. Titles sharing those same two words are grouped together; titles without a matching pair remain individual episodes.

Older API-only SoundCloud episodes use native HLS playback on Apple devices and HLS.js on Android/Chrome. RSS episodes continue to use their direct MP3 URLs.

Home-screen folders follow the selected sort. Date sorting ranks folders by newest or oldest contained episode, and title/filename sorting orders folder names alphabetically. Open folders sort their episodes using the same selection.
