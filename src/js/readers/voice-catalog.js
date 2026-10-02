// Pure helpers that rank the voices the device already has (Android TextToSpeech through
// window.InhouseSpeech, or the browser's speechSynthesis). Nothing here calls a cloud TTS:
// "free and unlimited" means we only choose among system voices, preferring on-device ones.

const ISO3 = { spa:'es', eng:'en', fra:'fr', fre:'fr', deu:'de', ger:'de', ita:'it', por:'pt', cat:'ca', glg:'gl', nld:'nl', dut:'nl', rus:'ru', jpn:'ja', zho:'zh', chi:'zh', kor:'ko', pol:'pl' }
// Languages the curated list always tries to cover, in the order they appear after the book/device language.
export const PRIORITY_LANGUAGES = ['es','en','fr','de','it','pt','ca']
const MIN_RECOMMENDED = 240

// Robotic/legacy engines and macOS novelty voices: demoted far below any normal voice.
const ROBOTIC = /espeak|compact|legacy|robot|festival|flite|mbrola|\bpico\b|\bsam\b/i
const NOVELTY = /\b(bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph|deranged|hysterical)\b/i
const NEURAL = /neural|natural|wavenet|studio|premium|enhanced|siri|\bhq\b|high.?quality/i
const MULTILINGUAL = /multilingual|multiling/i
const GOOGLE_ID = /-x-[a-z0-9]{2,5}-(?:local|network)\b/i

/** 'es_ES', 'spa-ESP', 'ES-es' -> 'es-ES' (language lower-case, region upper-case). */
export function normalizeLang(tag) {
  const parts = String(tag || '').trim().replace(/_/g, '-').split('-').filter(Boolean)
  if (!parts.length) return ''
  let language = parts[0].toLowerCase()
  language = ISO3[language] || language
  const region = parts.slice(1).find(part => /^[a-z]{2}$/i.test(part) || /^\d{3}$/.test(part))
  return region ? `${language}-${region.toUpperCase()}` : language
}
export const langBase = tag => normalizeLang(tag).split('-')[0]
const langRegion = tag => normalizeLang(tag).split('-')[1] || ''

const asList = value => Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? value.split(/[,\s]+/).filter(Boolean) : []

/**
 * Accepts the native bridge shape ({voiceURI,name,lang,quality,latency,network,installed,features})
 * and SpeechSynthesisVoice ({voiceURI,name,lang,localService,default}); older bridges only sent
 * name/lang/voiceURI with "· online"/"· dispositivo" in the name, which is still understood.
 */
export function normalizeVoice(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.voiceURI ?? raw.id ?? raw.name ?? '')
  const lang = normalizeLang(raw.lang)
  if (!id || !lang) return null
  const name = String(raw.name || id)
  const features = asList(raw.features)
  const tier = raw.quality == null || raw.quality === '' ? NaN : Number(raw.quality)
  const quality = tier > 0 ? tier : null
  const network = raw.network === true || raw.networkConnectionRequired === true || raw.localService === false
    || (raw.network == null && raw.localService == null && (/(?:^|[\s·(])online\b/i.test(name) || /-network$/i.test(id)))
  const installed = raw.installed !== false && !features.includes('notInstalled')
  return { id, name, lang, base:langBase(lang), region:langRegion(lang), quality, latency:Number(raw.latency) || null, network, installed, features,
    isDefault:raw.default === true, native:quality !== null, label:typeof raw.label === 'string' ? raw.label : '' }
}
export function normalizeVoices(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : Array.from(list || [])).map(normalizeVoice).filter(voice => voice && !seen.has(voice.id) && seen.add(voice.id))
}

export const isNatural = voice => NEURAL.test(`${voice.id} ${voice.name}`)
/** Higher is more natural. Quality tier first, then on-device over online, then name/id markers. */
export function scoreVoice(voice) {
  const text = `${voice.id} ${voice.name}`
  let score = voice.quality ?? 300 // browsers do not report quality: assume "normal"
  if (voice.network) score -= voice.quality === null ? 60 : 110 // needs a connection and can stall: an on-device voice wins even one Android tier lower (browsers report no tier and keep their online neural voices competitive)
  if (ROBOTIC.test(text)) score -= 200
  if (NOVELTY.test(text)) score -= 250
  if (NEURAL.test(text)) score += 80
  if (MULTILINGUAL.test(text)) score += 40
  if (GOOGLE_ID.test(voice.id)) score += 20 // Google Speech Services ids: neural-quality voices
  else if (/google/i.test(text)) score += 15
  if (voice.isDefault) score += 5
  return score
}
/** "High quality" for the download hint: Android's own tier >= HIGH, or a neural marker when no tier is known. */
export const isHighQuality = voice => voice.quality !== null ? voice.quality >= 400 && !ROBOTIC.test(`${voice.id} ${voice.name}`) : isNatural(voice) && !ROBOTIC.test(voice.name)

