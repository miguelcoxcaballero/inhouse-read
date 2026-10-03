// Curated Piper voices (rhasspy/piper-voices, VITS models) and where to download them from. Only voices that were proven
// end to end with their real weights are listed; adding one is a line in MODELS (plus its speakers, if it has several).
// Pure data and string helpers: this file is imported by the app at start-up (the voice picker needs the list), so it must
// stay tiny and free of the engine.

import { isSupertonicVoiceId, supertonicVoicesFor } from './supertonic-catalog.js'

/** Voice ids are namespaced so they never collide with Android/browser voice ids. */
export const NEURAL_PREFIX = 'piper:'
export const isNeuralVoiceId = id => typeof id === 'string' && (id.startsWith(NEURAL_PREFIX) || isSupertonicVoiceId(id))

/** Where the models live. Tests and mirrors set window.INHOUSE_NEURAL_VOICE_BASE before the app starts (see neuralVoiceBase). */
export const DEFAULT_VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

export const NAKDIMON = Object.freeze({
  url: 'https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/efffbfb226bfb511ebbcf55d0cecd8b35a89743d/src/piper/hebrew/nakdimon.onnx',
  bytes: 21312753,
  sha256: '9ff491dcc7d66392019d427a98b97d5de10c0d721628ae740858174ae22b190e'
})
const MARKO_BASE = 'https://huggingface.co/phantom9623/piper-serbian-tts/resolve/a71694f9ec3480f132dffaf7eb422d43aebd69e0/'

// A downloaded model is loaded into onnxruntime, so where it comes from is not negotiable at run time: the override must be
// https (or http on this very machine, for the test mirror) and is read ONCE, when this module loads at the start of the app.
// Anything a book's own script sets on window later (an EPUB's inline script runs with the page's origin) is ignored.
const trustedBase = url => {
  try { const { protocol, hostname } = new URL(url); return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) } catch { return false }
}
const overrideOf = env => { const value = env?.INHOUSE_NEURAL_VOICE_BASE; return typeof value === 'string' && trustedBase(value) ? value : '' }
const OVERRIDE_AT_LOAD = overrideOf(globalThis)

/** The base URL (always ending in '/') every model, config and the voices.json catalogue is fetched from. `env` is for tests: any other object is read as it is now. */
export function neuralVoiceBase(env = globalThis) {
  const base = (env === globalThis ? OVERRIDE_AT_LOAD : overrideOf(env)) || DEFAULT_VOICE_BASE
  return base.endsWith('/') ? base : base + '/'
}

/** 'es_MX-claude-high' -> { family:'es', locale:'es_MX', name:'claude', quality:'high' } (the dataset name may hold '_', the quality too: 'x_low'). */
export function parsePiperId(piperId) {
  const [locale, ...rest] = String(piperId).split('-')
  const quality = rest.pop() || ''
  return { family: locale.split('_')[0], locale, name: rest.join('-'), quality }
}

/** Path of a voice's files under the base URL: '<family>/<locale>/<name>/<quality>/<piperId>'. */
export function piperPath(piperId) {
  const { family, locale, name, quality } = parsePiperId(piperId)
  return `${family}/${locale}/${name}/${quality}/${piperId}`
}

/** URLs of the two files of a voice and of the catalogue that lists their sizes. */
export function voiceUrls(piperId, base = neuralVoiceBase()) {
  const path = base + piperPath(piperId)
  const urls = { model: `${path}.onnx`, config: `${path}.onnx.json`, catalogue: `${base}voices.json`, key: `${piperPath(piperId)}.onnx` }
  if (piperId === 'sr_RS-marko-medium') {
    if (base === DEFAULT_VOICE_BASE) {
      urls.model = `${MARKO_BASE}sr_Marko_medium.onnx`
      urls.config = `${MARKO_BASE}sr_Marko_medium.onnx.json`
    }
    urls.modelBytes = 63516051
  }
  if (piperId === 'he_IL-saspeech-medium') Object.assign(urls, {
    phonemizerModel: base === DEFAULT_VOICE_BASE ? NAKDIMON.url : `${base}aux/nakdimon.onnx`,
    phonemizerSize: NAKDIMON.bytes,
    phonemizerSha256: NAKDIMON.sha256
  })
  for (const name of ['model', 'config', 'phonemizerModel']) if (urls[name]) urls[name] = new URL(urls[name]).href
  return urls
}

