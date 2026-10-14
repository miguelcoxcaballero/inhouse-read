// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { limitIds, splitSegments, lengthScaleFor, synthesisRate, finishPiper, finishSupertonic, speedUpSpeech, silence } from '../../src/js/readers/neural-voice/synth-flow.js'
import * as rustVoice from '../../src/js/rust-voice-core.js'
import * as referencePcm from './helpers/reference-pcm.js'
import * as referenceTempo from './helpers/reference-speech-tempo.js'
import { referencePiper, referenceSupertonic } from './helpers/reference-synth-flow.js'
import { makePCM } from '../helpers/pcm-cases.mjs'

// The work the synthesis worker and the Android client do around the model, in the voice core, against the frozen
// JavaScript they ran before: phoneme-id bookkeeping, and the finishing of every chunk of audio.
let seed = 20261014
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength)
const same = (a, b) => expect(Buffer.compare(bytes(a), bytes(b))).toBe(0)
const outcome = run => { try { return { value: run() } } catch (error) { return { error: error.message } } }

describe('phoneme ids', () => {
  it('limits and splits 3000 random sequences like the original', () => {
    for (let round = 0; round < 3000; round++) {
      const symbols = [0, 152, 154, 256, undefined, NaN][next() % 6], size = next() % 80
      const ids = Array.from({ length: size }, () => [0, 0, 1, 2, 2, 3, 40, 151, 152, 153, 200, 300][next() % 12])
      expect(limitIds(ids, symbols)).toEqual(referencePcm.limitIds(ids, symbols))
      expect(splitSegments(ids)).toEqual(referencePcm.splitSegments(ids))
    }
  })
  it('keeps the documented cases', () => {
    expect(limitIds([1, 0, 10, 0, 152, 0, 11, 0, 2], 152)).toEqual([1, 0, 10, 0, 11, 0, 2])
    expect(limitIds([1, 0, 200, 0, 2], 0)).toEqual([1, 0, 200, 0, 2])
    expect(limitIds([], 152)).toEqual([])
    expect(splitSegments([1, 0, 17, 0, 18, 0, 2, 1, 0, 2, 1, 0, 31, 0, 28, 0, 2])).toEqual([[1, 0, 17, 0, 18, 0, 2], [1, 0, 31, 0, 28, 0, 2]])
    expect(splitSegments([1, 0, 5, 0, 6, 0])).toEqual([[1, 0, 5, 0, 6, 0]])
    expect(splitSegments([1, 0, 2])).toEqual([])
    expect(splitSegments([])).toEqual([])
  })
  it('handles a long fragment without a size limit of its own', () => {
    const ids = Array.from({ length: 200_000 }, (_, i) => (i % 9 === 8 ? 2 : i % 2 ? 0 : 5 + (i % 40)))
    expect(splitSegments(ids)).toEqual(referencePcm.splitSegments(ids))
    expect(limitIds(ids, 30)).toEqual(referencePcm.limitIds(ids, 30))
  })
})

describe('rates', () => {
  it('computes the model rate and the length scale of every kind of rate', () => {
    const rates = [undefined, null, NaN, 0, -0, -1, 0.1, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.9, 3, 3.5, 99, Infinity, -Infinity, 'x', '2', '1.5', [], {}]
    for (const rate of rates) {
      expect(synthesisRate(rate)).toBe(Math.min(1, Math.max(.5, Number(rate) || 1)))
      for (const base of [1, 0.8, 1.2, 0, 3.7]) expect(lengthScaleFor(base, rate)).toBe(referencePcm.lengthScaleFor(base, rate))
    }
  })
})

const TEXTS = ['Ya es tarde.', '¿Qué hora es?', 'Dijo: "Voy."', 'Cuando llegó el invierno,', 'el viejo bibliotecario cerró el último', 'Fin…', '终于。 ',
  'Él dijo « Oui. » ', 'Wait; ', 'Eh — ', '', '   ', '.', ',', 'a.)', 'a.) ”', 'a. ”b', "x.'\t\n", 'x ', 'x.﻿']
const RATES = [0.5, 0.75, 1, 1.1, 1.25, 1.5, 2, 2.5, 3]
const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000]

