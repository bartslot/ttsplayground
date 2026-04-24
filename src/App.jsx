import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import Avatar from "./Avatar";
import { decodeAudioBlob, findLeadingVoiceStart, prepareVoicePromptBlobFromAudioBuffer } from "./audioUtils";
import recIcon from "./assets/rec.svg";
import playIcon from "./assets/play.svg";
import pauseIcon from "./assets/pause.svg";

function findCurrentViseme(timeline, time, tailSeconds = 0.12) {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const key = timeline[i];
    if (time >= key.time && time <= key.time + key.duration + tailSeconds) return key.viseme;
  }
  return null;
}

function summarizeTimeline(timeline) {
  if (!timeline.length) {
    return { keys: 0, duration: 0, first: null, last: null };
  }

  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  return {
    keys: timeline.length,
    duration: last.time + last.duration,
    first,
    last
  };
}

function buildVisemeTimeline(alignment) {
  return Array.isArray(alignment?.words)
    ? alignment.words
        .flatMap((word) => {
          if (!Array.isArray(word?.phones) || typeof word?.start !== "number") return [];

          let time = word.start;
          return word.phones.flatMap((phoneInfo) => {
            const rawPhone = typeof phoneInfo?.phone === "string" ? phoneInfo.phone : "";
            const duration = typeof phoneInfo?.duration === "number" ? phoneInfo.duration : 0;
            const phoneme = rawPhone.split("_")[0].replace(/[0-9]/g, "").toUpperCase();
            const viseme = {
              AA: "viseme_ah",
              AE: "viseme_aa",
              AH: "viseme_ah",
              AO: "viseme_oh",
              OW: "viseme_oh",
              EH: "viseme_eh",
              ER: "viseme_er",
              IH: "viseme_ih",
              IY: "viseme_iy",
              UH: "viseme_uh",
              UW: "viseme_uw",
              B: "viseme_mbp",
              P: "viseme_mbp",
              M: "viseme_mbp",
              F: "viseme_fv",
              V: "viseme_fv",
              L: "viseme_l",
              S: "viseme_s",
              Z: "viseme_s",
              SH: "viseme_sh",
              CH: "viseme_ch",
              TH: "viseme_th",
              DH: "viseme_th",
              K: "viseme_kk",
              G: "viseme_kk",
              N: "viseme_nn",
              T: "viseme_tt",
              D: "viseme_tt"
            }[phoneme];
            const entries = viseme && duration > 0 ? [{ time, duration, viseme }] : [];
            time += duration;
            return entries;
          });
        })
        .sort((a, b) => a.time - b.time)
    : [];
}

const DEFAULT_PROMPT = "Record your voice for 15 seconds and i'll be able to speak. Are you ready?";
const DEFAULT_SAMPLE =
  "Hi there! I'm your virtual assistant. I just woke up using the voice you recorded from your mic, and I'm ready to chat. So, what's the first thing you want to say to me?";
const LIP_SYNC_LEAD_SECONDS = 0.08;
const VOICE_DB_NAME = "ttsplayground";
const VOICE_DB_VERSION = 1;
const VOICE_STORE = "voice-clone";

function openVoiceDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VOICE_DB_NAME, VOICE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VOICE_STORE)) {
        db.createObjectStore(VOICE_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
  });
}

async function saveVoiceCacheToDb(payload) {
  const db = await openVoiceDb();

  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(VOICE_STORE, "readwrite");
      tx.objectStore(VOICE_STORE).put(payload, "voice-clone");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save voice clone."));
      tx.onabort = () => reject(tx.error || new Error("Could not save voice clone."));
    });
  } finally {
    db.close();
  }
}

async function loadVoiceCacheFromDb() {
  const db = await openVoiceDb();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(VOICE_STORE, "readonly");
      const request = tx.objectStore(VOICE_STORE).get("voice-clone");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not load voice clone."));
    });
  } finally {
    db.close();
  }
}

