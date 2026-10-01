import { describe, it, expect } from 'vitest'
import {
  normalizeLang, normalizeVoice, normalizeVoices, scoreVoice, isHighQuality, rankedVoicesFor, bestVoiceFor, needsBetterVoice,
  languageName, voiceLabel, buildVoiceGroups, resolveVoice, readSystemVoices, detectLanguage
} from '../../src/js/readers/voice-catalog.js'

// Shapes the Android bridge sends: quality 100..500, latency, network flag, installed flag.
const android = (voiceURI, lang, quality, extra = {}) => ({ voiceURI, name:`${lang} voice`, lang, quality, latency:200, network:false, installed:true, features:[], ...extra })
const DEVICE = [
  android('es-es-x-eed-local', 'es-ES', 400),
  android('es-es-x-eea-network', 'es-ES', 400, { network:true }),
  android('es-us-x-sfb-local', 'es-US', 400),
  android('es-es-x-espeak', 'es-ES', 300, { name:'eSpeak es' }),
  android('en-us-x-iom-local', 'en-US', 400),
  android('en-gb-x-gbb-local', 'en-GB', 400),
  android('fr-fr-x-vlf-local', 'fr-FR', 400),
  android('de-de-x-nfh-local', 'de-DE', 400),
  android('it-it-x-kda-local', 'it-IT', 400),
  android('pt-br-x-afs-local', 'pt-BR', 400),
  android('pt-pt-x-jmn-local', 'pt-PT', 300),
  android('ca-es-x-jab-local', 'ca-ES', 300),
  android('ja-jp-x-htm-local', 'ja-JP', 400)
]
const voices = normalizeVoices(DEVICE)

describe('voice normalization', () => {
  it('normalizes language tags from Android, browsers and ISO 639-2 codes', () => {
    expect(normalizeLang('es_ES')).toBe('es-ES')
    expect(normalizeLang('PT-br')).toBe('pt-BR')
    expect(normalizeLang('spa-ESP')).toBe('es')
    expect(normalizeLang('')).toBe('')
  })
  it('reads the native shape, keeping quality, network and installation state', () => {
    expect(normalizeVoice(android('a', 'es-ES', 500, { network:true, latency:400 }))).toMatchObject({ id:'a', lang:'es-ES', base:'es', region:'ES', quality:500, network:true, installed:true, latency:400 })
    expect(normalizeVoice(android('b', 'es-ES', 400, { installed:false })).installed).toBe(false)
    expect(normalizeVoice(android('c', 'es-ES', 400, { features:['notInstalled'], installed:undefined })).installed).toBe(false)
  })
  it('understands SpeechSynthesisVoice and the old bridge format (name only)', () => {
    expect(normalizeVoice({ voiceURI:'v', name:'Monica', lang:'es_ES', localService:false })).toMatchObject({ network:true, quality:null, lang:'es-ES' })
    expect(normalizeVoice({ voiceURI:'v', name:'Monica', lang:'es-ES', localService:true }).network).toBe(false)
    expect(normalizeVoice({ voiceURI:'o', name:'español (España) · online', lang:'es-ES' }).network).toBe(true)
    expect(normalizeVoice({ voiceURI:'d', name:'español (España) · dispositivo', lang:'es-ES' }).network).toBe(false)
  })
  it('drops junk and duplicate ids', () => {
    expect(normalizeVoices([null, {}, { voiceURI:'x', lang:'' }, android('a', 'es-ES', 300), android('a', 'es-ES', 400)])).toHaveLength(1)
    expect(normalizeVoices(null)).toEqual([])
  })
})

