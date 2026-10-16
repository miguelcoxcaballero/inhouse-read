// @vitest-environment node
import { beforeEach, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { IPA_ORACLES, NON_DECIMAL_DIGIT_RANGES } from './fixtures/hebrew-oracles.js'
const state = vi.hoisted(() => ({ core: null }))
vi.mock('../../src/js/rust-voice-core.js', async original => {
  const real = await original()
  return { ...real, loadedRustVoiceCore: () => state.core || real.loadedRustVoiceCore() }
})
import { hebrewToIpa, nakdimonInputIds, mergeNiqqud } from '../../src/js/readers/neural-voice/hebrew.js'
import * as reference from './helpers/reference-hebrew.js'

// The Hebrew rules and the Nakdimon pre/post-processing (hebrew.rs in the voice core) against the frozen JavaScript
// implementation, which was checked against the pinned official Python (see neural-voice-hebrew.test.js).
const core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_voice.wasm'))).instance.exports
beforeEach(() => { state.core = null })
let seed = 3
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)

it.each(IPA_ORACLES)('equals the original for the official oracle %s, alone and repeated into a full fragment', text => {
  expect(hebrewToIpa(text)).toBe(reference.hebrewToIpa(text))
  const input = Array(20).fill(text).join(' ')
  expect(hebrewToIpa(input)).toBe(reference.hebrewToIpa(input))
})

it('keeps exact glyph, stress and sheva output for 30000 generated inputs of any length', () => {
  const chars = Array.from('אבגדהוזחטיכלמנסעפצקרשתךםןףץ!•A🙂׳״́͏\u0085  ﻿𐀀 .')
  const marks = Array.from('ְֱֲֳִֵֶַָׇֹֺֻּֽֿׁׂ֑ׄ֯')
  for (let i = 0; i < 30000; i++) {
    let text = ''
    for (let j = 0, n = (i % 30) + 1; j < n; j++) {
      text += chars[next() % chars.length]
      if (next() % 2) text += marks[next() % marks.length]
      if (next() % 3 === 0) text += marks[next() % marks.length]
      if (next() % 5 === 0) text += ' '
    }
    if (i % 3 === 0) text = Array(1 + (i % 9)).fill(text).join(' ')
    expect(hebrewToIpa(text)).toBe(reference.hebrewToIpa(text))
  }
})

it('reads the digraphs of geresh, lone surrogates and words with nothing to say like the original', () => {
  for (const text of ['צ׳י', 'ג׳ז ז׳', 'ג׳ַ', 'גַ׳', 'ש ׳ ג׳', '\ud800 שָׁלוֹם \udc00', 'שָׁלוֹם \ud800 '.repeat(30), '́', '́ ́', ' ', '', '!!! ??? ...',
    'שָׁלוֹם '.repeat(7000), '𐐀 שָׁלוֹם'])
    expect(hebrewToIpa(text)).toBe(reference.hebrewToIpa(text))
})

it('reads the character ids of the trained alphabet like the original, for every code point', () => {
  const text = codes => String.fromCodePoint(...codes)
  const check = codes => expect(Array.from(nakdimonInputIds(text(codes)))).toEqual(Array.from(reference.nakdimonInputIds(text(codes))))
  for (let first = 0; first < 0x110000; first += 4096) {
    const codes = []
    for (let code = first; code < Math.min(first + 4096, 0x110000); code++) if (code < 0xd800 || code > 0xdfff) codes.push(code)
    if (codes.length) check(codes)
  }
  for (let code = 0xd800; code <= 0xdfff; code += 37) expect(Array.from(nakdimonInputIds(String.fromCharCode(code)))).toEqual(Array.from(reference.nakdimonInputIds(String.fromCharCode(code))))
  for (const [first, last] of NON_DECIMAL_DIGIT_RANGES) { const codes = []; for (let code = first; code <= last; code++) codes.push(code); check(codes) }
  expect(Array.from(nakdimonInputIds(''))).toEqual([])
})

