# ClearSpeak speech trainer

ClearSpeak is a no-build, client-side speech practice app. Read a passage aloud and get feedback on how closely your words matched it, plus supporting signals for volume consistency and pitch variation — all scored in your browser.

Practice is level-by-level, not free choice. A short placement test finds your starting level, and each level's passage has to clear its bar before the next one unlocks.

No audio is ever uploaded or stored. Completed sessions keep only the target text, transcript, derived scores, and browser metadata, kept locally in `localStorage`.

## Placement test and levels

On first use, ClearSpeak offers a three-passage placement test that takes about two minutes. It uses the same private recording pipeline as every level, and **Skip and start at Level 1** always remains available. The result places you at a starting level based on your composite clarity/volume/pitch score.

Each level's passage is written on demand by the `worker/` Cloudflare Worker (see below) — targeted at whichever skill your local session history says is currently weakest, with difficulty scaling with the level number. Passing a level means clearing its bar: a minimum clarity score, and from level 2 on, steady volume and expressive (non-monotone) pitch. Falling short serves the same level again (a freshly generated passage, not a repeat) with specific reasons why; clearing it unlocks the next one. There's no fixed ceiling and no way to jump ahead or pick an arbitrary passage — progress is level-by-level only.

If passage generation is unavailable (offline, or the Worker's daily token budget is used up) ClearSpeak falls back to one of a small set of preset passages tagged by focus, so a level attempt never gets stuck waiting on the network.

## The level-generation Worker

`worker/` is a small, separate Cloudflare Worker (`clearspeak-levels`) that ClearSpeak's frontend calls to generate each level's passage. It's the one piece of this app that isn't purely client-side, and deliberately so: generating text requires a model call, and a Workers AI credential must never be shipped in browser-loaded code. The Worker reaches Workers AI through Cloudflare's native `AI` binding — no API token exists anywhere in this app, client or server.

To keep cost bounded regardless of traffic, the Worker tracks total tokens spent per calendar day (America/New_York) in a KV namespace and refuses new generations past a daily cap — 7,000 tokens most days, 5,000 on Sundays — returning a `budget_exceeded` response the client already knows how to fall back from. Deploy it with `cd worker && npx wrangler deploy`; see `worker/wrangler.jsonc` for its bindings.

## How scoring works

Text is lowercased, stripped of punctuation, and aligned against the transcript with word-level Levenshtein distance. The clarity score is the percentage of target words matched exactly; extra words are shown but don't lower the score. Volume is summarized from RMS variation during voiced samples; pitch is estimated with autocorrelation in the 75–400 Hz range and measured as semitone variation around the speaker's median. These are coaching signals, not clinical measurements.

## Run locally

Microphone APIs require a secure context. From this directory, run:

```sh
python3 -m http.server 8765
```

Then open `http://localhost:8765` in Chrome or Edge. Opening `index.html` directly with `file://` isn't recommended, since browsers commonly block ES modules or microphone access for local files.

There's no install, build, framework, or server API. The optional test suite needs Node.js:

```sh
npm test
```

## Browser support

- Microphone analysis uses `getUserMedia`, `AudioContext`, and `AnalyserNode`.
- Word transcription uses `SpeechRecognition` / `webkitSpeechRecognition`, best supported in Chromium browsers. Other browsers continue gracefully with volume and pitch feedback only.
- Speech recognition can't accept the `MediaStream` used by the analyser; it independently accesses the same microphone, which normally doesn't trigger a second permission prompt.
- Some browsers' speech recognition may use a vendor speech service even though ClearSpeak has no server or third-party integration of its own. Raw audio is never transmitted or retained by ClearSpeak itself.

## Embed in an existing website

Copy the folder anywhere under the host site and link to `index.html`, or move the markup inside `.st-app` into a host page while keeping:

```html
<link rel="stylesheet" href="./css/styles.css">
<script type="module" src="./js/app.js"></script>
```

Adjust those two paths for the final mount location. CSS is scoped under `.st-app` with an `st-` class prefix to avoid collisions, and follows a host page's `html[data-theme="dark"]` toggle if present. All assets are local — ClearSpeak makes no requests to third-party hosts.

## Backup format

History can be exported to a human-readable `.voice` JSON file. Import merges by session ID, so importing the same backup twice adds no duplicates. The **Replace history when importing** checkbox intentionally replaces local sessions instead. Import validates `appId: "speech-trainer"` and `schemaVersion: 1` before changing local data.
