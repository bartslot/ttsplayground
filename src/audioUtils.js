function getAudioContextCtor() {
  return window.AudioContext || window.webkitAudioContext;
}

function getOfflineAudioContextCtor() {
  return window.OfflineAudioContext || window.webkitOfflineAudioContext;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export async function decodeAudioFile(file) {
  return decodeAudioBuffer(await file.arrayBuffer());
}

export async function decodeAudioBlob(blob) {
  return decodeAudioBuffer(await blob.arrayBuffer());
}

async function decodeAudioBuffer(arrayBuffer) {
  const AudioContextCtor = getAudioContextCtor();
  const context = new AudioContextCtor();
  try {
    return await context.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await context.close();
  }
}

export function findLeadingVoiceStart(audioBuffer, options = {}) {
  const {
    threshold = 0.012,
    windowSeconds = 0.02,
    minVoiceSeconds = 0.08
  } = options;

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.max(1, Math.floor(windowSeconds * sampleRate));
  const minVoiceWindows = Math.max(1, Math.floor(minVoiceSeconds / windowSeconds));

  let consecutiveVoiceWindows = 0;

  for (let i = 0; i < channelData.length; i += windowSize) {
    let sumSquares = 0;
    const end = Math.min(i + windowSize, channelData.length);

    for (let j = i; j < end; j += 1) {
      const sample = channelData[j];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, end - i));

    if (rms >= threshold) {
      consecutiveVoiceWindows += 1;
      if (consecutiveVoiceWindows >= minVoiceWindows) {
        return Math.max(0, (i - windowSize * (minVoiceWindows - 1)) / sampleRate);
      }
    } else {
      consecutiveVoiceWindows = 0;
    }
  }

  return 0;
}

export function trimAudioBuffer(audioBuffer, startSeconds, endSeconds) {
  const start = clamp(startSeconds, 0, audioBuffer.duration);
  const end = clamp(endSeconds, start, audioBuffer.duration);
  const sampleRate = audioBuffer.sampleRate;
  const startOffset = Math.floor(start * sampleRate);
  const endOffset = Math.floor(end * sampleRate);
  const frameCount = Math.max(0, endOffset - startOffset);
  const AudioContextCtor = getAudioContextCtor();
  const context = new AudioContextCtor();
  const trimmed = context.createBuffer(
    audioBuffer.numberOfChannels,
    frameCount,
    sampleRate,
  );

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const source = audioBuffer.getChannelData(channel).subarray(startOffset, endOffset);
    trimmed.copyToChannel(source, channel, 0);
  }

  void context.close();

  return trimmed;
}

export function audioBufferToWavBlob(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  const writeString = (str) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
    offset += str.length;
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numberOfChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const channelData = [];
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    channelData.push(audioBuffer.getChannelData(channel));
  }

  let writeOffset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const sample = clamp(channelData[channel][i], -1, 1);
      view.setInt16(writeOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      writeOffset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export async function trimVoiceSampleToBlob(file, startSeconds, endSeconds) {
  const decoded = await decodeAudioFile(file);
  return prepareVoicePromptBlobFromAudioBuffer(decoded, startSeconds, endSeconds);
}

export async function trimVoiceBlobToWavBlob(blob, startSeconds, endSeconds) {
  const decoded = await decodeAudioBlob(blob);
  return prepareVoicePromptBlobFromAudioBuffer(decoded, startSeconds, endSeconds);
}

export async function prepareVoicePromptBlobFromAudioBuffer(audioBuffer, startSeconds, endSeconds) {
  const trimmed = trimAudioBuffer(audioBuffer, startSeconds, endSeconds);
  return renderMonoWavBlob(trimmed, 24000);
}

async function renderMonoWavBlob(audioBuffer, targetSampleRate = 24000) {
  const OfflineAudioContextCtor = getOfflineAudioContextCtor();
  const frameCount = Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate));
  const context = new OfflineAudioContextCtor(1, frameCount, targetSampleRate);
  const source = context.createBufferSource();

  source.buffer = audioBuffer;
  source.connect(context.destination);
  source.start(0);

  const rendered = await context.startRendering();
  return audioBufferToWavBlob(rendered);
}
