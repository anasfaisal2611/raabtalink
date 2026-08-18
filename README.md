# RaabtaLink

Offline-first emergency SOS PWA. A survivor can record a voice message, capture GPS, and save the SOS on the device with no internet and no backend.

This folder is **frontend only**. No FastAPI, WebRTC, maps, AI, or sync yet.

## Run it

From this project folder:

```bash
npx --yes serve frontend
```

Or:

```bash
python -m http.server 8080 --directory frontend
```

Then open the printed local URL on your phone or laptop.

The app needs a local web server (not `file://`) so the microphone, GPS, and service worker can work.

## What is built

- Victim screen: hold to record, pick emergency type, set people count, send SOS
- GPS via the browser Geolocation API
- Voice via MediaRecorder (stored as an audio blob, no speech-to-text)
- IndexedDB for local SOS records
- Cases screen for the healthcare worker: list saved SOS, replay voice, see GPS
- Service worker + manifest so the app can reopen offline

Each saved record looks like:

```text
SOS-001
Medical
2 people
GPS: 24.xxxxx, 67.xxxxx
Voice: recording.webm
Status: Pending
Synced: No
```

## Offline test

1. Open RaabtaLink while online and wait a few seconds so assets cache.
2. Turn off Wi-Fi / mobile data.
3. Close the browser.
4. Reopen RaabtaLink.
5. Record a voice SOS, allow GPS if asked, tap **Send SOS**.
6. Open **Cases** and play the voice back.

If that works, Phase 1 is done. Backend, local Wi-Fi sync, responder live dashboard, Whisper, and maps come after this.
