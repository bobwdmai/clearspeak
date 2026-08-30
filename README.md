# ClearSpeak speech trainer

ClearSpeak is a no-build, client-side speech practice app. Read a passage aloud and get feedback on how closely your words matched it, plus supporting signals for volume consistency and pitch variation — all scored in your browser.

Practice is level-by-level, not free choice. A short placement test finds your starting level, and each level's passage has to clear its bar before the next one unlocks.

No audio is ever uploaded or stored. Completed sessions keep only the target text, transcript, derived scores, and browser metadata, kept locally in `localStorage`.

## Placement test and levels

On first use, ClearSpeak offers a three-passage placement test that takes about two minutes. It uses the same private recording pipeline as every level, and **Skip and start at Level 1** always remains available. The result places you at one of five fixed levels, ordered by difficulty, each tagged with the skill — clarity, volume, or pitch — it exercises most.

Passing a level means clearing its bar: a minimum clarity score, and for some levels, steady volume or expressive (non-monotone) pitch. Falling short serves the same level again with specific reasons why; clearing it unlocks the next one. There's no way to jump ahead or pick an arbitrary passage — progress is level-by-level only.

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
