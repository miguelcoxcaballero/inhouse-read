// Hebrew Piper phonemization: Nakdimon restores niqqud, then the official Hebrew rules produce IPA.
// Ported from OHF-Voice/piper1-gpl at efffbfb226bfb511ebbcf55d0cecd8b35a89743d:
// src/piper/hebrew/{__init__,hebrew_ipa}.py and src/piper/phonemize_hebrew.py.
// The Nakdimon tables/merge are MIT, Copyright 2022 Elazar Gershuni; see public/neural-voice/hebrew-NOTICE.txt.
// The Piper IPA converter is distributed under Piper's GPL-3.0 licence (public/neural-voice/phon/COPYING).

const RAFE = '\u05BF', DAGESH = '\u05BC', SHIN_DOT = '\u05C1', SIN_DOT = '\u05C2'
const SHEVA = '\u05B0', HATAF_SEGOL = '\u05B1', HATAF_PATAH = '\u05B2', HATAF_QAMATS = '\u05B3'
const HIRIQ = '\u05B4', TSERE = '\u05B5', SEGOL = '\u05B6', PATAH = '\u05B7', QAMATS = '\u05B8'
const HOLAM = '\u05B9', QUBUTZ = '\u05BB', QAMATS_QATAN = '\u05C7'
const NIQQUD_PATTERN = /[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C7]/u
const TAAMIM_PATTERN = /[\u0591-\u05AF]/gu
const HEBREW_MARK = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/u
const PYTHON_WHITESPACE = /[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/u
const VOWEL_MARKS = new Set([SHEVA, HATAF_SEGOL, HATAF_PATAH, HATAF_QAMATS, HIRIQ, TSERE, SEGOL, PATAH, QAMATS, HOLAM, QUBUTZ, QAMATS_QATAN])
const HEBREW_LETTERS = Array.from({ length: 27 }, (_, index) => String.fromCodePoint(0x05D0 + index))
const VALID_LETTERS = [' ', '!', '"', "'", '(', ')', ',', '-', '.', ':', ';', '?', ...HEBREW_LETTERS]
const LETTER_CHARS = ['', 'H', 'O', '5', ...VALID_LETTERS]
const CHAR_TO_ID = new Map(LETTER_CHARS.map((letter, index) => [letter, index]))
// Keep the repeated patah and the mask at index 0: the trained N head has exactly 16 classes.
const NIQQUD_CHARS = ['', RAFE, ...Array.from({ length: 13 }, (_, index) => String.fromCodePoint(0x05B0 + index)), PATAH]
const DAGESH_CHARS = ['', RAFE, DAGESH], SIN_CHARS = ['', RAFE, SHIN_DOT, SIN_DOT]
const FINAL_FORMS = new Map(Array.from('ךםןףץ', (letter, index) => [letter, Array.from('כמנפצ')[index]]))
// Python str.isdigit includes these non-decimal digits as well as Unicode Nd characters.
const OTHER_DIGITS = /[\u00B2\u00B3\u00B9\u1369-\u1371\u19DA\u2070\u2074-\u2079\u2080-\u2089\u2460-\u2468\u2474-\u247C\u2488-\u2490\u24EA\u24F5-\u24FD\u24FF\u2776-\u277E\u2780-\u2788\u278A-\u2792\u{10A40}-\u{10A43}\u{10E60}-\u{10E68}\u{11052}-\u{1105A}\u{1F100}-\u{1F10A}]/u

/** The exact character alphabet used by the official Nakdimon ONNX model. */
export function normalizeNakdimonCharacter(letter) {
  if (VALID_LETTERS.includes(letter)) return letter // includes final forms; do not remap them first
  if (FINAL_FORMS.has(letter)) return FINAL_FORMS.get(letter)
  if (letter === '\n' || letter === '\t') return ' '
  if ('־‒–—―−'.includes(letter)) return '-'
  if (letter === '[') return '('
  if (letter === ']') return ')'
  if ('´‘’'.includes(letter)) return "'"
  if ('“”״'.includes(letter)) return '"'
  if (/\p{Decimal_Number}/u.test(letter) || OTHER_DIGITS.test(letter)) return '5'
  if (letter === '…') return ','
  if ('ײװױ'.includes(letter)) return 'H'
  return 'O'
}

export function nakdimonInputIds(text) {
  return Float32Array.from(Array.from(String(text).replace(new RegExp(NIQQUD_PATTERN.source, 'gu'), ''), letter => CHAR_TO_ID.get(normalizeNakdimonCharacter(letter))))
}

const canDagesh = letter => 'בגדהוזטיכלמנספצקשתךף'.includes(letter)
const canSin = letter => letter === 'ש'
const canNiqqud = letter => 'אבגדהוזחטיכלמנסעפצקרשתךן'.includes(letter)

function predictions(tensor, length, classes, name) {
  if (!tensor || tensor.type !== 'float32' || tensor.dims?.length !== 3 || tensor.dims[0] !== 1 || tensor.dims[1] !== length || tensor.dims[2] !== classes || tensor.data?.length !== length * classes) {
    throw new Error(`Nakdimon ${name}: invalid output shape or type`)
  }
  const selected = new Uint8Array(length)
  for (let index = 0; index < length; index++) {
    let best = 0, score = -Infinity
    for (let klass = 0; klass < classes; klass++) {
      const value = tensor.data[index * classes + klass]
      if (!Number.isFinite(value)) throw new Error(`Nakdimon ${name}: non-finite output`)
      if (value > score) { best = klass; score = value } // numpy.argmax chooses the first tie
    }
    selected[index] = best
  }
  return selected
}

/** Merge model predictions onto the ORIGINAL characters, in Nakdimon's dagesh/dot/vowel order. */
export function mergeNiqqud(letters, outputs) {
  const niqqud = predictions(outputs.N, letters.length, 16, 'N')
  const dagesh = predictions(outputs.D, letters.length, 3, 'D')
  const sin = predictions(outputs.S, letters.length, 4, 'S')
  const result = []
  for (let index = 0; index < letters.length; index++) {
    const letter = letters[index]
    result.push(letter)
    if (canDagesh(letter)) result.push(DAGESH_CHARS[dagesh[index]])
    if (canSin(letter)) result.push(SIN_CHARS[sin[index]])
    if (canNiqqud(letter)) result.push(NIQQUD_CHARS[niqqud[index]])
  }
  return result.join('').replaceAll(RAFE, '')
}

const has = (glyph, mark) => glyph.marks.includes(mark)
const hasVowels = glyph => glyph.marks.some(mark => VOWEL_MARKS.has(mark))
const segment = (onset, nucleus, dagesh = false) => ({ onset, nucleus, coda: [], dagesh })

function isCombiningMark(letter) {
  if (HEBREW_MARK.test(letter)) return true
  if (!/\p{M}/u.test(letter)) return false
  // Python unicodedata.combining checks the canonical class, not the Mark category (CGJ has class 0).
  // Canonical reordering past a class-1 or class-240 sentinel identifies every nonzero class.
  return (letter + '\u0334').normalize('NFD').startsWith('\u0334') || ('\u0345' + letter).normalize('NFD').startsWith(letter)
}

function glyphsOf(word) {
  const glyphs = []
  for (const letter of word.replace(TAAMIM_PATTERN, '').normalize('NFC')) {
    if (isCombiningMark(letter)) {
      if (glyphs.length) glyphs.at(-1).marks.push(letter)
    } else glyphs.push({ base: letter, marks: [] })
  }
  const digraphs = new Map([['ג׳', 'd͡ʒ'], ['ז׳', 'ʒ'], ['צ׳', 't͡ʃ']])
  const combined = []
  for (let index = 0; index < glyphs.length; index++) {
    const pair = glyphs[index].base + (glyphs[index + 1]?.base || '')
    if (digraphs.has(pair)) {
      combined.push({ base: `<IPA:${digraphs.get(pair)}>`, marks: [] })
      index++
    } else combined.push(glyphs[index])
  }
  return combined
}

function consonantOf(glyph, final) {
  const base = FINAL_FORMS.get(glyph.base) || glyph.base
  if (base === 'א' || base === 'ע') return '<GLT>'
  if (base === 'ה') return final && !has(glyph, DAGESH) ? '' : 'h'
  if (base === 'י') return 'j'
  if (base === 'ו') return 'v'
  if (base === 'ש') return has(glyph, SHIN_DOT) ? 'ʃ' : has(glyph, SIN_DOT) ? 's' : 'ʃ'
  if (base === 'ב') return has(glyph, DAGESH) ? 'b' : 'v'
  if (base === 'כ') return has(glyph, DAGESH) ? 'k' : 'χ'
  if (base === 'פ') return has(glyph, DAGESH) ? 'p' : 'f'
  return ({ ג: 'g', ד: 'd', ח: 'χ', ט: 't', ל: 'l', מ: 'm', נ: 'n', ס: 's', צ: 't͡s', ק: 'k', ר: 'ʁ', ת: 't', ז: 'z' })[base] || ''
}

function basicVowel(glyph) {
  for (const [mark, vowel] of [[QAMATS_QATAN, 'o'], [QUBUTZ, 'u'], [HIRIQ, 'i'], [TSERE, 'e'], [SEGOL, 'e'], [PATAH, 'a'], [QAMATS, 'a'], [HATAF_PATAH, 'a'], [HATAF_SEGOL, 'e'], [HATAF_QAMATS, 'o']]) {
    if (has(glyph, mark)) return [vowel, true]
  }
  return has(glyph, SHEVA) ? ['ə', false] : ['', false]
}

function wordSegments(word) {
  const glyphs = glyphsOf(word), segments = []
  let onset = []
  for (let index = 0; index < glyphs.length; index++) {
    const glyph = glyphs[index], next = glyphs[index + 1]
    if (glyph.base === 'ו' && has(glyph, DAGESH) && !hasVowels(glyph)) {
      segments.push(segment(onset, 'u')); onset = []
      continue
    }
    if (has(glyph, HIRIQ) && next?.base === 'י' && !hasVowels(next)) {
      const consonant = consonantOf(glyph, false)
      if (consonant && consonant !== '<GLT>') onset.push(consonant)
      segments.push(segment(onset, 'i')); onset = []; index++
      continue
    }
    if (glyph.base === 'ו' && has(glyph, HOLAM) && !has(glyph, DAGESH)) {
      segments.push(segment(onset, 'o')); onset = []
      continue
    }
    const consonant = consonantOf(glyph, index === glyphs.length - 1)
    const [vowel, vocalic] = basicVowel(glyph)
    if (vocalic) {
      if (consonant && consonant !== '<GLT>') onset.push(consonant)
      segments.push(segment(onset, vowel)); onset = []
    } else if (has(glyph, SHEVA)) {
      if (consonant && consonant !== '<GLT>') onset.push(consonant)
      segments.push(segment(onset, 'ə', has(glyph, DAGESH))); onset = []
    } else if (consonant === '<GLT>') onset.push('ʔ')
    else if (consonant) onset.push(consonant)
  }
  if (onset.length && segments.length) segments.at(-1).coda.push(...onset)
  return segments
}

function resolveSheva(segments) {
  let previousSilent = false
  for (let index = 0; index < segments.length; index++) {
    const current = segments[index]
    if (current.nucleus !== 'ə') { previousSilent = false; continue }
    if (index === 0 || (current.dagesh && index > 0) || previousSilent) {
      current.nucleus = 'e'; previousSilent = false
    } else {
      segments[index - 1].coda.push(...current.onset)
      current.onset = []; current.nucleus = ''; previousSilent = true
    }
  }
  const merged = []
  for (const current of segments) {
    if (!current.nucleus) {
      if (merged.length) merged.at(-1).coda.push(...current.onset)
      else merged.push(current)
    } else merged.push(current)
  }
  return merged
}

/** Rule-for-rule port of upstream hebrew_word_to_ipa, including its stress heuristic. */
export function hebrewWordToIpa(word) {
  const segments = resolveSheva(wordSegments(word))
  const stressed = segments.length === 2 && segments.at(-1).coda.length ? 0 : segments.length - 1
  return segments.map((current, index) => current.onset.join('') + (index === stressed ? 'ˈ' : '') + current.nucleus + current.coda.join('')).join('')
    .replace(/ʔ(?=[^aeiouəˈ]|$)/gu, '').replaceAll('͡', '')
}

export function hebrewToIpa(text) {
  return String(text).replace(TAAMIM_PATTERN, '').normalize('NFC').split(PYTHON_WHITESPACE).filter(Boolean).map(hebrewWordToIpa).join(' ')
}

/** IPA code points use the voice's table, not the fixed table in the espeak WASM program. */
export function phonemeIdsFromIpa(ipa, idMap) {
  if (!ipa) return []
  const ids = [...idMap['^'], ...idMap['_']]
  for (const phoneme of ipa) {
    if (!idMap[phoneme]) continue // upstream skips unknown phonemes
    ids.push(...idMap[phoneme], ...idMap['_'])
  }
  ids.push(...idMap['$'])
  return ids
}

const disposeTensors = tensors => {
  for (const tensor of new Set(tensors)) { try { tensor?.dispose?.() } catch { /* continue releasing the other tensors */ } }
}

/** Cached Nakdimon bytes are passed from the page; this module never downloads during reading. */
export async function createHebrewPhonemizer({ ort, model, config }) {
  if (!(model instanceof ArrayBuffer) || !model.byteLength) throw new Error('Hebrew phonemizer model is not available')
  const idMap = config?.phoneme_id_map
  if (!['_', '^', '$'].every(mark => Array.isArray(idMap?.[mark]) && idMap[mark].length)) throw new Error('Hebrew phoneme id map is not available')
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false })
  if (!session.inputNames?.length || !['N', 'D', 'S'].every(name => session.outputNames?.includes(name))) {
    await session.release().catch(() => {})
    throw new Error('Nakdimon session has invalid inputs or outputs')
  }
  let chain = Promise.resolve(), destroyed = false, destruction = null
  const phonemize = async text => {
    if (destroyed) throw new Error('Hebrew phonemizer was released')
    text = String(text || '')
    if (!NIQQUD_PATTERN.test(text) && text) {
      const letters = Array.from(text)
      const input = new ort.Tensor('float32', nakdimonInputIds(text), [1, letters.length])
      let outputs
      try {
        outputs = await session.run({ [session.inputNames[0]]: input })
        if (destroyed) throw new Error('Hebrew phonemizer was released')
        text = mergeNiqqud(letters, outputs)
      } finally { disposeTensors([input, ...Object.values(outputs || {})]) }
    }
    return phonemeIdsFromIpa(hebrewToIpa(text), idMap)
  }
  return {
    phonemize(text) {
      const job = chain.then(() => phonemize(text))
      chain = job.catch(() => {})
      return job
    },
    destroy() {
      destroyed = true
      return destruction ||= chain.then(() => session.release())
    }
  }
}
