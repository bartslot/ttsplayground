# Lip Sync Demo (Pocket TTS + Gentle + R3F)

Local demo pipeline:

1. Generate speech with Pocket TTS
2. Align transcript to audio with Gentle
3. Convert phonemes to visemes
4. Drive a GLTF avatar morph target in React Three Fiber

## Setup

```bash
npm install
```

Place your avatar at:

- `public/avatar.glb`

The avatar must include morph targets named like `viseme_aa`, `viseme_oh`, `viseme_mbp`, etc.

## Run Gentle

```bash
npm run gentle:start
```

Gentle is expected at `http://localhost:8765`.

## Generate demo audio

```bash
npm run tts:generate
```

Default transcript used by scripts:

- `Hello world this is a demo`

## Run forced alignment

```bash
npm run align:gentle
```

Writes alignment JSON to:

- `public/alignment/output.json`

## Start app

```bash
npm run dev
```

## Project structure

```text
/public
  /audio
  /alignment
  avatar.glb

/src
  App.jsx
  Avatar.jsx
  visemeMap.js
  useLipSync.js
```

## Notes

- This is a baseline demo; visemes are hard-switched.
- Improve realism with interpolation/easing between visemes.
- Alignment quality directly affects lip-sync quality.