export default function App() {
  const [viseme, setViseme] = useState(null);
  const [voiceError, setVoiceError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [, setRecordingLevel] = useState(0);
  const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE);
  const [mouthIntensity, setMouthIntensity] = useState(0.6);
  const [isBaking, setIsBaking] = useState(false);
  const [isPreparingSample, setIsPreparingSample] = useState(false);
  const [bakeError, setBakeError] = useState("");
  const [, setBakedAudioUrl] = useState("");
  const [isClonePlaying, setIsClonePlaying] = useState(false);
  const [preparedVoiceBlob, setPreparedVoiceBlob] = useState(null);
  const [fallbackTimeline, setFallbackTimeline] = useState([]);
  const [cachedSamplePreview, setCachedSamplePreview] = useState(null);

  const audioRef = useRef(null);
  const frameRef = useRef(0);
  const controlsRef = useRef(null);
  const voiceObjectUrlRef = useRef("");
  const bakedAudioUrlRef = useRef("");
  const bakedAudioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const meterRafRef = useRef(0);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(0);
  const recordingElapsedRef = useRef(0);
  const sampleBakeTokenRef = useRef(0);
  const objectUrlsRef = useRef(new Set());

  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.target.set(0, 1.4, 0);
    controlsRef.current.update();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadFallback = async () => {
      try {
        const response = await fetch("/alignment/output.json");
        if (!response.ok) return;
        const alignment = await response.json();
        if (!cancelled) {
          setFallbackTimeline(buildVisemeTimeline(alignment));
        }
      } catch {
        // Optional fallback only.
      }
    };

    void loadFallback();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const saved = await loadVoiceCacheFromDb();
        if (!saved || cancelled) return;

        const blob = saved.voiceBlob instanceof Blob ? saved.voiceBlob : null;
        if (!blob) return;

        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.add(url);
        voiceObjectUrlRef.current = url;

        setPreparedVoiceBlob(blob);

        const savedPreview = saved.samplePreview;
        const previewBlob = savedPreview?.audioBlob instanceof Blob ? savedPreview.audioBlob : null;
        if (previewBlob && savedPreview?.text) {
          setCachedSamplePreview({
            text: savedPreview.text,
            audioBlob: previewBlob,
            timeline: Array.isArray(savedPreview.timeline) ? savedPreview.timeline : [],
            audioDuration: typeof savedPreview.audioDuration === "number" ? savedPreview.audioDuration : 0
          });
          setSampleText(savedPreview.text);
        }
      } catch {
        // No saved clone yet. Stay silent.
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
      mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      audioContextRef.current?.close?.();
      bakedAudioRef.current?.pause?.();
    },
    []
  );

  const stopPlayback = () => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    bakedAudioRef.current?.pause?.();
    setViseme(null);
    setIsClonePlaying(false);
  };

  const playAudioWithTimeline = async (audioUrl, playTimeline, playbackMeta = {}) => {
    stopPlayback();

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    bakedAudioRef.current = audio;
    audio.onended = () => {
      stopPlayback();
    };

    try {
      await audio.play();
      setIsClonePlaying(true);
    } catch (err) {
      setBakeError(`Audio failed to start: ${err?.message || "unknown error"}`);
      setIsClonePlaying(false);
      return;
    }

    if (import.meta.env.DEV) {
      const summary = summarizeTimeline(playTimeline);
      console.groupCollapsed("[LipSync][Test 3] Playback start");
      console.log("audio duration:", playbackMeta.audioDuration ?? "unknown");
      console.log("timeline keys:", summary.keys);
      console.log("timeline duration:", summary.duration.toFixed(2));
      console.log("first key:", summary.first);
      console.log("last key:", summary.last);
      console.groupEnd();
    }

    const start = performance.now();
    const lastLogged = { viseme: null };

    const tick = () => {
      const t = (audio.currentTime || (performance.now() - start) / 1000) + LIP_SYNC_LEAD_SECONDS;
      const nextViseme = findCurrentViseme(playTimeline, t);
      setViseme(nextViseme);

      if (import.meta.env.DEV && nextViseme !== lastLogged.viseme) {
        lastLogged.viseme = nextViseme;
        console.log("[LipSync][Test 3] viseme:", nextViseme, "t=", t.toFixed(2));
      }

      if (!audio.paused && !audio.ended) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setViseme(null);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
  };

  const stopBakedPreview = useCallback(() => {
    bakedAudioRef.current?.pause?.();
    bakedAudioRef.current = null;
    bakedAudioUrlRef.current = "";
    setBakedAudioUrl("");
    setCachedSamplePreview(null);
  }, []);

  const postTtsRequest = useCallback(async (formData) => {
    const ttsBase = import.meta.env.VITE_TTS_URL ?? "";
    const requestTargets = ttsBase ? [`${ttsBase}/tts`] : ["/api/tts", "http://localhost:8001/tts"];

    let lastError = null;
    for (const target of requestTargets) {
      try {
        const response = await fetch(target, {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(`Pocket TTS returned HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 240)}` : ""}`);
        }

        return response;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`Pocket TTS request failed: ${lastError?.message || "network error"}`);
  }, []);

  const recordAndAutoCrop = async (blob) => {
    const decoded = await decodeAudioBlob(blob);
    const leadingSilence = findLeadingVoiceStart(decoded);
    const duration = decoded.duration;
    const start = leadingSilence;
    const end = Math.min(duration, start + Math.min(15, Math.max(0, duration - start)));
    const cropped = await prepareVoicePromptBlobFromAudioBuffer(decoded, start, end);

    const url = URL.createObjectURL(cropped);
    objectUrlsRef.current.add(url);
    voiceObjectUrlRef.current = url;

    setPreparedVoiceBlob(cropped);

    void saveVoiceCacheToDb({
      voiceBlob: cropped,
      voiceName: "voice-clone-ready.wav",
      voiceType: "audio/wav",
      voiceSize: cropped.size,
      duration: end - start,
      leadingSilence,
      samplePreview: null
    });
  };

  const resetVoiceRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = 0;
    }
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = 0;
    }
    recordingElapsedRef.current = 0;
    setRecordingTime(0);
    setRecordingLevel(0);
    setIsRecording(false);
  };

  const finalizeRecording = async () => {
    const chunks = recordingChunksRef.current;
    recordingChunksRef.current = [];

    if (chunks.length === 0) {
      setVoiceError("No audio was captured.");
      resetVoiceRecording();
      return;
    }

    const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });

    try {
      await recordAndAutoCrop(blob);
      setVoiceError("");
      setBakeError("");
    } catch (metadataError) {
      setVoiceError(metadataError.message || "Could not read the microphone recording.");
      setPreparedVoiceBlob(null);
    } finally {
      resetVoiceRecording();
    }
  };

  const startRecording = async () => {
    setVoiceError("");
    setBakeError("");
    stopPlayback();
    stopBakedPreview();
    setPreparedVoiceBlob(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordingChunksRef.current = [];

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const meterLoop = () => {
        const activeAnalyser = analyserRef.current;
        if (!activeAnalyser) return;

        const data = new Uint8Array(activeAnalyser.fftSize);
        activeAnalyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const sample = (data[i] - 128) / 128;
          sumSquares += sample * sample;
        }
        setRecordingLevel(Math.sqrt(sumSquares / data.length));
        meterRafRef.current = requestAnimationFrame(meterLoop);
      };

      const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
      const mimeType = preferredMimeTypes.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        finalizeRecording();
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingTime(0);
      setRecordingLevel(0);
      recordingElapsedRef.current = 0;
      meterLoop();

      recordingTimerRef.current = window.setInterval(() => {
        recordingElapsedRef.current += 0.1;
        setRecordingTime(Math.min(15, recordingElapsedRef.current));
        if (recordingElapsedRef.current >= 15) stopRecording();
      }, 100);
    } catch (recordError) {
      setVoiceError(recordError.message || "Could not access the microphone.");
      resetVoiceRecording();
    }
  };

  const stopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = 0;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close?.();
    audioContextRef.current = null;
    setIsRecording(false);
  };

  const bakeSpeech = useCallback(async ({ text, voiceBlob }) => {
    const message = text.trim();
    if (!message) {
      setBakeError("Enter sample text to synthesize.");
      return null;
    }

    setIsBaking(true);
    setBakeError("");
    stopBakedPreview();

    try {
      const formData = new FormData();
      formData.append("text", message);
      if (voiceBlob) {
        formData.append("voice_wav", new File([voiceBlob], "voice-clone.wav", { type: "audio/wav" }));
      }

      const response = await postTtsRequest(formData);

      const audioBlob = await response.blob();
      let audioDuration = 0;
      if (import.meta.env.DEV) {
        try {
          audioDuration = (await decodeAudioBlob(audioBlob)).duration;
        } catch {
          audioDuration = 0;
        }
      }
      const url = URL.createObjectURL(audioBlob);
      objectUrlsRef.current.add(url);
      bakedAudioUrlRef.current = url;
      setBakedAudioUrl(url);

      let playTimeline = [];
      try {
        const alignForm = new FormData();
        alignForm.append("audio", audioBlob, "generated.wav");
        alignForm.append("transcript", message);

        const gentleBase = import.meta.env.VITE_GENTLE_URL ?? "/gentle";
        const alignResponse = await fetch(`${gentleBase}/transcriptions?async=false`, {
          method: "POST",
          body: alignForm
        });

        if (!alignResponse.ok) {
          const bodyText = await alignResponse.text();
          throw new Error(`Gentle returned HTTP ${alignResponse.status}${bodyText ? `: ${bodyText.slice(0, 240)}` : ""}`);
        }

        const alignment = await alignResponse.json();
        playTimeline = buildVisemeTimeline(alignment);
      } catch (alignErr) {
        if (message.trim() === DEFAULT_SAMPLE.trim() && fallbackTimeline.length > 0) {
          playTimeline = fallbackTimeline;
        } else {
          throw alignErr;
        }
      }

      if (playTimeline.length === 0) {
        throw new Error("No visemes were generated for this speech.");
      }

      return { audioUrl: url, audioBlob, playTimeline, audioDuration };
    } catch (bakeErr) {
      setBakeError(bakeErr.message || "Could not bake voice with Pocket TTS.");
      return null;
    } finally {
      setIsBaking(false);
    }
  }, [fallbackTimeline, postTtsRequest, stopBakedPreview]);

  const getSamplePreview = useCallback(async (text = sampleText) => {
    if (!preparedVoiceBlob) return null;

    const message = text.trim();
    if (!message) {
      setBakeError("Enter sample text to synthesize.");
      return null;
    }

    if (cachedSamplePreview?.text === message && cachedSamplePreview.timeline.length > 0) {
      return cachedSamplePreview;
    }

    if (isPreparingSample) return null;

    const token = ++sampleBakeTokenRef.current;
    setIsPreparingSample(true);

    try {
      const result = await bakeSpeech({
        text: message,
        voiceBlob: preparedVoiceBlob
      });

      if (!result || token !== sampleBakeTokenRef.current) return null;

      const preview = {
        text: message,
        audioBlob: result.audioBlob,
        timeline: result.playTimeline,
        audioDuration: result.audioDuration
      };
      setCachedSamplePreview(preview);

      void (async () => {
        const current = await loadVoiceCacheFromDb();
        if (!current?.voiceBlob) return;

        await saveVoiceCacheToDb({
          ...current,
          voiceBlob: current.voiceBlob,
          samplePreview: {
            text: message,
            audioBlob: result.audioBlob,
            timeline: result.playTimeline,
            audioDuration: result.audioDuration
          }
        });
      })();

      return preview;
    } finally {
      if (token === sampleBakeTokenRef.current) {
        setIsPreparingSample(false);
      }
    }
  }, [bakeSpeech, cachedSamplePreview, isPreparingSample, preparedVoiceBlob, sampleText]);

  const playCachedPreview = async (preview) => {
    if (!preview?.audioBlob || !Array.isArray(preview.timeline) || preview.timeline.length === 0) return null;

    const audioUrl = URL.createObjectURL(preview.audioBlob);
    objectUrlsRef.current.add(audioUrl);
    bakedAudioUrlRef.current = audioUrl;
    setBakedAudioUrl(audioUrl);

    await playAudioWithTimeline(audioUrl, preview.timeline, { audioDuration: preview.audioDuration || 0 });
    return audioUrl;
  };

  const handleAvatarFaceTap = async () => {
    if (isBaking || isClonePlaying) return;
    const text = preparedVoiceBlob ? sampleText : DEFAULT_PROMPT;
    if (preparedVoiceBlob) {
      const cached = cachedSamplePreview?.text === text.trim() && cachedSamplePreview.timeline.length > 0 ? cachedSamplePreview : await getSamplePreview(text);
      if (cached) {
        await playCachedPreview(cached);
        return;
      }
    }

    const result = await bakeSpeech({
      text,
      voiceBlob: preparedVoiceBlob || null
    });
    if (result) {
      await playAudioWithTimeline(result.audioUrl, result.playTimeline, { audioDuration: result.audioDuration });
    }
  };

  const handlePlaySample = async () => {
    if (isBaking || isPreparingSample) return;

    if (isClonePlaying) {
      stopPlayback();
      return;
    }

    try {
      const text = sampleText.trim();
      const cached = cachedSamplePreview?.text === text && cachedSamplePreview.timeline.length > 0 ? cachedSamplePreview : await getSamplePreview(text);

      if (cached) {
        await playCachedPreview(cached);
      }
    } finally {
      if (!audioRef.current || audioRef.current.ended) {
        setIsClonePlaying(false);
      }
    }
  };

  useEffect(() => {
    if (!preparedVoiceBlob) return undefined;

    const handle = window.setTimeout(() => {
      void getSamplePreview(sampleText);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [preparedVoiceBlob, sampleText, getSamplePreview]);

  const voiceStatus = useMemo(() => {
    if (isRecording) return `Recording... ${recordingTime.toFixed(1)}s / 15.0s`;
    if (preparedVoiceBlob) return "Voice clone saved";
    return "Record your voice for 15 seconds and it will auto-crop.";
  }, [isRecording, recordingTime, preparedVoiceBlob]);

  return (
    <main className="app">
      <section className="stage">
        <Canvas camera={{ position: [0, 1.6, 3.0], fov: 32 }}>
          <color attach="background" args={["#c9d5df"]} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[2, 3, 2]} intensity={1.1} />
          <gridHelper args={[8, 24, "#6a7f8f", "#9bb0bf"]} position={[0, 0, 0]} />
          <Suspense fallback={null}>
            <group>
              <Avatar visemeState={viseme} mouthIntensity={mouthIntensity} />
              <mesh
                position={[0, 1.55, 0.12]}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleAvatarFaceTap();
                }}
              >
                <sphereGeometry args={[0.45, 16, 16]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
            <Environment preset="city" />
          </Suspense>
          <OrbitControls ref={controlsRef} makeDefault enablePan={false} target={[0, 1.4, 0]} minDistance={1.2} maxDistance={6.5} />
        </Canvas>

        <div className="hud" aria-label="Voice controls">
          <div className="hud__panel">
            <div className="hud__row">
              <button
                type="button"
                className={`icon-button icon-button--record ${isRecording ? "is-active" : ""}`}
                onClick={isRecording ? stopRecording : startRecording}
                aria-label={isRecording ? "Stop recording" : "Record voice"}
                title={isRecording ? "Stop recording" : "Record voice"}
              >
                <img src={recIcon} alt="" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="icon-button icon-button--play"
                onClick={handlePlaySample}
                disabled={isBaking || isPreparingSample}
                aria-label={isClonePlaying ? "Stop playback" : "Play sample"}
                title={isClonePlaying ? "Stop playback" : "Play sample"}
              >
                <img src={isClonePlaying ? pauseIcon : playIcon} alt="" aria-hidden="true" />
              </button>

              <div className="hud__status">
                <span>{voiceStatus}</span>
                {isRecording ? <strong>{(15 - recordingTime).toFixed(1)}s</strong> : null}
              </div>
            </div>

            <label className="hud__sample">
              <span>Sample text</span>
              <textarea
                rows="3"
                value={sampleText}
                onChange={(event) => setSampleText(event.target.value)}
                placeholder="Type the phrase Pocket TTS should speak"
              />
            </label>

            <div className="hud__footer">
              <label className="hud__slider">
                <span>Lip intensity</span>
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.05"
                  value={mouthIntensity}
                  onChange={(event) => setMouthIntensity(Number(event.target.value))}
                />
                <strong>{Math.round(mouthIntensity * 100)}%</strong>
              </label>
              <div className="hud__messages">
                {voiceError ? <p className="error">{voiceError}</p> : null}
                {bakeError ? <p className="error">{bakeError}</p> : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
