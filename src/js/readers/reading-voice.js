import {initializeVoiceSession,voiceSessionEvent,diagnosticVoice,prepareVoiceText} from './voice-session.js'
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

export { speechChunks }
/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader,onState=()=>{}) {
    initializeVoiceSession(this,reader,onState)
    window.InhouseReadAudioDiagnostics=session=>this.getDiagnosticState(session)
    try{localStorage.removeItem('inhouse-read-neural-slow')}catch{/* obsolete preference */}
    for(const type of ['inhouse-tts','inhouse-speech-layout','inhouse-speech-hold','inhouse-audio-control'])
      window.addEventListener(type,event=>voiceSessionEvent(this,type,event.detail))
  }
  getDiagnosticState(session) { return diagnosticVoice(this,session) }
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
  prepareText(text) { return prepareVoiceText(this,text) }
  detectLanguage(text) {
    return detectLanguage(text, this.reader.language || navigator.language || 'en-US')
  }
  pause() { return pauseReadingVoice(this) }
  stop() { return stopReadingVoice(this) }
  fail(message) { return failReadingVoice(this,message) }
  setSleep(minutes) { return sleepVoice(this,minutes) }

}
