// Expose VITS' existing phoneme durations as a second ONNX output. Weights,
// operators and the audio output are untouched. Unknown graphs stay untouched.
// The protobuf walk and the rewrite are the voice core (rust-core/src/onnx_durations.rs). The ~63 MB model stays in
// this buffer: the core asks for windows of it and skips the weights by their length, because copying the model into
// its memory would keep a second copy resident for nothing. Where the boundaries fall in the audio is synth-flow.js
// (Rust). The frozen JavaScript original is tests/unit/helpers/reference-piper-alignment.js.
import { loadedRustVoiceCore } from '../../rust-voice-core.js'
import { getText, withArena } from './core-call.js'

export function exposePiperDurations(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const core = loadedRustVoiceCore(), scan = core.onnx_scan_new(bytes.length)
  if (!scan) throw new Error('Voice core: cannot scan the model')
  try {
    return withArena(core, 6, info => {
      for (let step = core.onnx_scan_step(scan); step !== 0; step = core.onnx_scan_step(scan)) {
        if (step !== 1) throw new Error('Voice core: invalid model scan')
        core.onnx_scan_want(scan, info)
        const [start, length] = new Float64Array(core.memory.buffer, info, 2)
        const window = core.onnx_scan_window(scan, length)
        if (!window) throw new Error('Voice core: no memory for the model scan')
        new Uint8Array(core.memory.buffer, window, length).set(bytes.subarray(start, start + length))
      }
      const mode = core.onnx_scan_result(scan, info)
      if (mode === 0) return { bytes, name:null }
      if (mode !== 1 && mode !== 2) throw new Error('Voice core: invalid model scan')
      const [begin, data, end, nameLength, headerLength, outputLength] = new Float64Array(core.memory.buffer, info, 6)
      const name = getText(core, core.onnx_scan_name(scan), nameLength)
      if (mode === 1) return { bytes, name }
      const header = new Uint8Array(core.memory.buffer, core.onnx_scan_header(scan), headerLength).slice()
      const output = new Uint8Array(core.memory.buffer, core.onnx_scan_output(scan), outputLength).slice()
      const result = new Uint8Array(begin + headerLength + end - data + outputLength + bytes.length - end)
      let at = 0
      for (const part of [bytes.subarray(0, begin), header, bytes.subarray(data, end), output, bytes.subarray(end)]) { result.set(part, at); at += part.length }
      return { bytes:result, name }
    })
  } finally { core.onnx_scan_free(scan) }
}

const numbers = values => Float64Array.from(values, value => typeof value === 'number' ? value : NaN)

// At most the page boundaries of this utterance are phonemized; acoustic
// inference still runs ONCE for the whole sentence, with its natural prosody.
export async function phonemeMarks(text, marks, ids, phonemize) {
  const core = loadedRustVoiceCore(), requested = numbers([...new Set(marks || [])])
  const offsets = requested.length ? withArena(core, requested.length, pointer => {
    new Float64Array(core.memory.buffer, pointer, requested.length).set(requested)
    const found = core.voice_mark_offsets(pointer, requested.length, text.length, pointer)
    if (found < 0) throw new Error('Voice core: invalid call')
    return Array.from(new Float64Array(core.memory.buffer, pointer, found))
  }) : []
  const output = [], whole = numbers(ids)
  for (const offset of offsets) {
    const prefix = numbers(await phonemize(text.slice(0, offset)))
    const phoneme = withArena(core, Math.max(1, prefix.length + whole.length), pointer => {
      new Float64Array(core.memory.buffer, pointer, prefix.length).set(prefix)
      new Float64Array(core.memory.buffer, pointer + prefix.length * 8, whole.length).set(whole)
      return core.voice_prefix_phonemes(pointer, prefix.length, pointer + prefix.length * 8, whole.length)
    })
    if (phoneme < 0) throw new Error('Voice core: invalid call')
    if (phoneme > 0) output.push({ offset, phoneme })
  }
  return output
}
