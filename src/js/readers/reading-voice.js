import { detectLanguage, readSystemVoices, resolveVoice } from './voice-catalog.js'
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
    window.addEventListener('inhouse-tts', event => {
      if (event.detail?.id !== this.utteranceId || this.state !== 'playing') return
      if (event.detail.type === 'start') this.engineStarted(event.detail.id)
      if (event.detail.type === 'done') { this.engineEnded(event.detail.id); this.advance() }
      if (event.detail.type === 'interrupted') this.pause()
      if (event.detail.type === 'error' && !this.useLocalVoice()) this.fail('No hay una voz disponible para este idioma. Revisa las voces instaladas en Android.')
    })
  }
  get native() { return typeof window.InhouseSpeech?.speak === 'function' }
  get supported() { return this.native || Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance) }
  notify(message = '') { this.onState(this.state, message) }
  async play() {
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
    this.armPresent(id)
    const text = this.chunks[this.index]
    const { language, voiceId, voice } = this.voiceFor(text)
    this.spokenWith = voice
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
  /** Voice and language for one chunk; the ranking (best natural voice, per-chunk language) lives in voice-catalog.js. */
  voiceFor(text) {
    const language = this.options.multilingual ? this.detectLanguage(text) : this.reader.language || navigator.language || 'es-ES'
    let voices = readSystemVoices(window), voiceId = this.voice
    if (this.localOnly) { voices = voices.filter(voice => !voice.network); if (!voices.some(voice => voice.id === voiceId)) voiceId = '' }
    return resolveVoice(voices, { voiceId, language, multilingual:this.options.multilingual, deviceLang:navigator.language })
  }
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
    this.utteranceId = null; clearTimeout(this.presentTimer)
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
    this.chunks = []; this.items = []; this.source = null; this.index = 0; this.localOnly = false; this.spokenWith = null; this.heardStart = this.silentEngine = false; clearTimeout(this.sleepTimer); this.notify()
  }
  fail(message) { this.stop(); this.notify(message) }
  setSleep(minutes) {
    clearTimeout(this.sleepTimer)
    if (minutes > 0) this.sleepTimer = setTimeout(() => { this.stop(); this.notify('Se ha detenido la voz al terminar el temporizador.') }, minutes * 60000)
  }
}
