import { useEffect, useMemo, useState } from "react";
import { phonemeToViseme } from "./visemeMap";

function buildTimeline(alignmentData) {
  const timeline = [];
  const words = Array.isArray(alignmentData?.words) ? alignmentData.words : [];

  words.forEach((word) => {
    if (!Array.isArray(word?.phones) || typeof word?.start !== "number") {
      return;
    }

    let time = word.start;

    word.phones.forEach((phoneInfo) => {
      const rawPhone = typeof phoneInfo?.phone === "string" ? phoneInfo.phone : "";
      const duration = typeof phoneInfo?.duration === "number" ? phoneInfo.duration : 0;
      const phoneme = rawPhone.split("_")[0].replace(/[0-9]/g, "").toUpperCase();
      const viseme = phonemeToViseme[phoneme];

      if (viseme && duration > 0) {
        timeline.push({ time, duration, viseme });
      }

      time += duration;
    });
  });

  return timeline.sort((a, b) => a.time - b.time);
}

export function useLipSync() {
  const [alignmentData, setAlignmentData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/alignment/output.json", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (isMounted) {
          setAlignmentData(data);
        }
      } catch (err) {
        if (isMounted) {
          setAlignmentData(null);
          setError(`Failed to load /alignment/output.json: ${err?.message || "unknown error"}`);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  const timeline = useMemo(() => buildTimeline(alignmentData), [alignmentData]);

  return { timeline, isLoading, error };
}
