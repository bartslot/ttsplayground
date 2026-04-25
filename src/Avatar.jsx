import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { AnimationMixer, Box3, LoopRepeat, Vector3 } from "three";

const visemeAliases = {
  viseme_ah: ["viseme_aa", "viseme_AA"],
  viseme_aa: ["viseme_aa", "viseme_AA"],
  viseme_eh: ["viseme_E", "viseme_eh", "viseme_EH"],
  viseme_er: ["viseme_RR", "viseme_er", "viseme_R"],
  viseme_ih: ["viseme_I", "viseme_ih", "viseme_IH"],
  viseme_iy: ["viseme_I", "viseme_iy", "viseme_IY"],
  viseme_oh: ["viseme_O", "viseme_oh", "viseme_OH"],
  viseme_uw: ["viseme_U", "viseme_uw", "viseme_UW"],
  viseme_fv: ["viseme_FF", "viseme_fv", "viseme_F"],
  viseme_mbp: ["viseme_PP", "viseme_mbp", "viseme_P", "viseme_M", "viseme_B"],
  viseme_l: ["viseme_RR", "viseme_l", "viseme_L"],
  viseme_s: ["viseme_SS", "viseme_s", "viseme_S", "viseme_Z"],
  viseme_sh: ["viseme_CH", "viseme_sh", "viseme_SH"],
  viseme_ch: ["viseme_CH", "viseme_ch", "viseme_SH"],
  viseme_th: ["viseme_TH", "viseme_th", "viseme_DH"],
  viseme_kk: ["viseme_kk", "viseme_KK", "viseme_K", "viseme_G"],
  viseme_nn: ["viseme_NN", "viseme_nn", "viseme_N", "viseme_NG"],
  viseme_tt: ["viseme_DD", "viseme_tt", "viseme_T", "viseme_D"]
};

function buildTargetLookup(dictionary) {
  const lookup = new Map();

  Object.entries(dictionary || {}).forEach(([name, index]) => {
    lookup.set(name, index);
    lookup.set(name.toLowerCase(), index);
    lookup.set(name.toUpperCase(), index);
  });

  return lookup;
}

function resolveVisemeIndex(dictionary, visemeName) {
  if (!dictionary || !visemeName) return undefined;

  const lookup = buildTargetLookup(dictionary);
  const aliases = visemeAliases[visemeName] || [visemeName];

  for (const alias of aliases) {
    const index = lookup.get(alias) ?? lookup.get(alias.toLowerCase()) ?? lookup.get(alias.toUpperCase());
    if (index !== undefined) {
      return index;
    }
  }

  return undefined;
}

export default function Avatar({ visemeState, mouthIntensity = 1, onMeshReport, isReady = true }) {
  const { scene } = useGLTF("/avatar.glb");
  const idle001 = useGLTF("/animations/M_Standing_Idle_001.glb");
  const idle002 = useGLTF("/animations/M_Standing_Idle_002.glb");
  const rootRef = useRef();
  const mixerRef = useRef(null);
  const cycleTimeoutRef = useRef(0);
  const targetInfluencesRef = useRef(new Map());
  const idleClips = useMemo(
    () => [...(idle001.animations || []), ...(idle002.animations || [])].filter(Boolean),
    [idle001.animations, idle002.animations]
  );

  const meshNodes = useMemo(() => {
    const meshes = [];

    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      meshes.push(obj);
    });

    return meshes;
  }, [scene]);

  const meshReports = useMemo(
    () =>
      meshNodes.map((mesh) => ({
        name: mesh.name || "(unnamed)",
        isSkinnedMesh: Boolean(mesh.isSkinnedMesh),
        vertexMorphTargets: mesh.geometry?.morphAttributes?.position?.length || 0,
        morphTargets: Object.keys(mesh.morphTargetDictionary || {}),
        visemeTargets: Object.keys(mesh.morphTargetDictionary || {}).filter((name) =>
          name.toLowerCase().includes("viseme"),
        ),
        visible: mesh.visible
      })),
    [meshNodes],
  );

  useLayoutEffect(() => {
    const box = new Box3().setFromObject(scene);
    const center = new Vector3();
    box.getCenter(center);

    // eslint-disable-next-line react-hooks/immutability
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box.min.y;
  }, [scene]);

  useEffect(() => {
    onMeshReport?.(meshReports);
  }, [meshReports, onMeshReport]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || idleClips.length === 0) return undefined;

    const mixer = new AnimationMixer(root);
    mixerRef.current = mixer;

    const actions = idleClips.map((clip) => {
      const action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      action.setEffectiveWeight(0);
      return action;
    });

    let activeIndex = 0;
    const fadeSeconds = 0.45;

    const scheduleNext = () => {
      if (actions.length < 2) return;

      const currentIndex = activeIndex;
      const nextIndex = (currentIndex + 1) % actions.length;
      const currentAction = actions[currentIndex];
      const nextAction = actions[nextIndex];

      nextAction.reset();
      nextAction.setEffectiveWeight(1);
      nextAction.play();
      currentAction.crossFadeTo(nextAction, fadeSeconds, false);
      activeIndex = nextIndex;

      const clip = idleClips[nextIndex];
      const delaySeconds =
        Number.isFinite(clip?.duration) && clip.duration > 0
          ? Math.max(clip.duration - fadeSeconds, 3)
          : 6;

      cycleTimeoutRef.current = window.setTimeout(scheduleNext, delaySeconds * 1000);
    };

    actions[0]?.play();
    actions[0]?.setEffectiveWeight(1);

    const firstClip = idleClips[0];
    const initialDelaySeconds =
      Number.isFinite(firstClip?.duration) && firstClip.duration > 0
        ? Math.max(firstClip.duration - fadeSeconds, 3)
        : 6;

    cycleTimeoutRef.current = window.setTimeout(scheduleNext, initialDelaySeconds * 1000);

    return () => {
      if (cycleTimeoutRef.current) {
        clearTimeout(cycleTimeoutRef.current);
        cycleTimeoutRef.current = 0;
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      mixerRef.current = null;
    };
  }, [idleClips]);

  useEffect(() => {
    const nextTargets = new Map();
    const morphMeshes = meshNodes.filter(
      (mesh) => mesh.morphTargetDictionary && mesh.morphTargetInfluences,
    );

    morphMeshes.forEach((mesh) => {
      const targets = new Array(mesh.morphTargetInfluences.length).fill(0);
      const index = resolveVisemeIndex(mesh.morphTargetDictionary, visemeState);

      if (index !== undefined) {
        targets[index] = mouthIntensity;
      }

      nextTargets.set(mesh, targets);
    });

    targetInfluencesRef.current = nextTargets;
  }, [meshNodes, visemeState, mouthIntensity]);

  useFrame((_, delta) => {
    if (isReady) mixerRef.current?.update(delta);

    const morphMeshes = meshNodes.filter(
      (mesh) => mesh.morphTargetDictionary && mesh.morphTargetInfluences,
    );

    if (morphMeshes.length === 0) return;

    const smoothing = 1 - Math.exp(-delta * 14);

    morphMeshes.forEach((mesh) => {
      const influences = mesh.morphTargetInfluences;
      const targets = targetInfluencesRef.current.get(mesh);

      if (!targets) return;

      for (let i = 0; i < influences.length; i += 1) {
        influences[i] += (targets[i] - influences[i]) * smoothing;
      }
    });
  });

  return (
    <group ref={rootRef}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload("/avatar.glb");
useGLTF.preload("/animations/M_Standing_Idle_001.glb");
useGLTF.preload("/animations/M_Standing_Idle_002.glb");
