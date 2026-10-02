import { detectLanguage, isNeuralId, readSystemVoices, resolveVoice } from './voice-catalog.js'
import { neuralEngine, neuralVoiceList, neuralReady, unlockNeural } from './neural-runtime.js'
import { planSpeech, speechChunks } from './speech-text.js'

export { speechChunks }
// Blank or image-only pages passed over, one page turn at a time, before giving up.
const MAX_EMPTY_PAGES = 12
// foliate ignores a page turn while another one animates (the voice's own follow turn included): next() is retried
// this many times, this far apart, before an unchanged location is taken as the end of the book.
const END_RETRIES = 2, END_RETRY_MS = 200
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
// The highlight follows the sound, not the request: the engine needs a moment between speak() and the first audible word
// (hundreds of ms on Android's TextToSpeech, 1-2 s for an online voice) and says so with a 'start' event. If an engine never
// does, the sentence is shown after START_FALLBACK_MS (SILENT_ENGINE_MS once an utterance has ended without a 'start').
const START_FALLBACK_MS = 1500, SPOKEN_FALLBACK_MS = 4000, SILENT_ENGINE_MS = 0
// A neural voice always reports its 'start' (it is our own engine), so it has no fallback timer: it is waited for, and
// the status says so after NEURAL_WAIT_MS. It reads this many fragments ahead (same voice and speed) to stay gapless.
const NEURAL_WAIT_MS = 900, NEURAL_LOOKAHEAD = 4
// What the person sees when the neural voice gives up and the best system voice takes over.
const NEURAL_FALLBACK = {
  'too-slow':'La voz natural no va lo bastante rápida en este dispositivo. Sigo con la mejor voz del sistema.',
  'not-installed':'Esa voz natural ya no está instalada. Sigo con la mejor voz disponible.',
  default:'La voz natural no ha podido arrancar. Sigo con la mejor voz del sistema.'
}

