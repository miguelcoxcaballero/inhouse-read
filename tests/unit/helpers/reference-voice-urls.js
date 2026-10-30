// Frozen from 0a4d84ea (1.7.309): the Piper URL helpers of src/js/readers/neural-voice/catalog.js before they moved to
// rust-ui voice_urls.rs, and the two catalogue lookups that production no longer used (the picker ranks voices in Rust).
import { DEFAULT_VOICE_BASE, neuralVoiceBase, neuralVoices } from './reference-neural-catalog.js'

export const NAKDIMON = Object.freeze({
  url: 'https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/efffbfb226bfb511ebbcf55d0cecd8b35a89743d/src/piper/hebrew/nakdimon.onnx',
  bytes: 21312753,
  sha256: '9ff491dcc7d66392019d427a98b97d5de10c0d721628ae740858174ae22b190e'
})
const MARKO_BASE = 'https://huggingface.co/phantom9623/piper-serbian-tts/resolve/a71694f9ec3480f132dffaf7eb422d43aebd69e0/'

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