describe('naturalness score', () => {
  const score = raw => scoreVoice(normalizeVoice({ voiceURI:'v', name:'Voice', lang:'es-ES', ...raw }))
  it('ranks by quality tier first', () => {
    expect(score({ quality:500 })).toBeGreaterThan(score({ quality:400 }))
    expect(score({ quality:400 })).toBeGreaterThan(score({ quality:300 }))
    expect(score({ quality:300 })).toBeGreaterThan(score({ quality:100 }))
  })
  it('prefers an on-device voice to an online one of the same quality (free and unlimited, works offline)', () => {
    expect(score({ quality:400, network:false })).toBeGreaterThan(score({ quality:400, network:true }))
    expect(score({ localService:true })).toBeGreaterThan(score({ localService:false }))
  })
  it('rewards natural/neural markers and Google Speech Services ids, and demotes robotic engines', () => {
    expect(score({ name:'Microsoft Ava Online (Natural)' })).toBeGreaterThan(score({ name:'Microsoft David' }))
    expect(score({ name:'Premium Monica' })).toBeGreaterThan(score({ name:'Monica' }))
    expect(score({ voiceURI:'es-es-x-eed-local' })).toBeGreaterThan(score({ voiceURI:'plain' }))
    for (const name of ['eSpeak NG', 'Monica Compact', 'Legacy voice', 'Festival']) expect(score({ name })).toBeLessThan(score({ name:'Monica' }) - 150)
    expect(score({ name:'Zarvox' })).toBeLessThan(score({ name:'Monica' }) - 150)
  })
  it('flags high quality from the tier, or from neural markers when no tier exists', () => {
    expect(isHighQuality(normalizeVoice(android('a', 'es-ES', 400)))).toBe(true)
    expect(isHighQuality(normalizeVoice(android('a', 'es-ES', 300)))).toBe(false)
    expect(isHighQuality(normalizeVoice({ voiceURI:'a', name:'Jenny Online (Natural)', lang:'en-US' }))).toBe(true)
    expect(isHighQuality(normalizeVoice({ voiceURI:'a', name:'Monica', lang:'es-ES' }))).toBe(false)
    expect(isHighQuality(normalizeVoice(android('a', 'es-ES', 400, { name:'espeak' })))).toBe(false)
  })
})

describe('choosing a voice per language', () => {
  it('picks the best installed voice and never an eSpeak one when a real voice exists', () => {
    expect(bestVoiceFor(voices, 'es-ES').id).toBe('es-es-x-eed-local')
    expect(rankedVoicesFor(voices, 'es').map(v => v.id).at(-1)).toBe('es-es-x-espeak')
  })
  it('matches the region first (pt-BR vs pt-PT) and the device region when the book has none', () => {
    expect(bestVoiceFor(voices, 'pt-PT').id).toBe('pt-pt-x-jmn-local')
    expect(bestVoiceFor(voices, 'pt-BR').id).toBe('pt-br-x-afs-local')
    expect(bestVoiceFor(voices, 'es', 'es-US').id).toBe('es-us-x-sfb-local')
    expect(bestVoiceFor(voices, 'es', 'en-US').id).toBe('es-es-x-eed-local')
  })
  it('ignores voices that are not installed and languages without voices', () => {
    const list = normalizeVoices([android('x', 'es-ES', 500, { installed:false }), android('y', 'es-MX', 300)])
    expect(bestVoiceFor(list, 'es').id).toBe('y')
    expect(bestVoiceFor(list, 'sv')).toBeNull()
  })
  it('offers a download only when the best voice is missing or below high quality', () => {
    expect(needsBetterVoice(voices, 'es-ES')).toBe(false)
    expect(needsBetterVoice(voices, 'ca-ES')).toBe(true) // only a "normal" Catalan voice
    expect(needsBetterVoice(voices, 'sv-SE')).toBe(true) // none installed
    expect(needsBetterVoice([], 'es')).toBe(true)
  })
})

