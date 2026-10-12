import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {it,vi} from 'vitest'
import {LegacyActions,DOWNLOAD_ERRORS} from '../../src/js/readers/picker-actions-legacy.js'
const runtime=vi.hoisted(()=>({engine:null,list:null,declared:null,base:null,valid:null}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>runtime.engine(),neuralVoiceList:()=>runtime.list()}))
vi.mock('../../src/js/readers/voice-catalog.js',()=>({declaredLanguage:r=>runtime.declared(r),langBase:s=>runtime.base(s),isNeuralId:s=>runtime.valid(s)}))
function dependencies(engine,list,declared,base,valid){Object.assign(runtime,{engine,list,declared,base,valid})}
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
let engine,voices,declared
const getEngine=()=>engine,getVoices=()=>voices,getDeclared=()=>declared,base=s=>(s||'').split(/[-_]/)[0],valid=id=>id.startsWith('piper:')||id.startsWith('supertonic:')
dependencies(getEngine,getVoices,getDeclared,base,valid)
class NativeActions {
 click(event){return ui.picker_click(this,event)}
 cancel(id){return ui.picker_cancel(this,id,getEngine)}
 voiceName(id){return ui.picker_voice_name(id,getVoices)}
 async install(id){const context=ui.picker_install_begin(this,id,getEngine,valid,()=>new AbortController());if(!context)return;try{await context.task;ui.picker_install_done(this,id,context,getDeclared,base,getVoices)}catch(error){ui.picker_install_error(this,id,context,error,DOWNLOAD_ERRORS)}}
 use(id){return ui.picker_use(this,id,getEngine)}
 async remove(id){const context=ui.picker_remove_begin(this,id,getEngine,getVoices);if(!context)return;try{await context.engine.remove(id)}catch{}ui.picker_remove_done(this,id,context)}
}
const totals={install:0,remove:0,use:0,cancel:0,click:0}
function setup(native,trial){
 const host=new (native?NativeActions:LegacyActions)(),events=[];host.tasks=new Map();host.errors=new Map([['piper:a','old']]);
 host.announce=s=>events.push(['announce',s]);host.render=()=>events.push(['render']);host.dismiss=()=>events.push(['dismiss']);
 host.host={reader:{},preferences:{voice:['piper:a','supertonic:y','other'][trial%3],voiceLang:['','en','es'][trial%3]},setPreference:(...args)=>events.push(['preference',...args]),populateVoices:()=>events.push(['populate']),voice:trial%9?{voiceRemoved:id=>events.push(['removed',id])}:null};
 declared=['','en-US','es-ES'][Math.floor(trial/3)%3];
 voices=[{id:'piper:a',name:'Alpha',lang:'en-US'},{id:'supertonic:x',name:'Beta',lang:'es',sharedPack:true,modelKey:'super'},{id:'supertonic:y',name:'Gamma',lang:'es',sharedPack:true,modelKey:'super'}];
 const failure=()=>Object.assign(new Error('fixture'),{code:['offline','storage','aborted','unknown'][trial%4]});
 engine=trial%17?{
  unlock:options=>{events.push(['unlock',options]);if(trial%7===0)throw failure()},
  install:(id,{signal})=>{events.push(['install',id,signal.aborted]);if(trial%11===0){host.tasks.get(id).abort();return Promise.reject(failure())}if(trial%5===0)throw failure();return trial%3===0?Promise.reject(failure()):Promise.resolve()},
  cancel:id=>{events.push(['cancel',id]);if(trial%7===0)throw failure()},
  remove:id=>{events.push(['remove',id]);if(trial%5===0)throw failure();return trial%3===0?Promise.reject(failure()):Promise.resolve()}
 }:null;
 if(trial%13===0)host.tasks.set('piper:a',new AbortController());
 return {host,events};
}
async function compare(trial){
 const outputs=[];
 for(const native of [false,true]){
  const {host,events}=setup(native,trial),id=['piper:a','supertonic:x','supertonic:y','other'][Math.floor(trial/5)%4],operation=['install','remove','use','cancel','click'][trial%5];
  if(operation==='click'){
   const action=['install','remove','use','cancel','dismiss','unknown'][Math.floor(trial/20)%6];
   // Test dispatch identity separately from the async work itself.
   for(const name of ['install','remove','use','cancel'])host[name]=id=>events.push([name,id]);
   host.click({target:trial%7?{closest:selector=>{events.push(['closest',selector]);return trial%11?{dataset:{neuralAction:action,neuralId:id}}:null}}:{}});
  }else await host[operation](id);
  if(native)totals[operation]++;
  outputs.push({events,tasks:[...host.tasks].map(([id,c])=>[id,c.signal.aborted]),errors:[...host.errors]});
 }
 assert.deepEqual(outputs[1],outputs[0],'scenario '+trial);
}
it('preserves 1500 voice actions and releases 1500 repeated sessions',async()=>{
for(let i=0;i<1500;i++)await compare(i);
await new Promise(resolve=>setTimeout(resolve,0));
const retained=ui.ui_live_handles(),capacity=core.memory.buffer.byteLength;
for(let i=0;i<1500;i++)await compare(i);
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(ui.ui_live_handles(),retained);assert.equal(core.memory.buffer.byteLength,capacity);
for(const count of Object.values(totals))assert.ok(count>0);
});
