import {getRustUI} from '../rust-ui.js'
import {neuralEngine} from './neural-runtime.js'
import {nativeAudio,nativePcmBridge} from './neural-voice/audio.js'
import {initializeLegacyVoice,legacyVoiceEvent,LegacySession} from './voice-session-legacy.js'
export function initializeVoiceSession(host,reader,onState){const ui=getRustUI();return ui?.voice_initialize?ui.voice_initialize(host,reader,onState):initializeLegacyVoice.call(host,reader,onState)}
export function voiceSessionEvent(host,type,detail){const ui=getRustUI();return ui?.voice_event?ui.voice_event(host,type,detail,nativePcmBridge):legacyVoiceEvent(host,type,detail)}
export function diagnosticVoice(host,session){const ui=getRustUI();return ui?.voice_diagnostic?ui.voice_diagnostic(host,session,nativeAudio,neuralEngine,document):LegacySession.prototype.getDiagnosticState.call(host,session)}
export function prepareVoiceText(host,text){const ui=getRustUI();return ui?.voice_prepare_text?ui.voice_prepare_text(host,text):LegacySession.prototype.prepareText.call(host,text)}