describe('labels', () => {
  it('describes language, quality and connection in Spanish', () => {
    expect(languageName('es-ES')).toBe('Español (España)')
    expect(languageName('pt-BR')).toBe('Portugués (Brasil)')
    expect(languageName('en')).toBe('Inglés')
    expect(voiceLabel(normalizeVoice(android('a', 'es-ES', 400)))).toBe('Español (España) · Alta calidad · sin conexión')
    expect(voiceLabel(normalizeVoice(android('a', 'es-ES', 300, { network:true })))).toBe('Español (España) · Calidad normal · requiere internet')
    expect(voiceLabel(normalizeVoice(android('a', 'es-ES', 200)))).toContain('Calidad básica')
  })
  it('falls back to Intl names for other languages and keeps browser voice names', () => {
    expect(languageName('sv-SE').toLowerCase()).toContain('sueco')
    expect(voiceLabel(normalizeVoice({ voiceURI:'m', name:'Microsoft Helena - Spanish (Spain)', lang:'es-ES', localService:true }))).toBe('Español (España) · Helena · sin conexión')
    expect(voiceLabel(normalizeVoice({ voiceURI:'j', name:'Microsoft Jenny Online (Natural) - English (United States)', lang:'en-US', localService:false }))).toBe('Inglés (EE. UU.) · Jenny · Natural · requiere internet')
  })
})

describe('grouped picker', () => {
  const groups = buildVoiceGroups(voices, { bookLang:'fr-FR', deviceLang:'es-ES' })
  const langs = list => [...new Set(list.map(item => item.voice.base))]
  it('curates the natural voices: book language first, then device language, then the priority languages', () => {
    expect(langs(groups.recommended).slice(0, 3)).toEqual(['fr', 'es', 'en'])
    expect(langs(groups.recommended)).toEqual(expect.arrayContaining(['es', 'en', 'fr', 'de', 'it', 'pt', 'ca']))
    expect(langs(groups.recommended)).not.toContain('ja') // only book/device/priority languages are curated
  })
  it('offers at most two voices per language and never a robotic one', () => {
    for (const base of ['es', 'en', 'pt']) expect(groups.recommended.filter(item => item.voice.base === base).length).toBeLessThanOrEqual(2)
    expect(groups.recommended.some(item => item.id === 'es-es-x-espeak')).toBe(false)
    const spanish = groups.recommended.filter(item => item.voice.base === 'es')
    expect(spanish.map(item => item.id)).toEqual(['es-es-x-eed-local', 'es-us-x-sfb-local']) // second pick: another region, on-device
  })
  it("'Todas las voces' lists every installed voice, book language first, with unique labels", () => {
    expect(groups.all).toHaveLength(voices.length)
    expect(groups.all[0].voice.base).toBe('fr')
    expect(new Set(groups.all.map(item => item.label)).size).toBe(groups.all.length)
    expect(groups.labels.get('es-es-x-eed-local')).toBe('Español (España) · Alta calidad · sin conexión')
    expect(groups.all.find(item => item.id === 'es-es-x-eea-network').label).toMatch(/requiere internet/)
  })
  it('skips voices that are not installed and handles an empty device', () => {
    const none = buildVoiceGroups(normalizeVoices([android('n', 'es-ES', 500, { installed:false })]), { bookLang:'es' })
    expect(none.recommended).toEqual([]); expect(none.all).toEqual([])
    expect(buildVoiceGroups([], {}).recommended).toEqual([])
  })
})

