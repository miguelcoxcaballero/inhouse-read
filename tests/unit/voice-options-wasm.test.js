import {beforeAll,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import * as reference from '../../src/js/readers/voice-menus-legacy.js'
import * as active from '../../src/js/readers/voice-menus.js'
import {normalizeNeuralVoice,langBase} from '../../src/js/readers/voice-catalog.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});runtime.ui=ui})
const languages=['es-ES','es-MX','es-AR','en-US','en-GB','fr','it','pt-BR','pt-PT','de','nl','ca','ar','zh','ru','bg','sr','af','xx','zz','']
const names=['Lucía','Anne','Jane','Voz','Voz','日本語','Åsa','Sven','Léa','😀']
it('matches 3000 seeded language/voice menus, keeping stable ties and original voice references',()=>{
 let seed=0x5123;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
 for(let sample=0;sample<1000;sample++){
  const voices=[];for(let i=0;i<Math.floor(random()*90);i++){
   const id='piper:voice'+Math.floor(random()*30),entry={id,lang:languages[Math.floor(random()*languages.length)],name:names[Math.floor(random()*names.length)],quality:random()<.5?'high':'medium',sizeMB:60,recommended:random()<.3}
   const voice=normalizeNeuralVoice(entry,random()<.6?[id]:[]);if(voice){voice.network=random()<.1;if(random()<.1)voice.neural=false;voices.push(voice)}
  }
  voices.push(null,undefined)
  const settings={bookLang:languages[sample%languages.length],deviceLang:languages[(sample*3)%languages.length]},base=sample%2?langBase(languages[(sample*5)%languages.length]):''
  const bases=[...new Set(voices.filter(Boolean).map(v=>v.base))]
  expect(active.orderLanguages(bases,settings)).toEqual(reference.orderLanguages(bases,settings))
  expect(active.languageOptions(voices,settings)).toEqual(reference.languageOptions(voices,settings))
  const expected=reference.voiceOptions(voices,base,settings),actual=active.voiceOptions(voices,base,settings);expect(actual).toEqual(expected)
  for(let i=1;i<actual.length;i++)expect(actual[i].voice).toBe(expected[i].voice)
 }
},15000)
it('accepts the same iterable inputs for language grouping and does not mutate voices',()=>{
 const voice=Object.freeze(normalizeNeuralVoice({id:'piper:es',lang:'es',name:'Voz'},['piper:es'])),voices=new Set([voice]),settings={bookLang:'es'}
 expect(active.languageOptions(voices,settings)).toEqual(reference.languageOptions(voices,settings))
 expect(active.orderLanguages(new Set(['en','es']),settings)).toEqual(reference.orderLanguages(new Set(['en','es']),settings))
 expect(active.voiceOptions(Object.freeze([voice]),'es',settings)[1].voice).toBe(voice)
})
it('frees per-call labels and scores without growing the WASM arena',()=>{
 const voices=languages.map((lang,i)=>normalizeNeuralVoice({id:'piper:'+i,lang,name:'Voice '+i},['piper:'+i])).filter(Boolean),settings={bookLang:'es-ES',deviceLang:'en-GB'}
 const cycle=i=>{voices[0].name='Unique '+i;active.languageOptions(voices,settings);active.voiceOptions(voices,'',settings)}
 for(let i=0;i<30;i++)cycle(i);const before=core.memory.buffer.byteLength
 for(let i=30;i<1030;i++)cycle(i)
 expect(core.memory.buffer.byteLength).toBe(before)
},15000)
