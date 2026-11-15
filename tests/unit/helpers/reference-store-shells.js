// FROZEN copies of what moved to rust-ui store_shells.rs and neural_player.rs `gapless_construct`: the constructor and
// the default retry pause of VoiceStore (src/js/readers/neural-voice/store.js), the constructor and install() of
// SupertonicStore (supertonic-store.js) and the constructor of GaplessPlayer (player.js), as they were. `ui` (it was the
// module import) and the names those files imported (`modules`) are passed in; nothing else differs. They are the
// reference of store-shells.test.js: do not edit them to follow production.
export const referenceDefaultSleep = ui => (ms, signal) => new Promise((resolve, reject) => {
  const storeError = (code, message, cause) => ui.store_error(code, message, cause)
  if (signal?.aborted) { reject(storeError('aborted', 'aborted')); return }
  const cleanup = () => signal?.removeEventListener('abort', onAbort)
  const onAbort = () => { clearTimeout(timer); cleanup(); reject(storeError('aborted', 'aborted')) }
  const timer = setTimeout(() => { cleanup(); resolve() }, ms)
  signal?.addEventListener('abort', onAbort, { once: true })
})

export function referenceVoiceStoreConstruct({ neuralVoiceBase, defaultSleep }, { caches = globalThis.caches, fetch = globalThis.fetch?.bind(globalThis), base = () => neuralVoiceBase(), dictionaryBase = () => new URL(`${import.meta.env?.BASE_URL || '/'}neural-voice/phon/`, globalThis.location?.href || 'http://localhost/').href, storage = globalThis.navigator?.storage, sleep = defaultSleep, maxRetries = 4, online = () => globalThis.navigator?.onLine !== false, stallMs = 20_000 } = {}) {
    Object.assign(this, { caches, fetchFn: fetch, baseFn: base, dictionaryBase, storage, sleep, maxRetries, online, stallMs })
  }

export function referenceSupertonicConstruct(ui, { SUPERTONIC_ASSETS, SUPERTONIC_LEGACY_ASSETS, supertonicBase }, {caches=globalThis.caches,fetch=globalThis.fetch?.bind(globalThis),storage=globalThis.navigator?.storage,
    crypto=globalThis.crypto,base=supertonicBase(),assets=SUPERTONIC_ASSETS,
    legacyAssets=assets===SUPERTONIC_ASSETS?SUPERTONIC_LEGACY_ASSETS:[],stallMs=20000}={}) {
    Object.assign(this,{caches,fetchFn:fetch,storage,crypto,base,assets,legacyAssets,stallMs});
    this.marker=base+'.inhouse-complete.json';this.manifest=ui.supertonic_manifest(assets,base);this.job=null;this.generation=0;this.controller=null;
  }
export function referenceSupertonicInstall(ui, { SUPERTONIC_REVISION, supertonicAssetUrl }, {signal,onProgress=()=>{}}={}) {
    if(this.job)return this.job;
    const controller=new AbortController(),generation=this.generation;
    this.controller=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const promise=ui.supertonic_install(this,controller,generation,signal,onProgress,SUPERTONIC_REVISION,supertonicAssetUrl)
      .finally(()=>{signal?.removeEventListener('abort',abort);if(this.job===promise){this.job=null;this.controller=null;}});
    this.job=promise;return promise;
  }

export function referenceGaplessConstruct({ context, onStart = () => {}, onEnd = () => {}, onMark = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    Object.assign(this, { getContext: context, onStart, onEnd, onMark, setTimer, clearTimer })
    this.units = new Map()   // unit -> { sources:[{source,start,end}], start, end, complete, started, ended, timers:Set }
    this.nextTime = 0        // audio-clock end of everything scheduled
    this.scheduled = false   // something was scheduled since the last stopAll()
  }
