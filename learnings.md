# Learnings: Radio Stream Sync (braves-sync)

Portable notes from building a PWA that syncs a live radio stream to a TV broadcast. Stack: Next.js 15 / Vercel / Web Audio API.

---

## Radio Stream Sources

### Streams break. A lot.

iHeartRadio / StreamTheWorld uses opaque station IDs that change without notice. This project had to update from `WABORAMAAC` → `WCNNAMAAC` when the station rebranded. Build a fallback chain, not a single URL.

```typescript
const STREAM_CANDIDATES = [
  'https://playerservices.streamtheworld.com/api/livestream-redirect/WCNNAMAAC.aac',
  'https://playerservices.streamtheworld.com/api/livestream-redirect/WCNNFMAAC.aac',
  'https://playerservices.streamtheworld.com/api/livestream-redirect/WCNNAM.mp3',
  'https://tunein.cdnstream1.com/4066_96.mp3', // last resort
];
```

Try each in order. The AAC variant is preferred (lower latency, better quality). MP3 is the broadest-compatibility fallback. A TuneIn CDN URL as last resort has held up as an emergency escape hatch.

### Proxy is required for CORS + live-edge streaming

Browsers block direct audio element access to cross-origin streams via Web Audio API unless `Access-Control-Allow-Origin: *` is present. Most radio CDNs don't set this. Solution: proxy through your own edge function.

**Must-have proxy headers:**
- `User-Agent: Mozilla/5.0 ... iPhone ...` — some CDNs gate by UA
- `Referer: https://www.iheart.com/` — makes traffic look like legitimate iHeart referral
- `redirect: 'follow'` — radio streams are often behind redirect chains
- `Transfer-Encoding: chunked` + `X-Accel-Buffering: no` — prevents nginx from buffering the live stream
- `Access-Control-Allow-Origin: *` — the whole point

**Use Edge Runtime on Vercel.** Serverless functions have a 10s execution limit. Edge functions don't time out on streaming responses.

### `crossOrigin='anonymous'` must be set before `src`

On the `<audio>` element: assign `crossOrigin = 'anonymous'` before setting `src`. If you do it after, the browser may have already started a non-CORS request and won't retry.

---

## Web Audio API

### Audio graph for offset/delay control

```
Audio Element
  → MediaElementSourceNode
  → DelayNode (max 120s)
  → GainNode
  → destination
  ↘ AnalyserNode (for transient detection, non-destructive tap)
```

- **Radio is ahead of TV** (positive offset): set `DelayNode.delayTime` — immediate, native, no interpolation artifacts.
- **Radio is behind TV** (negative offset): seek forward.
  - HLS: set `audio.currentTime` directly (seekable buffer).
  - Plain HTTP stream: reconnect (`audio.load()` + `audio.play()`) to snap to live edge.

### iOS Safari quirks

- Audio context must be created (or resumed) inside a user gesture handler. Don't `await` anything before calling `.resume()` or the gesture is considered stale.
- `playsinline` attribute is required.
- The big "tap to start" button pattern exists for a reason — don't try to autoplay.

### ScriptProcessorNode is dead

`ScriptProcessorNode` is deprecated and has real compatibility issues on mobile. Do not build new code on it. The replacement is `AudioWorkletNode` but it's more complex. For transient/peak detection, `AnalyserNode` + polling is simpler and good enough.

---

## Sync Strategies

The core insight: **audio cross-correlation is usually the wrong tool.** Three simpler methods beat it in practice.

### Method 1: Tap Sync (simplest, most reliable)

User taps "RADIO" button when they hear something distinctive, then "TV" button when they see it.

```
offset = (tvTapTime - radioTapTime) / 1000  // seconds
```

No audio processing. No permissions. Works offline. The UX overhead (paying attention to both streams) is acceptable because users are already watching/listening.

### Method 2: Game Timeline Sync (most accurate for live sports)

Pull timestamped events from a live data API (e.g. MLB Stats API). Let the user select a specific play or pitch they just saw. Calculate offset from the event's ISO 8601 timestamp vs. wall clock.

```
offset = (Date.now() - pitch.startTime) / 1000
```

**This converts a real-time audio problem into a data problem.** API latency introduces a few seconds of error, but that's fine — the scrubber handles fine-tuning. Poll the API every ~30s during live games.

MLB Stats API (`statsapi.mlb.com`) is free and unauthenticated. Provides pitch-level timestamps.

### Method 3: Pitch Sync / Transient Detection (ambitious, fragile)

Tap when you see the ball hit the mitt on TV. The app scans the radio audio buffer for a matching transient (ball-impact sound).

**Transient detection heuristics that kinda work:**
- Sample analyser at ~20 Hz
- Flag as transient: peak amplitude ≥ 30/128 AND ≥ 1.8× the 4-sample rolling baseline
- Search window: 30s back + 20s forward from expected time

**When it fails:**
- Quiet broadcasts
- Commercials playing on radio
- Background noise
- Soft pitches

Build in a fallback to manual tap. Don't gate the flow on detection succeeding.

### What was abandoned: FFT cross-correlation

The first implementation built a full Cooley-Tukey FFT cross-correlation between a radio buffer and a microphone buffer. Downsampled both to 4 kHz, did radix-2 DIT FFT, found peak lag.

It was deleted for good reasons:
- Requires mic access on every sync (modal permission prompt, UX killer)
- Needs 15+ seconds of buffering before first sync attempt
- `ScriptProcessorNode` dependency (deprecated)
- Confidence threshold tuning was arbitrary and fragile
- 323 lines of complex audio math vs. `(tvTap - radioTap) / 1000`

The tap sync approach is strictly better for this use case.

---

## Fine-Tuning UX

No automated sync method is accurate to the frame. Always give users a scrubber.

- Slider range: ±120 seconds covers all realistic delays
- Nudge buttons: ±0.1s and ±1s for quick adjustments
- "Preview" mode: move slider without applying (let user preview before committing)
- "Apply" only highlights/enables when the preview value differs from current offset

This pattern means users never get stuck on a bad sync and always have an escape hatch.

---

## MLB Stats API

Free, no auth, no rate limit encountered in testing.

```
# Today's Braves game
https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=144&date=YYYY-MM-DD&hydrate=linescore

# Play-by-play with pitch timestamps
https://statsapi.mlb.com/api/v1/game/{gamePk}/playByPlay
```

Each pitch has:
- `startTime` (ISO 8601) — the key field for sync
- `balls`, `strikes`, `outs` — enough to identify the exact moment
- `description` — human-readable ("Called Strike", "In play, run(s)")
- `isInPlay`, `isStrike`, `isBall` flags

Braves team ID: `144`

---

## Deployment Notes

- Vercel Edge Runtime required for the stream proxy (no timeout)
- No environment variables needed if using only public APIs
- Next.js `export const runtime = 'edge'` in the API route is enough
- PWA manifest + `<meta name="apple-mobile-web-app-capable">` makes it installable on iOS home screen, which removes Safari chrome and feels more native
