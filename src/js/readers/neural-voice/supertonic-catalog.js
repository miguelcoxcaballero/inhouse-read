// Supertone Supertonic 3. Model: OpenRAIL-M; SDK inference recipe: MIT.
// Immutable upstream revision, individual file sizes and SHA-256 digests.
export const SUPERTONIC_MODEL_ID = 'supertonic3';
export const SUPERTONIC_REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323';
export const SUPERTONIC_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/' + SUPERTONIC_REVISION + '/';
// Only the vector estimator is quantized. Duration, text encoder and vocoder
// remain the original FP32 graphs. This derivative retains OpenRAIL-M.
export const SUPERTONIC_QUANT_REVISION = '95618f5d61cef4923c3b802a332fd603723718f7';
export const SUPERTONIC_VECTOR_URL = 'https://huggingface.co/askurios8/supertonic-3-int8/resolve/' + SUPERTONIC_QUANT_REVISION + '/variants/mixed-fast/onnx/vector_estimator.onnx';
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
export const SUPERTONIC_ASSETS = Object.freeze([
  {
    "path": "onnx/duration_predictor.onnx",
    "bytes": 3700147,
    "sha256": "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db"
  },
  {
    "path": "onnx/text_encoder.onnx",
    "bytes": 36416150,
    "sha256": "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff"
  },
  {
    "path": "onnx/vector_estimator.onnx",
    "url": SUPERTONIC_VECTOR_URL,
    "bytes": 65447164,
    "sha256": "073575704bf0b6ca0714eb6509029f324b794d5bd6dbdb27dccbbc5939abc167"
  },
  {
    "path": "onnx/vocoder.onnx",
    "bytes": 101424195,
    "sha256": "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba"
  },
  {
    "path": "onnx/tts.json",
    "bytes": 8253,
    "sha256": "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09"
  },
  {
    "path": "onnx/unicode_indexer.json",
    "bytes": 277676,
    "sha256": "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f"
  },
  {
    "path": "voice_styles/F1.json",
    "bytes": 292046,
    "sha256": "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2"
  },
  {
    "path": "voice_styles/M1.json",
    "bytes": 291748,
    "sha256": "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b"
  },
  {
    "path": "voice_styles/F2.json",
    "bytes": 292423,
    "sha256": "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6"
  },
  {
    "path": "LICENSE",
    "bytes": 15007,
    "sha256": "0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f"
  }
].map(asset=>Object.freeze({...asset,url:asset.url||SUPERTONIC_BASE+asset.path})));
export const SUPERTONIC_BYTES = SUPERTONIC_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
export const SUPERTONIC_LANGUAGES = Object.freeze(["en","ko","ja","ar","bg","cs","da","de","el","es","et","fi","fr","hi","hr","hu","id","it","lt","lv","nl","pl","pt","ro","ru","sk","sl","sv","tr","uk","vi"]);
export const SUPERTONIC_STYLES = Object.freeze(['F1', 'M1', 'F2']);
export const SUPERTONIC_LICENSE = Object.freeze({name:'OpenRAIL-M',url:SUPERTONIC_BASE+'LICENSE',attribution:'Copyright (c) 2026 Supertone Inc.'});
export const isSupertonicVoiceId = id => typeof id === 'string' && /^supertonic3:(F1|M1|F2):[a-z]{2}$/.test(id);
export function supertonicVoicesFor(languages) {
  const unique=[...new Set(languages.map(lang => String(lang).split(/[-_]/)[0]))].filter(lang => SUPERTONIC_LANGUAGES.includes(lang));
  return unique.flatMap(lang => SUPERTONIC_STYLES.map(style => ({id:`supertonic3:${style}:${lang}`, modelId:SUPERTONIC_MODEL_ID, modelKey:SUPERTONIC_MODEL_ID, piperId:SUPERTONIC_MODEL_ID, runtime:'supertonic3', provider:'supertonic',lang,style,name:`Supertonic ${style}`,quality:'natural',sizeMB:Math.ceil(SUPERTONIC_BYTES/1e6),downloadBytes:SUPERTONIC_BYTES,licenseUrl:'licenses/supertonic3-OpenRAIL-M.txt',sharedPack:true})));
}
