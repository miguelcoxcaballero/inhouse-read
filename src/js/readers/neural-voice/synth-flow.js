// What the synthesis worker (and the Android client) do around the model: the Piper phoneme-id bookkeeping and the
// finishing of every chunk of audio (cleaning, page-boundary placement, tempo, rests). All of it is the voice module
// (rust-ui/src/voice_kernels.rs over rust-core's synth_flow.rs, pcm.rs, duration_marks.rs and speech_tempo.rs). The caller
// has awaited the voice module (VoiceClientPlan.ready): there is no second implementation to fall back on. The frozen
// JavaScript originals are tests/unit/helpers/reference-*.js.
import { loadedRustVoiceUI as voice } from '../../rust-voice-ui.js'

/** `ms` of silence. */
export const silence = (sampleRate, ms) => new Float32Array(Math.max(0, Math.round(sampleRate * ms / 1000)))

/** length_scale for a speaking rate: Piper stretches time, so a faster voice is a smaller scale. */
export const lengthScaleFor = (base, rate) => voice().voice_host_length_scale(base, rate)
/** The speed the model itself is asked for: never faster than its natural pace. */
export const synthesisRate = rate => voice().voice_host_synthesis_rate(rate)
/** The float32 `scales` of one Piper run at the speaking `rate`: the config's inference values, else the model defaults. */
export const piperScales = (inference, rate) => voice().voice_host_piper_scales(inference, rate)
/** Drops the ids a voice trained with fewer symbols does not know, with their pads. */
export const limitIds = (ids, numSymbols) => voice().voice_host_limit_ids(ids, numSymbols)
/** Splits what piper_phonemize returns (several '^...$' sentences concatenated) into one id sequence per sentence, dropping the empty ones. */
export const splitSegments = ids => voice().voice_host_split_segments(ids)

/**
 * The finished audio of one sentence of a Piper fragment. `raw` is the model's output (cleaned on a copy), `durations` its
 * frame durations (or null), `points` the page boundaries of the fragment as {offset, phoneme}; `base`/`count` place this
 * sentence among the fragment's phonemes. Returns {pcm, marks:[{offset, sample}]}: cleaned, sped up and with its rests.
 */
export const finishPiper = (raw, durations, points, text, options) => voice().voice_host_finish_piper(raw, durations, points, text, options)

/**
 * The finished audio of one Supertonic fragment, already at its final speed: cleaned, with the rest after it. `timeline`
 * are the page boundaries (any fields, a `sample` in the raw audio). Returns {pcm, marks} or null when the model's audio
 * holds a sample that is not a finite number.
 */
export const finishSupertonic = (raw, text, timeline, options) => voice().voice_host_finish_supertonic(raw, text, timeline, options)

/** Transform marks along with their waveform; do not divide timestamps again. */
export const speedUpSpeech = (pcm, sampleRate, rate, marks = []) => voice().voice_host_speed_up(pcm, sampleRate, rate, marks)
