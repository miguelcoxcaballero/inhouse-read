import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {it,vi} from 'vitest'
import {LegacyPolicy,DOWNLOAD_ERRORS} from './helpers/reference-picker-policy.js'
const runtime=vi.hoisted(()=>({base:null,recommend:null}))
vi.mock('../../src/js/readers/voice-catalog.js',()=>({langBase:x=>runtime.base(x),recommendedNeuralFor:(...args)=>runtime.recommend(...args)}))
function dependencies(base,recommend){Object.assign(runtime,{base,recommend})}
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const key='inhouse-read-neural-offer-dismissed',base=x=>(x||'').split('-')[0];let recommend,events,raw,trial
const recommendVoice=(...args)=>recommend(...args),now=()=>Date.now(),read=()=>localStorage.getItem(key),write=value=>localStorage.setItem(key,value)
dependencies(base,recommendVoice)
class NativePolicy {
 state(engine,voice){return ui.picker_state(this,engine,voice,DOWNLOAD_ERRORS)}
 dismissed(){return ui.picker_dismissed(read)}
 snoozed(base){return ui.picker_snoozed(this,base,now)}
 dismiss(){return ui.picker_dismiss(this,base,now,write)}
 offerFor(engine,list){return ui.picker_offer_for(this,engine,list,base,recommendVoice,navigator.language)}
 renderOffer(engine,list){return ui.picker_render_offer(this,engine,list)}
}
it('preserves 2400 offer and availability decisions without retaining per-call values',()=>{
const originalNow=Date.now,originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'es-ES'}});
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>{events.push(['read',k]);if(trial%23===0)throw Error('storage');return raw},setItem:(k,value)=>{events.push(['write',k,value]);if(trial%19===0)throw Error('storage');raw=value}}});
Date.now=()=>{events.push(['now']);return 4e9};
function setup(native,i){
 trial=i;events=[];raw=['{}','null','false','true','0','"foo"','[]','{"en":true}','{"es":3999999999}','{"en":1}','{"en":"3999999999"}','{"en":0}','{broken','{"__proto__":{"x":1}}'][Math.floor(i/6)%14];
 const host=new (native?NativePolicy:LegacyPolicy)();host.host={voice:i%7?{}:null};host.bookLang=['en-US','es-ES','','__proto__'][Math.floor(i/84)%4];
 host.tasks=new Map(i%3===0?[['a',{}]]:[]);host.errors=new Map(i%5===0?[['a','custom']]:[]);host.render=()=>events.push(['render']);
 const voices=[{id:'a',base:'en'},{id:'b',base:'es'}];
 const engine={installed:new Set(i%11===0?['a']:[]),downloads:i%13?new Map([['a',{state:['idle','error','downloading'][Math.floor(i/6)%3],code:['offline','storage','unknown'][Math.floor(i/18)%3],fraction:.4}]]):undefined};
 recommend=(list,book,device)=>{events.push(['recommend',book,device]);return list.find(v=>v.base===base(book))||null};
 host.view={renderOffer:(voice,state)=>events.push(['offer',voice,state])};
 return{host,voices,engine};
}
function compare(i){
 const outputs=[];
 for(const native of [false,true]){
  const {host,voices,engine}=setup(native,i);let value;
  switch(i%6){case 0:value=host.state(engine,voices[0]);break;case 1:value=host.dismissed();break;case 2:value=host.snoozed(base(host.bookLang));break;case 3:value=host.dismiss();break;case 4:value=host.offerFor(i%17?engine:null,voices);break;case 5:value=host.renderOffer(i%17?engine:null,voices);break;}
  outputs.push({value,events,raw});
 }
 assert.deepEqual(outputs[1],outputs[0],'scenario '+i);
}
try{
 for(let i=0;i<2400;i++)compare(i);
 const retained=ui.ui_live_handles(),capacity=core.memory.buffer.byteLength;
 for(let i=0;i<2400;i++)compare(i);
 assert.equal(ui.ui_live_handles(),retained);assert.equal(core.memory.buffer.byteLength,capacity);

}finally{Date.now=originalNow;for(const [key,descriptor]of [['localStorage',originalStorage],['navigator',originalNavigator]])if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}

});
