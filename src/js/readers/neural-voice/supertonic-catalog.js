// Supertone Supertonic 3. Model: OpenRAIL-M; SDK inference recipe: MIT.
// The immutable upstream revision, the file sizes and SHA-256 digests, the languages, the profiles and the names they are
// shown with are tables of the app core (rust-core/src/supertonic_catalog.rs and voice_catalogue.rs), handed over once as
// the voice catalogue and awaited like the core itself. This file keeps the page's mirror override and the frozen shapes
// the store and the picker read.
import { getRustCore, loadRustCore } from '../../rust-core.js';
import { readTables, requireCore } from '../../core-tables.js';

/** The whole voice catalogue of the app core: Piper (neural-voice/catalog.js) and Supertonic. */
export const VOICE_CATALOGUE = readTables(await requireCore(getRustCore, loadRustCore, 'voice_catalogue_json'), 'voice_catalogue_json');
const tables = VOICE_CATALOGUE.supertonic;
export const SUPERTONIC_MODEL_ID = tables.modelId;
export const SUPERTONIC_REVISION = tables.revision;
export const SUPERTONIC_BASE = tables.base;
// Only the vector estimator is quantized; this derivative retains OpenRAIL-M.
export const SUPERTONIC_QUANT_REVISION = tables.quantRevision;
export const SUPERTONIC_VECTOR_URL = tables.vectorUrl;
const trustedOverride = value => {
  try { const url=new URL(value);return url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)) ? url.href.replace(/\/?$/,'/') : ''; }
  catch { return ''; }
};
// Capture before any imported book can alter the page's global configuration.
const overrideAtLoad=trustedOverride(globalThis.INHOUSE_SUPERTONIC_BASE);
export const supertonicBase = () => overrideAtLoad || SUPERTONIC_BASE;
// The local fixture mirror keeps logical paths; production assets may come
// from different immutable upstream revisions (for example a quantized graph).
export const supertonicAssetUrl = (asset,base=supertonicBase()) => base!==SUPERTONIC_BASE ? base+asset.path : (asset.url||base+asset.path);
export const SUPERTONIC_ASSETS = Object.freeze(tables.assets.map(Object.freeze));
export const SUPERTONIC_BYTES = tables.bytes;
export const SUPERTONIC_LANGUAGES = Object.freeze(tables.languages);
export const SUPERTONIC_LEGACY_STYLES = Object.freeze(tables.legacyStyles);
export const SUPERTONIC_STYLES = Object.freeze(tables.styles);
// Exact previous manifest; only this complete, verified pack can migrate offline.
export const SUPERTONIC_LEGACY_ASSETS = Object.freeze(tables.legacyAssets.map(index => SUPERTONIC_ASSETS[index]));
export const SUPERTONIC_LICENSE = Object.freeze(tables.license);
export const isSupertonicVoiceId = id => typeof id === 'string' && /^supertonic3:([FM][1-5]):[a-z]{2}$/.test(id);
// Each profile (F1-F5 women, M1-M5 men) is shown with a name of its language and the standard accent of that language.
for (const names of Object.values(tables.names)) Object.freeze(names);
export const SUPERTONIC_VOICE_NAMES = Object.freeze(tables.names);
/** 'Lucía' for es F1, 'Javier' for es M1; the profile itself when unknown. */
export function supertonicVoiceName(lang, style) {
  const names = SUPERTONIC_VOICE_NAMES[lang], index = Number(String(style).slice(1)) - 1;
  return names?.[String(style)[0]]?.[index] || `Supertonic ${style}`;
}
// The core lists every profile of every language as [id, lang, dialect, style, name]; `head` and `tail` are the fields
// every profile of the one shared pack has before and after its own.
const {head,tail}=tables.voice;
export function supertonicVoicesFor(languages) {
  const unique=[...new Set(languages.map(lang => String(lang).split(/[-_]/)[0]))];
  return unique.flatMap(lang => tables.voices.filter(row => row[1] === lang).map(([id,lang,dialect,style,name]) => ({id,...head,lang,dialect,style,name,...tail})));
}
