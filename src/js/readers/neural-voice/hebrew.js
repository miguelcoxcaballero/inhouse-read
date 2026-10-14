// Hebrew Piper phonemization: Nakdimon restores niqqud, then the official Hebrew rules produce IPA.
// Ported from OHF-Voice/piper1-gpl at efffbfb226bfb511ebbcf55d0cecd8b35a89743d:
// src/piper/hebrew/{__init__,hebrew_ipa}.py and src/piper/phonemize_hebrew.py.
// The Nakdimon tables/merge are MIT, Copyright 2022 Elazar Gershuni; see public/neural-voice/hebrew-NOTICE.txt.
// The Piper IPA converter is distributed under Piper's GPL-3.0 licence (public/neural-voice/phon/COPYING).
//
// The rules (syllables, consonants, vowels, sheva, stress), the Nakdimon alphabet and the merge of the model's predictions
// are Rust (rust-core/src/hebrew.rs, the voice core). What stays here is the browser's: Unicode normalisation and
// canonical combining classes, the ONNX session and the voice's phoneme-id table. tests/unit/helpers/reference-hebrew.js
// is the frozen JavaScript implementation the Rust one is compared with.
import { loadedRustVoiceCore } from '../../rust-voice-core.js'
import { layout, textOf, withArena } from './core-call.js'

const NIQQUD_PATTERN = /[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C7]/u
const TAAMIM_PATTERN = /[\u0591-\u05AF]/gu
const HEBREW_MARK = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/u
const PYTHON_WHITESPACE = /[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/u
// The marks the rules look at, one bit each (rust-core/src/hebrew.rs): 05B0..05BC, rafe, shin dot, sin dot, qamats qatan.
const MARK_BITS = new Map(Array.from({ length: 13 }, (_, i) => [0x5b0 + i, 1 << i]).concat([[0x5bf, 1 << 13], [0x5c1, 1 << 14], [0x5c2, 1 << 15], [0x5c7, 1 << 16]]))
const WORD_BREAK = 0xfffffffe
const DECIMAL_NUMBER = /\p{Decimal_Number}/u

function isCombiningMark(letter) {
  if (HEBREW_MARK.test(letter)) return true
  if (!/\p{M}/u.test(letter)) return false
  // Python unicodedata.combining checks the canonical class, not the Mark category (CGJ has class 0).
  // Canonical reordering past a class-1 or class-240 sentinel identifies every nonzero class.
  return (letter + '\u0334').normalize('NFD').startsWith('\u0334') || ('\u0345' + letter).normalize('NFD').startsWith(letter)
}

/** The IPA of a Hebrew text with niqqud: words joined by a space, as upstream does. */
export function hebrewToIpa(text) {
  const words = String(text).replace(TAAMIM_PATTERN, '').normalize('NFC').split(PYTHON_WHITESPACE).filter(Boolean)
  // One packet per fragment: (base code point, mark bits) per glyph, a break between words.
  const packet = []
  words.forEach((word, index) => {
    if (index) packet.push(WORD_BREAK, 0)
    let open = false
    for (const letter of word.replace(TAAMIM_PATTERN, '').normalize('NFC')) {
      const code = letter.codePointAt(0)
      if (!isCombiningMark(letter)) { packet.push(code, 0); open = true } // a mark before any letter of the word belongs to nothing
      else if (open) packet[packet.length - 1] |= MARK_BITS.get(code) || 0
    }
  })
  const pairs = packet.length / 2
  if (!pairs) return ''
  const core = loadedRustVoiceCore(), capacity = pairs * 8
  return withArena(core, Math.ceil((packet.length + capacity) / 2), pointer => {
    new Uint32Array(core.memory.buffer, pointer, packet.length).set(packet)
    const output = pointer + packet.length * 4, count = core.hebrew_ipa_words(pointer, pairs, output, capacity)
    if (count < 0) throw new Error('Hebrew IPA: the text is too long')
    return textOf(new Uint32Array(core.memory.buffer, output, count))
  })
}

/** The ids of the characters of the official Nakdimon alphabet (any niqqud already in the text is ignored). */
export function nakdimonInputIds(text) {
  const letters = Array.from(String(text)), count = letters.length
  if (!count) return new Float32Array(0)
  const core = loadedRustVoiceCore(), { at, cells } = layout(count * 4, count, count * 4)
  return withArena(core, cells, pointer => {
    const codes = new Uint32Array(core.memory.buffer, pointer + at[0], count), decimal = new Uint8Array(core.memory.buffer, pointer + at[1], count)
    letters.forEach((letter, i) => { codes[i] = letter.codePointAt(0); decimal[i] = DECIMAL_NUMBER.test(letter) ? 1 : 0 })
    const written = core.nakdimon_ids(pointer + at[0], pointer + at[1], count, pointer + at[2])
    if (written < 0) throw new Error('Nakdimon: invalid call')
    return new Float32Array(core.memory.buffer, pointer + at[2], written).slice()
  })
}

/** Merge model predictions onto the ORIGINAL characters, in Nakdimon's dagesh/dot/vowel order. */
export function mergeNiqqud(letters, outputs) {
  const core = loadedRustVoiceCore(), count = letters.length
  const { at, cells } = layout(count * 4, count * 16, count, count, count, count * 16 * 4)
  return withArena(core, cells, pointer => {
    const codes = new Uint32Array(core.memory.buffer, pointer + at[0], count)
    letters.forEach((letter, i) => { codes[i] = letter.codePointAt(0) })
    // N (16 niqqud classes), D (dagesh), S (shin/sin dot): each checked, then reduced to its best class, in this order.
    for (const [name, classes, where] of [['N', 16, at[2]], ['D', 3, at[3]], ['S', 4, at[4]]]) {
      const tensor = outputs[name]
      if (!tensor || tensor.type !== 'float32' || tensor.dims?.length !== 3 || tensor.dims[0] !== 1 || tensor.dims[1] !== count || tensor.dims[2] !== classes || tensor.data?.length !== count * classes) {
        throw new Error(`Nakdimon ${name}: invalid output shape or type`)
      }
      new Float32Array(core.memory.buffer, pointer + at[5], count * classes).set(tensor.data)
      const status = core.nakdimon_argmax(pointer + at[5], count, classes, pointer + where)
      if (status !== 1) throw new Error(`Nakdimon ${name}: ${status === 0 ? 'non-finite output' : 'invalid call'}`)
    }
    const written = core.nakdimon_assemble(pointer + at[0], count, pointer + at[2], pointer + at[3], pointer + at[4], pointer + at[1])
    if (written < 0) throw new Error('Nakdimon: invalid call')
    return textOf(new Uint32Array(core.memory.buffer, pointer + at[1], written))
  })
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
