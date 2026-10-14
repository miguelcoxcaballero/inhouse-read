// @vitest-environment node
import { it, expect } from 'vitest'
import { normalizeSupertonicText, supertonicTextChunks } from '../../src/js/readers/neural-voice/supertonic-runtime.js'
import * as original from './helpers/reference-supertonic-text.js'
import { SUPERTONIC_LANGUAGES } from '../../src/js/readers/neural-voice/supertonic-catalog.js'

// The text side of the Supertonic recipe (supertonic_text.rs in the voice core) against the frozen JavaScript.
let seed = 515
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
const pick = list => list[next() % list.length]
const outcome = run => { try { return { value: run() } } catch (error) { return { error: error.message } } }

const PIECES = ['Hola', 'mundo', 'e.g.,', 'i.e.,', '@', 'a@b.c', ' ', '  ', '\t', '\n', ' ', ' ', '﻿', '　', '"', '""', '"""', "'", "''", '‘', '’', '“', '”', '´', '`',
  '–', '‑', '—', '-', '_', '[', ']', '|', '/', '#', '→', '←', '♥', '☆', '♡', '©', '\\', ',', '.', '!', '?', ';', ':', ' ,', '  .', ' \n?', ')', '(', '}', '…', '。', '」', '』',
  '】', '〉', '》', '›', '»', '😀', '🌍', '☀', '➿', '🇪🇸', '🤩', '\ud800', '\udc00', 'café', 'ﬁ', '①', 'Ａ', '́', 'ñ', '한국어 문장.', '日本語。', 'Привет!', 'ça va ?', '１２３']

it('cleans 40000 random texts like the original, in every language', () => {
  let spoken = 0, silent = 0
  for (let round = 0; round < 40000; round++) {
    const text = Array.from({ length: next() % 14 }, () => pick(PIECES)).join(round % 3 ? '' : ' ')
    const lang = round % 5 === 0 ? 'xx' : pick(SUPERTONIC_LANGUAGES)
    const a = outcome(() => normalizeSupertonicText(text, lang)), b = outcome(() => original.normalizeSupertonicText(text, lang))
    expect(a).toEqual(b)
    if (b.value) spoken++; else if (b.value === '') silent++
  }
  expect(spoken).toBeGreaterThan(20000)
  expect(silent).toBeGreaterThan(500)
})

it('cleans the cases the recipe names', () => {
  expect(normalizeSupertonicText('  Hola , mundo — e.g., esto @ casa  ', 'es')).toBe(original.normalizeSupertonicText('  Hola , mundo — e.g., esto @ casa  ', 'es'))
  expect(normalizeSupertonicText('Hola', 'es')).toBe('<es>Hola.</es>')
  expect(normalizeSupertonicText('', 'es')).toBe('')
  expect(normalizeSupertonicText(null, 'es')).toBe('')
  expect(normalizeSupertonicText('😀', 'es')).toBe('')
  expect(() => normalizeSupertonicText('Hola', 'zz')).toThrow('Idioma Supertonic no disponible: zz')
})

it('cuts 15000 random texts into the same chunks, and long ones too', () => {
  const sentence = 'Una frase bastante larga, con comas; y puntos. Otra más! ¿Y esta? 日本語。文章。 '
  for (let round = 0; round < 15000; round++) {
    const parts = Array.from({ length: next() % 40 }, () => pick([...PIECES, sentence, 'x'.repeat(next() % 200), ' '.repeat(next() % 5), 'palabra ']))
    const text = (round % 7 === 0 ? ' \n ' : '') + parts.join('') + (round % 11 === 0 ? ' 　' : '')
    const lang = pick(['es', 'en', 'ko', 'ja', 'fr'])
    expect(supertonicTextChunks(text, lang)).toEqual(original.supertonicTextChunks(text, lang))
  }
  for (const length of [299, 300, 301, 600, 601, 3000, 20000]) {
    const text = sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length)
    for (const lang of ['es', 'ko', 'ja']) expect(supertonicTextChunks(text, lang)).toEqual(original.supertonicTextChunks(text, lang))
  }
  expect(supertonicTextChunks('', 'es')).toEqual([])
  expect(supertonicTextChunks(undefined, 'es')).toEqual([])
  const surrogates = '😀'.repeat(400) + '\ud800'.repeat(150)
  expect(supertonicTextChunks(surrogates, 'es')).toEqual(original.supertonicTextChunks(surrogates, 'es'))
})
