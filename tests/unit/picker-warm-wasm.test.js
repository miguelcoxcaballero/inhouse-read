import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {it,vi} from 'vitest'
import {LegacyWarm} from './helpers/reference-picker-warm.js'
const runtime=vi.hoisted(()=>({engine:null,load:null,list:null}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>runtime.engine(),loadNeural:()=>runtime.load(),neuralVoiceList:e=>runtime.list(e)}))
function dependencies(engine,load,list){Object.assign(runtime,{engine,load,list})}
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const ignored=value=>Promise.resolve(value).catch(()=>{})
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
function setup(native,trial){
 const host=new LegacyWarm(),events=[],callbacks=[],listeners=[],book={id:'book'},other={id:'other'}
 const record=(name,value)=>events.push([name,value])
 const schedule=(kind,callback,ms)=>{const id=callbacks.length+1;callbacks.push(callback);record(kind,[id,ms]);return id}
 globalThis.setTimeout=(fn,ms)=>schedule('timeout',fn,ms)
 globalThis.clearTimeout=id=>record('clear',id)
 globalThis.requestAnimationFrame=fn=>schedule('frame',fn,undefined)
 globalThis.requestIdleCallback=trial%3?((fn,options)=>schedule('idle',fn,options.timeout)):undefined
 globalThis.cancelIdleCallback=trial%7?(id=>record('cancel-idle',id)):undefined
 vi.stubGlobal('localStorage',{getItem(key){record('read',key);if(trial%29===0)throw Error('storage');return trial%2?'1':null},setItem(key,value){record('write',[key,value]);if(trial%31===0)throw Error('storage')}})
 const voice={id:'voice',neural:trial%5!==0,installed:trial%11!==0}
 const reader={voiceFor(text){record('voice-for',text);return{voice}},preparePlayback(active){record('prepare',active());if(trial%23===0)throw Error('prepare');return Promise.resolve(true)}}
 const engine={status:trial%2?'speaking':'idle',installed:new Set(trial%4?['b','a']:[]),
  addEventListener(name,callback){record('listen',name);listeners.push([name,callback])},
  refresh(){record('refresh-engine',null);return trial%19?Promise.resolve():Promise.reject(Error('refresh'))},
  warmUp(id){record('warm-engine',id);if(trial%17===0)throw Error('warm');return trial%13?Promise.resolve():Promise.reject(Error('warm'))}}
 const factory=()=>trial%37?engine:null,load=()=>{record('load',null);return trial%41?Promise.resolve():Promise.reject(Error('load'))}
 dependencies(factory,load,()=>[])
 Object.assign(host,{host:{book:trial%43?book:null,voice:reader,populateVoices(){record('populate',null)}},warmGeneration:2,warmed:trial%7===0,warmHandle:trial%3?{idle:trial%2===0,id:71}:null,frame:trial%7===0?9:0,signature:trial%4?'a,b':'',engine:trial%3?null:engine,
  render(){record('render',null)},patchProgress(value){record('progress',value===engine);return trial%2===0}})
 if(native){
  host.warmContext=()=>ui.picker_warm_context(host);host.isWarmCurrent=context=>ui.picker_warm_current(host,context)
  host.used=()=>ui.picker_used(()=>localStorage.getItem('inhouse-read-neural-used'))
  host.warm=()=>ui.picker_warm(host,(owner,context)=>{const run=()=>ui.picker_warm_fire(owner,context);return typeof requestIdleCallback==='function'?{idle:true,id:requestIdleCallback(run,{timeout:2500})}:{idle:false,id:setTimeout(run,800)}})
  host.cancelWarm=()=>ui.picker_cancel_warm(host,typeof cancelIdleCallback==='function'?cancelIdleCallback:null,clearTimeout)
  host.refresh=({warm=true}={})=>ui.picker_refresh(host,warm,(owner,context,warm)=>load().then(()=>ui.picker_loaded(owner,context,warm),()=>{}))
  host.attach=(warm=true)=>ui.picker_attach(host,warm,factory,(owner,engine)=>{
   engine.addEventListener('change',()=>owner.changed())
   engine.addEventListener('status',()=>ui.picker_engine_status(owner,engine,()=>localStorage.setItem('inhouse-read-neural-used','1')))
  },(owner,engine,context,warm)=>Promise.resolve(engine.refresh?.()).catch(()=>{}).then(()=>ui.picker_engine_refreshed(owner,context,warm)))
  host.warmUp=()=>ui.picker_warm_up(host,factory,ignored,(owner,context)=>()=>owner.isWarmCurrent(context))
  host.changed=()=>ui.picker_changed(host,factory,owner=>requestAnimationFrame(()=>ui.picker_paint_frame(owner)))
  host.paint=()=>ui.picker_paint(host,factory)
 }
 return{host,events,callbacks,listeners,book,other,engine}
}
const methods=['warm','refresh','used','attach','warmContext','isWarmCurrent','cancelWarm','warmUp','changed','paint']
it('preserves 1600 warming scenarios and releases 1000 repeated sessions',async()=>{
const original=Object.fromEntries(['setTimeout','clearTimeout','requestAnimationFrame','requestIdleCallback','cancelIdleCallback'].map(key=>[key,globalThis[key]]))
try{
 const totals={}
 for(const method of methods)for(let trial=0;trial<160;trial++){
  const results=[]
  for(const native of [false,true]){
   const{host,events,callbacks,listeners,book,other,engine}=setup(native,trial)
   let result,error
   const args=method==='refresh'?[{warm:trial%2===0}]:method==='attach'?[trial%2===0]:method==='isWarmCurrent'?[trial%3?{book:trial%2?book:other,generation:trial%5?2:1}:null]:[]
   try{result=host[method](...args)}catch(e){error=e.message}
   const synchronous=events.slice()
   if(trial%17===0)host.warmGeneration++;if(trial%23===0)host.host.book=other
   await flush();for(const[,callback]of listeners)callback();await flush()
   for(const callback of callbacks)callback();await flush()
   if(native)for(const[name]of events)totals[name]=(totals[name]||0)+1
   results.push({result,error,synchronous,events,warmed:host.warmed,handle:host.warmHandle,generation:host.warmGeneration,signature:host.signature,frame:host.frame,engine:host.engine===engine?'same':host.engine})
  }
  assert.deepEqual(results[1],results[0],method+' '+trial)
 }
 for(const name of ['idle','timeout','clear','cancel-idle','frame','read','write','voice-for','prepare','refresh-engine','warm-engine','listen','load','populate','render','progress'])assert.ok(totals[name]>0,name)
 const cycle=async()=>{const{host,callbacks,listeners}=setup(true,1);host.warm();await flush();for(const cb of callbacks)cb();await flush();for(const[,cb]of listeners)cb();await flush();host.cancelWarm()}
 await cycle();const before=ui.ui_live_handles(),capacity=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++)await cycle()
 assert.equal(ui.ui_live_handles(),before);assert.equal(core.memory.buffer.byteLength,capacity)

}finally{vi.unstubAllGlobals();for(const[key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
})
