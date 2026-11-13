import { SUPERTONIC_ASSETS, SUPERTONIC_LEGACY_ASSETS, supertonicBase, supertonicAssetUrl, SUPERTONIC_REVISION } from './supertonic-catalog.js';
import { readerUI as ui, rustMethods } from '../rust-ui-required.js';

export const SUPERTONIC_CACHE = 'inhouse-supertonic3-v1';

/** One immutable pack for all languages/styles. Streams each file into Cache Storage, verifies it, and writes the
 * completion marker last. Interrupted downloads can reuse complete verified files, but never appear installed.
 * The verification, the download and the reads are rust-ui (supertonic_store.rs); this class keeps the injected services and the running job. */
export class SupertonicStore {
  constructor({caches=globalThis.caches,fetch=globalThis.fetch?.bind(globalThis),storage=globalThis.navigator?.storage,
    crypto=globalThis.crypto,base=supertonicBase(),assets=SUPERTONIC_ASSETS,
    legacyAssets=assets===SUPERTONIC_ASSETS?SUPERTONIC_LEGACY_ASSETS:[],stallMs=20000}={}) {
    Object.assign(this,{caches,fetchFn:fetch,storage,crypto,base,assets,legacyAssets,stallMs});
    this.marker=base+'.inhouse-complete.json';this.manifest=ui().supertonic_manifest(assets,base);this.job=null;this.generation=0;this.controller=null;
  }
  install({signal,onProgress=()=>{}}={}) {
    if(this.job)return this.job;
    const controller=new AbortController(),generation=this.generation;
    this.controller=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const promise=ui().supertonic_install(this,controller,generation,signal,onProgress,SUPERTONIC_REVISION,supertonicAssetUrl)
      .finally(()=>{signal?.removeEventListener('abort',abort);if(this.job===promise){this.job=null;this.controller=null;}});
    this.job=promise;return promise;
  }
}
rustMethods(SupertonicStore,'store_method','cache committedAssets installed availableStyles readAssets readConfig remove',{part:'supertonic',revision:SUPERTONIC_REVISION});
