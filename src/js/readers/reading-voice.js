import {readerUI} from './rust-ui-required.js'
import {loadNeural,neuralEngine,neuralVoiceList,unlockNeural} from './neural-runtime.js'
import {nativeAudio,nativePcmBridge} from './neural-voice/audio.js'
import {declaredLanguage,detectLanguage,isNeuralId,langBase,resolveVoice} from './voice-catalog.js'
import {firstCompleteSentenceOffset,planSpeech,speechChunks} from './speech-text.js'

export { speechChunks }
// The audiobook's session (rust-ui voice_*.rs): what is spoken next, prepared, presented, joined across pages,
// navigated, paused and stopped. These methods hand Rust the session (`this`) and the engine, audio and timer
// doorways it calls back; the frozen JavaScript originals are tests/unit/helpers/reference-voice-*.js.
const clearTimer=id=>clearTimeout(id),add=(a,b)=>a+b,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const ignore=value=>Promise.resolve(value).catch(()=>{}),deviceLanguage=()=>navigator.language
/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader,onState=()=>{}) {
    readerUI().voice_initialize(this,reader,onState)
    window.InhouseReadAudioDiagnostics=session=>this.getDiagnosticState(session)
    try{localStorage.removeItem('inhouse-read-neural-slow')}catch{/* obsolete preference */}
    for(const type of ['inhouse-tts','inhouse-speech-layout','inhouse-speech-hold','inhouse-audio-control'])
      window.addEventListener(type,event=>readerUI().voice_event(this,type,event.detail,nativePcmBridge))
  }
  getDiagnosticState(session) { return readerUI().voice_diagnostic(this,session,nativeAudio,neuralEngine,document) }
  get supported() { return Boolean(neuralEngine()) }
  notify(message = '') { this.onState(this.state, message) }
  restartFromVisiblePage() { return readerUI().voice_restart_visible(this) }
  async play() { return readerUI().voice_play(this,loadNeural,neuralEngine,unlockNeural,nativeAudio) }
  speakCurrent() {
    const ui=readerUI()
    return ui.voice_speak_current(this,neuralVoiceList,langBase,isNeuralId,Date.now,(owner,promise,generation,index)=>{void promise.then(()=>ui.voice_join_ready(owner,generation,index))})
  }
  /**
   * Voice and language for one chunk; the ranking (best natural voice, per-chunk language) lives in voice-catalog.js.
   * Automatic selection ranks installed natural voices. An explicit selection stays selected when its files are missing,
   * so the reader can explain which voice needs to be downloaded again.
   */
  voiceFor(text) { return readerUI().voice_for(this,text,neuralVoiceList,isNeuralId,declaredLanguage,langBase,resolveVoice,deviceLanguage) }
  useTransport(name) {
    this.transport = name
  }
  /**
   * Hands the fragment to the neural engine, with the next few fragments (same voice and speed) so it can synthesise them while
   * this one plays. A missing engine leaves a visible error for a manual retry.
   */
  speakNeural(id,text,voice) {
    const ui=readerUI()
    return ui.voice_speak_neural(this,id,text,voice,neuralEngine,nativeAudio,clearTimeout,(owner,id)=>setTimeout(()=>ui.voice_wait_started(owner,id),900),
      (owner,id)=>queueMicrotask(()=>owner.engineFailed({id,reason:'synth-failed'})))
  }
  upcomingFor(voice) { return readerUI().voice_upcoming(this,voice) }
  audioItem(item) { return readerUI().voice_audio_item(item) }
  needsPageJoin(item,index) { return readerUI().voice_needs_join(this,item,index) }
  joinPageSentence() { return readerUI().voice_join_sentence(this,add) }
  /** One detached page, prepared only near the current page's end. Never
   * reveal it or let its PCM play until advance adopts its first fragment. */
  prepareAhead() { const ui=readerUI();return ui.voice_prepare_ahead(this,(owner,request)=>()=>ui.voice_ahead_active(owner,request),neuralEngine) }
  clearAhead() { return readerUI().voice_clear_ahead(this) }
  /** Retry a failed worker with the same natural voice, then expose the error for a manual retry. */
  engineFailed(detail) { return readerUI().voice_engine_failed(this,detail,clearTimeout,neuralEngine,ignore) }
  /** Lets the neural voice try again after it was given up on (the person changed the voice or the speed). */
  retryNeural() { return readerUI().voice_retry(this) }
  /** A neural voice was removed (the person tapped Quitar): the reading in progress stops using it now, not when its files are gone. */
  voiceRemoved(id) { return readerUI().voice_removed(this,id) }
  async advance() { const ui=readerUI();return ui.voice_advance(this,(owner,generation)=>()=>ui.voice_advance_active(owner,generation),sleep) }
  /** Explicit seek helper; page gestures use seekToPoint after a long hold. */
  jumpToPoint({doc,x,y} = {}) { return readerUI().voice_jump_point(this,doc,x,y) }
  async continueFromPage(navigate) { return readerUI().voice_continue_page(this,navigate) }
  browse() { return readerUI().voice_browse(this,add) }
  async returnToAudio() { return readerUI().voice_return_audio(this) }
  async seekToPoint({doc,x,y}) { return readerUI().voice_seek_point(this,doc,x,y) }
  async refreshPageBreaks() { return readerUI().voice_refresh_breaks(this,neuralEngine) }
  async prepare(source,opening = false) { return readerUI().voice_prepare(this,source,opening,planSpeech,firstCompleteSentenceOffset) }
  async prepareOpening() { return readerUI().voice_prepare_opening(this) }
  async preparePlayback(isActive = () => true) { return readerUI().voice_prepare_playback(this,isActive,neuralEngine) }
  async prepareNext(generation) { const ui=readerUI();return ui.voice_prepare_next(this,generation,(owner,generation)=>()=>ui.voice_next_active(owner,generation)) }
  pagePlanValid(plan) { return readerUI().voice_page_valid(plan) }
  async revalidateNext(plan,generation) { return readerUI().voice_revalidate_next(this,plan,generation) }
  adopt(plan) { return readerUI().voice_adopt_plan(this,plan) }
  // --- Highlight timing: what is painted and followed is what is being heard -------------------------------------------
  /** The engine reported the first audible word of utterance `id`. */
  engineStarted(id) { return readerUI().voice_engine_started(this,id,clearTimeout,nativeAudio) }
  engineEnded(id) { return readerUI().voice_engine_ended(this,id) }
  present(id = this.utteranceId, offset = 0) { return readerUI().voice_present(this,id,offset,clearTimeout,ignore) }
  unpaint() { return readerUI().voice_unpaint(this,clearTimeout) }
  /** Re-speaks the current fragment, so a new speed or voice is heard now instead of at the next one. */
  restart() { return readerUI().voice_restart(this) }
  cancelUtterance(reason = 'stop') { return readerUI().voice_cancel(this,reason,clearTimer,nativeAudio,neuralEngine) }
  prepareText(text) { return readerUI().voice_prepare_text(this,text) }
  detectLanguage(text) {
    return detectLanguage(text, this.reader.language || navigator.language || 'en-US')
  }
  pause() { return readerUI().voice_pause(this) }
  stop() { return readerUI().voice_stop(this,clearTimer) }
  fail(message) { return readerUI().voice_fail(this,message) }
  setSleep(minutes) { const ui=readerUI();return ui.voice_set_sleep(this,minutes,clearTimeout,(owner,ms)=>setTimeout(()=>ui.voice_sleep_expired(owner),ms)) }

}
