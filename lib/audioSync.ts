/**
 * FFT-based cross-correlation to find time offset between radio and TV (mic) audio.
 *
 * Both buffers are sampled at SAMPLE_RATE (4 kHz).
 *
 * We search for where `radio` (the shorter, recent radio clip) best matches
 * within `mic` (the longer rolling mic / TV buffer).
 *
 * If the best match is at position τ in mic, then:
 *   - mic content at position τ+radio.length-1 corresponds to the same broadcast
 *     moment as radio content at radio.length-1 (the most recent radio sample).
 *   - The mic captured that moment (mic.length - 1 - (τ + radio.length - 1)) samples
 *     ago, i.e. (mic.length - τ - radio.length) / sampleRate seconds ago.
 *   - Radio captured it "just now" (0 seconds ago).
 *   - Therefore TV is (mic.length - τ - radio.length) / sampleRate seconds AHEAD of radio.
 *   - We need to seek radio FORWARD by that many seconds.
 */

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place Cooley-Tukey FFT (radix-2, DIT). Modifies re and im in place. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);

    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0;
      for (let k = 0; k < half; k++) {
        const tRe = re[i + k + half] * uRe - im[i + k + half] * uIm;
        const tIm = re[i + k + half] * uIm + im[i + k + half] * uRe;
        re[i + k + half] = re[i + k] - tRe;
        im[i + k + half] = im[i + k] - tIm;
        re[i + k] += tRe;
        im[i + k] += tIm;
        const newU = uRe * wRe - uIm * wIm;
        uIm = uRe * wIm + uIm * wRe;
        uRe = newU;
      }
    }
  }
}

/** In-place IFFT via conjugate trick. */
function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

function rms(a: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / a.length);
}

/**
 * Find the time offset (in seconds) by which radio is behind the TV.
 *
 * @param radio  Recent radio clip (shorter — e.g. 10 s × 4000 Hz = 40 000 samples)
 * @param mic    Rolling mic / TV buffer (longer — e.g. 60 s × 4000 Hz = 240 000 samples)
 * @param sampleRate  Samples per second used for both buffers (default 4000)
 * @returns  offsetSeconds  > 0 → radio is behind TV by that many seconds (seek forward)
 *                          < 0 → radio is ahead of TV (add delay)
 *           confidence     0..1 — normalized peak correlation (< 0.15 = no reliable match)
 */
export function findSyncOffset(
  radio: Float32Array,
  mic: Float32Array,
  sampleRate: number = 4000,
): { offsetSeconds: number; confidence: number } {
  if (radio.length === 0 || mic.length < radio.length) {
    return { offsetSeconds: 0, confidence: 0 };
  }

  const radioRms = rms(radio);
  const micRms = rms(mic);
  if (radioRms < 1e-6 || micRms < 1e-6) {
    return { offsetSeconds: 0, confidence: 0 };
  }

  // Normalize both signals to unit RMS
  const rNorm = new Float32Array(radio.length);
  const mNorm = new Float32Array(mic.length);
  for (let i = 0; i < radio.length; i++) rNorm[i] = radio[i] / radioRms;
  for (let i = 0; i < mic.length; i++) mNorm[i] = mic[i] / micRms;

  // FFT size must hold the full linear correlation output
  const n = nextPow2(rNorm.length + mNorm.length - 1);

  const aRe = new Float64Array(n);
  const aIm = new Float64Array(n);
  const bRe = new Float64Array(n);
  const bIm = new Float64Array(n);

  for (let i = 0; i < rNorm.length; i++) aRe[i] = rNorm[i];
  for (let i = 0; i < mNorm.length; i++) bRe[i] = mNorm[i];

  fft(aRe, aIm);
  fft(bRe, bIm);

  // C = conj(A) * B  →  xcorr(τ) peak at τ means mic[τ..] matches radio
  const cRe = new Float64Array(n);
  const cIm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cRe[i] = aRe[i] * bRe[i] + aIm[i] * bIm[i];
    cIm[i] = aRe[i] * bIm[i] - aIm[i] * bRe[i];
  }

  ifft(cRe, cIm);

  // Only valid lags: 0 ≤ τ ≤ mic.length - radio.length
  const maxLag = mic.length - radio.length;
  let maxVal = -Infinity;
  let bestTau = 0;
  for (let tau = 0; tau <= maxLag; tau++) {
    if (cRe[tau] > maxVal) {
      maxVal = cRe[tau];
      bestTau = tau;
    }
  }

  // Confidence: peak / max-possible for unit-RMS signals of length radio.length
  const confidence = maxVal / radio.length;

  // Radio is behind TV by this many seconds
  const offsetSeconds = (mic.length - bestTau - radio.length) / sampleRate;

  return { offsetSeconds, confidence: Math.max(0, confidence) };
}
