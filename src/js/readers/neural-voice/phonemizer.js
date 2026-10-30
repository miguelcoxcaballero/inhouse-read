// Text -> Piper phoneme ids, with the piper_phonemize WebAssembly build (the piper-phonemize C++ program compiled with
// Emscripten; it embeds espeak-ng). The glue (piper_phonemize.mjs), the wasm and the trimmed espeak-ng data live in
// public/neural-voice/phon/ (see the README there). This is a small wrapper over that Emscripten module: it runs inside the
// synthesis worker and nothing here touches the DOM.
//
// One Emscripten module has a fixed 17 MB heap that every callMain() erodes (it is a command-line program run again and
// again, and it never gives everything back): after ~75-155 calls (fewer for longer texts) it fails for good and, called
// on, takes the whole renderer down. So the module is replaced by a fresh one every REBUILD_EVERY calls (well under the
// 74-call minimum measured with 180-character fragments; building one takes ~100 ms) and when a call throws, in which case
// that text is tried once more on the fresh module.

// The rebuilds, the retry, the dictionaries and the reading of the output are the voice module (rust-ui/src/
// voice_phonemizer.rs over rust-core/src/phonemizer_runtime.rs); this file keeps the Emscripten factory and its print hooks,
// the dictionary download and its AbortController, and the chain that runs one text at a time.
import { fetchDictionary, dictionaryUrl } from './dictionary-cache.js'
import { loadPhonemizerFactory } from './phonemizer-assets.js'
import { loadedRustVoiceUI, requireRustVoiceUI } from '../../rust-voice-ui.js'

/**
 * espeak-ng dictionaries that are NOT inside piper_phonemize.data (the languages added after the first seven: ru alone is 8 MB):
 * each one is a file of its own, dict/<name>_dict next to the data, fetched the first time a voice of that language speaks.
 * The list is the one of scripts/trim-espeak-data.mjs.
 */
export const EXTRA_DICTIONARIES = ['nl', 'pl', 'ru', 'uk', 'tr', 'sv', 'da', 'no', 'fi', 'cs', 'el', 'hu', 'ro', 'ar', 'cmn', 'vi', 'bg', 'sr', 'hi']
/** 'ru' -> 'ru', 'nb' -> 'no', 'es-419' -> '' (that one is in the data pack); '' when no separate dictionary is needed. */
export const extraDictionaryOf = espeakVoice => loadedRustVoiceUI().voice_phonemizer_dictionary_of(espeakVoice, EXTRA_DICTIONARIES)

/** Calls after which the module is replaced (measured: the worst case, 180-character texts, breaks at 74). */
export const REBUILD_EVERY = 40
// Keep the filesystem API, file table and data pack from the same revision in Android's HTTP cache.
export const PHONEMIZER_REVISION = '20261002-dictionaries'

/**
 * @param {{base:string, importModule?:(url:string)=>Promise<{default:Function}>, rebuildEvery?:number}} options
 *   base: absolute URL (ending in '/') of the folder holding piper_phonemize.{mjs,wasm,data}.
 * @returns {Promise<{phonemize:(text:string, espeakVoice:string)=>Promise<number[]>, destroy:()=>void}>}
 */
export async function createPhonemizer({ base, importModule = loadPhonemizerFactory, rebuildEvery = REBUILD_EVERY, fetchFile }) {
  const assetUrl = name => `${base}${name}?v=${PHONEMIZER_REVISION}`
  const [{ default: factory }, voice] = await Promise.all([importModule(assetUrl('piper_phonemize.mjs')), requireRustVoiceUI()])
  const downloads = new AbortController()
  const phon = new voice.VoicePhonemizer(Number(rebuildEvery), {
    // The program prints one JSON object per call; only the current module is heard. The glue asks for
    // 'piper_phonemize.wasm' and 'piper_phonemize.data': both come from our own folder (never a CDN).
    create: token => factory({ print: text => phon.print(token, text), printErr: text => phon.print_error(token, text), locateFile: assetUrl }),
    fetch: name => { const url = dictionaryUrl(base, name); return fetchFile ? fetchFile(url) : fetchDictionary(url, { signal:downloads.signal }) },
    abort: () => downloads.abort()
  }, EXTRA_DICTIONARIES)
  await phon.start()
  let chain = Promise.resolve()
  return {
    /** Same espeak program/IDs. Serial host scheduling prevents overlapping callers from rebuilding each other's heap. */
    phonemize(text, espeakVoice) {
      const job = chain.then(() => phon.phonemize(text, espeakVoice))
      chain = job.catch(() => {})
      return job
    },
    destroy() { phon.destroy() }
  }
}
