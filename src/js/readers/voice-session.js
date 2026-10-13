import {readerUI} from './rust-ui-required.js'
import {neuralEngine} from './neural-runtime.js'
import {nativeAudio,nativePcmBridge} from './neural-voice/audio.js'
export function initializeVoiceSession(host,reader,onState){return readerUI().voice_initialize(host,reader,onState)}
export function voiceSessionEvent(host,type,detail){return readerUI().voice_event(host,type,detail,nativePcmBridge)}
export function diagnosticVoice(host,session){return readerUI().voice_diagnostic(host,session,nativeAudio,neuralEngine,document)}
export function prepareVoiceText(host,text){return readerUI().voice_prepare_text(host,text)}
