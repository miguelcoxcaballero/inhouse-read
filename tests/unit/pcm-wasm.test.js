// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, expect, it } from 'vitest'
import { prepareSpeech as reference } from './helpers/reference-pcm-timing.js'
import { kernelPrepare } from './helpers/voice-kernels.js'
import { pcmCases, makePCM } from '../helpers/pcm-cases.mjs'

// The cleaning of the audio (pcm_prepare in the voice core) against the frozen JavaScript pipeline it replaced, byte for byte.
let core
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength)
const exact = (a, b) => expect(Buffer.compare(bytes(a), bytes(b))).toBe(0)
beforeAll(async () => {
  core = (await WebAssembly.instantiate(readFileSync(new URL('../../src/wasm/inhouse_read_voice.wasm', import.meta.url)))).instance.exports
  expect(typeof core.pcm_prepare).toBe('function')
})

for (const input of pcmCases) it('preserves every playable PCM byte and leaves the source intact: ' + input.name, () => {
  const a = makePCM(input), rate = input.rate || 22050
  const expected = reference(a.slice(), rate, { model: input.model, timing: true }), actual = kernelPrepare(core, a, rate, input.model, true)
  exact(actual.pcm, expected.pcm)
  expect(actual.from).toBe(expected.from)
  exact(a, makePCM(input))
  expect(actual.pcm.buffer).not.toBe(core.memory.buffer)
})

it('is total over the samples: NaN and infinities behave as they did in JavaScript', () => {
  let seed = 8675309
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  const specials = [NaN, Infinity, -Infinity, -0, 1e-45, 3.4e38, 0.9, -0.9]
  for (let round = 0; round < 400; round++) {
    const count = 1 + next() % 9000, a = makePCM({ count, amplitude: 0.05 + (next() % 100) / 100 })
    for (let i = 0, n = next() % 6; i < n; i++) a[next() % count] = specials[next() % specials.length]
    const rate = [8000, 16000, 22050, 24000, 44100, 48000, 96000, 11025.125, 22050.5][next() % 9], model = next() % 4 ? '' : 'no_NO-nvcc-medium'
    const expected = reference(a.slice(), rate, { model, timing: true }), actual = kernelPrepare(core, a, rate, model, true)
    exact(actual.pcm, expected.pcm)
    expect(actual.from).toBe(expected.from)
  }
})

it('matches 600 random utterances: levels, silences, models and sample rates', () => {
  let seed = 424242
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  for (let round = 0; round < 600; round++) {
    const count = next() % 60000, a = new Float32Array(count)
    const lead = next() % (count + 1), tail = next() % (count + 1), level = [0.0005, 0.004, 0.03, 0.2, 0.9, 1.5][next() % 6]
    for (let i = lead; i < Math.max(lead, count - tail); i++) a[i] = ((next() / 4294967296) - 0.5) * level * (i % 7 ? 1 : 2)
    const rate = [8000, 16000, 22050, 24000, 44100, 48000, 96000, 384000][next() % 8], model = next() % 5 ? '' : 'no_NO-nvcc-medium'
    const expected = reference(a.slice(), rate, { model, timing: true }), actual = kernelPrepare(core, a, rate, model, true)
    exact(actual.pcm, expected.pcm)
    expect(actual.from).toBe(expected.from)
  }
})

it('recreates views after memory growth and frees exactly once', () => {
  const a = makePCM({ count: 8193 }), b = a.slice()
  let frees = 0
  const tracked = { ...core, pcm_prepare(...args) { const status = core.pcm_prepare(...args); core.memory.grow(1); return status }, free_f64(p, n) { frees++; core.free_f64(p, n) } }
  exact(kernelPrepare(tracked, b, 24000), reference(a.slice(), 24000))
  exact(b, makePCM({ count: 8193 }))
  expect(frees).toBe(1)
})

it('declines a sample rate it cannot use, without touching the caller data, and frees its arena', () => {
  for (const rate of [NaN, 0, -1, Infinity, 384001]) {
    const a = makePCM({ count: 8192 }), before = Buffer.from(bytes(a))
    let live = 0
    const tracked = { ...core, alloc_f64(n) { const p = core.alloc_f64(n); if (p) live += n; return p }, free_f64(p, n) { core.free_f64(p, n); live -= n } }
    expect(kernelPrepare(tracked, a, rate)).toBeNull()
    expect(Buffer.compare(before, bytes(a))).toBe(0)
    expect(live).toBe(0)
  }
})

it('bounds memory through repeated calls', () => {
  const a = makePCM({ count: 66150, amplitude: 0.1 })
  kernelPrepare(core, a, 22050)
  const capacity = core.memory.buffer.byteLength
  for (let i = 0; i < 100; i++) kernelPrepare(core, a, 22050)
  expect(core.memory.buffer.byteLength).toBe(capacity)
})
