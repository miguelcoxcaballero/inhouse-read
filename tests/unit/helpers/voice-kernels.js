// Raw-ABI callers for the individual kernels of the voice core. Production reaches them through synth-flow.js, which
// finishes a whole chunk in one call; these let a test hold each kernel to its frozen JavaScript original on its own.
import { withArena } from '../../../src/js/readers/neural-voice/core-call.js'

/** pcm_prepare: peak normalisation, silence trimming and fades of a copy of `pcm`. null when the core declines. */
export function kernelPrepare(core, pcm, sampleRate, model = '', timing = false) {
  const count = pcm.length, sampleSlots = Math.ceil(count / 2)
  return withArena(core, sampleSlots + 4, pointer => {
    new Float32Array(core.memory.buffer, pointer, count).set(pcm)
    const metadata = pointer + sampleSlots * 8
    if (core.pcm_prepare(pointer, metadata, count, sampleRate, model === 'no_NO-nvcc-medium' ? 1 : 0) !== 1) return null
    const [gain, from, to, faded] = new Float64Array(core.memory.buffer, metadata, 4)
    const speech = new Float32Array(core.memory.buffer, pointer + from * 4, to - from).slice()
    return timing ? { pcm: speech, from, to, gain, faded } : speech
  })
}

/** speech_tempo: PICOLA speed-up of `pcm`, with the positions of `positions` moved along. null when the core declines. */
export function kernelTempo(core, pcm, sampleRate, speed, positions = []) {
  const slots = Math.ceil(pcm.length / 2), length = slots * 2 + positions.length
  return withArena(core, length, pointer => {
    const output = pointer + slots * 8, marks = output + slots * 8
    new Float32Array(core.memory.buffer, pointer, pcm.length).set(pcm)
    new Float64Array(core.memory.buffer, marks, positions.length).set(positions)
    const count = core.speech_tempo(pointer, output, pcm.length, sampleRate, speed, marks, positions.length)
    if (!count) return null
    return { pcm: new Float32Array(core.memory.buffer, output, count).slice(), positions: Array.from(new Float64Array(core.memory.buffer, marks, positions.length)) }
  })
}

/** duration_marks: [{offset, sample}] of marks {offset, phoneme}. Throws on a misuse of the arguments. */
export function kernelDurationMarks(core, marks, durations, { base = 0, count, samples, trim = 0, lead = 0, length }) {
  const frames = durations.length, found = marks.length
  return withArena(core, frames + found * 3 + 6, pointer => {
    const packet = new Float64Array(core.memory.buffer, pointer, frames + found * 3 + 6)
    packet.set(durations)
    packet.set(marks.map(mark => mark.phoneme), frames)
    packet.set([base, count, samples, trim, lead, length], frames + found)
    const output = pointer + (frames + found + 6) * 8
    const written = core.duration_marks(pointer, frames, pointer + frames * 8, found, pointer + (frames + found) * 8, output)
    if (written < 0) throw new Error('duration_marks: misuse')
    const records = new Float64Array(core.memory.buffer, output, written * 2)
    return Array.from({ length: written }, (_, i) => ({ offset: marks[records[i * 2]].offset, sample: records[i * 2 + 1] }))
  })
}
