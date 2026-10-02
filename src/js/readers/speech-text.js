// Pure text side of the audiobook: turn the raw text a reader exposes into
// sentences and spoken fragments WITHOUT losing where each one came from. The
// reading highlight needs "sentence 7 is raw[1203, 1290)", so every cleanup
// (footnote markers, collapsed whitespace, soft hyphens, repeated headers)
// keeps an index map from the cleaned text back to the raw text.

const FOOTNOTE_MARKERS = [/\[(?:\d{1,3}|[*†‡])\]/g, /\(\s*(?:note|nota)\s+\d+\s*\)/gi]
const INVISIBLE = /[­​⁠﻿]/
// Repeated short lines are running headers only when they sit close together;
// over a whole chapter a repeated "Yes." or "* * *" is real content.
const HEADER_WINDOW = 40
// speech-map.js puts this between blocks that must not run into each other (see HARD_BLOCKS there).
export const HARD_BREAK = '\u2029'

/** Drops what must not be read, keeping raw offsets: returns { text, map } with map[i] = raw offset of text[i]. */
export function normalizeSpeech(raw, { footnotes = true, skipHeaders = false } = {}) {
  raw = String(raw || '')
  const removed = new Uint8Array(raw.length)
  const remove = (from, to) => removed.fill(1, from, to)
  if (!footnotes) for (const pattern of FOOTNOTE_MARKERS) for (const m of raw.matchAll(pattern)) remove(m.index, m.index + m[0].length)
  if (skipHeaders) {
    const lines = [...raw.matchAll(/[^\n\u2029]+/g)].map(m => ({ from:m.index, to:m.index + m[0].length, key:m[0].trim().toLocaleLowerCase() }))
    const nearby = new Map()
    lines.forEach((line, i) => { if (line.key && line.key.length < 90) (nearby.get(line.key) || nearby.set(line.key, []).get(line.key)).push(i) })
    for (const places of nearby.values()) {
      for (let i = 0; i < places.length; i++) {
        if ((i > 0 && places[i] - places[i - 1] <= HEADER_WINDOW) || (i + 1 < places.length && places[i + 1] - places[i] <= HEADER_WINDOW)) remove(lines[places[i]].from, lines[places[i]].to)
      }
    }
  }
  // "informa-\ntion": a line-end hyphen between letters is typesetting, not speech.
  for (const m of raw.matchAll(/(?<=\p{L})[-‐]\n(?=\p{Ll})/gu)) remove(m.index, m.index + 2)
  // Characters are collected in arrays: books are long and string surgery per break would be quadratic.
  const chars = [], map = []
  for (let i = 0; i < raw.length; i++) {
    if (removed[i]) continue
    const ch = raw[i]
    if (INVISIBLE.test(ch)) continue
    if (ch === HARD_BREAK) {
      // End of a heading, list item or table cell: it is its own sentence even without a full stop, so it is read and highlighted alone.
      if (chars.at(-1) === ' ') { chars.pop(); map.pop() }
      if (chars.length && !/[.!?。！？…:;]/.test(chars.at(-1))) { chars.push('.'); map.push(i) }
    }
    if (/\s/.test(ch)) {
      if (chars.length && chars.at(-1) !== ' ') { chars.push(' '); map.push(i) }
    } else { chars.push(ch); map.push(i) }
  }
  if (chars.at(-1) === ' ') { chars.pop(); map.pop() }
  const text = chars.join('')
  return { text, map }
}

/** Sentences of an already normalised text; long ones also carry their <=180 character spoken fragments. */
export function speechSentences(text) {
  const sentences = []
  for (const sentence of String(text).matchAll(/[^.!?。！？]+[.!?。！？]*\s*/g)) {
    const fragments = []
    for (const part of sentence[0].matchAll(/.{1,180}(?:\s|$)|.{1,180}/g)) {
      const value = part[0].trim()
      if (!value) continue
      const start = sentence.index + part.index + part[0].length - part[0].trimStart().length
      fragments.push({ start, end:start + value.length, text:value })
    }
    if (fragments.length) sentences.push({ start:fragments[0].start, end:fragments.at(-1).end, fragments })
  }
  return sentences
}

export const speechChunks = text => speechSentences(String(text || '').replace(/\s+/g, ' ').trim()).flatMap(s => s.fragments.map(f => f.text))

/**
 * Spoken fragments of `raw` from raw offset `from` on. Every item keeps the raw
 * range of the fragment (what the page must show) and of its whole sentence
 * (what gets highlighted while its fragments are spoken).
 */
export function planSpeech(raw, options = {}, from = 0) {
  const { text, map } = normalizeSpeech(raw, options)
  let low = 0, high = map.length
  while (low < high) { const mid = (low + high) >> 1; if (map[mid] < from) low = mid + 1; else high = mid }
  const rawRange = (start, end) => ({ start:map[low + start], end:map[low + end - 1] + 1 })
  const items = []
  for (const sentence of speechSentences(text.slice(low))) {
    const whole = rawRange(sentence.start, sentence.end)
    for (const fragment of sentence.fragments) items.push({ text:fragment.text, ...rawRange(fragment.start, fragment.end), sentence:whole })
  }
  return items
}
