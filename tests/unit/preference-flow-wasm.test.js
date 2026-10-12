import assert from 'node:assert/strict'
import {it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'

const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const themes={paper:{color:'black'},night:{color:'grey'}}
const normalize=(p,key,value)=>({...p,[key]:value})
function setup(native,variant){
 const events=[],pending=[],host={preferences:{rate:1,voice:'lessac',voiceLang:'en',theme:'paper',footnotes:true,multilingual:false,skipHeaders:true}}
 host.voice={stop(){events.push(['stop'])},retryNeural(){events.push(['retry'])},restart(){events.push(['restart'])}}
 host.neuralPicker={render(){events.push(['render'])},warmUp(){events.push(['warm'])}}
 host.view={applyPreferences(p,theme,pdf){events.push(['view',{...p},theme,pdf])}}
 host.reader={format:variant%2?{engine:'pdf'}:null,applyPreferences(p){events.push(['engine',{...p}]);if(variant%5===0)throw Error('engine sync');return variant%5===1?Promise.reject(Error('engine async')):Promise.resolve()}}
 host.updateMiniPlayer=()=>events.push(['mini']);host.error=message=>events.push(['error',message])
 const store=p=>{events.push(['store',{...p}]);if(variant%3===0)throw Error('quota')},notify=()=>events.push(['notify'])
 if(variant%7===0){delete host.voice.retryNeural;delete host.voice.restart;host.neuralPicker=null}
 host.applyPreferences=async(updateBook=true)=>{
  if(native)return ui.reader_apply_preferences(host,updateBook,themes,store)
  const p=host.preferences;try{store(p)}catch{}
  host.view.applyPreferences(p,themes[p.theme],host.reader.format?.engine==='pdf')
  host.voice.rate=p.rate;host.voice.voice=p.voice;host.voice.languageOverride=p.voiceLang
  host.neuralPicker?.render();host.voice.options={footnotes:p.footnotes,multilingual:p.multilingual,skipHeaders:p.skipHeaders};host.updateMiniPlayer()
  try{if(updateBook)await host.reader.applyPreferences(p)}catch{host.error('No se pudo aplicar.')}
 }
 const originalApply=host.applyPreferences;host.applyPreferences=(...args)=>{const promise=originalApply(...args);pending.push(promise);return promise}
 host.setPreference=(key,value,restart=true)=>{
  if(native)return ui.reader_set_preference(host,key,value,restart,normalize,notify)
  const audio=['rate','voice','voiceLang','footnotes','multilingual','skipHeaders'].includes(key)
  if(!audio)host.voice.stop();host.preferences=normalize(host.preferences,key,value);host.applyPreferences(!audio);notify()
  host.voice.options={footnotes:host.preferences.footnotes,multilingual:host.preferences.multilingual,skipHeaders:host.preferences.skipHeaders}
  if(key==='rate'||key==='voice'||key==='voiceLang'){host.voice.retryNeural?.();if(restart)host.voice.restart?.()}
  if(audio)host.neuralPicker?.warmUp()
 }
 return{host,events,pending}
}
it('preserves synchronous effects and asynchronous error order through 200 preference sequences',async()=>{
let checks=0
for(let trial=0;trial<200;trial++){
 const output=[]
 for(const native of [false,true]){
  const {host,events,pending}=setup(native,trial)
  for(const [key,value] of [['rate',2],['voice','alba'],['voiceLang','nl'],['footnotes',false],['multilingual',true],['skipHeaders',false],['theme','night'],['fontSize',24]])host.setPreference(key,value,trial%2===0)
  const synchronous=structuredClone(events),voice={...host.voice};delete voice.stop;delete voice.retryNeural;delete voice.restart
  await Promise.all(pending);output.push({synchronous,final:events,voice,preferences:host.preferences})
 }
 assert.deepEqual(output[1],output[0]);checks++
}
})
it('releases repeated preference command handles without growing WASM memory',async()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++){const {host,pending}=setup(true,i);host.setPreference('rate',2);await Promise.all(pending)}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}
})
it('uses the current reader after synchronous UI callbacks replace the reader',async()=>{
 const {host,events}=setup(true,2)
 host.updateMiniPlayer=()=>{events.push(['mini']);host.reader={applyPreferences:p=>events.push(['replacement',p.rate])}}
 await host.applyPreferences()
 expect(events).toContainEqual(['replacement',1]);expect(events.some(event=>event[0]==='engine')).toBe(false)
})
it('preserves a normalization failure and does not continue applying or notifying',()=>{
 const {host,events}=setup(true,2),failure=Error('invalid preference')
 expect(()=>ui.reader_set_preference(host,'theme','night',true,()=>{throw failure},()=>events.push(['notify']))).toThrow(failure)
 expect(events).toEqual([['stop']]);expect(host.preferences.theme).toBe('paper')
})
it('requires render and warmUp when a picker exists, but accepts an absent picker',async()=>{
 const {host,pending}=setup(true,2);host.neuralPicker={}
 await expect(host.applyPreferences(false)).rejects.toThrow()
 expect(()=>ui.reader_set_preference(host,'footnotes',true,true,normalize,()=>{})).toThrow()
 await Promise.allSettled(pending)
 host.neuralPicker=null;await expect(host.applyPreferences(false)).resolves.toBeUndefined()
})
