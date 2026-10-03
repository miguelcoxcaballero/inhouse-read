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
const TERMINATORS = /[.!?。！？…:;]/
const CLOSERS = /["'”’»›)\]}」』]/

// A reader can confirm marginal header ranges without treating repeated body
// paragraphs as headers. Ignore damaged metadata rather than clamping a range
// into legitimate text. Confirmed ranges cover one complete short line only.
function validHeaderRange(raw, range) {
  const start = range?.start, end = range?.end
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > raw.length || end <= start) return false
  const value = raw.slice(start, end)
  if (!value.trim() || value.trim().length >= 90 || /[\r\n\u2028\u2029]/.test(value)) return false
  const before = Math.max(...['\r', '\n', '\u2028', '\u2029'].map(separator => raw.lastIndexOf(separator, start - 1))) + 1
  const next = raw.slice(end).search(/[\r\n\u2028\u2029]/), after = next < 0 ? raw.length : end + next
  return !raw.slice(before, start).trim() && !raw.slice(end, after).trim()
}

/** Drops what must not be read, keeping raw offsets: returns { text, map } with map[i] = raw offset of text[i]. */
export function normalizeSpeech(raw, { footnotes = true, skipHeaders = false, headerRanges } = {}) {
  raw = String(raw || '')
  const removed = new Uint8Array(raw.length)
  const remove = (from, to) => removed.fill(1, from, to)
  if (!footnotes) for (const pattern of FOOTNOTE_MARKERS) for (const m of raw.matchAll(pattern)) remove(m.index, m.index + m[0].length)
  if (skipHeaders) {
    if (headerRanges !== undefined) {
      // [] means the reader confirmed no headers; malformed supplied metadata
      // is also not permission to discard repeated genuine paragraphs.
      if (Array.isArray(headerRanges)) for (const range of headerRanges) if (validHeaderRange(raw, range)) remove(range.start, range.end)
    } else {
      const lines = [...raw.matchAll(/[^\n\u2029]+/g)].map(m => ({ from:m.index, to:m.index + m[0].length, key:m[0].trim().toLocaleLowerCase() }))
      const nearby = new Map()
      lines.forEach((line, i) => { if (line.key && line.key.length < 90) (nearby.get(line.key) || nearby.set(line.key, []).get(line.key)).push(i) })
      for (const places of nearby.values()) {
        for (let i = 0; i < places.length; i++) {
          if ((i > 0 && places[i] - places[i - 1] <= HEADER_WINDOW) || (i + 1 < places.length && places[i + 1] - places[i] <= HEADER_WINDOW)) remove(lines[places[i]].from, lines[places[i]].to)
        }
      }
    }
  }
  // "informa-\ntion": a line-end hyphen between letters is typesetting, not speech.
  for (const m of raw.matchAll(/(?<=\p{L})[-‐]\n(?=\p{Ll})/gu)) remove(m.index, m.index + 2)
  // Characters are collected in arrays: books are long and string surgery per break would be quadratic.
  const chars = [], map = [], breaks = []
  for (let i = 0; i < raw.length; i++) {
    if (removed[i]) continue
    const ch = raw[i]
    if (INVISIBLE.test(ch)) continue
    if (ch === HARD_BREAK) {
      // End of a heading, list item or table cell: it is its own sentence even without a full stop, so it is read and highlighted alone.
      if (chars.at(-1) === ' ') { chars.pop(); map.pop() }
      // Not after 'Dijo: "Voy."' either: a terminator followed by closing quotes/brackets already ends the sentence.
      let last = chars.length - 1
      while (last >= 0 && CLOSERS.test(chars[last])) last--
      if (chars.length && !TERMINATORS.test(chars[Math.max(last, 0)]) && !TERMINATORS.test(chars.at(-1))) { chars.push('.'); map.push(i) }
      if (chars.length) breaks.push(chars.length) // the space pushed below: a sentence ends here whatever the punctuation (so "A." and "B." cells are not initials)
    }
    if (/\s/.test(ch)) {
      if (chars.length && chars.at(-1) !== ' ') { chars.push(' '); map.push(i) }
    } else { chars.push(ch); map.push(i) }
  }
  if (chars.at(-1) === ' ') { chars.pop(); map.pop() }
  const text = chars.join('')
  return { text, map, breaks:breaks.filter(at => at < text.length) }
}

