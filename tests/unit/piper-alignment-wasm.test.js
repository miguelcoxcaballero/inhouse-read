// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { rustVoiceCore } from './helpers/rust-voice-ready.js'
import { exposePiperDurations, phonemeMarks } from '../../src/js/readers/neural-voice/piper-alignment.js'
import * as frozen from './helpers/reference-piper-alignment.js'

// The protobuf walk/rewrite and the boundary planning moved to rust-core onnx_durations.rs.
// reference-piper-alignment.js is the frozen JavaScript original of both.
const encode = new TextEncoder()
const vint = value => { const out = []; do { const part = value % 128; value = Math.floor(value / 128); out.push(part | (value ? 128 : 0)) } while (value); return out }
const field = (n, bytes, wire = 2) => wire === 2 ? [...vint(n * 8 + 2), ...vint(bytes.length), ...bytes]
  : wire === 0 ? [...vint(n * 8), ...bytes] : wire === 1 ? [...vint(n * 8 + 1), ...bytes.slice(0, 8)] : [...vint(n * 8 + 5), ...bytes.slice(0, 4)]
const str = (n, s) => field(n, typeof s === 'string' ? encode.encode(s) : s)
const node = (op, inputs, outputs, extra = []) => field(1, [...inputs.flatMap(i => str(1, i)), ...outputs.flatMap(o => str(2, o)), ...(op === null ? [] : str(4, op)), ...extra])
function random(seed) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 } }
const names = ['a', 'b', 'c', 'dur', 'phonemes', 'input', 'input_lengths', 'scales', 'sid', 'audio', '﻿b', 'é', '日本', '😀']
function model(seed) {
  const next = random(seed), pick = values => values[Math.floor(next() * values.length)]
  const ceilOut = pick(['b', 'b', 'dur', '﻿b', 'é'])
  const nodes = [node('Ceil', ['a'], [ceilOut]), node('CumSum', [next() < 0.9 ? ceilOut : 'x'], ['c'])]
  for (let i = 0, n = Math.floor(next() * 6); i < n; i++) nodes.push(node(pick(['Mul', 'Ceil', 'CumSum', 'Add', 'Constant']), [pick(names)], next() < 0.2 ? [pick(names), pick(names)] : [pick(names)],
    next() < 0.3 ? field(5, Array.from({ length:Math.floor(next() * 90000) }, (_, k) => k & 255)) : []))
  if (next() < 0.1) nodes.push(node(null, ['a'], ['z']))
  const inputs = ['input', 'input_lengths', 'scales'].filter(() => next() < 0.95).map(n => field(11, [...str(1, n), ...field(2, [8, 1])]))
  if (next() < 0.3) inputs.push(field(11, str(1, 'sid')))
  const outputs = [field(12, str(1, 'audio'))]
  if (next() < 0.2) outputs.push(field(12, str(1, ceilOut)))
  const initializers = Array.from({ length:Math.floor(next() * 4) }, () => field(5, Array.from({ length:Math.floor(next() * 200000) }, (_, k) => (k * 31) & 255)))
  const entries = [...nodes, ...initializers, ...inputs, ...outputs]
  for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); if (next() < 0.3) [entries[i], entries[j]] = [entries[j], entries[i]] }
  const graph = field(7, entries.flat())
  const top = [...field(1, [7], 0), ...str(2, 'pytorch'), ...graph, ...field(8, field(1, [8, 13]))]
  const bytes = Uint8Array.from(next() < 0.1 ? [...top, ...graph] : top)
  // Damage some models: a flipped byte, a truncation or a bad wire type.
  const damage = next()
  if (damage < 0.08) bytes[Math.floor(next() * bytes.length)] ^= 1 << Math.floor(next() * 8)
  else if (damage < 0.12) return bytes.subarray(0, Math.floor(next() * bytes.length))
  else if (damage < 0.14) return Uint8Array.from([...bytes, 0x0f])
  return bytes
}
function same(input) {
  const expected = frozen.exposePiperDurations(input), actual = exposePiperDurations(input)
  expect(actual.name).toBe(expected.name)
  // Byte comparison of whole models: a generic deep equality is far too slow for megabytes.
  expect(actual.bytes).toBeInstanceOf(Uint8Array)
  expect(Buffer.compare(Buffer.from(actual.bytes.buffer, actual.bytes.byteOffset, actual.bytes.length),
    Buffer.from(expected.bytes.buffer, expected.bytes.byteOffset, expected.bytes.length))).toBe(0)
  if (expected.bytes === input) expect(actual.bytes).toBe(input)
  return actual
}

