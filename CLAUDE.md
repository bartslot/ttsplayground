# ttsplayground

TTS demo app — record voice, clone it via Pocket TTS, play back with 3D avatar lip sync. All on free hosting.

## Purpose

Test and showcase [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts) voice cloning with a Three.js avatar that lip-syncs to generated speech. No paid infra.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite |
| 3D / Avatar | Three.js, @react-three/fiber, @react-three/drei |
| TTS backend | Pocket TTS (Python FastAPI), hosted on HuggingFace Spaces (Docker) |
| Frontend hosting | Vercel |
| Voice storage | IndexedDB (browser, persists across sessions) |
| Lip sync | Local G2P estimator (`lipSyncLocal.js`) — no server needed |

## Key files

- `src/App.jsx` — main app, recording, TTS request, playback, lip sync wiring
- `src/Avatar.jsx` — Three.js avatar, idle animations, morph target visemes
- `src/lipSyncLocal.js` — client-side G2P: text + audio duration → viseme timeline
- `src/audioUtils.js` — decode audio, crop leading silence, prepare voice prompt blob
- `../pocket-tts-space/app.py` — FastAPI wrapper around pocket-tts, CORS enabled

## Hosting

- **Frontend**: Vercel — set `VITE_TTS_URL` env var to HF Space URL
- **TTS backend**: HuggingFace Spaces (Docker), user `barukasharlot`, space `pocket-tts-server`
- **Gentle aligner**: not hosted — lip sync uses local fallback instead

## Lip sync

No Gentle in prod. `lipSyncLocal.js` estimates viseme timeline from text + decoded audio duration using rule-based English G2P. Not frame-perfect but natural-looking.

## Voice cloning flow

1. User records mic (up to 15s, auto-cropped)
2. WAV sent as `voice_wav` form field to `/tts` on HF Space
3. Pocket TTS clones voice, returns `audio/wav`
4. Audio decoded → duration → local viseme timeline built
5. Avatar plays back with morph target animation