const byScore = (a, b) => scoreVoice(b) - scoreVoice(a) || a.id.localeCompare(b.id)
const usable = voices => voices.filter(voice => voice.installed)

/** Voices that speak `lang`, best first; a matching region (pt-BR vs pt-PT) beats a better-scored other region. */
export function rankedVoicesFor(voices, lang, deviceLang = '') {
  const base = langBase(lang), region = langRegion(lang), deviceRegion = langBase(deviceLang) === base ? langRegion(deviceLang) : ''
  const bonus = voice => (region && voice.region === region ? 150 : !region && deviceRegion && voice.region === deviceRegion ? 25 : 0)
  return usable(voices).filter(voice => voice.base === base).sort((a, b) => scoreVoice(b) + bonus(b) - scoreVoice(a) - bonus(a) || a.id.localeCompare(b.id))
}
export const bestVoiceFor = (voices, lang, deviceLang = '') => rankedVoicesFor(voices, lang, deviceLang)[0] || null

/** True when the best voice for this language is missing or below "high quality": time to offer a download. */
export function needsBetterVoice(voices, lang, deviceLang = '') {
  const best = bestVoiceFor(voices, lang, deviceLang)
  return !best || !isHighQuality(best)
}

// Names are in Spanish because the UI is; Intl.DisplayNames covers the long tail.
const LANGUAGES = { es:'Español', en:'Inglés', fr:'Francés', de:'Alemán', it:'Italiano', pt:'Portugués', ca:'Catalán', gl:'Gallego', eu:'Euskera', nl:'Neerlandés', ru:'Ruso', ja:'Japonés', zh:'Chino', ko:'Coreano', pl:'Polaco' }
const REGIONS = { ES:'España', US:'EE. UU.', GB:'Reino Unido', MX:'México', AR:'Argentina', CO:'Colombia', CL:'Chile', FR:'Francia', DE:'Alemania', IT:'Italia', PT:'Portugal', BR:'Brasil', CA:'Canadá', AU:'Australia', IN:'India', IE:'Irlanda', CH:'Suiza', AT:'Austria', BE:'Bélgica' }
const displayName = (code, type) => {
  try { const value = new Intl.DisplayNames(['es'], { type }).of(code); return value && value !== code ? value : '' } catch { return '' }
}
const capitalize = text => text.charAt(0).toLocaleUpperCase('es') + text.slice(1)
export function languageName(tag) {
  const lang = normalizeLang(tag), base = langBase(lang), region = langRegion(lang)
  if (!base) return ''
  const name = LANGUAGES[base] || capitalize(displayName(base, 'language') || base)
  const where = region ? REGIONS[region] || displayName(region, 'region') || region : ''
  return where ? `${name} (${where})` : name
}
/** The person/brand part of a browser voice name ("Microsoft Helena - Spanish (Spain)" -> "Helena"); empty for technical ids. */
function voiceTitle(voice) {
  if (voice.native || /-x-|^[a-z]{2,3}[-_][a-z0-9]{2,4}\b/i.test(voice.name)) return ''
  const title = voice.name.replace(/^(?:Microsoft|Google|Apple)\s+/i, '').split(/\s+-\s+/)[0].replace(/\(.*?\)/g, '').replace(/\b(?:Online|Natural)\b/gi, '').replace(/\s+/g, ' ').trim()
  return title && !title.toLocaleLowerCase('es').startsWith((LANGUAGES[voice.base] || voice.base).toLocaleLowerCase('es')) ? title : ''
}
/** e.g. 'Español (España) · Alta calidad · sin conexión'. */
export function voiceLabel(voice) {
  const quality = voice.quality === null ? (isNatural(voice) ? 'Natural' : '') : voice.quality >= 400 ? 'Alta calidad' : voice.quality >= 300 ? 'Calidad normal' : 'Calidad básica'
  return [languageName(voice.lang), voiceTitle(voice), quality, voice.network ? 'requiere internet' : 'sin conexión'].filter(Boolean).join(' · ')
}

/**
 * Groups for the picker: a curated 'Recomendadas (naturales)' (best 1-2 per language, book language first, then the
 * device language, then es/en/fr/de/it/pt/ca) and 'Todas las voces'. Identical labels get "· voz N" so they can be told apart.
 */
