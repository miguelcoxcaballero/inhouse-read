import { declaredLanguage, detectLanguage, isNeuralId, langBase, resolveVoice } from './voice-catalog.js'
import { loadNeural, neuralEngine, neuralVoiceList, unlockNeural } from './neural-runtime.js'
import { planSpeech, speechChunks } from './speech-text.js'
import { nativeAudio, nativePcmBridge } from './neural-voice/audio.js'

export { speechChunks }
// Blank or image-only pages passed over, one page turn at a time, before giving up.
const MAX_EMPTY_PAGES = 12
// foliate ignores a page turn while another one animates (the voice's own follow turn included): next() is retried
// this many times, this far apart, before an unchanged location is taken as the end of the book.
const END_RETRIES = 2, END_RETRY_MS = 200
// A changed reader viewport can invalidate detached pixels while current audio
// keeps playing. Rebuild that candidate without discarding its cached voice PCM.
const PAGE_PREPARATION_RETRIES = 2
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
// A neural voice always reports its 'start' (it is our own engine), so it has no fallback timer: it is waited for, and
// the status says so after NEURAL_WAIT_MS. It reads this many fragments ahead (same voice and speed) to stay gapless.
const NEURAL_WAIT_MS = 900, NEURAL_LOOKAHEAD = 4
// A neural worker that dies mid-reading (a phone's WebView short of memory) is rebuilt and the fragment spoken again, this many
// times in a row, before the voice is given up on. A fragment that is heard to the end clears the count, so a worker that
// only dies now and then never ends the neural reading.
const NEURAL_RETRIES = 3
const NEURAL_ERRORS = {
  'not-installed':'La voz natural seleccionada no está instalada. Descárgala de nuevo.',
  default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'
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
    this.preparingPage = null; this.deferredPage = null; this.resumeNextPage = false
    this.aheadPage = null
    this.diagnosticAdvance = null
    this.diagnosticStarts = 0; this.diagnosticDones = 0
    // The native bridge reads this synchronous, session-gated getter after real callbacks.
    // This instance is the app's single reader voice; no worker/model is loaded by installation.
    window.InhouseReadAudioDiagnostics = session => this.getDiagnosticState(session)
    this.rate = 1
    this.voice = ''
    this.languageOverride = '' // 'es', 'en'... chosen in the Idioma dropdown; '' follows the book
    this.options = {footnotes:false,multilingual:false,skipHeaders:false}
    // Reading uses only the selected on-device neural engine.
    this.transport = null
    // Failure remains visible until the person retries; it never changes the selected voice.
    this.neuralOff = ''; this.missing = new Set(); this.neuralRetries = 0
    try { localStorage.removeItem('inhouse-read-neural-slow') } catch { /* obsolete policy is never consulted */ }
    window.addEventListener('inhouse-tts', event => {
      if (event.detail?.id !== this.utteranceId || this.state !== 'playing') return
      if (event.detail.type === 'start') { this.diagnosticStarts++; this.engineStarted(event.detail.id) }
      if (event.detail.type === 'done') { this.diagnosticDones++; this.engineEnded(event.detail.id); this.advance() }
      if (event.detail.type === 'interrupted') this.pause()
      if (event.detail.type === 'error') this.engineFailed(event.detail)
    })
    // The reader measured new page breaks (a relayout, or a chapter read with
    // the screen off now on screen): re-cut what is still to be read there.
    window.addEventListener('inhouse-speech-layout', () => { void this.refreshPageBreaks() })
    window.addEventListener('inhouse-audio-control', event => {
      const detail = event.detail
      if (!nativePcmBridge() || !this.nativeSession || detail?.session !== this.nativeSession) return
      if (detail.action === 'pause') this.pause()
      else if (detail.action === 'stop') this.stop()
      else if (detail.action === 'play' && this.state === 'paused') this.play()
    })
  }
  getDiagnosticState(session) {
    if (!this.nativeSession || session !== this.nativeSession) return null
    const numeric = value => Number.isFinite(value) && value >= 0 ? value : 0
    const reader = this.reader.speechDiagnosticState
    const position = this.reader.speechPosition
    const advance = this.diagnosticAdvance?.generation === this.generation ? this.diagnosticAdvance : null
    return {
      schema:1, sessionMatches:true, nativeSessionMatches:nativeAudio()?.session === this.nativeSession,
      hidden:Boolean(document.hidden), visibility:['visible','hidden','prerender'].includes(document.visibilityState) ? document.visibilityState : 'unknown',
      state:this.state, generation:this.generation, utteranceSequence:numeric(this.spoken),
      utterancePresent:Boolean(this.utteranceId), utteranceStarted:Boolean(this.utteranceId && this.startedId === this.utteranceId),
      index:this.index, chunkCount:this.chunks.length, itemCount:this.items.length,
      ttsStarts:this.diagnosticStarts, ttsDones:this.diagnosticDones, advanceStage:advance?.stage || 'idle',
      preparingPage:Boolean(this.preparingPage?.generation === this.generation), deferredPage:Boolean(this.deferredPage), aheadPage:Boolean(this.aheadPage),
      reader:{ kind:['pdf','foliate'].includes(reader?.kind) ? reader.kind : 'none',
        index:Number.isInteger(position?.index) && position.index >= 0 ? position.index : null,
        followPending:numeric(reader?.followPending), pageTurnPending:numeric(reader?.pageTurnPending),
        ...(reader?.paginator ? { paginator:{
          turnStage:Number.isInteger(reader.paginator.turnStage) && reader.paginator.turnStage >= 0 && reader.paginator.turnStage <= 3 ? reader.paginator.turnStage : 0,
          displayStage:Number.isInteger(reader.paginator.displayStage) && reader.paginator.displayStage >= 0 && reader.paginator.displayStage <= 6 ? reader.paginator.displayStage : 0,
          sectionLoadPending:Boolean(reader.paginator.sectionLoadPending), viewLoadPending:Boolean(reader.paginator.viewLoadPending),
          viewReady:Number.isInteger(reader.paginator.viewReady) && reader.paginator.viewReady >= 0 && reader.paginator.viewReady <= 3 ? reader.paginator.viewReady : 0,
        }} : {}) },
      engine:neuralEngine()?.getDiagnosticState?.() ?? null
    }
  }
  get supported() { return Boolean(neuralEngine()) }
  notify(message = '') { this.onState(this.state, message) }
  async play() {
    unlockNeural() // synchronously, inside the tap: the browser only lets the page start audio from a user gesture
    this.nativeSession = nativeAudio()?.session || null
    if (this.state === 'playing' || this.state === 'loading') return
    this.retryNeural()
    if (this.state === 'paused' && this.chunks.length && !this.resumeNextPage) {
      this.state = 'playing'; this.notify(); this.speakCurrent(); return
    }
    const generation = ++this.generation
    this.state = 'loading'; this.notify('Preparando la voz…')
    try {
      await loadNeural()
      if (generation !== this.generation) return
      const engine = neuralEngine()
      if (!engine) return this.fail('Este dispositivo no puede reproducir voces naturales.')
      try { await engine.refresh?.() } catch {
        if (generation !== this.generation) return
        this.neuralOff = 'init-failed'; return this.fail(NEURAL_ERRORS.default)
      }
      if (generation !== this.generation) return
      const next = this.resumeNextPage ? await this.prepareNext(generation) : undefined
      if (generation !== this.generation) return
      if (next === null) { this.stop(); this.notify('Final del libro.'); return }
      const plan = next || await this.prepare()
      if (generation !== this.generation) return
      this.adopt(plan)
      this.resumeNextPage = false
      if (!this.chunks.length) return this.fail('Esta página no contiene texto legible. Los PDF escaneados necesitan reconocimiento de texto para escucharlos.')
      this.state = 'playing'; this.notify(); this.speakCurrent()
    } catch { if (generation === this.generation) this.fail('No se pudo preparar el texto.') }
  }
  speakCurrent() {
    if (this.state !== 'playing') return
    const id = `${this.generation}-${this.index}-${Date.now()}-${this.spoken = (this.spoken || 0) + 1}`
    this.utteranceId = id
    const text = this.chunks[this.index]
    const { language, voice } = this.voiceFor(text)
    this.spokenWith = voice
    if (voice?.neural) { this.speakNeural(id, text, voice); return }
    this.neuralOff = 'not-installed'
    const available = neuralVoiceList().some(candidate => candidate.base === langBase(language))
    this.fail(this.voice && isNeuralId(this.voice) ? NEURAL_ERRORS['not-installed'] : available
      ? 'Descarga una voz natural para este idioma.' : 'No hay voz natural para este idioma. Elige uno de los idiomas disponibles.')
  }
  /**
   * Voice and language for one chunk; the ranking (best natural voice, per-chunk language) lives in voice-catalog.js.
   * Automatic selection ranks installed natural voices. An explicit selection stays selected when its files are missing,
   * so the reader can explain which voice needs to be downloaded again.
   */
  voiceFor(text) {
    const language = this.options.multilingual ? this.detectLanguage(text) : this.languageOverride || this.reader.language || navigator.language || 'es-ES'
    const voices = neuralVoiceList().filter(voice => voice.installed && !this.missing.has(voice.id))
    let voiceId = isNeuralId(this.voice) ? this.voice : ''
    // A neural voice speaks one language (its phonemiser is the language's): a saved choice for another language than the one the
    // book DECLARES would garble it, so an English book read after picking a Spanish voice gets the automatic pick for English
    // instead. A book that declares nothing (a PDF) keeps the person's choice: the device language says nothing about it.
    const declared = declaredLanguage(this.reader)
    if (isNeuralId(voiceId) && !this.options.multilingual && declared && !this.languageOverride) {
      const chosen = voices.find(voice => voice.id === voiceId)
      if (chosen && chosen.base !== langBase(declared)) voiceId = ''
    }
    if (voiceId && !voices.some(voice => voice.id === voiceId)) return { voice:null, voiceId, language }
    return resolveVoice(voices, { voiceId, language, multilingual:this.options.multilingual, deviceLang:navigator.language })
  }
  useTransport(name) {
    this.transport = name
  }
  /**
   * Hands the fragment to the neural engine, with the next few fragments (same voice and speed) so it can synthesise them while
   * this one plays. A missing engine leaves a visible error for a manual retry.
   */
  speakNeural(id, text, voice) {
    const engine = neuralEngine()
    if (!engine) { this.neuralOff = 'init-failed'; this.fail(NEURAL_ERRORS.default); return false }
    clearTimeout(this.presentTimer)
    this.useTransport('neural')
    const { upcoming, deferAfter } = this.upcomingFor(voice)
    clearTimeout(this.waitTimer)
    this.waitTimer = setTimeout(() => { if (id === this.utteranceId && this.state === 'playing' && this.startedId !== id) { this.waiting = true; this.notify('Preparando la voz natural…') } }, NEURAL_WAIT_MS)
    try {
      engine.speak({ text, voiceId:voice.id, rate:this.rate, id, upcoming, deferAfter })
      this.nativeSession = nativeAudio()?.session || this.nativeSession
    } catch { queueMicrotask(() => this.engineFailed({ id, reason:'synth-failed' })) }
    return true
  }
  upcomingFor(voice) {
    const upcoming = []
    for (let next = this.index + 1; next < this.chunks.length && upcoming.length < NEURAL_LOOKAHEAD; next++) {
      if (this.options.multilingual && this.voiceFor(this.chunks[next]).voice?.id !== voice.id) break // another language: another voice, not prefetched
      upcoming.push(this.chunks[next])
    }
    const deferAfter = upcoming.length
    const plan = this.aheadPage?.plan
    if (this.index + 1 + upcoming.length === this.chunks.length && plan?.items) {
      for (const item of plan.items.slice(0, NEURAL_LOOKAHEAD)) {
        if (this.voiceFor(item.text).voice?.id !== voice.id) break
        upcoming.push(item.text)
      }
    }
    return { upcoming, deferAfter }
  }
  /** One detached page, prepared only near the current page's end. Never
   * reveal it or let its PCM play until advance adopts its first fragment. */
  prepareAhead() {
    if (this.aheadPage?.error?.name === 'AbortError' ||
      this.aheadPage?.plan && !this.pagePlanValid(this.aheadPage.plan)) this.clearAhead()
    if (this.state !== 'playing' || this.aheadPage || this.deferredPage ||
      this.chunks.length - this.index - 1 > NEURAL_LOOKAHEAD || typeof this.reader.getNextSpeechSource !== 'function') return
    const request = { generation:this.generation, source:this.source, plan:undefined, cancelled:false }
    this.aheadPage = request
    const isActive = () => !request.cancelled && request.generation === this.generation &&
      this.state === 'playing' && (this.source === request.source || this.source === request.plan?.source)
    request.promise = (async () => {
      let source
      try {
        source = await this.reader.getNextSpeechSource({ isActive })
        if (!isActive()) { source?.clear?.(); return undefined }
        if (source === undefined && this.aheadPage === request) this.aheadPage = null
        request.plan = source == null ? source : await this.prepare(source)
        if (!isActive()) { source?.clear?.(); request.plan = undefined; return undefined }
        const { voice } = this.voiceFor(this.chunks[this.index])
        if (voice && this.index < this.chunks.length) {
          const { upcoming, deferAfter } = this.upcomingFor(voice)
          neuralEngine()?.extendUpcoming?.({ id:this.utteranceId, voiceId:voice.id, rate:this.rate, upcoming, deferAfter })
        }
        return request.plan
      } catch (error) { source?.clear?.(); request.error = error; return undefined }
    })()
  }
  clearAhead() {
    const ahead = this.aheadPage
    this.aheadPage = null
    if (ahead) { ahead.cancelled = true; ahead.plan?.source?.clear?.() }
  }
  /** Retry a failed worker with the same natural voice, then expose the error for a manual retry. */
  engineFailed(detail) {
    if (detail.id !== this.utteranceId || this.state !== 'playing' || this.transport !== 'neural') return
    const reason = detail.reason
    clearTimeout(this.waitTimer); this.waiting = false
    try { neuralEngine()?.stop() } catch { /* already stopped */ }
    if ((reason === 'synth-failed' || reason === 'init-failed') && this.neuralRetries < NEURAL_RETRIES) {
      // The engine already dropped its dead worker: speaking the same fragment again starts a fresh one.
      this.neuralRetries++
      this.notify('Reiniciando la voz natural…')
      this.speakCurrent()
      return
    }
    this.neuralOff = reason || 'synth-failed'
    if (reason === 'not-installed') { this.missing.add(this.spokenWith?.id); Promise.resolve(neuralEngine()?.refresh?.()).catch(() => {}) }
    this.pause()
    this.notify(NEURAL_ERRORS[reason] || NEURAL_ERRORS.default)
  }
  /** Lets the neural voice try again after it was given up on (the person changed the voice or the speed). */
  retryNeural() { this.neuralOff = ''; this.neuralRetries = 0; this.missing.clear() }
  /** A neural voice was removed (the person tapped Quitar): the reading in progress stops using it now, not when its files are gone. */
  voiceRemoved(id) {
    this.missing.add(id)
    if (this.state === 'playing' && this.spokenWith?.id === id) { this.pause(); this.notify('Voz natural quitada. Elige otra voz natural para continuar.') }
  }
  async advance() {
    if (this.state !== 'playing') return
    if (++this.index < this.chunks.length) return this.speakCurrent()
    const generation = this.generation
    const diagnostic = this.diagnosticAdvance = { generation, stage:'prepare-next' }
    // The sentence just read stays painted while the page turns: the next one replaces it the moment it is heard (see present()).
    try {
      if (typeof this.reader.getNextSpeechSource === 'function') {
        const ahead = this.aheadPage
        let next
        if (ahead) {
          this.aheadPage = null
          const request = { generation }; this.preparingPage = request
          try {
            next = await ahead.promise
            if (ahead.error) {
              if (ahead.error.name !== 'AbortError' || generation !== this.generation || this.state !== 'playing') throw ahead.error
              next = await this.prepareNext(generation)
            }
          }
          finally { if (this.preparingPage === request) this.preparingPage = null }
          if (next === undefined && generation === this.generation && this.state === 'playing') next = await this.prepareNext(generation)
        } else next = await this.prepareNext(generation)
        if (generation !== this.generation || this.state !== 'playing') { next?.source?.clear?.(); return }
        if (!this.pagePlanValid(next)) next = await this.revalidateNext(next, generation)
        if (generation !== this.generation || this.state !== 'playing') { next?.source?.clear?.(); return }
        if (next === null) { this.stop(); this.notify('Final del libro.'); return }
        if (next !== undefined) {
          this.adopt(next)
          if (!this.chunks.length) return this.fail('Página siguiente sin texto legible.')
          return this.speakCurrent()
        }
      }
      const isActive = () => generation === this.generation && this.state === 'playing'
      for (let blank = 0; blank < MAX_EMPTY_PAGES; blank++) {
        const previous = JSON.stringify(this.reader.location)
        diagnostic.stage = 'next-turn'
        await this.reader.next({ source:true, isActive })
        if (generation !== this.generation || this.state !== 'playing') return
        for (let retry = 0; retry < END_RETRIES && JSON.stringify(this.reader.location) === previous; retry++) {
          diagnostic.stage = 'retry-wait'
          await wait(END_RETRY_MS)
          if (generation !== this.generation || this.state !== 'playing') return
          diagnostic.stage = 'retry-turn'
          await this.reader.next({ source:true, isActive })
          if (generation !== this.generation || this.state !== 'playing') return
        }
        if (JSON.stringify(this.reader.location) === previous) { this.stop(); this.notify('Final del libro.'); return }
        diagnostic.stage = 'prepare-source'
        const plan = await this.prepare()
        if (generation !== this.generation || this.state !== 'playing') return
        this.adopt(plan)
        if (this.chunks.length) return this.speakCurrent()
      }
      this.fail('Página siguiente sin texto legible.')
    } catch { if (generation === this.generation) this.fail('No se pudo pasar de página.') }
    finally { if (this.diagnosticAdvance === diagnostic) this.diagnosticAdvance = null }
  }
  /**
   * Text to speak from the visible page on. Readers that can map text back to the
   * page hand over a source (offsets -> DOM) so each sentence can be highlighted
   * and followed; the others keep the plain text path, unhighlighted.
   */
  /**
   * Fragments end where pages end, so the next audible fragment turns the page
   * at the first word of the next page. Those cuts were measured when the
   * source was built; after a relayout (fonts, a real resize) or for a
   * chapter first read with the screen off they are stale or missing, and the
   * page waited for the next sentence. The fragment being heard is kept; the
   * rest of the source is re-cut at the measured breaks, and the engine gets
   * the new upcoming texts (what it already prepared and still matches is kept).
   */
  async refreshPageBreaks() {
    const source = this.source, generation = this.generation, index = this.index
    if (this.state !== 'playing' || typeof source?.measurePageBreaks !== 'function') return false
    let pageBreaks
    try { pageBreaks = await source.measurePageBreaks() } catch { return false }
    if (!Array.isArray(pageBreaks) || this.state !== 'playing' || generation !== this.generation ||
      this.source !== source || this.index !== index) return false
    const current = this.items[index]
    if (!current) return false
    const known = source.pageBreaks || []
    if (known.length === pageBreaks.length && known.every((at, i) => at === pageBreaks[i])) return false
    source.pageBreaks = pageBreaks
    const rest = (await this.prepare({ ...source, start:current.end })).items
      .map(item => item.start < current.sentence.end && item.sentence.start >= current.sentence.start ? { ...item, sentence:current.sentence } : item)
    if (this.state !== 'playing' || generation !== this.generation || this.source !== source || this.index !== index) return false
    this.items = [...this.items.slice(0, index + 1), ...rest]
    this.chunks = this.items.map(item => item.text)
    const { voice } = this.voiceFor(this.chunks[index])
    if (voice) {
      const { upcoming, deferAfter } = this.upcomingFor(voice)
      neuralEngine()?.extendUpcoming?.({ id:this.utteranceId, voiceId:voice.id, rate:this.rate, upcoming, deferAfter })
    }
    return true
  }
  async prepare(source) {
    if (source === undefined) {
      const pending = this.reader.getSpeechSource?.()
      source = pending ? await pending : null
    }
    if (!source) return { source, items:speechChunks(this.prepareText(await this.reader.getSpeechText())).map(text => ({ text })) }
    const { footnotes, skipHeaders } = this.options
    return { source, items:planSpeech(source.text, { footnotes, skipHeaders, pageBreaks:source.pageBreaks, headerRanges:source.headerRanges }, source.start || 0) }
  }
  /** Optional fixed-page preparation: it must leave the current page visible until an audible start. */
  async prepareNext(generation) {
    if (typeof this.reader.getNextSpeechSource !== 'function') return undefined
    const request = { generation }; this.preparingPage = request
    const isActive = () => generation === this.generation && (this.state === 'playing' || this.state === 'loading')
    let source
    try {
      for (let retry = 0; retry <= PAGE_PREPARATION_RETRIES; retry++) {
        try {
          source = await this.reader.getNextSpeechSource({ isActive })
          if (!isActive()) { source?.clear?.(); return undefined }
          // undefined means this format has no deferred-page API; null means an actual end, never a cancelled preparation.
          if (source == null) return source
          const plan = await this.prepare(source)
          if (!isActive()) { source.clear?.(); return undefined }
          if (this.pagePlanValid(plan)) return plan
          source.clear?.(); source = null
          if (retry === PAGE_PREPARATION_RETRIES) throw new Error('La página preparada sigue cambiando.')
        } catch (error) {
          source?.clear?.(); source = null
          if (!isActive()) return undefined
          if (error.name !== 'AbortError' || retry === PAGE_PREPARATION_RETRIES) throw error
        }
      }
    } catch (error) { source?.clear?.(); throw error }
    finally { if (this.preparingPage === request) this.preparingPage = null }
  }
  pagePlanValid(plan) {
    try { return !plan?.source?.isValid || plan.source.isValid() === true }
    catch { return false }
  }
  async revalidateNext(plan, generation) {
    if (this.pagePlanValid(plan)) return plan
    plan?.source?.clear?.()
    if (generation !== this.generation || this.state !== 'playing') return undefined
    return this.prepareNext(generation)
  }
  adopt({ source, items }) {
    this.source = source; this.items = items; this.chunks = items.map(item => item.text); this.index = 0
    this.deferredPage = typeof source?.activate === 'function' ? source : null
  }
  // --- Highlight timing: what is painted and followed is what is being heard -------------------------------------------
  /** The engine reported the first audible word of utterance `id`. */
  engineStarted(id) {
    if (id !== this.utteranceId || this.state !== 'playing') return
    this.startedId = id
    clearTimeout(this.waitTimer)
    if (this.waiting) { this.waiting = false; this.notify() }
    this.present(id)
    const native = nativeAudio(), position = this.reader.speechPosition
    if (native?.session === this.nativeSession && Number.isInteger(position?.index)) {
      try { native.bridge.mark?.(native.session, id, position.index, position.kind) } catch { /* media progress is advisory */ }
    }
    if (this.state === 'playing') this.prepareAhead()
  }
  /** The engine finished `id`: remember whether it ever announced a start, so a silent engine is not waited for again. */
  engineEnded(id) {
    this.neuralRetries = 0
    if (this.startedId !== id && this.source?.activate) { this.pause(); this.notify(NEURAL_ERRORS.default); return }
    if (this.startedId !== id) this.present(id)
  }
  /**
   * Shows the sentence of the fragment being spoken and lets the reader bring it on screen. The sentence is painted once
   * for all its <=180 character fragments (a fragment only re-follows) and the previous one stays until it is replaced,
   * so there is no blank flash between sentences or at a page turn. A deferred fixed page commits before its highlight;
   * an invalidated page pauses the voice. Highlight and follow failures remain cosmetic.
   */
  present(id = this.utteranceId) {
    clearTimeout(this.presentTimer)
    if (id !== this.utteranceId || this.state !== 'playing') return
    const item = this.items[this.index], source = this.source
    if (!source || !item?.sentence) return
    if (source.activate) {
      // A no-start completion may paint a legacy source, but can never reveal a prepared next page.
      if (this.startedId !== id) return
      let activated = false
      try { activated = source.activate() } catch { /* navigation or layout invalidated the prepared page */ }
      if (activated !== true) { this.pause(); this.notify('No se pudo mostrar la página. Pulsa Reintentar para continuar.'); return }
      this.deferredPage = null
    }
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
    const preparing = this.waiting // the 'Preparando la voz natural…' of the old utterance must not outlive it
    this.clearAhead()
    this.cancelUtterance('restart')
    if (preparing) this.notify()
    this.speakCurrent()
  }
  cancelUtterance(reason = 'stop') {
    this.utteranceId = null; clearTimeout(this.presentTimer); clearTimeout(this.waitTimer); this.waiting = false
    if (this.transport === 'neural' || nativeAudio()) {
      this.transport = null
      try {
        const engine = neuralEngine()
        if (reason === 'restart' && engine?.cancelCurrent) engine.cancelCurrent()
        else if (reason === 'pause' && engine?.pause) engine.pause()
        else engine?.stop()
      } catch { /* nothing to stop */ }
    }
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
    if (this.state !== 'playing' && this.state !== 'loading') return
    const pendingPage = this.deferredPage || this.preparingPage?.generation === this.generation
    if (pendingPage) this.resumeNextPage = true
    this.clearAhead()
    this.diagnosticAdvance = null
    ++this.generation; this.state = 'paused'; this.cancelUtterance('pause'); this.unpaint()
    if (pendingPage) { this.chunks = []; this.items = []; this.source = null; this.index = 0; this.deferredPage = null }
    if (this.index >= this.chunks.length) this.chunks = []
    this.notify()
  }
  stop() {
    this.clearAhead()
    this.diagnosticAdvance = null
    ++this.generation; this.state = 'stopped'; this.cancelUtterance(); this.unpaint()
    this.nativeSession = null
    this.preparingPage = null; this.deferredPage = null; this.resumeNextPage = false
    this.chunks = []; this.items = []; this.source = null; this.index = 0; this.missing.clear(); this.spokenWith = null; clearTimeout(this.sleepTimer); this.notify()
  }
  fail(message) { this.stop(); this.notify(message) }
  setSleep(minutes) {
    clearTimeout(this.sleepTimer)
    if (minutes > 0) this.sleepTimer = setTimeout(() => { this.stop(); this.notify('Temporizador terminado.') }, minutes * 60000)
  }
}
