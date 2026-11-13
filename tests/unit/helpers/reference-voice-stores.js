// Frozen from 8d9ae0a1 (after 1.7.326): the Piper and Supertonic voice stores while every member was its own JavaScript method calling
// one rust-ui export. Tests only: voice-store-methods.test.js compares the classes whose members are now answered by the
// rust-ui dispatcher (store_methods.rs) with these, member by member, over the same fake browser services.
import { DEFAULT_VOICE_BASE, neuralVoiceBase, piperVoices } from '../../../src/js/readers/neural-voice/catalog.js'
import { SUPERTONIC_ASSETS, SUPERTONIC_LEGACY_ASSETS, supertonicBase, supertonicAssetUrl, SUPERTONIC_REVISION } from '../../../src/js/readers/neural-voice/supertonic-catalog.js'
import { readerUI as ui } from '../../../src/js/readers/rust-ui-required.js'
// Downloaded voices live in Cache Storage ('inhouse-neural-voices-v1'), keyed by the very URL they were fetched from:
// the model (.onnx, ~63 MB) and its config (.onnx.json). The model is written LAST, so "model present" means "voice
// complete"; an interrupted download leaves nothing usable behind (and nothing half-written: Cache.put is atomic).
//
// The download is streamed with progress and is abortable. On flaky mobile data it survives dropped connections: the
// bytes received so far are kept in memory and the transfer continues with a Range request (If-Range with the ETag, so a
// file replaced upstream is never glued together); a server that ignores Range, or a Range request that fails before a
// single byte arrives (CORS, proxies), makes it start again cleanly instead. Sizes are checked against Content-Length and,
// when it can be reached, against the catalogue (voices.json) of the voice repository. A connection that goes silent without
// closing (a phone changing network) is given up on after `stallMs` without a byte and takes the same resume path.
// The download, the listing and the reads are rust-ui (voice_store.rs); this class keeps the injected browser services.

const CACHE_NAME = 'inhouse-neural-voices-v1'

/** URLs of the two files of a voice and of the catalogue that lists their sizes (rust-ui voice_urls.rs). */
const voiceUrls = (piperId, base = neuralVoiceBase()) => ui().catalog_voice_urls(piperId, base, DEFAULT_VOICE_BASE)

/** Error with a `code` the UI maps to Spanish copy: 'offline' | 'http' | 'storage' | 'aborted'. */
const storeError = (code, message, cause) => ui().store_error(code, message, cause)

const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(storeError('aborted', 'aborted')); return }
  const cleanup = () => signal?.removeEventListener('abort', onAbort)
  const onAbort = () => { clearTimeout(timer); cleanup(); reject(storeError('aborted', 'aborted')) }
  const timer = setTimeout(() => { cleanup(); resolve() }, ms)
  signal?.addEventListener('abort', onAbort, { once: true })
})

export class LegacyVoiceStore {
  /**
   * Everything the browser provides is injectable so the logic can be tested without a network or a real cache.
   * @param {{caches?:CacheStorage, fetch?:typeof fetch, base?:()=>string, storage?:StorageManager, sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>, maxRetries?:number, online?:()=>boolean, stallMs?:number}} deps
   */
  constructor({ caches = globalThis.caches, fetch = globalThis.fetch?.bind(globalThis), base = () => neuralVoiceBase(), dictionaryBase = () => new URL(`${'/'}neural-voice/phon/`, globalThis.location?.href || 'http://localhost/').href, storage = globalThis.navigator?.storage, sleep = defaultSleep, maxRetries = 4, online = () => globalThis.navigator?.onLine !== false, stallMs = 20_000 } = {}) {
    Object.assign(this, { caches, fetchFn: fetch, baseFn: base, dictionaryBase, storage, sleep, maxRetries, online, stallMs })
  }

  get supported() { return !!this.caches && typeof this.fetchFn === 'function' }
  urls(piperId) { return voiceUrls(piperId, this.baseFn()) }
  /** piperIds whose model AND config are both stored. */
  list() { return ui().store_list(this, piperVoices) }
  has(piperId) { return ui().store_has(this, piperId) }
  /** The voice's .onnx.json, parsed. */
  readConfig(piperId) { return ui().store_read_config(this, piperId) }
  /** The model bytes (a fresh ArrayBuffer each time, so it can be transferred to the worker). */
  readModel(piperId) { return ui().store_read_model(this, piperId) }
  /** The Hebrew pointing model is installed with the voice and never fetched during playback. */
  readPhonemizerModel(piperId) { return ui().store_read_phonemizer(this, piperId) }
  remove(piperId) { return ui().store_remove(this, piperId) }
  /** Asks the browser not to evict the voices under storage pressure. Best effort, never throws. */
  persist() { return ui().store_persist(this) }
  /** Size the repository's catalogue promises for the model, or 0 when unknown (offline mirror, slow, or not listed). */
  expectedSize(piperId, signal) { return ui().store_expected_size(this, piperId, signal) }
  /**
   * Downloads a voice into the cache. `onProgress({received,total,fraction})` is called as bytes arrive (total is 0
   * while unknown). Resolves with {bytes}. Rejects with an Error whose `code` is 'offline' | 'http' | 'storage' | 'aborted'.
   */
  download(piperId, options) { return ui().store_download(this, piperId, options) }
}

const SUPERTONIC_CACHE = 'inhouse-supertonic3-v1';

/** One immutable pack for all languages/styles. Streams each file into Cache Storage, verifies it, and writes the
 * completion marker last. Interrupted downloads can reuse complete verified files, but never appear installed.
 * The verification, the download and the reads are rust-ui (supertonic_store.rs); this class keeps the injected services and the running job. */
export class LegacySupertonicStore {
  constructor({caches=globalThis.caches,fetch=globalThis.fetch?.bind(globalThis),storage=globalThis.navigator?.storage,
    crypto=globalThis.crypto,base=supertonicBase(),assets=SUPERTONIC_ASSETS,
    legacyAssets=assets===SUPERTONIC_ASSETS?SUPERTONIC_LEGACY_ASSETS:[],stallMs=20000}={}) {
    Object.assign(this,{caches,fetchFn:fetch,storage,crypto,base,assets,legacyAssets,stallMs});
    this.marker=base+'.inhouse-complete.json';this.manifest=ui().supertonic_manifest(assets,base);this.job=null;this.generation=0;this.controller=null;
  }
  cache() { return ui().supertonic_cache(this); }
  committedAssets() { return ui().supertonic_committed(this,SUPERTONIC_REVISION); }
  installed() { return ui().supertonic_installed(this,SUPERTONIC_REVISION); }
  availableStyles() { return ui().supertonic_styles(this,SUPERTONIC_REVISION); }
  install({signal,onProgress=()=>{}}={}) {
    if(this.job)return this.job;
    const controller=new AbortController(),generation=this.generation;
    this.controller=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const promise=ui().supertonic_install(this,controller,generation,signal,onProgress,SUPERTONIC_REVISION,supertonicAssetUrl)
      .finally(()=>{signal?.removeEventListener('abort',abort);if(this.job===promise){this.job=null;this.controller=null;}});
    this.job=promise;return promise;
  }
  readAssets() { return ui().supertonic_read_assets(this,SUPERTONIC_REVISION); }
  readConfig() { return ui().supertonic_read_config(this,SUPERTONIC_REVISION); }
  remove() { return ui().supertonic_remove(this); }
}
