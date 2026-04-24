import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/plugins/regions";

const MAX_SELECTION_SECONDS = 15;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function VoiceWaveform({
  audioUrl,
  selectionStart,
  selectionEnd,
  onSelectionChange
}) {
  const containerRef = useRef(null);
  const waveSurferRef = useRef(null);
  const regionRef = useRef(null);
  const propsRef = useRef({ selectionStart, selectionEnd, onSelectionChange });

  useEffect(() => {
    propsRef.current = { selectionStart, selectionEnd, onSelectionChange };
  }, [selectionStart, selectionEnd, onSelectionChange]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return undefined;

    const regions = RegionsPlugin.create();

    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      height: 120,
      waveColor: "#8fa8bb",
      progressColor: "#17364d",
      cursorColor: "#17364d",
      normalize: true,
      interact: true,
      dragToSeek: true,
      fillParent: true,
      plugins: [regions]
    });

    waveSurferRef.current = waveSurfer;

    const handleReady = () => {
      const duration = waveSurfer.getDuration();
      const regionLength = Math.min(MAX_SELECTION_SECONDS, duration);
      const maxStart = Math.max(0, duration - regionLength);
      const { selectionStart: currentStart, selectionEnd: currentEnd, onSelectionChange: currentChange } = propsRef.current;
      const start = clamp(currentStart ?? 0, 0, maxStart);
      const end = Math.min(duration, currentEnd ?? start + regionLength);
      const fixedEnd = Math.max(start, Math.min(end, start + regionLength));

      regionRef.current?.remove();
      const region = regions.addRegion({
        start,
        end: fixedEnd,
        drag: true,
        resize: false,
        color: "rgba(22, 52, 74, 0.22)"
      });

      region.on("update-end", () => {
        propsRef.current.onSelectionChange?.({ start: region.start, end: region.end, duration });
      });

      regionRef.current = region;
      currentChange?.({ start: region.start, end: region.end, duration });
    };

    waveSurfer.on("ready", handleReady);
    waveSurfer.load(audioUrl);

    return () => {
      regionRef.current = null;
      waveSurfer.destroy();
      waveSurferRef.current = null;
    };
  }, [audioUrl]);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    const duration = waveSurferRef.current?.getDuration?.() ?? 0;
    const { selectionStart: currentStart, selectionEnd: currentEnd } = propsRef.current;
    const regionLength = Math.min(
      MAX_SELECTION_SECONDS,
      duration || 0,
      currentEnd > currentStart ? currentEnd - currentStart : MAX_SELECTION_SECONDS,
    );
    const maxStart = Math.max(0, duration - regionLength);
    const nextStart = clamp(currentStart ?? 0, 0, maxStart);
    const nextEnd = Math.min(duration || nextStart + regionLength, currentEnd ?? nextStart + regionLength);
    const fixedEnd = Math.max(nextStart, Math.min(nextEnd, nextStart + regionLength));

    region.setOptions({ start: nextStart, end: fixedEnd });
  }, [selectionStart, selectionEnd]);

  return <div className="waveform" ref={containerRef} />;
}
