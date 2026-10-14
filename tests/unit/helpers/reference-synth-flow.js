// Frozen from f5abb75 (src/js/readers/neural-voice/worker.js, `synth`): what the synthesis worker did with the model's output
// before the Rust voice core did it. It strings together the frozen JavaScript originals of the helpers it used.
import { prepareSpeech } from './reference-pcm-timing.js'
import { silence, concat, pauseAfter, restScale, PAUSE_MS } from './reference-pcm.js'
import { durationMarks } from './reference-piper-alignment.js'
import { speedUpSpeech } from './reference-speech-tempo.js'

/** One sentence of a Piper fragment: {pcm, marks} exactly as the worker posted them. */
export function referencePiper(raw, durations, points, text, { sampleRate, model, rate, base, count, last, first }) {
  const { pcm: speech, from } = prepareSpeech(raw, sampleRate, { model, timing: true })
  const rest = restScale(rate)
  const timeline = durationMarks(points, durations, { base, count, samples: raw.length, trim: from, lead: 0, length: speech.length })
  const fast = speedUpSpeech(speech, sampleRate, rate, timeline)
  const lead = first ? new Float32Array(0) : silence(sampleRate, PAUSE_MS.sentence * rest)
  const pcm = concat([lead, fast.pcm, last ? silence(sampleRate, pauseAfter(text) * rest) : new Float32Array(0)])
  return { pcm, marks: fast.marks.map(mark => ({ ...mark, sample: mark.sample + lead.length })) }
}

/** One Supertonic fragment: {pcm, marks} exactly as the worker posted them (it threw on audio that is not finite). */
export function referenceSupertonic(raw, text, timeline, { sampleRate, rate }) {
  if (!raw.every(Number.isFinite)) return null
  const { pcm: speech, from } = prepareSpeech(raw, sampleRate, { timing: true })
  const pcm = concat([speech, silence(sampleRate, pauseAfter(text) * restScale(rate))])
  return { pcm, marks: timeline.map(mark => ({ ...mark, sample: Math.max(0, Math.min(speech.length - 1, mark.sample - from)) })) }
}