export function buildVoiceGroups(voices, { bookLang = '', deviceLang = '' } = {}) {
  const all = usable(voices)
  const names = new Map(), count = new Map()
  for (const voice of [...all].sort(byScore)) {
    const label = voiceLabel(voice)
    count.set(label, (count.get(label) || 0) + 1)
    names.set(voice.id, count.get(label) > 1 ? `${label} · voz ${count.get(label)}` : label)
  }
  const entry = voice => ({ id:voice.id, lang:voice.lang, label:names.get(voice.id), voice })
  const bookBase = langBase(bookLang), deviceBase = langBase(deviceLang)
  const order = [...new Set([bookBase, deviceBase, ...PRIORITY_LANGUAGES].filter(Boolean))]
  const recommended = []
  for (const base of order) {
    const ranked = rankedVoicesFor(all, base === bookBase ? bookLang : base === deviceBase ? deviceLang : base, deviceLang).filter(voice => scoreVoice(voice) >= MIN_RECOMMENDED)
    if (!ranked.length) continue
    // The second pick prefers another region (es-ES + es-MX) when it is close enough in quality to be worth offering.
    const second = ranked.slice(1).find(voice => voice.region !== ranked[0].region && scoreVoice(voice) >= scoreVoice(ranked[0]) - 120)
      || ranked.slice(1).find(voice => scoreVoice(voice) >= scoreVoice(ranked[0]) - 120)
    recommended.push(...[ranked[0], second].filter(Boolean).map(entry))
  }
  const rank = voice => voice.base === bookBase ? 0 : voice.base === deviceBase ? 1 : 2
  const everything = [...all].sort((a, b) => rank(a) - rank(b) || languageName(a.base).localeCompare(languageName(b.base), 'es') || byScore(a, b)).map(entry)
  return { recommended, all:everything, labels:names }
}

/**
 * The voice and language for one utterance. An explicit choice always wins, except with 'Voz multilingüe' on and a
 * chunk in another language: then that language gets ITS best voice. Without an explicit choice the best natural
 * voice for the language is used. `voiceId` is '' when the system default should decide (no matching voice).
 */
export function resolveVoice(voices, { voiceId = '', language = '', multilingual = false, deviceLang = '' } = {}) {
  const list = Array.isArray(voices) ? voices : []
  const chosen = voiceId && usable(list).find(voice => voice.id === voiceId)
  if (chosen && (!multilingual || chosen.base === langBase(language))) return { voice:chosen, voiceId:chosen.id, language:chosen.lang }
  // An id we cannot see in the list (old bridge, list not loaded yet) is still passed through when there is nothing to choose from.
  if (voiceId && !chosen && !list.length && !multilingual) return { voice:null, voiceId, language }
  const best = bestVoiceFor(list, language, deviceLang)
  return best ? { voice:best, voiceId:best.id, language:best.lang } : { voice:null, voiceId:'', language }
}

/** Reads the device's voices from the native bridge (preferred) or speechSynthesis; `env` is injectable for tests. */
export function readSystemVoices(env = globalThis) {
  try {
    if (typeof env.InhouseSpeech?.speak === 'function') return typeof env.InhouseSpeech.getVoices === 'function' ? normalizeVoices(JSON.parse(env.InhouseSpeech.getVoices())) : []
    return normalizeVoices(env.speechSynthesis?.getVoices?.() || [])
  } catch { return [] }
}

