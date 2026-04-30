# Expressive Avatar (Emotion + Eye Animation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add emotion blending and eye animation (blink + saccade) to the existing ttsplayground avatar, so it speaks with synced lips, natural blinking eyes, and smoothly shifting emotional expressions.

**Architecture:** The existing `Avatar.jsx` already drives morph targets for visemes via `visemeState` prop and smooth lerping in `useFrame`. We extend it with two new hooks — `useEmotion.js` and `useEyeAnimation.js` — that each produce a `Map<mesh, targets[]>` merged into the morph target pass each frame. `App.jsx` provides an `emotion` prop driven by a simple rule (speaking → neutral/happy, idle → neutral).

**Tech Stack:** React 19, React Three Fiber (`useFrame`), Three.js morph targets, existing `Avatar.jsx` + `App.jsx`

---

## What already exists (do NOT reimplement)

| Feature | File | Status |
|---------|------|--------|
| TTS via Pocket TTS / HF Space | `App.jsx:540–590` | ✅ done |
| Gentle alignment call | `App.jsx:564–578` | ✅ done |
| Local viseme fallback | `lipSyncLocal.js` | ✅ done |
| ARPAbet → viseme map | `visemeMap.js` | ✅ done |
| Morph target lerping | `Avatar.jsx:197–209` | ✅ done |
| Idle animation cycling | `Avatar.jsx:100–155` | ✅ done |
| Viseme timeline driver | `App.jsx:280–335` | ✅ done |

**Gaps being filled by this plan:**
- Emotion morph targets (happy, sad, angry, neutral blend)
- Eye blink (random interval, natural timing)
- Eye saccade (subtle random micro-movements)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/useEmotion.js` | **Create** | Returns `{ emotionTargets: Map }` — per-mesh morph target arrays for the current emotion blend |
| `src/useEyeAnimation.js` | **Create** | Returns `{ eyeTargets: Map }` — per-mesh morph target arrays for blink + saccade state |
| `src/Avatar.jsx` | **Modify** | Accept `emotion` + `eyeState` props; merge emotion/eye target maps into the morph pass |
| `src/App.jsx` | **Modify** | Pass `emotion` prop based on playback state; no eye wiring needed (Avatar drives it internally) |

---

## Task 1: Discover available morph targets on the avatar

Before writing any animation code we need to know which morph target names the GLB actually exposes for eyes and expressions. `Avatar.jsx` already reports this via `onMeshReport`.

**Files:**
- Read: `src/Avatar.jsx` (meshReports, onMeshReport prop)
- Read: `src/App.jsx` (where onMeshReport is used)

- [ ] **Step 1: Run the app and capture mesh report**

```bash
cd /Users/bartslot/BartsAutomation/BartsDev/apps/ttsplayground
npm run dev
```

Open browser console on `http://localhost:5173`. Look for the mesh report logged by `onMeshReport`. Record all morph target names that contain: `blink`, `eye`, `happy`, `sad`, `angry`, `surprise`, `neutral`, `mouth`, `smile`, `frown`.

- [ ] **Step 2: Map target names to categories**