// A '.' after one of these is part of the word, never the end of a sentence ("Sr. Gómez", "pág. 12", "Fig. 3").
const ABBREVIATIONS = new Set(('sr sra sres sras srta srs dr dra drs lic ing arq prof profa pág págs pag pags núm num vol vols ed eds av avda pza gral cnel sto sta ud uds vd vds '
  + 'ee mr mrs ms mx messrs mt jr vs cf fig figs pp approx '
  + 'm mm mme mmes mlle mlles st ste env chap bd '
  + 'hr nr str bzw ggf '
  + 'sig sigg dott avv').split(' '))
// ...but these only when a number follows ("Jan. 3rd", "n.º 4").
const BEFORE_NUMBER = new Set('jan feb mar apr jun jul aug sep sept oct nov dec ene abr ago dic no nº n.º p'.split(' '))
const OPENERS = /[—–\-"'“‘«‹(\[]/
const CLOSING_QUOTES = '"\'”’»›)]}」』'
const RUN = /[.!?。！？…؟।॥]+/g
const isLower = ch => ch !== undefined && ch !== ch.toUpperCase() && ch === ch.toLowerCase()
const isUpper = ch => ch !== undefined && ch !== ch.toLowerCase()

/** Does the terminator run [runStart, runEnd) (closing quotes up to `end`) really end a sentence? The text before it starts at `from`. */
function endsSentence(text, from, runStart, runEnd, end) {
  if (end >= text.length) return true
  const run = text.slice(runStart, runEnd)
  const last = run.at(-1)
  let n = end
  while (n < text.length && /\s/.test(text[n])) n++
  if (n >= text.length) return true
  if (n === end) {
    // No space after it: "3.5", "U.S.A", "c.-à-d.", "example.com" stay whole; full-width and ?/! runs end the sentence.
    return /[。！？]/.test(last) || /[!?]/.test(run) || !/[\p{L}\p{N}-]/u.test(text[n])
  }
  let lead = n
  while (lead < text.length && OPENERS.test(text[lead])) lead++
  const next = text[lead]
  const word = /([\p{L}\p{N}]+)$/u.exec(text.slice(from, runStart))?.[1] || ''
  const lower = word.toLocaleLowerCase()
  if (isLower(next)) {
    // « Bonjour ! » dit-il, "—¿Vienes? —preguntó Luis", "nadie lo creyó... pero", "etc. y", "p. ej. sobre": the sentence goes on.
    if (end > runEnd || /[—–-]/.test(text[n]) || /\.{2,}|…/.test(run)) return false
    if (run === '.' && (word.length <= 2 || ABBREVIATIONS.has(lower) || lower === 'etc')) return false
  }
  if (run !== '.') return true
  if (ABBREVIATIONS.has(lower) && (word.length > 1 || lower === 'm')) return false
  if (BEFORE_NUMBER.has(lower) && /\p{N}/u.test(next || '')) return false
  // Initials ("J. R. R. Tolkien") and list numbers ("1." "a)") on their own.
  if (word.length === 1 && isUpper(word) && isUpper(next)) return false
  if (/^[(\[]?(?:\d{1,3}|[a-z]|[ivxlcdm]{1,6})[.)\]]*$/i.test(text.slice(from, end).trim())) return false
  return true
}

/** Raw end offsets of the sentences of `text`: terminators that really end one, plus the hard breaks (`breaks`: indexes of the space after a heading, cell or item). */
function sentenceEnds(text, breaks = []) {
  const candidates = [...breaks.map(at => ({ end:at, hard:true }))]
  for (const run of text.matchAll(RUN)) {
    const runEnd = run.index + run[0].length
    let end = runEnd
    for (;;) {
      if (CLOSING_QUOTES.includes(text[end] ?? '\0')) end++
      else if (text[end] === ' ' && /[»›]/.test(text[end + 1] || '')) end += 2 // French « … ! »
      else break
    }
    candidates.push({ end, runStart:run.index, runEnd })
  }
  candidates.sort((a, b) => a.end - b.end)
  const ends = []
  let from = 0
  for (const candidate of candidates) {
    if (candidate.end <= from) continue
    if (candidate.hard || endsSentence(text, from, candidate.runStart, candidate.runEnd, candidate.end)) { ends.push(candidate.end); from = candidate.end }
  }
  if (from < text.length) ends.push(text.length)
  return ends
}

const MAX_FRAGMENT = 180
const CLAUSE = /[,;:—–،、，；：]/

/** Cuts [from, to) into spoken fragments of at most MAX_FRAGMENT characters: evenly sized, at a clause mark when there is one near the middle, never an orphan word. */
function cutFragments(text, from, to) {
  const cuts = []
  let pos = from
  while (to - pos > MAX_FRAGMENT) {
    const ideal = Math.round((to - pos) / Math.ceil((to - pos) / MAX_FRAGMENT))
    let best = -1, bestScore = Infinity
    for (let at = pos + Math.ceil(ideal * .6); at <= Math.min(pos + MAX_FRAGMENT, to - 1); at++) {
      const space = /\s/.test(text[at]) && !/\s/.test(text[at - 1]), cjk = /[、，；：]/.test(text[at - 1]) && !/\s/.test(text[at])
      if (!space && !cjk) continue
      const score = Math.abs(at - pos - ideal) + (CLAUSE.test(text[at - 1]) ? 0 : ideal)
      if (score < bestScore) { best = at; bestScore = score }
    }
    const cut = best > 0 ? best : pos + MAX_FRAGMENT // text with no spaces at all: hard cut
    cuts.push([pos, cut])
    pos = cut
    while (pos < to && /\s/.test(text[pos])) pos++
  }
  cuts.push([pos, to])
  return cuts
}

/**
 * Sentences of an already normalised text; long ones also carry their <=180 character spoken fragments.
 * `breaks` are the places where a heading, list item or cell ends (normalizeSpeech reports them).
 * Evaluated against Intl.Segmenter: ICU does not know "Sr." or "J. K." either, glues "¡Imposible! —Hola —dijo Ana—." together and
 * splits « Bonjour ! » dit-il, so the splitter stays this one, with the abbreviation/initial/number rules above.
 */
export function speechSentences(text, breaks = []) {
  text = String(text)
  const sentences = []
  let from = 0
  for (const end of sentenceEnds(text, breaks)) {
    let start = from
    from = end
    while (start < end && /\s/.test(text[start])) start++
    let stop = end
    while (stop > start && /\s/.test(text[stop - 1])) stop--
    if (stop <= start) continue
    const fragments = cutFragments(text, start, stop).map(([a, b]) => ({ start:a, end:b, text:text.slice(a, b) }))
    sentences.push({ start, end:stop, fragments })
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
  const { text, map, breaks } = normalizeSpeech(raw, options)
  let low = 0, high = map.length
  while (low < high) { const mid = (low + high) >> 1; if (map[mid] < from) low = mid + 1; else high = mid }
  const rawRange = (start, end) => ({ start:map[low + start], end:map[low + end - 1] + 1 })
  const pageCuts = [...new Set((options.pageBreaks || []).filter(Number.isFinite).map(offset => {
    let a = low, b = map.length
    while (a < b) { const mid = (a + b) >>> 1; if (map[mid] < offset) a = mid + 1; else b = mid }
    return a - low
  }))].sort((a, b) => a - b)
  const items = []
  for (const sentence of speechSentences(text.slice(low), breaks.filter(at => at >= low).map(at => at - low))) {
    const whole = rawRange(sentence.start, sentence.end)
    for (const fragment of sentence.fragments) {
      const cuts = [fragment.start, ...pageCuts.filter(at => at > fragment.start && at < fragment.end), fragment.end]
      for (let index = 1; index < cuts.length; index++) {
        let start = cuts[index - 1], end = cuts[index]
        while (start < end && /\s/.test(text[low + start])) start++
        while (end > start && /\s/.test(text[low + end - 1])) end--
        if (end > start) items.push({ text:text.slice(low + start, low + end), ...rawRange(start, end), sentence:whole })
      }
    }
  }
  return items
}