function randomUtterance() {
  const sampleRate = SAMPLE_RATES[next() % SAMPLE_RATES.length], count = 1 + next() % 26000
  const level = [0.004, 0.03, 0.2, 0.9][next() % 4], raw = new Float32Array(count)
  const lead = next() % (count >> 2 + 1), tail = next() % (count >> 2 + 1)
  for (let i = lead; i < count - tail; i++) raw[i] = ((next() / 4294967296) - 0.5) * level * (1 + Math.sin(i / 37))
  return { raw, sampleRate }
}

describe('a finished sentence of Piper audio', () => {
  it('equals the original worker for 500 random sentences (levels, rates, rests, boundaries)', () => {
    let rendered = 0
    for (let round = 0; round < 500; round++) {
      const { raw, sampleRate } = randomUtterance()
      const phonemes = 1 + next() % 120, base = next() % 400, text = TEXTS[next() % TEXTS.length], rate = RATES[next() % RATES.length]
      const durations = next() % 6 ? Float32Array.from({ length: phonemes }, () => (next() % 4000) / 100) : next() % 2 ? null : Float32Array.from({ length: phonemes + 1 }, () => 1)
      const points = Array.from({ length: next() % 12 }, (_, i) => ({ offset: i * 3 + 1, phoneme: base - 2 + (next() % (phonemes + 6)) }))
      const options = { sampleRate, model: next() % 5 ? 'es_ES-davefx-medium' : 'no_NO-nvcc-medium', rate, base, count: phonemes, last: next() % 2 === 0, first: next() % 2 === 0 }
      const expected = outcome(() => referencePiper(raw.slice(), durations, points, text, options)), actual = outcome(() => finishPiper(raw, durations, points, text, options))
      expect(actual.error).toBe(expected.error)
      if (expected.value) {
        same(actual.value.pcm, expected.value.pcm)
        expect(actual.value.marks).toEqual(expected.value.marks)
        rendered++
      }
    }
    expect(rendered).toBe(500)
  })

  it('places boundaries from the phoneme durations, with the trim and the leading rest', () => {
    const raw = makePCM({ count: 30000, amplitude: 0.4 }), sampleRate = 22050
    const durations = Float32Array.from({ length: 60 }, (_, i) => 1 + (i % 5)), points = [3, 20, 59, 61, 5].map((phoneme, i) => ({ offset: 10 * i + 1, phoneme }))
    for (const rate of [1, 1.5]) for (const first of [true, false]) {
      const options = { sampleRate, model: '', rate, base: 0, count: 60, last: true, first }
      const actual = finishPiper(raw, durations, points, 'Una frase.', options), expected = referencePiper(raw.slice(), durations, points, 'Una frase.', options)
      same(actual.pcm, expected.pcm)
      expect(actual.marks).toEqual(expected.marks)
      expect(actual.marks.length).toBeGreaterThan(0)
    }
  })

  it('rests after a sentence by what the text ends with', () => {
    const raw = makePCM({ count: 9000, amplitude: 0.3 }), sampleRate = 22050
    const bare = finishPiper(raw, null, [], 'x', { sampleRate, model: '', rate: 1, base: 0, count: 1, last: false, first: true }).pcm.length
    for (const text of TEXTS) {
      const withRest = finishPiper(raw, null, [], text, { sampleRate, model: '', rate: 1, base: 0, count: 1, last: true, first: true }).pcm.length
      expect(withRest - bare).toBe(silence(sampleRate, referencePcm.pauseAfter(text)).length)
    }
  })

  it('refuses what the tempo refuses, with the original messages', () => {
    const { raw, sampleRate } = randomUtterance(), many = Array.from({ length: 200 }, (_, i) => ({ offset: i + 1, phoneme: i }))
    const durations = Float32Array.from({ length: 300 }, () => 1), options = { sampleRate, model: '', rate: 2, base: 0, count: 300, last: true, first: true }
    const bad = raw.slice(); bad[bad.length >> 1] = NaN
    for (const [signal, points] of [[raw, many], [bad, []]]) {
      const expected = outcome(() => referencePiper(signal.slice(), durations, points, 'x.', options)), actual = outcome(() => finishPiper(signal, durations, points, 'x.', options))
      expect(actual.error).toBe(expected.error)
      expect(actual.error).toBeTruthy()
    }
    const slow = { ...options, rate: 1 }
    same(finishPiper(bad, durations, [], 'x.', slow).pcm, referencePiper(bad.slice(), durations, [], 'x.', slow).pcm)
  })

  it('does not touch the caller buffers', () => {
    const { raw, sampleRate } = randomUtterance(), copy = raw.slice(), durations = Float32Array.from({ length: 30 }, () => 2)
    finishPiper(raw, durations, [{ offset: 1, phoneme: 4 }], 'a.', { sampleRate, model: '', rate: 1.5, base: 0, count: 30, last: true, first: true })
    same(raw, copy)
  })
})

