import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {it,vi} from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {LegacyPickerRender as LegacyRender,WARNINGS} from '../../src/js/readers/picker-render-legacy.js'
import {LegacyPolicy,DOWNLOAD_ERRORS} from '../../src/js/readers/picker-policy-legacy.js'
import {LegacyNeuralView} from '../../src/js/readers/neural-view-legacy.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
let engine,list;const base=x=>(x||'').split('-')[0],recommend=(list,lang)=>list.find(v=>v.base===base(lang))||null
const getEngine=()=>engine,getList=()=>list,order=(voices)=>[...voices].reverse(),language=x=>'Language '+x
const runtime=vi.hoisted(()=>({engine:null,list:null,order:null,language:null,base:null,recommend:null}))
Object.assign(runtime,{engine:getEngine,list:getList,order,language,base,recommend})
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>runtime.engine(),neuralVoiceList:()=>runtime.list()}))
vi.mock('../../src/js/readers/voice-catalog.js',()=>({langBase:(...a)=>runtime.base(...a),recommendedNeuralFor:(...a)=>runtime.recommend(...a),orderNeuralVoices:(...a)=>runtime.order(...a),languageName:(...a)=>runtime.language(...a)}))
const services={engine:getEngine,list:getList,order:(v,b,d)=>order(v,{bookLang:b,deviceLang:d}),language,url:path=>new URL(path,new URL(import.meta.env?.BASE_URL||'/',location.href)).href,base,recommend,cancel:()=>{},device:()=>navigator.language,messages:DOWNLOAD_ERRORS,warnings:WARNINGS}
const policy=LegacyPolicy.prototype,render=LegacyRender.prototype
class Host {
 state(...a){return this.rustPolicy?ui.picker_state(this,...a,DOWNLOAD_ERRORS):policy.state.apply(this,a)}
 dismissed(...a){return this.rustPolicy?ui.picker_dismissed(()=>localStorage.getItem('inhouse-read-neural-offer-dismissed')):policy.dismissed.apply(this,a)}
 snoozed(...a){return this.rustPolicy?ui.picker_snoozed(this,...a,()=>Date.now()):policy.snoozed.apply(this,a)}
 offerFor(...a){return this.rustPolicy?ui.picker_offer_for(this,...a,base,recommend,navigator.language):policy.offerFor.apply(this,a)}
 renderOffer(...a){return this.rustPolicy?ui.picker_render_offer(this,...a):policy.renderOffer.apply(this,a)}
 focusKey(){return this.view.focusKey()}
 restoreFocus(key){return this.view.restoreFocus(key)}
 render(){return this.native?this.view.renderPicker(this):render.render.call(this)}
 row(engine,voice){return this.native?this.view.pickerRow(this,engine,voice):render.row.call(this,engine,voice)}
 patchProgress(engine){return this.native?this.view.patchPickerProgress(this,engine):render.patchProgress.call(this,engine)}
}
function tree(node){return node.nodeType===3?node.textContent:{tag:node.nodeName,attrs:[...node.attributes||[]].map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...node.childNodes].map(tree)}}
function setup(native,trial,size=8,viewOnlyRust=false){
 localStorage.clear();document.body.innerHTML='<section><div data-neural><div data-neural-warning><span data-neural-warning-text></span></div><ul data-neural-list></ul></div><div data-neural-offer></div></section>'
 const host=new Host();host.native=native;host.rustPolicy=native||viewOnlyRust;host.frame=17;host.signature='previous';host.bookLang=['en-US','es-ES',''][trial%3]
 host.host={voiceBaseShown:['','en','es'][Math.floor(trial/3)%3],voice:trial%13?{neuralOff:['','not-installed','unknown'][Math.floor(trial/9)%3]}:null,preferences:{voice:trial%2?'voice0':'voice2'}}
 host.tasks=new Map();host.errors=new Map()
 host.block=document.querySelector('[data-neural]');host.offer=document.querySelector('[data-neural-offer]')
 host.view=(native||viewOnlyRust)?new ui.RustNeuralView(document.querySelector('section')):new LegacyNeuralView(document.querySelector('section'));if(native)host.view.configurePicker(services)
 list=Array.from({length:trial%17?size:0},(_,i)=>({id:'voice'+i,name:'Natural '+i,lang:i%2?'en-US':'es-ES',base:i%2?'en':'es',sizeMB:5+i/2,recommended:i%3===0,sharedPack:i%2===0,modelKey:'shared',upgradeBytes:trial%5?1500000:0,licenseUrl:i%2?'licenses/test.txt':'',licenseName:trial%4?'OpenRAIL-M':'Custom'}))
 engine={installed:new Set(trial%4?['shared:F1:en']:[]),downloads:new Map()}
 for(let i=0;i<list.length;i++){
  const id=list[i].id,status=(i+trial)%4
  if(status===1)engine.installed.add(id)
  if(status===2)engine.downloads.set(id,{state:'downloading',fraction:.12,total:5000000})
  if(status===3)engine.downloads.set(id,{state:'error',code:['storage','offline','unknown'][trial%3]})
  if(i===0&&trial%7===0)host.tasks.set(id,{})
  if(i===1&&trial%11===0)host.errors.set(id,'Custom error')
 }
 if(trial%19===0)localStorage.setItem('inhouse-read-neural-offer-dismissed','{"en":true,"es":true}')
 host.engine=engine;return host
}
function run(native,trial){
 const host=setup(native,trial);try{
  host.render();const snapshots=[tree(document.body)]
  const first=host.block.querySelector('[data-neural-action]');first?.focus();host.render();snapshots.push(tree(document.body),host.focusKey())
  for(const download of engine.downloads.values())if(download.state==='downloading')download.fraction=.73
  if(trial%23===0)host.block.querySelector('.reading-neural-progress')?.remove()
  if(trial%29===0&&list.length)list=list.slice(1)
  const before=host.block.querySelector('button'),patched=host.patchProgress(engine)
  snapshots.push(patched,tree(document.body),host.block.querySelector('button')===before,host.frame,host.signature)
  return snapshots
 }finally{host.view.free?.();document.body.innerHTML=''}
}
let retained,capacity
for(let block=0;block<4;block++)it(`preserves voice rows, focus and pressed buttons, scenarios ${block*60}–${block*60+59}`,()=>{
 for(let i=block*60;i<(block+1)*60;i++)assert.deepEqual(run(true,i),run(false,i),'scenario '+i)
 if(block===3){retained=ui.ui_live_handles();capacity=core.memory.buffer.byteLength}
})
for(let block=0;block<4;block++)it(`preserves DOM and bounded references, cycles ${block*60}–${block*60+59}`,()=>{
 for(let i=block*60;i<(block+1)*60;i++)assert.deepEqual(run(true,i),run(false,i),'cycle '+i)
 assert.equal(ui.ui_live_handles(),retained);assert.equal(core.memory.buffer.byteLength,capacity)
})