// One row per downloadable model. `sizeMB` is the .onnx download (63 MB for a 'medium' voice, 77 for sharvard and ukrainian_tts);
// the name and the speakers come from each voice's .onnx.json (dataset, speaker_id_map).
// Spanish is first (the app's own language); `recommended` is the one the picker offers first for its language.
const MODELS = [
  { piperId: 'es_MX-claude-high', lang: 'es-MX', quality: 'high', sizeMB: 63, recommended: true, speakers: [{ name: 'Claude' }] },
  { piperId: 'es_ES-davefx-medium', lang: 'es-ES', quality: 'medium', sizeMB: 63, speakers: [{ name: 'Davefx' }] },
  { piperId: 'es_ES-sharvard-medium', lang: 'es-ES', quality: 'medium', sizeMB: 77, speakers: [{ name: 'Sharvard (hombre)', speaker: 0 }, { name: 'Sharvard (mujer)', speaker: 1 }] },
  { piperId: 'en_US-lessac-medium', lang: 'en-US', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Lessac' }] },
  { piperId: 'en_GB-alba-medium', lang: 'en-GB', quality: 'medium', sizeMB: 63, speakers: [{ name: 'Alba' }] },
  { piperId: 'fr_FR-siwis-medium', lang: 'fr-FR', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Siwis' }] },
  { piperId: 'de_DE-thorsten-medium', lang: 'de-DE', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Thorsten' }] },
  { piperId: 'it_IT-paola-medium', lang: 'it-IT', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Paola' }] },
  { piperId: 'pt_BR-faber-medium', lang: 'pt-BR', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Faber' }] },
  { piperId: 'pt_PT-tugão-medium', lang: 'pt-PT', quality: 'medium', sizeMB: 63, speakers: [{ name: 'Tugão' }] },
  { piperId: 'ca_ES-upc_ona-medium', lang: 'ca-ES', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Ona' }] },
  { piperId: 'ca_ES-upc_pau-x_low', lang: 'ca-ES', quality: 'low', sizeMB: 28, licenseName:'CC BY-SA 3.0 ES', licenseUrl:'licenses/piper-extra-voices.txt', speakers: [{ name: 'Pau' }] },
  // Other regions of the first languages.
  { piperId: 'es_AR-daniela-high', lang: 'es-AR', quality: 'high', sizeMB: 114, speakers: [{ name: 'Daniela' }] },
  { piperId: 'en_GB-cori-high', lang: 'en-GB', quality: 'high', sizeMB: 114, speakers: [{ name: 'Cori' }] },
  // More languages. Installation retains required external dictionaries for cold offline playback.
  { piperId: 'nl_NL-pim-medium', lang: 'nl-NL', quality: 'medium', sizeMB: 64, recommended: true, speakers: [{ name: 'Pim' }] },
  { piperId: 'pl_PL-gosia-medium', lang: 'pl-PL', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Gosia' }] },
  { piperId: 'ru_RU-irina-medium', lang: 'ru-RU', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Irina' }] },
  { piperId: 'uk_UA-ukrainian_tts-medium', lang: 'uk-UA', quality: 'medium', sizeMB: 77, recommended: true, speakers: [{ name: 'Lada', speaker: 0 }, { name: 'Mykyta', speaker: 1 }, { name: 'Tetiana', speaker: 2 }] },
  { piperId: 'tr_TR-dfki-medium', lang: 'tr-TR', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'DFKI' }] },
  { piperId: 'sv_SE-nst-medium', lang: 'sv-SE', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'NST' }] },
  { piperId: 'da_DK-talesyntese-medium', lang: 'da-DK', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Talesyntese' }] },
  { piperId: 'no_NO-talesyntese-medium', lang: 'nb-NO', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Talesyntese' }] },
  // NVCC's source speaker map and Table 2 identify KON and MON as distinct
  // Oslo speakers. Both share the same downloaded model, not a pitch preset.
  { piperId: 'no_NO-nvcc-medium', lang:'nb-NO', quality:'medium', sizeMB:77, licenseName:'CC0', licenseUrl:'licenses/piper-extra-voices.txt', speakers:[{name:'NVCC KON',speaker:3},{name:'NVCC MON',speaker:6}] },
  { piperId: 'fi_FI-harri-medium', lang: 'fi-FI', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Harri' }] },
  { piperId: 'cs_CZ-jirka-medium', lang: 'cs-CZ', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Jirka' }] },
  { piperId: 'el_GR-rapunzelina-low', lang: 'el-GR', quality: 'low', sizeMB: 63, recommended: true, speakers: [{ name: 'Rapunzelina' }] },
  { piperId: 'hu_HU-anna-medium', lang: 'hu-HU', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Anna' }] },
  { piperId: 'ro_RO-mihai-medium', lang: 'ro-RO', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Mihai' }] },
  { piperId: 'ar_JO-kareem-medium', lang: 'ar-JO', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Kareem' }] },
  { piperId: 'zh_CN-huayan-medium', lang: 'zh-CN', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Huayan' }] },
  { piperId: 'vi_VN-vais1000-medium', lang: 'vi-VN', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Vais1000' }] },
  { piperId: 'bg_BG-dimitar-medium', lang: 'bg-BG', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Dimitar' }] },
  // Author-trained Serbian model; the similarly named rhasspy model is actually Sorbian.
  { piperId: 'sr_RS-marko-medium', lang: 'sr-RS', quality: 'medium', sizeMB: 64, recommended: true, speakers: [{ name: 'Marko' }] },
  { piperId: 'hi_IN-pratham-medium', lang: 'hi-IN', quality: 'medium', sizeMB: 64, recommended: true, speakers: [{ name: 'Pratham' }] },
  // Includes Nakdimon, required for real Hebrew phonemization and offline playback.
  { piperId: 'he_IL-saspeech-medium', lang: 'he-IL', quality: 'medium', sizeMB: 85, recommended: true, speakers: [{ name: 'Saspeech' }] }
]

/**
 * One entry per voice a person can pick: a model with several speakers gives one entry per speaker (they share the one
 * downloaded model). The id of speaker 0 is 'piper:<piperId>', the others 'piper:<piperId>#<speaker>'.
 * `models` below groups them by model.
 * @type {import('./index.js').NeuralVoice[]}
 */
export const piperVoices = MODELS.flatMap(model => model.speakers.map((who, index) => {
  const speaker = who.speaker ?? 0
  return {
    id: NEURAL_PREFIX + model.piperId + (speaker ? `#${speaker}` : ''),
    piperId: model.piperId,
    lang: model.lang,
    name: who.name,
    quality: model.quality,
    sizeMB: model.sizeMB,
    speaker,
    ...(model.licenseUrl ? {licenseUrl:model.licenseUrl,licenseName:model.licenseName} : {}),
    ...(model.recommended && !index ? { recommended: true } : {})
  }
}))
// Multilingual profiles use generic language tags. They do not claim an
// Argentine, Mexican, Portuguese or other regional accent.
export const supertonicVoices = supertonicVoicesFor(piperVoices.map(voice => voice.lang))
export const neuralVoices = [...piperVoices, ...supertonicVoices]

/** piperId -> the voices (speakers) that share that model. */
export const modelsOf = voices => {
  const map = new Map()
  for (const voice of voices) (map.get(voice.piperId) || map.set(voice.piperId, []).get(voice.piperId)).push(voice)
  return map
}

/** The catalogue entry for a voice id ('piper:es_MX-claude-high'), if it is one of ours. */
export const findNeuralVoice = (id, voices = neuralVoices) => voices.find(voice => voice.id === id) || null

/** Language tag -> the voice to offer first ('es-MX' or 'es' -> Claude): same region first, else the language's recommended one. */
export function recommendedVoice(lang, voices = neuralVoices) {
  const tag = String(lang || '').replace('_', '-')
  const base = tag.split('-')[0].toLowerCase()
  const ofLanguage = voices.filter(voice => voice.lang.split('-')[0] === base)
  // A generic multilingual tag is not a regional match that should override
  // the compact recommended Piper download for the language.
  return ofLanguage.find(voice => tag.includes('-') && voice.lang.toLowerCase() === tag.toLowerCase()) || ofLanguage.find(voice => voice.recommended) || ofLanguage[0] || null
}
