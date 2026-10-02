// Curated Piper voices (rhasspy/piper-voices, VITS models) and where to download them from. Only voices that were proven
// end to end with their real weights are listed; adding one is a line in MODELS (plus its speakers, if it has several).
// Pure data and string helpers: this file is imported by the app at start-up (the voice picker needs the list), so it must
// stay tiny and free of the engine.

/** Voice ids are namespaced so they never collide with Android/browser voice ids. */
export const NEURAL_PREFIX = 'piper:'
export const isNeuralVoiceId = id => typeof id === 'string' && id.startsWith(NEURAL_PREFIX)

/** Where the models live. Tests and mirrors set window.INHOUSE_NEURAL_VOICE_BASE before the app starts (see neuralVoiceBase). */
export const DEFAULT_VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

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
  return { model: `${path}.onnx`, config: `${path}.onnx.json`, catalogue: `${base}voices.json`, key: `${piperPath(piperId)}.onnx` }
}

// The first seven languages were proven end to end with their real weights; nl, pl, tr, cs, sv, da, fi, ro and hu were added
// from the rhasspy/piper-voices listing without network access to the files (see public/neural-voice/phon/README.md).
// One row per downloadable model. `sizeMB` is the .onnx download (63 MB for a 'medium' voice, 77 for sharvard);
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
  { piperId: 'ca_ES-upc_ona-medium', lang: 'ca-ES', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Ona' }] },
  { piperId: 'nl_NL-pim-medium', lang: 'nl-NL', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Pim' }] },
  { piperId: 'nl_BE-nathalie-medium', lang: 'nl-BE', quality: 'medium', sizeMB: 63, speakers: [{ name: 'Nathalie' }] },
  { piperId: 'pl_PL-gosia-medium', lang: 'pl-PL', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Gosia' }] },
  { piperId: 'tr_TR-dfki-medium', lang: 'tr-TR', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Dfki' }] },
  { piperId: 'cs_CZ-jirka-medium', lang: 'cs-CZ', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Jirka' }] },
  { piperId: 'sv_SE-nst-medium', lang: 'sv-SE', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Nst' }] },
  { piperId: 'da_DK-talesyntese-medium', lang: 'da-DK', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Talesyntese' }] },
  { piperId: 'fi_FI-harri-medium', lang: 'fi-FI', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Harri' }] },
  { piperId: 'ro_RO-mihai-medium', lang: 'ro-RO', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Mihai' }] },
  { piperId: 'hu_HU-anna-medium', lang: 'hu-HU', quality: 'medium', sizeMB: 63, recommended: true, speakers: [{ name: 'Anna' }] }
]

/**
 * One entry per voice a person can pick: a model with several speakers gives one entry per speaker (they share the one
 * downloaded model). The id of speaker 0 is 'piper:<piperId>', the others 'piper:<piperId>#<speaker>'.
 * `models` below groups them by model.
 * @type {import('./index.js').NeuralVoice[]}
 */
export const neuralVoices = MODELS.flatMap(model => model.speakers.map((who, index) => {
  const speaker = who.speaker ?? 0
  return {
    id: NEURAL_PREFIX + model.piperId + (index ? `#${speaker}` : ''),
    piperId: model.piperId,
    lang: model.lang,
    name: who.name,
    quality: model.quality,
    sizeMB: model.sizeMB,
    speaker,
    ...(model.recommended && !index ? { recommended: true } : {})
  }
}))

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
  return ofLanguage.find(voice => voice.lang.toLowerCase() === tag.toLowerCase()) || ofLanguage.find(voice => voice.recommended) || ofLanguage[0] || null
}