describe('Piper duration output from the Rust voice core', () => {
  it('rewrites, recognises and leaves untouched exactly like the frozen original on 300 models', () => {
    const outcomes = new Map()
    for (let seed = 1; seed <= 300; seed++) {
      const input = model(seed), before = Buffer.from(input), result = same(input)
      expect(Buffer.from(input).equals(before)).toBe(true)
      const kind = result.name === null ? 'untouched' : result.bytes === input ? 'exposed' : 'rewritten'
      outcomes.set(kind, (outcomes.get(kind) || 0) + 1)
      if (kind === 'rewritten') same(result.bytes)
    }
    for (const kind of ['untouched', 'exposed', 'rewritten']) expect(outcomes.get(kind)).toBeGreaterThan(30)
  })
  it('matches on malformed varints, field numbers, wire types and names that are not UTF-8', () => {
    const cases = [[], [255], [58, 127], [58, 4, 8, 255, 255, 255], [0, 0], [8, 128, 128, 128, 128, 128, 128, 128, 128, 1],
      [58, 0], [56, 1], [57, 1, 2, 3, 4, 5, 6, 7, 8], [61, 1, 2, 3], [59], [60], [8, 255, 255, 255, 255, 255, 255, 255, 15]]
    for (const value of cases) same(Uint8Array.from(value))
    const next = random(9)
    for (let i = 0; i < 400; i++) {
      const weird = Array.from({ length:1 + Math.floor(next() * 6) }, () => Math.floor(next() * 256))
      const out = next() < 0.5 ? weird : [0xef, 0xbb, 0xbf, ...weird]
      const graph = field(7, [...node('Ceil', ['a'], [out]), ...node('CumSum', [next() < 0.5 ? out : weird.slice(1)], ['c']),
        ...['input', 'input_lengths', 'scales'].flatMap(n => field(11, str(1, n))), ...field(12, str(1, next() < 0.3 ? out : 'audio')),
        ...(next() < 0.2 ? field(1, [8, 1], 0) : []), ...(next() < 0.1 ? field(11, [1, 2, 3, 4], 5) : [])])
      same(Uint8Array.from(graph))
    }
    for (let i = 0; i < 400; i++) same(Uint8Array.from({ length:Math.floor(next() * 40) }, () => Math.floor(next() * 256)))
  })
  it('accepts an ArrayBuffer and never copies a large model into the voice core', () => {
    const weights = new Uint8Array(12 * 1024 * 1024).fill(7)
    const graph = [...node('Ceil', ['a'], ['b']), ...node('CumSum', ['b'], ['c']), ...['input', 'input_lengths', 'scales'].flatMap(n => field(11, str(1, n))), ...field(12, str(1, 'audio'))]
    const head = Uint8Array.from([...vint(7 * 8 + 2), ...vint(graph.length + 5 + weights.length), ...graph, ...vint(5 * 8 + 2), ...vint(weights.length)])
    const input = new Uint8Array(head.length + weights.length); input.set(head); input.set(weights, head.length)
    const before = rustVoiceCore.memory.buffer.byteLength, result = exposePiperDurations(input.buffer)
    expect(result.name).toBe('b')
    expect(result.bytes.length - input.length).toBeLessThan(80)
    expect(Buffer.from(result.bytes).equals(Buffer.from(frozen.exposePiperDurations(input).bytes))).toBe(true)
    expect(rustVoiceCore.memory.buffer.byteLength - before).toBeLessThan(1024 * 1024)
  })
  it('plans the same boundaries and prefix phonemes, phonemizing only valid distinct offsets in order', async () => {
    const next = random(5)
    for (let round = 0; round < 300; round++) {
      const text = 'One two three, four.'.slice(0, 1 + Math.floor(next() * 20))
      const marks = Array.from({ length:Math.floor(next() * 8) }, () => [3, 4, 4, -1, 0, -0, 2.5, text.length, text.length - 1, 200, '4', NaN, Infinity, 7, 1][Math.floor(next() * 15)])
      const ids = [1, 0, ...Array.from({ length:Math.floor(next() * 10) }, () => Math.floor(next() * 4) + 2), 2]
      const phonemize = calls => async value => { calls.push(value); return value.length % 3 ? ids.slice(0, value.length) : [...ids.slice(0, 2), 9, 2] }
      const given = next() < 0.05 ? null : marks, expectedCalls = [], actualCalls = []
      const expected = await frozen.phonemeMarks(text, given, ids, phonemize(expectedCalls))
      const actual = await phonemeMarks(text, given, ids, phonemize(actualCalls))
      expect(actualCalls).toEqual(expectedCalls)
      expect(actual).toEqual(expected)
    }
    expect(await phonemeMarks('One two.', [4, 4, -1, 200], [1, 0, 9, 0, 10, 0, 11, 0, 2], async () => [1, 0, 9, 0, 2])).toEqual([{ offset:4, phoneme:4 }])
  })
  it('reports a missing voice core instead of passing the model through', async () => {
    vi.resetModules()
    vi.doMock('../../src/js/rust-voice-ui.js', () => ({ loadedRustVoiceUI:() => { throw new Error('El módulo de voz no está cargado.') } }))
    try {
      const isolated = await import('../../src/js/readers/neural-voice/piper-alignment.js')
      expect(() => isolated.exposePiperDurations(new Uint8Array(4))).toThrow('El módulo de voz no está cargado.')
      await expect(isolated.phonemeMarks('ab', [1], [1], async () => [1])).rejects.toThrow('El módulo de voz no está cargado.')
    } finally { vi.doUnmock('../../src/js/rust-voice-ui.js'); vi.resetModules() }
  })
})