describe('resolving the voice for an utterance', () => {
  it("'Automática' uses the best voice of the language and returns its full tag", () => {
    expect(resolveVoice(voices, { language:'es' })).toMatchObject({ voiceId:'es-es-x-eed-local', language:'es-ES' })
    expect(resolveVoice(voices, { language:'sv-SE' })).toMatchObject({ voice:null, voiceId:'', language:'sv-SE' })
  })
  it('an explicit choice always wins', () => {
    expect(resolveVoice(voices, { voiceId:'en-gb-x-gbb-local', language:'es-ES' })).toMatchObject({ voiceId:'en-gb-x-gbb-local' })
    expect(resolveVoice(voices, { voiceId:'es-es-x-espeak', language:'es-ES' }).voiceId).toBe('es-es-x-espeak')
  })
  it('a voice that vanished falls back to automatic, but passes through when no list was loaded', () => {
    expect(resolveVoice(voices, { voiceId:'gone', language:'es-ES' }).voiceId).toBe('es-es-x-eed-local')
    expect(resolveVoice([], { voiceId:'saved', language:'es-ES' })).toMatchObject({ voiceId:'saved', language:'es-ES' })
    expect(resolveVoice([], { language:'es-ES' }).voiceId).toBe('')
  })
  it('multilingual gives each chunk language ITS best voice, but keeps the chosen voice for its own language', () => {
    expect(resolveVoice(voices, { voiceId:'es-es-x-eed-local', language:'fr-FR', multilingual:true }).voiceId).toBe('fr-fr-x-vlf-local')
    expect(resolveVoice(voices, { voiceId:'es-us-x-sfb-local', language:'es-ES', multilingual:true }).voiceId).toBe('es-us-x-sfb-local')
    expect(resolveVoice(voices, { voiceId:'', language:'de-DE', multilingual:true })).toMatchObject({ voiceId:'de-de-x-nfh-local', language:'de-DE' })
  })
})

describe('reading the device voices', () => {
  it('prefers the native bridge and tolerates a broken one', () => {
    const env = { InhouseSpeech:{ speak() {}, getVoices:() => JSON.stringify(DEVICE) }, speechSynthesis:{ getVoices:() => [{ voiceURI:'b', name:'B', lang:'en-US' }] } }
    expect(readSystemVoices(env)).toHaveLength(DEVICE.length)
    expect(readSystemVoices({ InhouseSpeech:{ speak() {}, getVoices:() => 'not json' } })).toEqual([])
    expect(readSystemVoices({ InhouseSpeech:{ speak() {} } })).toEqual([])
  })
  it('falls back to speechSynthesis voices', () => {
    expect(readSystemVoices({ speechSynthesis:{ getVoices:() => [{ voiceURI:'b', name:'B', lang:'en-US', localService:true }] } })).toMatchObject([{ id:'b', network:false }])
    expect(readSystemVoices({})).toEqual([])
  })
})

describe('language detection', () => {
  it.each([
    ['Los niños salieron a jugar con una pelota en el parque.', 'es-ES'],
    ['¿Qué quieres que haga?', 'es-ES'],
    ['The old man was sitting by the window and she was not there.', 'en-US'],
    ["I don't know what you want from me.", 'en-US'],
    ['Les enfants sont allés dans la forêt avec leur mère et ils ont mangé.', 'fr-FR'],
    ['Der Mann ist nicht mit dem Zug gefahren, weil er müde war und es regnete.', 'de-DE'],
    ['Il bambino non è andato con la madre perché era stanco, ma anche felice.', 'it-IT'],
    ['As crianças não foram com a mãe porque estavam cansadas, mas ela está bem.', 'pt-PT'],
    ['Você sabe que não é assim, e ela também não foi com você.', 'pt-BR'],
    ['Els nens van anar al parc amb una pilota, però també és molt tard.', 'ca-ES']
  ])('%s -> %s', (text, expected) => { expect(detectLanguage(text, 'sv-SE')).toBe(expected) })
  it('keeps the book region when the detected language agrees and falls back on short or ambiguous text', () => {
    expect(detectLanguage('Los niños salieron a jugar con una pelota.', 'es-MX')).toBe('es-MX')
    expect(detectLanguage('As crianças não foram com a mãe porque estavam cansadas.', 'pt-BR')).toBe('pt-BR')
    expect(detectLanguage('Capítulo 1', 'en-GB')).toBe('en-GB')
    expect(detectLanguage('', 'de-DE')).toBe('de-DE')
    expect(detectLanguage('12345 ...', undefined)).toBe('en-US')
  })
})