Create a reference comment block (do NOT commit this — it's scratch notes):

```
// Discovered morph targets on Wolf3D_Head (example — update with actual names):
// BLINK:   eyeBlinkLeft, eyeBlinkRight
// SACCADE: eyeLookUpLeft, eyeLookDownLeft, eyeLookInLeft, eyeLookOutLeft, (Right variants)
// EMOTION HAPPY:   mouthSmileLeft, mouthSmileRight
// EMOTION SAD:     browDownLeft, browDownRight, mouthFrownLeft, mouthFrownRight
// EMOTION ANGRY:   browDownLeft, browDownRight, noseSneerLeft, noseSneerRight
// NEUTRAL: (all zero)
```

Ready Player Me avatars use ARKit blendshape names — these are the standard names. Verify against what the console shows.

- [ ] **Step 3: Commit nothing yet — move to Task 2**

---

## Task 2: Create `useEmotion.js`

**Files:**
- Create: `src/useEmotion.js`

- [ ] **Step 1: Write `useEmotion.js`**

```js
// src/useEmotion.js
import { useMemo } from "react";

// Weights per emotion — keys are ARKit morph target names (Ready Player Me standard)
// Adjust names to match what Task 1 discovered
const EMOTION_PRESETS = {
  neutral: {},
  happy: {
    mouthSmileLeft: 0.6,
    mouthSmileRight: 0.6,
    cheekSquintLeft: 0.3,
    cheekSquintRight: 0.3,
  },
  sad: {
    browDownLeft: 0.4,
    browDownRight: 0.4,
    mouthFrownLeft: 0.5,
    mouthFrownRight: 0.5,
    browInnerUp: 0.3,
  },
  angry: {
    browDownLeft: 0.7,
    browDownRight: 0.7,
    noseSneerLeft: 0.4,
    noseSneerRight: 0.4,
    mouthPressLeft: 0.3,
    mouthPressRight: 0.3,
  },
};

/**
 * Returns a Map<mesh, Float32Array-like targets[]> for the current emotion.
 * meshNodes: array of Three.js mesh objects from Avatar scene traversal
 * emotion: "neutral" | "happy" | "sad" | "angry"
 */
export function useEmotion(meshNodes, emotion = "neutral") {
  return useMemo(() => {
    const preset = EMOTION_PRESETS[emotion] ?? EMOTION_PRESETS.neutral;
    const map = new Map();

    meshNodes.forEach((mesh) => {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) return;

      const targets = new Array(influences.length).fill(0);
      Object.entries(preset).forEach(([name, weight]) => {
        const idx = dict[name];
        if (idx !== undefined) targets[idx] = weight;
      });
      map.set(mesh, targets);
    });

    return map;
  }, [meshNodes, emotion]);
}
```

- [ ] **Step 2: Verify it imports without error**

```bash
# In the running vite dev server, add a temporary import to Avatar.jsx:
# import { useEmotion } from "./useEmotion";
# Check browser console — no errors = pass
```

- [ ] **Step 3: Commit**

```bash
git add src/useEmotion.js
git commit -m "feat: add useEmotion hook with happy/sad/angry/neutral presets"
```

---

## Task 3: Create `useEyeAnimation.js`

**Files:**
- Create: `src/useEyeAnimation.js`

- [ ] **Step 1: Write `useEyeAnimation.js`**

```js
// src/useEyeAnimation.js
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";

// ARKit names — verify against Task 1 mesh report
const BLINK_LEFT = "eyeBlinkLeft";
const BLINK_RIGHT = "eyeBlinkRight";
const LOOK_UP_L = "eyeLookUpLeft";
const LOOK_UP_R = "eyeLookUpRight";
const LOOK_DOWN_L = "eyeLookDownLeft";
const LOOK_DOWN_R = "eyeLookDownRight";
const LOOK_IN_L = "eyeLookInLeft";
const LOOK_IN_R = "eyeLookInRight";
const LOOK_OUT_L = "eyeLookOutLeft";
const LOOK_OUT_R = "eyeLookOutRight";

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * Drives blink and saccade by writing directly into morphTargetInfluences each frame.
 * Returns nothing — it operates as a side-effect hook.
 */
export function useEyeAnimation(meshNodes) {
  // Blink state
  const blinkRef = useRef({ phase: "open", timer: randomBetween(2, 5), value: 0 });
  // Saccade state
  const saccadeRef = useRef({
    timer: randomBetween(1, 3),
    targetH: 0, // -1 to 1 horizontal
    targetV: 0, // -1 to 1 vertical
    currentH: 0,
    currentV: 0,
  });

  // Build index lookup once per meshNodes change
  const indexMaps = useMemo(() => {
    return meshNodes.map((mesh) => {
      const d = mesh.morphTargetDictionary;
      if (!d) return null;
      return {
        mesh,
        blinkL: d[BLINK_LEFT],
        blinkR: d[BLINK_RIGHT],
        lookUpL: d[LOOK_UP_L],
        lookUpR: d[LOOK_UP_R],
        lookDownL: d[LOOK_DOWN_L],
        lookDownR: d[LOOK_DOWN_R],
        lookInL: d[LOOK_IN_L],
        lookInR: d[LOOK_IN_R],
        lookOutL: d[LOOK_OUT_L],
        lookOutR: d[LOOK_OUT_R],
      };
    }).filter(Boolean);
  }, [meshNodes]);

  useFrame((_, delta) => {
    const smooth = 1 - Math.exp(-delta * 14);

    // --- BLINK ---
    const blink = blinkRef.current;
    blink.timer -= delta;

    if (blink.phase === "open" && blink.timer <= 0) {
      blink.phase = "closing";
      blink.timer = 0;
    }
    if (blink.phase === "closing") {
      blink.value = Math.min(blink.value + delta * 12, 1);
      if (blink.value >= 1) {
        blink.phase = "opening";
      }
    }
    if (blink.phase === "opening") {
      blink.value = Math.max(blink.value - delta * 10, 0);
      if (blink.value <= 0) {
        blink.phase = "open";
        blink.timer = randomBetween(2, 6);
      }
    }

    // --- SACCADE ---
    const saccade = saccadeRef.current;
    saccade.timer -= delta;
    if (saccade.timer <= 0) {
      saccade.targetH = randomBetween(-0.15, 0.15);
      saccade.targetV = randomBetween(-0.1, 0.1);
      saccade.timer = randomBetween(1.5, 4);
    }
    saccade.currentH += (saccade.targetH - saccade.currentH) * smooth;
    saccade.currentV += (saccade.targetV - saccade.currentV) * smooth;

    const h = saccade.currentH; // negative = look left, positive = look right
    const v = saccade.currentV; // negative = look down, positive = look up

    // Apply to meshes
    indexMaps.forEach(({ mesh, blinkL, blinkR, lookUpL, lookUpR, lookDownL, lookDownR, lookInL, lookInR, lookOutL, lookOutR }) => {
      const inf = mesh.morphTargetInfluences;
      if (!inf) return;

      // Blink
      if (blinkL !== undefined) inf[blinkL] += (blink.value - inf[blinkL]) * smooth;
      if (blinkR !== undefined) inf[blinkR] += (blink.value - inf[blinkR]) * smooth;

      // Vertical
      const up = Math.max(0, v);
      const down = Math.max(0, -v);
      if (lookUpL !== undefined) inf[lookUpL] += (up - inf[lookUpL]) * smooth;
      if (lookUpR !== undefined) inf[lookUpR] += (up - inf[lookUpR]) * smooth;
      if (lookDownL !== undefined) inf[lookDownL] += (down - inf[lookDownL]) * smooth;
      if (lookDownR !== undefined) inf[lookDownR] += (down - inf[lookDownR]) * smooth;

      // Horizontal: positive h = look right = lookOutLeft + lookInRight
      const outL = Math.max(0, h);
      const inL = Math.max(0, -h);
      if (lookOutL !== undefined) inf[lookOutL] += (outL - inf[lookOutL]) * smooth;
      if (lookInL !== undefined) inf[lookInL] += (inL - inf[lookInL]) * smooth;
      if (lookInR !== undefined) inf[lookInR] += (outL - inf[lookInR]) * smooth;
      if (lookOutR !== undefined) inf[lookOutR] += (inL - inf[lookOutR]) * smooth;
    });
  });
}
```

- [ ] **Step 2: Verify import compiles**

In browser console after saving — no red errors = pass.

- [ ] **Step 3: Commit**

```bash
git add src/useEyeAnimation.js
git commit -m "feat: add useEyeAnimation hook with blink and saccade"
```

---

## Task 4: Wire hooks into `Avatar.jsx`

**Files:**
- Modify: `src/Avatar.jsx`

- [ ] **Step 1: Add imports at top of `Avatar.jsx`**

After existing imports, add:

```js
import { useEmotion } from "./useEmotion";
import { useEyeAnimation } from "./useEyeAnimation";
```

- [ ] **Step 2: Add `emotion` prop to the Avatar function signature**

Change:

```js
export default function Avatar({ visemeState, mouthIntensity = 1, onMeshReport, isReady = true }) {
```

To:

```js
export default function Avatar({ visemeState, mouthIntensity = 1, onMeshReport, isReady = true, emotion = "neutral" }) {
```

- [ ] **Step 3: Call `useEmotion` inside Avatar (after `meshNodes` is defined)**

Add after the `meshNodes` useMemo (around line 75):

```js
const emotionTargets = useEmotion(meshNodes, emotion);
```

- [ ] **Step 4: Call `useEyeAnimation` inside Avatar (after `meshNodes`)**

```js
useEyeAnimation(meshNodes);
```

- [ ] **Step 5: Merge emotion targets into the viseme `useEffect`**

Find the `useEffect` that builds `targetInfluencesRef` (around line 170). Change it so emotion weights are added on top of viseme weights:

```js
useEffect(() => {
  const nextTargets = new Map();
  const morphMeshes = meshNodes.filter(
    (mesh) => mesh.morphTargetDictionary && mesh.morphTargetInfluences,
  );

  morphMeshes.forEach((mesh) => {
    // Start from emotion baseline
    const emotionBase = emotionTargets.get(mesh) ?? new Array(mesh.morphTargetInfluences.length).fill(0);
    const targets = [...emotionBase];

    // Overlay viseme on top
    const index = resolveVisemeIndex(mesh.morphTargetDictionary, visemeState);
    if (index !== undefined) {
      targets[index] = mouthIntensity;
    }

    nextTargets.set(mesh, targets);
  });

  targetInfluencesRef.current = nextTargets;
}, [meshNodes, visemeState, mouthIntensity, emotionTargets]);
```

- [ ] **Step 6: Verify in browser — avatar still animates, no console errors**

- [ ] **Step 7: Commit**

```bash
git add src/Avatar.jsx
git commit -m "feat: wire emotion and eye animation into Avatar morph target pass"
```

---

## Task 5: Pass `emotion` from `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add emotion state**

Find where other state is declared (around line 140). Add:

```js
const [emotion, setEmotion] = useState("neutral");
```

- [ ] **Step 2: Set emotion when playback starts/stops**

Find where `setViseme(null)` is called on playback end (around line 282 and 333). After each `setViseme(null)`, add:

```js
setEmotion("neutral");
```

Find where playback starts (where the timeline loop begins, around line 305). Before the loop starts, add:

```js
setEmotion("happy");
```

- [ ] **Step 3: Pass `emotion` to Avatar**

Find the Avatar usage (around line 737):

```jsx
<Avatar visemeState={viseme} mouthIntensity={mouthIntensity} isReady={isReady} />
```

Change to:

```jsx
<Avatar visemeState={viseme} mouthIntensity={mouthIntensity} isReady={isReady} emotion={emotion} />
```

- [ ] **Step 4: Verify full flow in browser**

1. Click Generate / play
2. Avatar should show slight smile while speaking (`happy` emotion)
3. Avatar returns to neutral when done
4. Eyes should blink on random interval throughout

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: drive avatar emotion from playback state (happy while speaking, neutral idle)"
```

---

## Task 6: Tune morph target names to actual GLB

The presets in `useEmotion.js` and `useEyeAnimation.js` use Ready Player Me ARKit names. If the avatar uses different names, targets will silently be ignored (indexes undefined = no-op).

**Files:**
- Modify: `src/useEmotion.js`
- Modify: `src/useEyeAnimation.js`

- [ ] **Step 1: Capture actual morph target names from browser**

In `Avatar.jsx`, the `meshReports` already lists all morph target names. Add a temporary console.log to see them:

```js
// Temporary — in Avatar.jsx useEffect for onMeshReport:
console.table(meshReports.flatMap(r => r.morphTargets));
```

Run `npm run dev`, open console, copy the full list.

- [ ] **Step 2: Update constant names in `useEyeAnimation.js`**

Replace `BLINK_LEFT`, `BLINK_RIGHT`, `LOOK_*` constants with the actual names found in Step 1.

- [ ] **Step 3: Update `EMOTION_PRESETS` in `useEmotion.js`**

Replace key names in each preset object with actual names from Step 1 that correspond to smile, frown, brow shapes.

- [ ] **Step 4: Remove temporary console.log from Avatar.jsx**

- [ ] **Step 5: Verify in browser — eyes blink, smile visible while speaking**

- [ ] **Step 6: Commit**

```bash
git add src/useEmotion.js src/useEyeAnimation.js src/Avatar.jsx
git commit -m "fix: align morph target names to actual GLB blendshapes"
```

---

## Success Criteria

- [ ] Audio plays from Pocket TTS
- [ ] Lips sync (visemes animate correctly)
- [ ] Eyes blink at random natural intervals (every 2–6 seconds)
- [ ] Eyes shift subtly (saccade) between blinks
- [ ] Face shows happy blend while speaking, neutral at rest
- [ ] No console errors
- [ ] `npm run dev` starts cleanly

## Dev commands

```bash
npm run dev                  # start frontend
npm run gentle:start         # start Gentle in Docker (for alignment)
npm run tts:serve            # start local Pocket TTS
```
