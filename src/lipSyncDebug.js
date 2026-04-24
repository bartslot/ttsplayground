export function summarizeAlignment(timeline, alignmentError, isLoading) {
  if (isLoading) {
    return {
      status: "loading",
      message: "Alignment file still loading."
    };
  }

  if (alignmentError) {
    return {
      status: "error",
      message: alignmentError
    };
  }

  if (timeline.length === 0) {
    return {
      status: "empty",
      message: "Alignment loaded, but no visemes were parsed."
    };
  }

  const end = timeline[timeline.length - 1];
  return {
    status: "ok",
    message: `Parsed ${timeline.length} viseme keys over ${(end.time + end.duration).toFixed(2)}s.`
  };
}

export function logAlignmentDebug(timeline, alignmentError, isLoading) {
  const result = summarizeAlignment(timeline, alignmentError, isLoading);

  console.groupCollapsed("[LipSync][Test 1] Alignment parse");
  console.log("status:", result.status);
  console.log("message:", result.message);
  console.log("timeline sample:", timeline.slice(0, 10));
  console.groupEnd();

  return result;
}

export function logAvatarDebug(meshReports) {
  console.groupCollapsed("[LipSync][Test 2] Avatar morph targets");
  console.log("morph meshes:", meshReports.length);
  console.table(
    meshReports.map((mesh) => ({
      name: mesh.name,
      isSkinnedMesh: mesh.isSkinnedMesh,
      vertexMorphTargets: mesh.vertexMorphTargets,
      morphTargets: mesh.morphTargets.length,
      visemeTargets: mesh.visemeTargets.join(", "),
      visible: mesh.visible
    })),
  );
  meshReports.forEach((mesh) => console.log(mesh));
  console.groupEnd();
}

export function logPlaybackDebug({ time, viseme, currentKey, matchedMeshes }) {
  console.groupCollapsed("[LipSync][Test 3] Playback tick");
  console.log("time:", time.toFixed(3));
  console.log("current viseme:", viseme);
  console.log("current key:", currentKey);
  console.log("matched meshes:", matchedMeshes);
  console.groupEnd();
}
