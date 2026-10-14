// @vitest-environment node
import { beforeAll, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { durationMarks } from './helpers/reference-piper-alignment.js'
import { kernelDurationMarks } from './helpers/voice-kernels.js'

// Where the page boundaries of a sentence fall in its audio (duration_marks in the voice core), against the frozen JavaScript.
let core
beforeAll(async () => { core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_voice.wasm'))).instance.exports })
const compare = (marks, durations, cfg) => expect(kernelDurationMarks(core, marks, durations, cfg)).toEqual(durationMarks(marks, durations, cfg))

it('uses the compiled frame mapping and preserves opaque offsets and clamps', () => {
  const values = Float32Array.from({ length: 128 }, (_, i) => i % 8), marks = [{ offset: { point: 1 }, phoneme: 2 }, { offset: 'source', phoneme: 70 }, { offset: 3, phoneme: 133 }, { offset: 4, phoneme: 1 }]
  compare(marks, values, { base: 2, count: 128, samples: 9000, trim: 150, lead: 5, length: 2000 })
  expect(kernelDurationMarks(core, marks, values, { base: 2, count: 128, samples: 9000, trim: 150, lead: 5, length: 2000 }).length).toBeGreaterThan(0)
})
it('matches 20000 whole packets with actual Float32 durations, of any size', () => {
  let seed = 3
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  for (let i = 0; i < 20000; i++) {
    const count = 1 + next() % 1200, values = Float32Array.from({ length: count }, () => next() % 2000 / 50), base = next() % 80
    const marks = Array.from({ length: next() % 41 }, (_, index) => ({ offset: 'opaque:' + index, phoneme: base - 4 + next() % (count + 8) }))
    compare(marks, values, { base, count, samples: next() % 100000, trim: next() % 1000, lead: next() % 1000, length: next() % 100000 })
  }
})
it.each([Float32Array, Float64Array, Array])('keeps standard numeric %s input exact', Type => {
  const values = Type.from({ length: 100 }, (_, i) => i / 10), marks = [{ offset: 3, phoneme: 25 }, { offset: 9, phoneme: 50 }]
  compare(marks, values, { count: 100, samples: 5000, length: 4000 })
})
it('handles small packets like the original', () => {
  compare([{ offset: 1, phoneme: 1 }], Float32Array.of(2, 3, 4), { count: 3, samples: 40, length: 40 })
  compare([{ offset: 1, phoneme: 1 }], Float32Array.of(2, 3, 4), { base: 1, count: 3, samples: 40, length: 40 })
  compare([], Float32Array.of(2, 3, 4), { count: 3, samples: 40, length: 40 })
})
it('gives no boundaries for zero, invalid and overflowing durations, exactly as the original', () => {
  const marks = [{ offset: 1, phoneme: 20 }, { offset: 2, phoneme: 0 }]
  for (const value of [0, NaN, Infinity, -1, 1e308, -0, 1e-320]) compare(marks, new Float64Array(100).fill(value), { count: 100, samples: 40, length: 40 })
  const mixed = new Float64Array(100).fill(1); mixed[40] = -0.5
  compare(marks, mixed, { count: 100, samples: 40, length: 40 })
})
it('gives no boundaries when the durations are not the announced count', () => {
  const marks = [{ offset: 1, phoneme: 20 }], values = new Float32Array(100).fill(1)
  for (const count of [99, 101, 0]) compare(marks, values, { count, samples: 40, length: 40 })
})
it('places a boundary on an empty or tiny audio like the original', () => {
  const marks = [{ offset: 1, phoneme: 20 }, { offset: 2, phoneme: 22 }], values = new Float32Array(100).fill(1)
  for (const length of [0, 1, 2]) compare(marks, values, { count: 100, samples: 4000, trim: 10, lead: 3, length })
})
it('keeps -0 and the rounding of halves where JavaScript puts them', () => {
  const values = new Float32Array(10).fill(1), marks = Array.from({ length: 10 }, (_, i) => ({ offset: i, phoneme: i }))
  for (const samples of [0, 5, 10, 15, 25, 0.5, 1.5, 2.5]) for (const trim of [0, 1, 2.5, -3]) for (const lead of [0, 1, 0.5]) compare(marks, values, { count: 10, samples, trim, lead, length: 30 })
})
it('rejects fractional phoneme indices and incomplete options as a misuse, with nothing returned', () => {
  const values = new Float32Array(100).fill(1)
  expect(() => kernelDurationMarks(core, [{ offset: 1, phoneme: 2.5 }], values, { count: 100, samples: 40, length: 40 })).toThrow()
  expect(() => kernelDurationMarks(core, [{ offset: 1, phoneme: 2 }], values, { base: 0.5, count: 100, samples: 40, length: 40 })).toThrow()
  expect(() => kernelDurationMarks(core, [{ offset: 1, phoneme: 2 }], values, { count: 100, samples: Infinity, length: 40 })).toThrow()
})
it('bounds memory through repeated complete mappings', () => {
  const marks = Array.from({ length: 16 }, (_, i) => ({ offset: i, phoneme: i * 30 })), values = new Float32Array(1000).fill(1), cfg = { count: 1000, samples: 5000, length: 5000 }
  kernelDurationMarks(core, marks, values, cfg)
  const capacity = core.memory.buffer.byteLength
  for (let i = 0; i < 200; i++) kernelDurationMarks(core, marks, values, cfg)
  expect(core.memory.buffer.byteLength).toBe(capacity)
})
