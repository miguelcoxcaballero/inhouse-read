import {neuralEngine} from '../../../src/js/readers/neural-runtime.js'
import {nativeAudio,nativePcmBridge} from '../../../src/js/readers/neural-voice/audio.js'
export function initializeLegacyVoice(reader,onState){this.reader = reader
this.onState = onState
this.state = 'stopped'
this.generation = 0
this.openingLayout = 0
this.index = 0
this.chunks = []
this.items = []
this.source = null
this.preparingPage = null;
this.deferredPage = null;
this.resumeNextPage = false
this.aheadPage = null
this.diagnosticAdvance = null
this.diagnosticStarts = 0;
this.diagnosticDones = 0
this.rate = 1
this.voice = ''
this.languageOverride = ''
this.options = {footnotes:false,multilingual:false,skipHeaders:false}
this.transport = null
this.neuralOff = '';
this.missing = new Set();
this.neuralRetries = 0}
const handlers={"inhouse-tts":function(event){
      if (event.detail?.id !== this.utteranceId || this.state !== 'playing') return
      if (event.detail.type === 'start') { this.diagnosticStarts++; this.engineStarted(event.detail.id) }
      if (event.detail.type === 'boundary') this.present(event.detail.id,event.detail.offset)
      if (event.detail.type === 'done') { this.diagnosticDones++; this.engineEnded(event.detail.id); this.advance() }
      if (event.detail.type === 'interrupted') this.pause()
      if (event.detail.type === 'error') this.engineFailed(event.detail)
    },
"inhouse-speech-layout":function(event){ ++this.openingLayout; this.openingPlan = null; void this.refreshPageBreaks() },
"inhouse-speech-hold":function(event){
      if (this.state !== 'playing') return
      event.detail.handled = true
      if (!event.detail.probe) void this.seekToPoint(event.detail)
    },
"inhouse-audio-control":function(event){
      const detail = event.detail
      if (!nativePcmBridge() || !this.nativeSession || detail?.session !== this.nativeSession) return
      if (detail.action === 'pause') this.pause()
      else if (detail.action === 'stop') this.stop()
      else if (detail.action === 'play' && this.state === 'paused') this.play()
    }}
export function legacyVoiceEvent(host,kind,detail){return handlers[kind]?.call(host,{detail})}
export class LegacySession {
 constructor(reader,onState){initializeLegacyVoice.call(this,reader,onState)}
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
}
