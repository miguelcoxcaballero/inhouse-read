import {readerUI,rustMethods} from './rust-ui-required.js'
import * as runtime from './neural-runtime.js'
import * as audio from './neural-voice/audio.js'
import * as catalog from './voice-catalog.js'
import * as speech from './speech-text.js'

export { speechChunks } from './speech-text.js'
// The audiobook's session: what is spoken next, prepared ahead, presented, joined across pages, navigated, paused
// and stopped is rust-ui (voice_*.rs; its methods are answered by voice_methods.rs). The kit holds the engine, audio,
// catalogue, text and timer doorways Rust calls back (the modules are read when a method needs them); the frozen
// originals are tests/unit/helpers/reference-voice-*.js.
// The join, start-wait, failed-synthesis and sleep timers are rust-ui voice_*_later (reader_assembly.rs).
const kit={runtime,audio,catalog,speech,get clearTimeout(){return clearTimeout},get now(){return Date.now},get document(){return document},
 clearTimer:id=>clearTimeout(id),add:(a,b)=>a+b,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),ignore:value=>Promise.resolve(value).catch(()=>{}),
 deviceLanguage:()=>navigator.language,always:()=>true}
/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader,onState=()=>{}) { const ui=readerUI(); ui.voice_construct(this,reader,onState,kit,ui) }
  get supported() { return Boolean(runtime.neuralEngine()) }
  notify(message = '') { this.onState(this.state, message) }
  useTransport(name) { this.transport = name }
  detectLanguage(text) {
    return catalog.detectLanguage(text, this.reader.language || navigator.language || 'en-US')
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
