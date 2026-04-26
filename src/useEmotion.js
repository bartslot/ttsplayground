// src/useEmotion.js
import { useMemo } from "react";

// Weights per emotion — keys are ARKit morph target names (Ready Player Me standard)
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
 * Returns a Map<mesh, number[]> for the current emotion.
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