// --- Language detection: stop-word scoring per language, with a few script/diacritic hints. ---
// Words that several languages share ("la", "de", "en"...) are listed in each of them but count half, so they can never
// decide a language on their own; only markers of one language do. The book language also gets a head start below.
const WORDS = {
  es: 'el la los las de y en un una unos unas del al que para con por como pero más mas está esta este esto estos también sin sobre entre cuando muy ya todo todos toda nada algo hay fue era eran ser soy eres somos son su sus es se no lo le les me mi mis te tu nos os ni sí así aquí allí donde porque quien quién cual cuyo cuyos qué cómo dónde ha han he hemos había tiene tengo tenía voy va vamos van hacia hasta desde después antes mientras aunque pues bien otro otra otros vez mismo yo usted ustedes nosotros ella ellos ellas',
  en: 'the and of to in is that it was for with as his her he she they you this have not but are were been from at by on an i my your we what do does did know there their will would can just be has had them then him me our its who which when where how all been out about if or so no up one into than some could should said like over only more now',
  fr: 'le la les des une un est que qui dans pour pas sur avec il elle ils elles nous vous mais ou au aux du de ce cette ces sont été être je tu et en ne se sa son ses mon ma mes ton ta tes leur leurs où comme plus très tout tous faire fait avait était ont a ai suis es sommes êtes y lui moi toi',
  de: 'der die das und ist nicht ein eine mit den dem des auf für von zu sich auch es war ich er sie wir aber wie oder im in an um aus bei nach noch nur schon dann wenn dass da du ihr ihm ihn mir dir uns euch hat haben hatte sind waren wird wurde kann so was wer wo man mein dein sein',
  it: 'il lo la gli le che di non una un è sono per con come più ma anche questo questa nel nella della delle degli dei del al alla alle allo si io lui lei noi voi loro mi ti ci vi ha hanno ho abbiamo era erano fu essere molto tutto tutti quando dove perché cosa niente solo già ancora sempre mai',
  pt: 'o a os as que não uma um uns umas do da dos das em no na nos nas de para com por mais como mas foi são está estão também ele ela eles elas você vocês eu nós me te se lhe lhes meu minha seu sua seus suas era eram ser tem têm tinha muito já ainda quando onde porque quem cujo ao aos à às',
  ca: 'el la els les que i amb per una un uns unes és són però també això aquest aquesta aquests aquestes dels de del al als molt més no jo tu nosaltres vosaltres ell ella ells elles em et es ens us li hi en ha han hem heu he va vaig vam van era eren ser sóc ets som sou mateix perquè quan on qui què com tot tots tota totes res algú ningú meva meu meus meves seva seu seus seves nostre vostre sense després abans fins des mentre encara ja ara aquí allà'
}
const WORD_SETS = Object.fromEntries(Object.entries(WORDS).map(([lang, words]) => [lang, new Set(words.split(' '))]))
const WORD_LANGS = new Map()
for (const [lang, set] of Object.entries(WORD_SETS)) for (const word of set) WORD_LANGS.set(word, [...(WORD_LANGS.get(word) || []), lang])
// What the book language is worth up front, and how far another language must clearly be ahead to override it.
const FALLBACK_BONUS = 2
const HINTS = [
  ['es', /[ñ¿¡]/g, 3], ['de', /ß/g, 3], ['de', /[äöü]/g, 1], ['pt', /[ãõ]/g, 3], ['fr', /œ/g, 3], ['fr', /ç/g, 1], ['ca', /ç/g, 1], ['ca', /l·l|·/g, 3],
  ['it', /[ìù]/g, 1.5], ['fr', /[èêâîôû]/g, 0.5], ['ca', /[àò]/g, 1]
]
const DEFAULT_REGION = { es:'ES', en:'US', fr:'FR', de:'DE', it:'IT', pt:'PT', ca:'ES' }
// \b does not treat accented letters as word characters, hence the explicit letter look-arounds.
const BRAZILIAN = /(?<!\p{L})(?:você|vocês|ônibus|celular|geladeira|café da manhã|a gente)(?!\p{L})/iu

/**
 * Best-guess BCP-47 tag for a short text. Short or ambiguous text falls back to `fallback` (the book language),
 * and a detected language keeps the fallback's region when they agree (book 'pt-BR' + Portuguese text -> pt-BR).
 */
export function detectLanguage(text, fallback = 'en-US') {
  const sample = String(text || '').toLocaleLowerCase()
  const scores = {}
  for (const word of sample.match(/[\p{L}·']+/gu) || []) {
    const langs = WORD_LANGS.get(word)
    if (langs) for (const lang of langs) scores[lang] = (scores[lang] || 0) + (langs.length === 1 ? 1 : 0.5)
  }
  for (const [lang, pattern, weight] of HINTS) { const hits = sample.match(pattern); if (hits) scores[lang] = (scores[lang] || 0) + hits.length * weight }
  const known = normalizeLang(fallback), home = langBase(known)
  // The book language starts ahead: a different language must beat it clearly, not by a shared "la" or "de".
  if (home in WORD_SETS) scores[home] = scores[home] || 0
  const ranked = Object.entries(scores).map(([lang, score]) => [lang, lang === home ? score + FALLBACK_BONUS : score]).sort((a, b) => b[1] - a[1])
  const [lang, score] = ranked[0] || []
  if (!lang || scores[lang] < 2 || (ranked[1] && ranked[1][1] === score)) return fallback
  if (langBase(known) === lang && langRegion(known)) return known
  if (lang === 'pt') return BRAZILIAN.test(sample) ? 'pt-BR' : 'pt-PT'
  return `${lang}-${DEFAULT_REGION[lang]}`
}
