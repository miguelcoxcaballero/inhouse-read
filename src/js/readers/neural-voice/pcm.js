// Pure helpers on mono Float32 PCM and on Piper phoneme-id sequences. They run inside the synthesis worker (so the page
// never touches samples) and are plain functions so they can be unit-tested without any audio stack.

/** Piper's phoneme id markers: '^' begins a sentence, '$' ends it and '_' is the pad between phonemes. */
export const BOS = 1, EOS = 2, PAD = 0

/** Largest absolute sample. */
export function peakOf(pcm) {
  let peak = 0
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a }
  return peak
}

/** Root mean square of the samples (0 for an empty buffer). */
export function rmsOf(pcm) {
  if (!pcm.length) return 0
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
  return Math.sqrt(sum / pcm.length)
}

/**
 * Brings the loudest sample to `target`, like Piper's own command line does for every utterance. The voices differ a lot
 * in level (es_ES davefx peaks at 0.97, ca_ES upc_ona at 0.14), so without this the volume would jump between voices;
 * the gain is capped so that a near-silent buffer (breath, noise) is not blown up. Works in place, returns the gain used.
 */
export function peakNormalize(pcm, { target = 0.9, maxGain, floor = 1e-3, model = '' } = {}) {
  const peak = peakOf(pcm)
  // NVCC's real KON/MON speech peaks at 0.031–0.052 (RMS 0.0034–0.0092),
  // too quiet even after the usual 6x cap. Allow 12x for this model only;
  // low-level noise or a sparse click still uses the ordinary cap. Explicit
  // caller limits and the common 0.9 peak ceiling remain authoritative.
  const cap = maxGain ?? (model === 'no_NO-nvcc-medium' && peak >= 0.02 && rmsOf(pcm) >= 0.002 ? 12 : 6)
  const gain = Math.min(cap, target / Math.max(peak, floor))
  if (Math.abs(gain - 1) > 1e-6) for (let i = 0; i < pcm.length; i++) pcm[i] *= gain
  return gain
}

/**
 * Cuts the quiet lead-in and tail Piper leaves around every utterance (they would add up to an audible hole between
 * fragments), keeping a little air on both sides. "Quiet" is relative to the buffer's own peak, with an absolute
 * floor so pure noise does not count as speech. Returns a copy (an all-quiet buffer gives an empty one).
 */
export function trimSilence(pcm, sampleRate, { relative = 0.02, floor = 0.002, leadMs = 14, tailMs = 40 } = {}) {
  const threshold = Math.max(peakOf(pcm) * relative, floor)
  let from = 0, to = pcm.length - 1
  while (from < pcm.length && Math.abs(pcm[from]) < threshold) from++
  if (from >= pcm.length) return new Float32Array(0)
  while (to > from && Math.abs(pcm[to]) < threshold) to--
  from = Math.max(0, from - Math.round(sampleRate * leadMs / 1000))
  to = Math.min(pcm.length - 1, to + Math.round(sampleRate * tailMs / 1000))
  return pcm.slice(from, to + 1)
}

/** Linear fade in/out of the first/last `ms`, so a cut never clicks. In place. */
export function fadeEdges(pcm, sampleRate, ms = 4) {
  const n = Math.min(Math.round(sampleRate * ms / 1000), pcm.length >> 1)
  for (let i = 0; i < n; i++) {
    const k = i / n
    pcm[i] *= k
    pcm[pcm.length - 1 - i] *= k
  }
  return pcm
}

/** `ms` of silence. */
export const silence = (sampleRate, ms) => new Float32Array(Math.max(0, Math.round(sampleRate * ms / 1000)))

/** Concatenates buffers. */
export function concat(parts) {
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}

// How long the voice rests when a fragment ends: a full stop is a real pause, a fragment cut at a comma a short one, and
// one cut in the middle of a clause (long sentences are split at <=180 characters) hardly any.
export const PAUSE_MS = { sentence: 240, clause: 140, cut: 60 }
const SENTENCE_END = /[.!?…。！？]["'”’»›)\]}」』]*\s*$/
const CLAUSE_END = /[,;:，；：—–-]["'”’»›)\]}」』]*\s*$/
/** Pause (ms) that follows the spoken `text`. */
export function pauseAfter(text) {
  const t = String(text || '')
  if (SENTENCE_END.test(t)) return PAUSE_MS.sentence
  if (CLAUSE_END.test(t)) return PAUSE_MS.clause
  return PAUSE_MS.cut
}

/**
 * Splits what piper_phonemize returns (several '^...$' sentences concatenated when the text holds '.', '?' or '!'
 * inside) into one id sequence per sentence, dropping the empty ones ('^_$').
 */
export function splitSegments(ids) {
  const segments = []
  let current = []
  for (const id of ids) {
    current.push(id)
    if (id === EOS) {
      if (current.length > 3) segments.push(current)
      current = []
    }
  }
  if (current.length > 3) segments.push(current)
  return segments
}

/**
 * piper_phonemize numbers phonemes with Piper's default table, which has 154 symbols; some voices were trained with a
 * few less (davefx, thorsten, faber: 152) or more. An id the voice does not know would make the model fail, so it is
 * dropped together with its pad.
 */
export function limitIds(ids, numSymbols) {
  if (!numSymbols) return ids
  const out = []
  for (const id of ids) {
    if (id >= numSymbols) continue
    if (id === PAD && out[out.length - 1] === PAD) continue
    out.push(id)
  }
  return out
}

/** length_scale for a speaking rate: Piper stretches time, so a faster voice is a smaller scale. */
export const lengthScaleFor = (base, rate) => base / Math.min(3, Math.max(0.5, Number(rate) || 1))
