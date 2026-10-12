import assert from 'node:assert/strict'
import {it,vi,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {LegacyVoiceFlow} from '../../src/js/readers/voice-flow-legacy.js'
const fixture=vi.hoisted(()=>({voices:[]}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralVoiceList:()=>fixture.voices}))
import {langBase,declaredLanguage} from '../../src/js/readers/voice-catalog.js'
import {languageOptions,voiceOptions} from '../../src/js/readers/voice-menus-legacy.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const device=()=>navigator.language
function setup(native,trial){
 const voices=['es-ES','es-MX','en-GB','en-US','nl-NL'].map((lang,i)=>({id:'voice'+i,lang,base:langBase(lang),region:lang.split('-')[1],name:'Voice '+i,installed:trial%(i+2)!==0,neural:true,tier:'high',recommended:i===2}))
 if(trial%11===0)voices.length=0
 fixture.voices=voices
 const host=new LegacyVoiceFlow(),events=[]
 host.reader={language:['es-ES','en-AU','nl-NL',''][trial%4],metadata:{language:['en-US','es-MX',''][trial%3]}}
 if(trial%13===0)Object.defineProperty(host.reader,'language',{get(){throw Error('no book')}})
 host.preferences={voice:['voice0','voice2','removed',''][trial%4],voiceLang:['','es','nl'][trial%3]}
 host.voiceCatalog=trial%5?{voices}:null
 host.setPreference=(key,value,options)=>{events.push(['preference',key,value,options]);host.preferences={...host.preferences,[key]:value}}
 host.languageMenu={setOptions:(...args)=>events.push(['languages',...args]),setValueText:(...args)=>events.push(['language-label',...args])}
 host.voiceMenu={setOptions:(...args)=>events.push(['voices',...args]),setValueText:(...args)=>events.push(['voice-label',...args])}
 host.neuralPicker=trial%7?{render:()=>events.push(['render'])}:null
 if(native){
  host.bookLanguage=()=>ui.reader_book_language(host,device)
  host.voiceBase=voices=>ui.reader_voice_base(host,voices,langBase,declaredLanguage)
  host.chooseLanguage=value=>ui.reader_choose_language(host,value,langBase)
  host.populateVoices=()=>ui.reader_populate_voices(host,()=>voices,device,langBase,languageOptions,voiceOptions)
 }
 return{host,voices,events}
}
it('preserves choices, automatic labels, installation state and menu effects in 500 scenarios',()=>{
let checks=0
for(let trial=0;trial<500;trial++){
 const outputs=[]
 for(const native of [false,true]){
  const {host,voices,events}=setup(native,trial)
  const initialBase=host.voiceBase(voices);host.populateVoices();host.chooseLanguage(['','es','en','nl'][trial%4]);host.populateVoices()
  assert.equal(host.voiceCatalog.voices,voices)
  outputs.push({initialBase,events,preferences:host.preferences,catalog:host.voiceCatalog,shown:host.voiceBaseShown})
 }
 assert.deepEqual(outputs[1],outputs[0]);checks++
}
})
it('keeps voice-menu command allocations bounded through 2000 cycles',()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++){const {host}=setup(true,i);host.populateVoices();host.chooseLanguage('es')}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}
})
it('reads the device locale only when the book language is absent or throws',()=>{
 let calls=0;const device=()=>{calls++;return 'nl-NL'},host={reader:{language:'es-MX'}}
 expect(ui.reader_book_language(host,device)).toBe('es-MX');expect(calls).toBe(0)
 Object.defineProperty(host.reader,'language',{get(){throw Error('closed')}})
 expect(ui.reader_book_language(host,device)).toBe('nl-NL');expect(calls).toBe(1)
})
it('keeps an installed voice for its language and clears an incompatible one before changing language',()=>{
 const {host,voices,events}=setup(true,1);host.preferences={voice:'voice0',voiceLang:''};voices[0].installed=true;host.voiceCatalog={voices}
 host.chooseLanguage('es');expect(events.filter(row=>row[0]==='preference')).toEqual([['preference','voiceLang','es',undefined]])
 events.length=0;host.chooseLanguage('nl');expect(events.filter(row=>row[0]==='preference')).toEqual([['preference','voice','',{restart:false}],['preference','voiceLang','nl',undefined]])
})
