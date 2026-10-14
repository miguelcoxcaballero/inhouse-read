import { SUPERTONIC_ASSETS, SUPERTONIC_LEGACY_ASSETS, supertonicBase, supertonicAssetUrl, SUPERTONIC_REVISION } from './supertonic-catalog.js';
import { readerUI as ui } from '../rust-ui-required.js';

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