/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader, onState = () => {}) {
    this.reader = reader
    this.onState = onState
    this.state = 'stopped'
    this.generation = 0
    this.index = 0
    this.chunks = []
    this.items = []
    this.source = null
    this.rate = 1
    this.voice = ''
    this.options = {footnotes:false,multilingual:false,skipHeaders:false}
    // Where the current utterance was handed: 'neural' (our engine), 'native' (Android bridge) or 'web' (speechSynthesis).
    this.transport = null
    // Neural voice trouble: `neuralOff` is the reason it was given up on (system voices only until retryNeural());
    // `missing` are voices the engine said are not installed any more (this reading only).
    this.neuralOff = ''; this.missing = new Set()
    window.addEventListener('inhouse-tts', event => {
      if (event.detail?.id !== this.utteranceId || this.state !== 'playing') return
      if (event.detail.type === 'start') this.engineStarted(event.detail.id)
      if (event.detail.type === 'done') { this.engineEnded(event.detail.id); this.advance() }
      if (event.detail.type === 'interrupted') this.pause()
      if (event.detail.type === 'error') this.engineFailed(event.detail)
    })
  }
  get native() { return typeof window.InhouseSpeech?.speak === 'function' }
  get supported() { return this.native || Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance) || neuralReady() }
  notify(message = '') { this.onState(this.state, message) }
  async play() {
    unlockNeural() // synchronously, inside the tap: the browser only lets the page start audio from a user gesture
    if (!this.supported) return this.fail('Actualiza la app Android para activar la lectura en voz alta, o utiliza un navegador con síntesis de voz.')
    if (this.state === 'playing' || this.state === 'loading') return
    if (this.state === 'paused' && this.chunks.length) {
      this.state = 'playing'; this.notify(); this.speakCurrent(); return
    }
    const generation = ++this.generation
    this.state = 'loading'; this.notify('Preparando la voz…')
    try {
      const plan = await this.prepare()
      if (generation !== this.generation) return
      this.adopt(plan)
      if (!this.chunks.length) return this.fail('Esta página no contiene texto legible. Los PDF escaneados necesitan reconocimiento de texto para escucharlos.')
      this.state = 'playing'; this.notify(); this.speakCurrent()
    } catch { if (generation === this.generation) this.fail('No se pudo preparar el texto para la lectura en voz alta.') }
  }
  speakCurrent() {
    if (this.state !== 'playing') return
    const id = `${this.generation}-${this.index}-${Date.now()}-${this.spoken = (this.spoken || 0) + 1}`
    this.utteranceId = id
    const text = this.chunks[this.index]
    let { language, voiceId, voice } = this.voiceFor(text)
    this.spokenWith = voice
    if (voice?.neural) {
      if (this.speakNeural(id, text, voice)) return
      ;({ language, voiceId, voice } = this.voiceFor(text)); this.spokenWith = voice // the engine is gone: a system voice takes this fragment
    }
    this.useTransport(this.native ? 'native' : 'web')
    this.armPresent(id)
    if (this.native) { window.InhouseSpeech.speak(text, language, this.rate, voiceId, id); return }
    const utterance = new SpeechSynthesisUtterance(text)
    this.utterance = utterance
    utterance.lang = language
    utterance.rate = this.rate
    const voices = speechSynthesis.getVoices()
    utterance.voice = (voiceId && voices.find(v => v.voiceURI === voiceId)) || voices.find(v => v.lang.startsWith(language.split('-')[0])) || null
    utterance.onstart = () => this.engineStarted(id)
    utterance.onend = () => { if (id === this.utteranceId && this.state === 'playing') { this.engineEnded(id); this.advance() } }
    utterance.onerror = event => { if (id === this.utteranceId && !['canceled','interrupted'].includes(event.error) && !this.useLocalVoice()) this.fail('No se pudo reproducir la voz. Prueba otra voz instalada.') }
    speechSynthesis.speak(utterance)
  }
  /**
   * Voice and language for one chunk; the ranking (best natural voice, per-chunk language) lives in voice-catalog.js.
   * Installed neural voices compete with the system ones (and win by default); a saved neural choice that is not
   * installed (any more) or given up on resolves to the best other voice, never to a system voice with a foreign id.
   */
  voiceFor(text) {
    const language = this.options.multilingual ? this.detectLanguage(text) : this.reader.language || navigator.language || 'es-ES'
    let voices = readSystemVoices(window), voiceId = this.voice
    if (!this.neuralOff) voices = [...voices, ...neuralVoiceList().filter(voice => voice.installed && !this.missing.has(voice.id))]
    if (this.localOnly) voices = voices.filter(voice => !voice.network)
    if (this.localOnly || isNeuralId(voiceId)) { if (!voices.some(voice => voice.id === voiceId)) voiceId = '' }
    return resolveVoice(voices, { voiceId, language, multilingual:this.options.multilingual, deviceLang:navigator.language })
  }
  useTransport(name) {
    if (this.transport !== name) this.heardStart = this.silentEngine = false // each engine says on its own whether it announces starts
    this.transport = name
  }
  /**
   * Hands the fragment to the neural engine, with the next few fragments (same voice and speed) so it can synthesise them while
   * this one plays. False when the engine is gone: the caller carries on with a system voice.
   */
  speakNeural(id, text, voice) {
    const engine = neuralEngine()
    if (!engine) { this.neuralOff = 'init-failed'; return false }
    clearTimeout(this.presentTimer)
    this.useTransport('neural')
    const upcoming = []
    for (let next = this.index + 1; next < this.chunks.length && upcoming.length < NEURAL_LOOKAHEAD; next++) {
      if (this.options.multilingual && this.voiceFor(this.chunks[next]).voice?.id !== voice.id) break // another language: another voice, not prefetched
      upcoming.push(this.chunks[next])
    }
    clearTimeout(this.waitTimer)
    this.waitTimer = setTimeout(() => { if (id === this.utteranceId && this.state === 'playing' && this.startedId !== id) { this.waiting = true; this.notify('Preparando la voz natural…') } }, NEURAL_WAIT_MS)
    try { engine.speak({ text, voiceId:voice.id, rate:this.rate, id, upcoming }) } catch { queueMicrotask(() => this.engineFailed({ id, reason:'synth-failed' })) }
    return true
  }
  /** The engine could not speak `detail.id`. A neural voice hands over to the best system voice; the others stop (or go local) as before. */
  engineFailed(detail) {
    if (this.transport !== 'neural') {
      if (!this.useLocalVoice()) this.fail('No hay una voz disponible para este idioma. Revisa las voces instaladas en Android.')
      return
    }
    const reason = detail.reason
    clearTimeout(this.waitTimer); this.waiting = false
    try { neuralEngine()?.stop() } catch { /* already stopped */ }
    if (reason === 'not-installed') { this.missing.add(this.spokenWith?.id); try { neuralEngine()?.refresh?.() } catch { /* the picker refreshes on its own */ } }
    else this.neuralOff = reason || 'synth-failed'
    this.notify(NEURAL_FALLBACK[reason] || NEURAL_FALLBACK.default)
    this.speakCurrent()
  }
  /** Lets the neural voice try again after it was given up on (the person changed the voice or the speed). */
  retryNeural() { this.neuralOff = ''; this.missing.clear() }
  /** An online voice failed (offline, quota): once per session, carry on with the best on-device voice instead of stopping. */
  useLocalVoice() {
    if (this.localOnly || !this.spokenWith?.network || this.state !== 'playing') return false
    this.localOnly = true
    this.speakCurrent()
    return true
  }
  async advance() {
    if (this.state !== 'playing') return
    if (++this.index < this.chunks.length) return this.speakCurrent()
    const generation = this.generation
    // The sentence just read stays painted while the page turns: the next one replaces it the moment it is heard (see present()).
    try {
      for (let blank = 0; blank < MAX_EMPTY_PAGES; blank++) {
        const previous = JSON.stringify(this.reader.location)
        await this.reader.next()
        if (generation !== this.generation || this.state !== 'playing') return
        for (let retry = 0; retry < END_RETRIES && JSON.stringify(this.reader.location) === previous; retry++) {
          await wait(END_RETRY_MS)
          if (generation !== this.generation || this.state !== 'playing') return
          await this.reader.next()
          if (generation !== this.generation || this.state !== 'playing') return
        }
        if (JSON.stringify(this.reader.location) === previous) { this.stop(); this.notify('Has llegado al final.'); return }
        const plan = await this.prepare()
        if (generation !== this.generation || this.state !== 'playing') return
        this.adopt(plan)
        if (this.chunks.length) return this.speakCurrent()
      }
      this.fail('La siguiente página no tiene texto legible. Puedes avanzar y volver a escuchar.')
    } catch { if (generation === this.generation) this.fail('No se pudo continuar en la siguiente página.') }
  }
  /**
   * Text to speak from the visible page on. Readers that can map text back to the
   * page hand over a source (offsets -> DOM) so each sentence can be highlighted
   * and followed; the others keep the plain text path, unhighlighted.
   */
  async prepare() {
    const pending = this.reader.getSpeechSource?.()
    const source = pending ? await pending : null
    if (!source) return { source, items:speechChunks(this.prepareText(await this.reader.getSpeechText())).map(text => ({ text })) }
    const { footnotes, skipHeaders } = this.options
    return { source, items:planSpeech(source.text, { footnotes, skipHeaders }, source.start || 0) }
  }
  adopt({ source, items }) {
    this.source = source; this.items = items; this.chunks = items.map(item => item.text); this.index = 0
  }
  // --- Highlight timing: what is painted and followed is what is being heard -------------------------------------------
  /** The engine reported the first audible word of utterance `id`. */
  engineStarted(id) {
    if (id !== this.utteranceId || this.state !== 'playing') return
    this.startedId = id
    clearTimeout(this.waitTimer)
    if (this.waiting) { this.waiting = false; this.notify() }
    this.present(id)
  }
  /** Safety net for engines (or old bridges) that never say when they start; a missing event must not leave the page plain. */
  armPresent(id) {
    clearTimeout(this.presentTimer)
    const ms = this.silentEngine ? SILENT_ENGINE_MS : this.heardStart ? SPOKEN_FALLBACK_MS : START_FALLBACK_MS
    this.presentTimer = setTimeout(() => this.present(id), ms)
  }
  /** The engine finished `id`: remember whether it ever announced a start, so a silent engine is not waited for again. */
  engineEnded(id) {
    if (this.transport === 'neural') { if (this.startedId !== id) this.present(id); return } // our engine always announces starts; if one was lost, still show the sentence
    if (this.startedId === id) this.heardStart = true
    else if (!this.heardStart) this.silentEngine = true
  }
  /**
   * Shows the sentence of the fragment being spoken and lets the reader bring it on screen. The sentence is painted once
   * for all its <=180 character fragments (a fragment only re-follows) and the previous one stays until it is replaced,
   * so there is no blank flash between sentences or at a page turn. Cosmetic: it can never stop the voice.
   */
  present(id = this.utteranceId) {
    clearTimeout(this.presentTimer)
    if (id !== this.utteranceId || this.state !== 'playing') return
    const item = this.items[this.index], source = this.source
    if (!source || !item?.sentence) return
    const { start, end } = item.sentence
    try {
      const shown = this.shown
      if (!shown || shown.source !== source || shown.start !== start || shown.end !== end) {
        if (shown && shown.source !== source) shown.source.clear?.()
        this.shown = { source, start, end }
        source.highlight?.(start, end)
      }
      Promise.resolve(source.follow?.(item.start, item.end)).catch(() => {})
    } catch { /* the page may have changed under a paused voice */ }
  }
  /** Removes the highlight (and the one a previous page left behind). */
  unpaint() {
    clearTimeout(this.presentTimer)
    const shown = this.shown
    this.shown = null
    shown?.source.clear?.()
    if (this.source !== shown?.source) this.source?.clear?.()
  }
  /** Re-speaks the current fragment, so a new speed or voice is heard now instead of at the next one. */
  restart() {
    if (this.state !== 'playing' || this.index >= this.chunks.length) return
    this.cancelUtterance(); this.speakCurrent()
  }
  cancelUtterance() {
    this.utteranceId = null; clearTimeout(this.presentTimer); clearTimeout(this.waitTimer); this.waiting = false
    if (this.transport === 'neural') { this.transport = null; try { neuralEngine()?.stop() } catch { /* nothing to stop */ } return }
    if (this.native) window.InhouseSpeech.stop()
    else window.speechSynthesis?.cancel()
  }
  prepareText(text) {
    let value = String(text || '')
    if (!this.options.footnotes) value = value.replace(/\[(?:\d{1,3}|[*†‡])\]/g,'').replace(/\(\s*(?:note|nota)\s+\d+\s*\)/gi,'')
    if (this.options.skipHeaders) {
      const lines = value.split(/\n+/)
      const counts = new Map()
      for (const line of lines) { const key=line.trim().toLocaleLowerCase(); if (key.length && key.length<90) counts.set(key,(counts.get(key)||0)+1) }
      value = lines.filter(line => { const key=line.trim().toLocaleLowerCase(); return !(key.length<90 && counts.get(key)>1) }).join(' ')
    }
    return value
  }
  detectLanguage(text) {
    return detectLanguage(text, this.reader.language || navigator.language || 'en-US')
  }
  pause() {
    if (this.state !== 'playing') return
    ++this.generation; this.state = 'paused'; this.cancelUtterance(); this.unpaint()
    if (this.index >= this.chunks.length) this.chunks = []
    this.notify()
  }
  stop() {
    ++this.generation; this.state = 'stopped'; this.cancelUtterance(); this.unpaint()
    this.chunks = []; this.items = []; this.source = null; this.index = 0; this.localOnly = false; this.missing.clear(); this.spokenWith = null; this.heardStart = this.silentEngine = false; clearTimeout(this.sleepTimer); this.notify()
  }
  fail(message) { this.stop(); this.notify(message) }
  setSleep(minutes) {
    clearTimeout(this.sleepTimer)
    if (minutes > 0) this.sleepTimer = setTimeout(() => { this.stop(); this.notify('Se ha detenido la voz al terminar el temporizador.') }, minutes * 60000)
  }
}
