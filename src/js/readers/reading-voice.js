import {readerUI,rustMethods} from './rust-ui-required.js'
import {loadNeural,neuralEngine,neuralVoiceList,unlockNeural} from './neural-runtime.js'
import {nativeAudio,nativePcmBridge} from './neural-voice/audio.js'
import {declaredLanguage,detectLanguage,isNeuralId,langBase,resolveVoice} from './voice-catalog.js'
import {firstCompleteSentenceOffset,planSpeech,speechChunks} from './speech-text.js'

export { speechChunks }
// The audiobook's session: what is spoken next, prepared ahead, presented, joined across pages, navigated, paused
// and stopped is rust-ui (voice_*.rs; its methods are answered by voice_methods.rs). The kit holds the engine, audio,
// catalogue, text and timer doorways Rust calls back; the frozen originals are tests/unit/helpers/reference-voice-*.js.
const kit={loadNeural,neuralEngine,neuralVoiceList,unlockNeural,nativeAudio,declaredLanguage,isNeuralId,langBase,resolveVoice,planSpeech,firstCompleteSentenceOffset,
 get clearTimeout(){return clearTimeout},get now(){return Date.now},get document(){return document},
 clearTimer:id=>clearTimeout(id),add:(a,b)=>a+b,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),ignore:value=>Promise.resolve(value).catch(()=>{}),
 deviceLanguage:()=>navigator.language,always:()=>true,
 joinReady:(ui,owner,promise,generation,index)=>{void promise.then(()=>ui.voice_join_ready(owner,generation,index))},
 waitStarted:(ui,owner,id)=>setTimeout(()=>ui.voice_wait_started(owner,id),900),
 synthFailed:(owner,id)=>queueMicrotask(()=>owner.engineFailed({id,reason:'synth-failed'})),
 sleepTimer:(ui,owner,ms)=>setTimeout(()=>ui.voice_sleep_expired(owner),ms)}
/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader,onState=()=>{}) {
    readerUI().voice_initialize(this,reader,onState)
    window.InhouseReadAudioDiagnostics=session=>this.getDiagnosticState(session)
    try{localStorage.removeItem('inhouse-read-neural-slow')}catch{/* obsolete preference */}
    for(const type of ['inhouse-tts','inhouse-speech-layout','inhouse-speech-hold','inhouse-audio-control'])
      window.addEventListener(type,event=>readerUI().voice_event(this,type,event.detail,nativePcmBridge))
  }
  get supported() { return Boolean(neuralEngine()) }
  notify(message = '') { this.onState(this.state, message) }
  useTransport(name) { this.transport = name }
  detectLanguage(text) {
    return detectLanguage(text, this.reader.language || navigator.language || 'en-US')
  }
}
// voiceFor ranks the installed natural voices (an explicit choice stays even when its files are missing, so the
// reader can say which voice to download again); speakNeural hands the engine the next few fragments too;
// prepareAhead prepares one detached page near the current page's end, never shown before advance adopts it;
// present/engineStarted/engineEnded paint and follow what is being heard.
rustMethods(ReadingVoice,'voice_method',`getDiagnosticState restartFromVisiblePage ~play speakCurrent voiceFor speakNeural upcomingFor
 audioItem needsPageJoin joinPageSentence prepareAhead clearAhead engineFailed retryNeural voiceRemoved ~advance jumpToPoint
 ~continueFromPage browse ~returnToAudio ~seekToPoint ~refreshPageBreaks ~prepare ~prepareOpening ~preparePlayback ~prepareNext
 pagePlanValid ~revalidateNext adopt engineStarted engineEnded present unpaint restart cancelUtterance prepareText pause stop fail setSleep`,kit)
