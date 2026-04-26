// src/useEyeAnimation.js
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";

// ARKit names (Ready Player Me standard)
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
 * Side-effect only hook — returns nothing.
 */
export function useEyeAnimation(meshNodes) {
  const blinkRef = useRef({ phase: "open", timer: randomBetween(2, 5), value: 0 });
  const saccadeRef = useRef({
    timer: randomBetween(1, 3),
    targetH: 0,
    targetV: 0,
    currentH: 0,
    currentV: 0,
  });

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
      if (blink.value >= 1) blink.phase = "opening";
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

    const h = saccade.currentH;
    const v = saccade.currentV;

    indexMaps.forEach(({ mesh, blinkL, blinkR, lookUpL, lookUpR, lookDownL, lookDownR, lookInL, lookInR, lookOutL, lookOutR }) => {
      const inf = mesh.morphTargetInfluences;
      if (!inf) return;

      if (blinkL !== undefined) inf[blinkL] += (blink.value - inf[blinkL]) * smooth;
      if (blinkR !== undefined) inf[blinkR] += (blink.value - inf[blinkR]) * smooth;

      const up = Math.max(0, v);
      const down = Math.max(0, -v);
      if (lookUpL !== undefined) inf[lookUpL] += (up - inf[lookUpL]) * smooth;
      if (lookUpR !== undefined) inf[lookUpR] += (up - inf[lookUpR]) * smooth;
      if (lookDownL !== undefined) inf[lookDownL] += (down - inf[lookDownL]) * smooth;
      if (lookDownR !== undefined) inf[lookDownR] += (down - inf[lookDownR]) * smooth;

      const outL = Math.max(0, h);
      const inL = Math.max(0, -h);
      if (lookOutL !== undefined) inf[lookOutL] += (outL - inf[lookOutL]) * smooth;
      if (lookInL !== undefined) inf[lookInL] += (inL - inf[lookInL]) * smooth;
      if (lookInR !== undefined) inf[lookInR] += (outL - inf[lookInR]) * smooth;
      if (lookOutR !== undefined) inf[lookOutR] += (inL - inf[lookOutR]) * smooth;
    });
  });
}