it('puts the model predictions back on 5000 random texts exactly like the original, ties and rafe included', () => {
  const letters = Array.from('אבגדהוזחטיכלמנסעפצקרשתךםןףץ !A1.')
  const tensor = (rows, classes, tie) => {
    const data = Float32Array.from({ length: rows * classes }, () => (next() % 5) - 2)
    if (tie) data.fill(1, 0, classes)
    return { type: 'float32', dims: [1, rows, classes], data }
  }
  for (let round = 0; round < 5000; round++) {
    const text = Array.from({ length: next() % 40 }, () => (next() % 40 === 0 ? 'ֿ' : letters[next() % letters.length]))
    const outputs = { N: tensor(text.length, 16, round % 7 === 0), D: tensor(text.length, 3, round % 11 === 0), S: tensor(text.length, 4, round % 13 === 0) }
    expect(mergeNiqqud(text, outputs)).toBe(reference.mergeNiqqud(text, outputs))
  }
})

it('reports the first broken head, in the order the original checked them', () => {
  const good = rows => ({ N: tensor(rows, 16), D: tensor(rows, 3), S: tensor(rows, 4) })
  function tensor(rows, classes) { return { type: 'float32', dims: [1, rows, classes], data: new Float32Array(rows * classes) } }
  const cases = [
    outputs => { outputs.N.data[3] = NaN; outputs.D.dims = [1, 2, 3] },
    outputs => { outputs.D.data[1] = Infinity; outputs.S.type = 'int32' },
    outputs => { outputs.S.data[2] = -Infinity },
    outputs => { delete outputs.D; outputs.N.data[0] = NaN },
    outputs => { outputs.N.dims = [1, 16] }
  ]
  for (const mutate of cases) {
    const outputs = good(2); mutate(outputs)
    const message = run => { try { run(); return 'no error' } catch (error) { return error.message } }
    expect(message(() => mergeNiqqud(['ש', 'ב'], outputs))).toBe(message(() => reference.mergeNiqqud(['ש', 'ב'], outputs)))
  }
})

it('keeps memory bounded across repeated complete calls', () => {
  const text = 'שָׁלוֹם עוֹלָם '.repeat(40)
  state.core = core
  hebrewToIpa(text); nakdimonInputIds(text)
  const capacity = core.memory.buffer.byteLength
  for (let i = 0; i < 200; i++) { hebrewToIpa(text); nakdimonInputIds(text) }
  expect(core.memory.buffer.byteLength).toBe(capacity)
})

it('frees its arena exactly once when the core declines a call, and says so', () => {
  const text = 'שָׁלוֹם עוֹלָם '.repeat(10)
  for (const hebrew_ipa_words of [() => -1, () => { throw new Error('trap') }]) {
    let live = 0
    state.core = { ...core, alloc_f64(n) { const p = core.alloc_f64(n); if (p) live += n; return p }, free_f64(p, n) { core.free_f64(p, n); live -= n }, hebrew_ipa_words }
    expect(() => hebrewToIpa(text)).toThrow()
    expect(live).toBe(0)
  }
  state.core = { ...core, alloc_f64: () => 0 }
  expect(() => hebrewToIpa(text)).toThrow(/memory/)
})

it('is the voice domain: no imports, and the synthesis kernels beside the rules', () => {
  expect(core.core_domain()).toBe(2)
  expect(core.core_abi_version()).toBe(1)
  for (const name of ['hebrew_ipa_words', 'nakdimon_ids', 'nakdimon_argmax', 'nakdimon_assemble', 'pcm_prepare', 'speech_tempo', 'duration_marks', 'voice_finish_piper', 'voice_finish_supertonic', 'voice_speed_up']) expect(typeof core[name]).toBe('function')
  expect(core.plant_surface_lattice).toBeUndefined()
  expect(core.speech_normalize).toBeUndefined()
  expect(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync('src/wasm/inhouse_read_voice.wasm')))).toEqual([])
})