describe('a finished fragment of Supertonic audio', () => {
  it('equals the original worker for 300 random fragments', () => {
    for (let round = 0; round < 300; round++) {
      const { raw, sampleRate } = randomUtterance(), text = TEXTS[next() % TEXTS.length], rate = RATES[next() % RATES.length]
      const timeline = Array.from({ length: next() % 6 }, (_, i) => ({ offset: i + 1, sample: (next() % (raw.length + 40)) - 20, estimated: true }))
      same(finishSupertonic(raw, text, timeline, { sampleRate, rate }).pcm, referenceSupertonic(raw.slice(), text, timeline, { sampleRate, rate }).pcm)
      expect(finishSupertonic(raw, text, timeline, { sampleRate, rate }).marks).toEqual(referenceSupertonic(raw.slice(), text, timeline, { sampleRate, rate }).marks)
    }
  })
  it('reports audio that is not a number', () => {
    const { raw, sampleRate } = randomUtterance()
    for (const value of [NaN, Infinity, -Infinity]) { const bad = raw.slice(); bad[bad.length >> 1] = value; expect(finishSupertonic(bad, 'x.', [], { sampleRate, rate: 1 })).toBeNull() }
  })
})

describe('speeding up speech', () => {
  it('returns the very same objects at normal speed and for silence', () => {
    const pcm = makePCM({ count: 5000 }), marks = [{ offset: 1, sample: 3 }]
    for (const rate of [undefined, 0, 0.5, 1, 'x', NaN]) { const out = speedUpSpeech(pcm, 24000, rate, marks); expect(out.pcm).toBe(pcm); expect(out.marks).toBe(marks) }
    const empty = new Float32Array(0)
    expect(speedUpSpeech(empty, 24000, 2, marks).pcm).toBe(empty)
  })
  it('equals the original for random utterances and marks with extra fields, in any order', () => {
    for (let round = 0; round < 120; round++) {
      const { raw, sampleRate } = randomUtterance(), rate = RATES[next() % RATES.length]
      const marks = Array.from({ length: next() % 9 }, (_, i) => ({ offset: i, sample: [(next() % raw.length), -1, raw.length, 3.5, NaN, '7', undefined][next() % 7], estimated: i % 2 === 0 }))
      const expected = outcome(() => referenceTempo.speedUpSpeech(raw.slice(), sampleRate, rate, marks)), actual = outcome(() => speedUpSpeech(raw.slice(), sampleRate, rate, marks))
      expect(actual.error).toBe(expected.error)
      if (expected.value) { same(actual.value.pcm, expected.value.pcm); expect(actual.value.marks).toEqual(expected.value.marks) }
    }
  })
  it('refuses input the tempo cannot take, with the original messages', () => {
    const pcm = makePCM({ count: 5000, amplitude: 0.3 })
    for (const sampleRate of [7999, 96001, 22050.5, NaN]) expect(outcome(() => speedUpSpeech(pcm, sampleRate, 2))).toEqual(outcome(() => referenceTempo.speedUpSpeech(pcm, sampleRate, 2)))
    const bad = pcm.slice(); bad[10] = Infinity
    expect(outcome(() => speedUpSpeech(bad, 24000, 2))).toEqual(outcome(() => referenceTempo.speedUpSpeech(bad, 24000, 2)))
    const marks = Array.from({ length: 129 }, (_, i) => ({ sample: i }))
    expect(outcome(() => speedUpSpeech(pcm, 24000, 2, marks))).toEqual({ error: 'Too many speech boundaries' })
    expect(outcome(() => speedUpSpeech([1, 2, 3], 24000, 2))).toEqual(outcome(() => referenceTempo.speedUpSpeech([1, 2, 3], 24000, 2)))
  })
})

describe('the voice core is required', () => {
  it('says so, in the app\'s own words, when it is missing', async () => {
    vi.resetModules()
    const fresh = await import('../../src/js/rust-voice-core.js')
    expect(() => fresh.loadedRustVoiceCore()).toThrow(/módulo de voz/)
    expect(rustVoice.loadedRustVoiceCore()).toBeTruthy()
  })
})
