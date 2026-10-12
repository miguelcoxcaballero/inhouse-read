import {advanceVoice} from './voice-advance.js'
import {dispatchVoice,dispatchNeuralVoice,failedVoiceEngine,removedVoice,sleepVoice} from './voice-dispatch.js'
import {refreshVoiceBreaks,prepareVoice,prepareVoiceOpening,prepareVoicePlayback,prepareNextVoice} from './voice-preparation.js'
import {startVoicePresentation,endVoicePresentation,presentVoice,unpaintVoice} from './voice-presentation.js'
import {prepareVoiceAhead,clearVoiceAhead,voicePageValid,revalidateVoiceNext,adoptVoicePlan} from './voice-ahead.js'
import {jumpVoicePoint,continueVoicePage,browseVoice,returnVoiceAudio,seekVoicePoint} from './voice-navigation.js'
import {joinVoiceSentence} from './voice-join.js'
import {selectReadingVoice,upcomingVoiceItems,voiceAudioItem,voiceNeedsJoin} from './voice-selection.js'
import {pauseReadingVoice,stopReadingVoice,restartReadingVoice,cancelReadingVoice,retryReadingVoice,failReadingVoice} from './voice-stop.js'
import {restartVisibleVoice,playReadingVoice} from './voice-start.js'
import { detectLanguage } from './voice-catalog.js'
import { neuralEngine } from './neural-runtime.js'
import { speechChunks } from './speech-text.js'
import { nativeAudio, nativePcmBridge } from './neural-voice/audio.js'

export { speechChunks }
/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader, onState = () => {}) {
    this.reader = reader
    this.onState = onState
    this.state = 'stopped'
    this.generation = 0
    this.openingLayout = 0
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
      if (event.detail.type === 'boundary') this.present(event.detail.id,event.detail.offset)
      if (event.detail.type === 'done') { this.diagnosticDones++; this.engineEnded(event.detail.id); this.advance() }
      if (event.detail.type === 'interrupted') this.pause()
      if (event.detail.type === 'error') this.engineFailed(event.detail)
    })
    // The reader measured new page breaks (a relayout, or a chapter read with
    // the screen off now on screen): re-cut what is still to be read there.
    window.addEventListener('inhouse-speech-layout', () => { ++this.openingLayout; this.openingPlan = null; void this.refreshPageBreaks() })
    window.addEventListener('inhouse-speech-hold', event => {
      if (this.state !== 'playing') return
      event.detail.handled = true
      if (!event.detail.probe) void this.seekToPoint(event.detail)
    })
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
  restartFromVisiblePage() { return restartVisibleVoice(this) }
  play() { return playReadingVoice(this) }
  speakCurrent() { return dispatchVoice(this) }
  /**
   * Voice and language for one chunk; the ranking (best natural voice, per-chunk language) lives in voice-catalog.js.
   * Automatic selection ranks installed natural voices. An explicit selection stays selected when its files are missing,
   * so the reader can explain which voice needs to be downloaded again.
   */
  voiceFor(text) { return selectReadingVoice(this,text) }
  useTransport(name) {
    this.transport = name
  }
  /**
   * Hands the fragment to the neural engine, with the next few fragments (same voice and speed) so it can synthesise them while
   * this one plays. A missing engine leaves a visible error for a manual retry.
   */
  speakNeural(id,text,voice) { return dispatchNeuralVoice(this,id,text,voice) }
  upcomingFor(voice) { return upcomingVoiceItems(this,voice) }
  audioItem(item) { return voiceAudioItem(item) }
  needsPageJoin(item,index) { return voiceNeedsJoin(this,item,index) }
  joinPageSentence() { return joinVoiceSentence(this) }
  /** One detached page, prepared only near the current page's end. Never
   * reveal it or let its PCM play until advance adopts its first fragment. */
  prepareAhead() { return prepareVoiceAhead(this) }
  clearAhead() { return clearVoiceAhead(this) }
  /** Retry a failed worker with the same natural voice, then expose the error for a manual retry. */
  engineFailed(detail) { return failedVoiceEngine(this,detail) }
  /** Lets the neural voice try again after it was given up on (the person changed the voice or the speed). */
  retryNeural() { return retryReadingVoice(this) }
  /** A neural voice was removed (the person tapped Quitar): the reading in progress stops using it now, not when its files are gone. */
  voiceRemoved(id) { return removedVoice(this,id) }
  advance() { return advanceVoice(this) }
  /** Explicit seek helper; page gestures use seekToPoint after a long hold. */
  jumpToPoint(point = {}) { return jumpVoicePoint(this,point) }
  continueFromPage(navigate) { return continueVoicePage(this,navigate) }
  browse() { return browseVoice(this) }
  returnToAudio() { return returnVoiceAudio(this) }
  seekToPoint(point) { return seekVoicePoint(this,point) }
  refreshPageBreaks() { return refreshVoiceBreaks(this) }
  prepare(source,opening = false) { return prepareVoice(this,source,opening) }
  prepareOpening() { return prepareVoiceOpening(this) }
  preparePlayback(isActive = () => true) { return prepareVoicePlayback(this,isActive) }
  prepareNext(generation) { return prepareNextVoice(this,generation) }
  pagePlanValid(plan) { return voicePageValid(plan) }
  revalidateNext(plan,generation) { return revalidateVoiceNext(this,plan,generation) }
  adopt(plan) { return adoptVoicePlan(this,plan) }
  // --- Highlight timing: what is painted and followed is what is being heard -------------------------------------------
  /** The engine reported the first audible word of utterance `id`. */
  engineStarted(id) { return startVoicePresentation(this,id) }
  engineEnded(id) { return endVoicePresentation(this,id) }
  present(id = this.utteranceId, offset = 0) { return presentVoice(this,id,offset) }
  unpaint() { return unpaintVoice(this) }
  /** Re-speaks the current fragment, so a new speed or voice is heard now instead of at the next one. */
  restart() { return restartReadingVoice(this) }
  cancelUtterance(reason = 'stop') { return cancelReadingVoice(this,reason) }
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
  pause() { return pauseReadingVoice(this) }
  stop() { return stopReadingVoice(this) }
  fail(message) { return failReadingVoice(this,message) }
  setSleep(minutes) { return sleepVoice(this,minutes) }

}
