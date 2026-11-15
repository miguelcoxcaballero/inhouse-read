// Downloaded Piper voices live in Cache Storage, keyed by the URL they were fetched from. The download (streamed,
// abortable, resumed with a Range request), the listing and the reads are rust-ui (voice_store.rs, which documents
// them, answered by store_methods.rs), and so are what the constructor builds and the pause between two attempts
// (store_shells.rs).
import { DEFAULT_VOICE_BASE, neuralVoiceBase, piperVoices } from './catalog.js'
import { readerUI as ui, rustMethods } from '../rust-ui-required.js'

export const CACHE_NAME = 'inhouse-neural-voices-v1'

/** URLs of the two files of a voice and of the catalogue that lists their sizes (rust-ui voice_urls.rs). */
export const voiceUrls = (piperId, base = neuralVoiceBase()) => ui().catalog_voice_urls(piperId, base, DEFAULT_VOICE_BASE)

/** Error with a `code` the UI maps to Spanish copy: 'offline' | 'http' | 'storage' | 'aborted'. */
export const storeError = (code, message, cause) => ui().store_error(code, message, cause)

// The defaults of a store that need this page: the voice repository and the folder of the phonemizer's dictionaries.
const defaults = { base: () => neuralVoiceBase(),
  dictionaryBase: () => new URL(`${import.meta.env?.BASE_URL || '/'}neural-voice/phon/`, globalThis.location?.href || 'http://localhost/').href }

export class VoiceStore {
  /**
   * Everything the browser provides is injectable so the logic can be tested without a network or a real cache.
   * @param {{caches?:CacheStorage, fetch?:typeof fetch, base?:()=>string, storage?:StorageManager, sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>, maxRetries?:number, online?:()=>boolean, stallMs?:number}} deps
   */
  constructor(deps) { ui().voice_store_construct(this, deps, defaults) }

  get supported() { return !!this.caches && typeof this.fetchFn === 'function' }
  urls(piperId) { return voiceUrls(piperId, this.baseFn()) }
}
// list, has, the reads, remove, persist, expectedSize(piperId, signal) and download(piperId, {signal, onProgress}), which
// rejects with an Error whose `code` is 'offline' | 'http' | 'storage' | 'aborted': documented in voice_store.rs.
rustMethods(VoiceStore, 'store_method', 'list has readConfig readModel readPhonemizerModel remove persist expectedSize download',
  { part:'piper', voices:piperVoices })
