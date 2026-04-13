# Radio-TV Sync App — "SyncCast"

## Overview
A mobile-friendly web app that syncs a live radio broadcast (680 the Fan — Atlanta Braves) with a TV stream. The user opens the app on their phone, taps "Sync," the phone mic listens to the TV audio, cross-correlates it with the radio stream, calculates the delay, and adjusts radio playback to match the TV perfectly.

## Tech Stack
- **Framework:** Next.js 14+ (App Router)
- **Hosting:** Vercel
- **Audio:** Web Audio API (mic capture + analysis)
- **Radio Stream:** iHeartRadio 680 the Fan HLS stream, proxied through a Next.js API route to avoid CORS issues
- **Styling:** Tailwind CSS
- **No paid APIs. No databases. No auth.**

## Architecture

### How It Works (Step by Step)
1. User opens the app on their phone and taps **"Sync"**
2. App starts playing the 680 the Fan radio stream (buffered ~60 seconds behind live)
3. Phone mic captures 8–10 seconds of TV audio
4. App simultaneously captures 8–10 seconds of radio audio from the stream
5. Cross-correlation algorithm compares the two audio fingerprints to find the time offset
6. App adjusts the radio stream playback position to match the TV
7. Radio now plays in sync with TV. Done.

### Key Technical Details

#### Radio Stream Proxy
- Create a Next.js API route (`/api/stream`) that proxies the 680 the Fan audio stream
- iHeartRadio stream URL for 680 the Fan: you'll need to discover this dynamically
  - Try fetching from: `https://playerservices.streamtheworld.com/api/livestream-redirect/WABORAMAAC` (or similar StationID)
  - Alternative: scrape the iHeartRadio player page for the HLS `.m3u8` URL
  - The proxy strips CORS headers so the browser can access the audio data
- The proxy should forward the audio stream as `audio/mpeg` or `audio/aac`

#### Mic Capture
- Use `navigator.mediaDevices.getUserMedia({ audio: true })` to access the phone mic
- Connect to an `AnalyserNode` or `ScriptProcessorNode` (or `AudioWorkletNode`) to get raw PCM samples
- Capture ~10 seconds of audio at 16kHz mono (downsample from default 44.1kHz)

#### Radio Audio Capture
- Play the radio stream through an `<audio>` element connected to the Web Audio API via `createMediaElementSource()`
- Simultaneously tap into the audio data using an `AnalyserNode` to get raw samples
- Buffer the last ~90 seconds of radio audio in memory (circular buffer of PCM samples)

#### Cross-Correlation (Sync Algorithm)
- Take the 10-second mic sample (TV audio) and slide it across the 90-second radio buffer
- Use normalized cross-correlation to find the best match:
  ```
  correlation(offset) = sum(mic[i] * radio[i + offset]) / (norm(mic) * norm(radio_segment))
  ```
- The offset with the highest correlation score = the delay between TV and radio
- Apply that delay: seek the radio stream forward or backward to align
- For performance, downsample both signals to ~4kHz before correlating (still plenty for speech matching)
- Use FFT-based correlation if brute force is too slow (it shouldn't be for these sizes)

#### Playback Adjustment
- If radio is AHEAD of TV: add a delay buffer (easy — just buffer and delay playback)
- If radio is BEHIND TV: skip forward in the stream (seek ahead in the buffer)
- After initial sync, optionally re-sync every 2–3 minutes to correct for drift

## UI Design
Dead simple. One screen. Dark theme (you're watching a game).

```
┌─────────────────────────┐
│                         │
│      🔴 SyncCast        │
│   680 the Fan • LIVE    │
│                         │
│   ┌─────────────────┐   │
│   │                 │   │
│   │   🎙️ SYNC NOW   │   │
│   │                 │   │
│   └─────────────────┘   │
│                         │
│   Status: Ready         │
│                         │
│   🔊 ━━━━━━━━━━━━━ 🔊   │
│        Volume            │
│                         │
│   [Re-Sync]  [Stop]     │
│                         │
└─────────────────────────┘
```

### States
1. **Ready** — "Tap Sync to start" — radio is not playing yet
2. **Listening** — "Listening to your TV..." — mic is active, capturing TV audio (show a waveform animation)
3. **Syncing** — "Calculating delay..." — running cross-correlation
4. **Synced** — "Synced! Delay: +2.3s" — radio is playing in sync, show the calculated offset
5. **Error** — "Couldn't find a match. Make sure the game is on." — correlation confidence too low

## File Structure
```
/app
  /page.tsx          — Main (only) page
  /api/stream/route.ts — Proxy for radio stream
  /layout.tsx        — App layout
/components
  /SyncButton.tsx    — Big sync button with states
  /AudioVisualizer.tsx — Simple waveform animation during listening
  /VolumeSlider.tsx  — Volume control
/lib
  /audioSync.ts      — Cross-correlation algorithm
  /audioCapture.ts   — Mic capture utilities
  /radioBuffer.ts    — Circular buffer for radio audio
  /streamUtils.ts    — Stream URL discovery and proxy helpers
```

## Implementation Notes

### Stream Discovery
- 680 the Fan is an iHeartRadio station. The stream URL may change.
- Try these approaches in order:
  1. Direct StreamTheWorld URL: `https://playerservices.streamtheworld.com/api/livestream-redirect/WABORAMAAC`
  2. If that doesn't work, try variations: `WABOFMAAC`, `WABORAMAAAC`, etc.
  3. Fallback: use a known working iHeartRadio stream URL and make it configurable
- The API route should handle redirects and forward the final audio stream

### Mobile Considerations
- Web Audio API + getUserMedia works on iOS Safari 14.5+ and all modern Android browsers
- iOS requires a user gesture (tap) before audio can play — the Sync button handles this
- Request mic permission on first tap
- Use `playsinline` on any audio/video elements
- Keep the screen awake during playback: use the Wake Lock API (`navigator.wakeLock.request('screen')`)

### Performance
- Cross-correlation on 10 seconds of 4kHz mono audio = 40,000 samples vs 360,000 samples (90 sec buffer)
- This is ~14 billion multiply-accumulates brute force — too slow
- Use FFT-based correlation: O(n log n) — fast enough in the browser
- Or: chunk the buffer and use a coarse-to-fine approach (find rough offset at low resolution, refine)

### Edge Cases
- If correlation confidence is below a threshold (e.g., < 0.3), show an error — the game might not be on, or there's too much background noise
- If the user's TV is on a commercial but radio isn't (or vice versa), sync may fail — show a "try again in a minute" message
- Re-sync periodically (every 3 min) to handle stream drift

## PWA Setup
- Add a `manifest.json` so users can "Add to Home Screen"
- App name: "SyncCast"
- Theme color: dark navy (#0a1628)
- Icon: simple radio/TV sync icon

## MVP Scope
Build ONLY these features for v1:
1. Play 680 the Fan radio stream
2. Mic capture on tap
3. Cross-correlation sync
4. Volume control
5. Re-sync button
6. Basic PWA manifest

Do NOT build: multiple station support, settings page, accounts, analytics, or anything else.
