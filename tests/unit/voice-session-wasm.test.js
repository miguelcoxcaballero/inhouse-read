import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {it,expect,vi,afterEach} from 'vitest'
import {ReadingVoice} from '../../src/js/readers/reading-voice.js'
const fixture=vi.hoisted(()=>({ui:null,native:()=>null,engine:()=>null,pcm:()=>false}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>fixture.engine()}))
vi.mock('../../src/js/readers/neural-voice/audio.js',()=>({nativeAudio:()=>fixture.native(),nativePcmBridge:()=>fixture.pcm()}))
function dependencies(n,e,d,p){fixture.native=n;fixture.engine=e;fixture.pcm=p;vi.stubGlobal('document',d)}
afterEach(()=>{fixture.ui=null;vi.unstubAllGlobals()})
import {LegacySession,legacyVoiceEvent as legacyEvent} from './helpers/reference-voice-session.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const onState=()=>{},reader={};
it('preserves initial state, 1800 events, 1200 diagnostics and 1000 text cases',()=>{
const legacy=new LegacySession(reader,onState),native=Object.create(LegacySession.prototype);ui.voice_initialize(native,reader,onState)
assert.deepEqual(native,legacy);assert.equal(native.reader,reader);assert.equal(native.onState,onState)
const values=[undefined,null,-1,0,-0,1,2,3,4,6,7,0.5,NaN,Infinity,'2',false,true]
const totals={engineStarted:0,engineEnded:0,present:0,advance:0,pause:0,play:0,stop:0,engineFailed:0,refreshPageBreaks:0,seekToPoint:0}
for(let trial=0;trial<1800;trial++){
 const outputs=[]
 for(const native of [false,true]){
  const host=new LegacySession({},onState),events=[]
  Object.assign(host,{state:['playing','paused','loading','stopped'][trial%4],generation:3,utteranceId:'u1',nativeSession:'session',startedId:trial%3?'u1':'old',spoken:values[trial%values.length],diagnosticStarts:trial%9,diagnosticDones:trial%7,index:2,chunks:['a','b','c'],items:[{text:'a'}]})
  for(const name in totals)host[name]=(...args)=>events.push([name,...args])
  const kind=['inhouse-tts','inhouse-speech-layout','inhouse-speech-hold','inhouse-audio-control','unknown'][Math.floor(trial/4)%5]
  const detail={id:trial%11?'u1':'old',type:['start','boundary','done','interrupted','error'][Math.floor(trial/20)%5],offset:12,probe:trial%7===0,session:trial%13?'session':'old',action:['play','pause','stop','other'][Math.floor(trial/100)%4]}
  const pcm=()=>trial%17!==0;dependencies(()=>null,()=>null,{},pcm)
  if(native)ui.voice_event(host,kind,detail,pcm);else legacyEvent(host,kind,detail)
  if(native)for(const event of events)if(event[0] in totals)totals[event[0]]++
  outputs.push({events,detail,starts:host.diagnosticStarts,dones:host.diagnosticDones,layout:host.openingLayout,plan:host.openingPlan})
 }
 assert.deepEqual(outputs[1],outputs[0],'event '+trial)
}
for(const[key,value]of Object.entries(totals))assert.ok(value>0,key)
for(let trial=0;trial<1200;trial++){
 const results=[]
 for(const native of [false,true]){
  const host=new LegacySession({},onState),events=[]
  host.nativeSession=trial%13?'session':null;host.utteranceId=trial%7?'u1':null;host.startedId=trial%3?'u1':'old';host.spoken=values[trial%values.length];host.state=['playing','paused','loading','stopped'][trial%4]
  host.diagnosticAdvance=trial%3?{generation:trial%11?0:3,stage:trial%5?'prepare-next':''}:null;host.preparingPage=trial%2?{generation:0}:null;host.deferredPage=trial%3?{}:null;host.aheadPage=trial%4?{}:null
  const paginator={turnStage:values[trial%values.length],displayStage:values[(trial+3)%values.length],sectionLoadPending:trial%2,viewLoadPending:trial%5,viewReady:values[(trial+6)%values.length]}
  host.reader={speechDiagnosticState:trial%5?{kind:['pdf','foliate','other'][trial%3],followPending:values[trial%values.length],pageTurnPending:values[(trial+4)%values.length],paginator:trial%7?paginator:null}:null,speechPosition:trial%3?{index:values[(trial+7)%values.length]}:null}
  const doc={hidden:trial%2,visibilityState:['visible','hidden','prerender','unknown'][trial%4]},bridge=()=>{events.push('native');return trial%17?{session:'session'}:null},engine=()=>{events.push('engine');return trial%19?{getDiagnosticState:()=>trial%3?{count:2}:null}:null}
  dependencies(bridge,engine,doc,()=>true)
  const session=trial%23?'session':'old',value=native?ui.voice_diagnostic(host,session,bridge,engine,doc):host.getDiagnosticState(session)
  results.push({value,events})
 }
 assert.deepEqual(results[1],results[0],'diagnostic '+trial)
}
const texts=['','Heading\nSome real text [12].\nHeading\nA note (NOTE 4).','\ud800\n\ud801\n\ud800','İSTANBUL\nAnother [†] paragraph.\nİstanbul','  \n \nBody','a'.repeat(89)+'\n'+'a'.repeat(89),'a'.repeat(90)+'\n'+'a'.repeat(90),'[1] [1234] [*] [‡] ( nota 12 )\r\nMore text.',null,0,false,123,['One','Two']]
for(let i=0;i<1000;i++){
 const host=new LegacySession({},onState);host.options={footnotes:i%2===0,skipHeaders:i%3!==0}
 assert.equal(ui.voice_prepare_text(host,texts[i%texts.length]),host.prepareText(texts[i%texts.length]),'text '+i)
}
})
it('releases references across 2000 sessions',()=>{
ui.voice_initialize({},reader,onState);ui.voice_prepare_text({options:{}},'Test [1]');ui.voice_diagnostic({},'none',()=>null,()=>null,{hidden:false,visibilityState:'visible'});
const before=ui.ui_live_handles(),capacity=core.memory.buffer.byteLength
for(let i=0;i<2000;i++){const host={};ui.voice_initialize(host,reader,onState);ui.voice_prepare_text(host,'Test [1]');ui.voice_diagnostic(host,'none',()=>null,()=>null,{hidden:false,visibilityState:'visible'})}
assert.equal(ui.ui_live_handles(),before);assert.equal(core.memory.buffer.byteLength,capacity)
})

it('uses the compiled session adapters without changing reader or callback identity',()=>{
 // The session's constructor and window listeners (reading-voice.js), as the former voice-session.js adapters drove them.
 fixture.ui=ui;const host=new ReadingVoice(reader,onState)
 expect(host.reader).toBe(reader);expect(host.onState).toBe(onState)
 host.state='playing';host.utteranceId='current';host.engineStarted=vi.fn()
 window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{id:'old',type:'start'}}))
 expect(host.engineStarted).not.toHaveBeenCalled()
 window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{id:'current',type:'start'}}))
 expect(host.engineStarted).toHaveBeenCalledExactlyOnceWith('current')
 expect(host.prepareText('Words [1].')).toBe('Words .')
 expect(host.getDiagnosticState('old')).toBeNull()
 expect(window.InhouseReadAudioDiagnostics('old')).toBeNull()
 host.state='stopped'
})
