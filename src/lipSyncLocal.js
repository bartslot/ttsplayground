const VOWEL_RE = /[aeiou]/gi;

const DIGRAPHS = [
  ["sh", "viseme_sh"],
  ["ch", "viseme_ch"],
  ["th", "viseme_th"],
  ["ph", "viseme_fv"],
  ["wh", "viseme_uw"],
  ["ng", "viseme_nn"],
];

const SINGLE = {
  a: "viseme_aa",
  e: "viseme_eh",
  i: "viseme_ih",
  o: "viseme_oh",
  u: "viseme_uw",
  b: "viseme_mbp",
  p: "viseme_mbp",
  m: "viseme_mbp",
  f: "viseme_fv",
  v: "viseme_fv",
  l: "viseme_l",
  r: "viseme_er",
  s: "viseme_s",
  z: "viseme_s",
  k: "viseme_kk",
  g: "viseme_kk",
  c: "viseme_kk",
  n: "viseme_nn",
  t: "viseme_tt",
  d: "viseme_tt",
  w: "viseme_uw",
  y: "viseme_ih",
  h: null,
  j: "viseme_ch",
  q: "viseme_kk",
  x: "viseme_kk",
};

function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const matches = w.match(VOWEL_RE);
  let count = matches ? matches.length : 1;
  if (w.endsWith("e") && count > 1) count -= 1;
  return Math.max(1, count);
}

function wordToVisemes(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  const result = [];
  let i = 0;
  while (i < w.length) {
    const pair = w.slice(i, i + 2);
    const digraph = DIGRAPHS.find(([d]) => d === pair);
    if (digraph) {
      if (digraph[1]) result.push(digraph[1]);
      i += 2;
      continue;
    }
    const v = SINGLE[w[i]];
    if (v) result.push(v);
    i += 1;
  }
  return result.length ? result : ["viseme_mbp"];
}

/**
 * Build a viseme timeline purely from text + total audio duration.
 * Returns the same shape as buildVisemeTimeline: [{time, duration, viseme}]
 */
export function buildLocalVisemeTimeline(text, audioDuration) {
  if (!text || !audioDuration || audioDuration <= 0) return [];

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const syllableCounts = words.map(countSyllables);
  const totalSyllables = syllableCounts.reduce((s, c) => s + c, 0) || 1;

  // Reserve ~12% for inter-word pauses distributed evenly
  const pauseTotal = audioDuration * 0.12;
  const speechTotal = audioDuration - pauseTotal;
  const pausePerWord = pauseTotal / words.length;
  const secPerSyllable = speechTotal / totalSyllables;

  const timeline = [];
  let cursor = 0;

  words.forEach((word, wi) => {
    const wordDuration = syllableCounts[wi] * secPerSyllable;
    const visemes = wordToVisemes(word);
    const visemeDuration = wordDuration / visemes.length;

    visemes.forEach((viseme) => {
      timeline.push({ time: cursor, duration: visemeDuration, viseme });
      cursor += visemeDuration;
    });

    cursor += pausePerWord;
  });

  return timeline;
}
