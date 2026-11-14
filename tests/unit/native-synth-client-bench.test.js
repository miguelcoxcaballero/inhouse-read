// @vitest-environment node
// NATIVE_CLIENT_BENCH=1 npx vitest run tests/unit/native-synth-client-bench.test.js
// What the Android client costs around the model for one fragment of three sentences: phoneme ids, the split into
// sentences, the scales, the finishing of every chunk. The model and the phonemizer are fakes that answer at once, so the
// figure is the client's own work (rust-ui native_synth_client.rs and the voice module's kernels it calls by name).
import { readFileSync } from 'node:fs'
import { beforeAll, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ core: null }))
vi.mock('../../src/js/rust-voice-core.js', () => ({ requireRustVoiceCore: async () => state.core, loadedRustVoiceCore: () => state.core, loadRustVoiceCore: async () => state.core, getRustVoiceCore: () => state.core }))
import './helpers/rust-ui-ready.js'
import { NativeSynthClient } from '../../src/js/readers/neural-voice/native-client.js'
import { NativeTensor } from '../../src/js/readers/neural-voice/native-ort.js'
beforeAll(async () => {
  const { instance } = await WebAssembly.instantiate(readFileSync(new URL('../../src/wasm/inhouse_read_voice.wasm', import.meta.url)))
  state.core = instance.exports
})
it.skipIf(!process.env.NATIVE_CLIENT_BENCH)('measures a synthesis job of the Android client around a fake model', async () => {
  const median = values => values.slice().sort((a, b) => a - b)[values.length >> 1]
  const jobs = 200, rounds = 15, text = 'First part of it. Second part of it! And a third one?'
  // Three '^ ... $' sentences, as piper_phonemize returns them for the text.
  const sentence = [1, 0, 20, 0, 21, 0, 22, 0, 23, 0, 24, 0, 25, 0, 26, 0, 27, 0, 2], ids = [...sentence, ...sentence, ...sentence]
  const made = new Map(), audio = length => made.get(length) || made.set(length, Float32Array.from({ length }, (_, i) => Math.sin(i / 9) * .2)).get(length)
  async function client(samples) {
    const session = { inputNames: ['input', 'input_lengths', 'scales'], outputNames: ['output'], release: async () => {}, run: async () => ({ output: { data: audio(samples), dispose() {} } }) }
    const ort = { Tensor: NativeTensor, dispose() {}, InferenceSession: { create: async () => session } }
    const made = new NativeSynthClient({ store: { readConfig: async () => ({ audio: { sample_rate: 22050 }, espeak: { voice: 'en-us' }, num_symbols: 256 }), readModel: async () => new ArrayBuffer(8) },
      createOrt: () => ort, createPhon: async () => ({ phonemize: async () => ids, destroy() {} }) })
    await made.prepare('en_US-test-medium')
    return async () => {
      const start = process.hrtime.bigint()
      for (let job = 0; job < jobs; job++) {
        let chunks = 0
        await new Promise((resolve, reject) => made.synth({ text, rate: 1 }, { onChunk: () => { chunks++ }, onEnd: resolve, onError: reject }))
        expect(chunks).toBe(3)
      }
      return Number(process.hrtime.bigint() - start) / 1e3 / jobs
    }
  }
  const line = []
  for (const [label, samples] of [['about 1.5 s of audio a sentence', 33075], ['200 samples a sentence', 200]]) {
    const run = await client(samples), times = []
    await run()
    for (let round = 0; round < rounds; round++) times.push(await run())
    line.push(`${label}: ${median(times).toFixed(1)} us (${times.map(Math.round).join(' ')})`)
  }
  console.log(`BENCH native client job of three sentences, medians of ${rounds} rounds of ${jobs} jobs | ${line.join(' | ')}`)
}, 600000)
