import { SUPERTONIC_ASSETS, SUPERTONIC_LEGACY_ASSETS, supertonicBase, supertonicAssetUrl, SUPERTONIC_REVISION } from './supertonic-catalog.js';
import { readerUI as ui, rustMethods } from '../rust-ui-required.js';

export const SUPERTONIC_CACHE = 'inhouse-supertonic3-v1';

/** One immutable pack for all languages/styles. Streams each file into Cache Storage, verifies it, and writes the
 * completion marker last. Interrupted downloads can reuse complete verified files, but never appear installed.
 * The verification, the download and the reads are rust-ui (supertonic_store.rs), what the constructor builds and the one install job
 * store_shells.rs; `kit` is what they need of this page's modules. */
const kit={base:supertonicBase,assets:SUPERTONIC_ASSETS,legacyAssets:SUPERTONIC_LEGACY_ASSETS,revision:SUPERTONIC_REVISION,url:supertonicAssetUrl,noop(){}};
export class SupertonicStore {
  constructor(deps) { ui().supertonic_store_construct(this,deps,kit) }
  install(options) { return ui().supertonic_store_install(this,options,kit) }
}
rustMethods(SupertonicStore,'store_method','cache committedAssets installed availableStyles readAssets readConfig remove',{part:'supertonic',revision:SUPERTONIC_REVISION});
