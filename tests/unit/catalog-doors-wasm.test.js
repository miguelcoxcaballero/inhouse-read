// @vitest-environment node
// The catalogue's doors that rust-ui answers itself (catalog_doors.rs `catalog_door`) against the frozen JavaScript
// (tests/unit/helpers/reference-voice-catalog.js, reference-voice-order.js, reference-language-detect.js). The reader
// reaches them bound to the page's normalizeLang and a number; this calls the same export the same way.
import './helpers/rust-ui-ready.js'
import {it,expect} from 'vitest'
import {readerUI} from '../../src/js/readers/rust-ui-required.js'
import {normalizeLang} from '../../src/js/readers/voice-catalog.js'
import * as frozen from './helpers/reference-voice-catalog.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {makeCases} from '../helpers/voice-order-cases.js'

const door=(which,...args)=>{const ui=readerUI();return ui.catalog_door(normalizeLang,which,...args)}
const outcome=run=>{try{return ['returned',run()]}catch(error){return ['threw',error?.constructor?.name]}}
function same(actual,expected,label){
 expect(actual[0],label).toBe(expected[0])
 if(expected[0]==='threw')return expect(actual[1],label).toBe(expected[1])
 expect(Object.is(actual[1],expected[1]),`${label}: ${String(actual[1])} vs ${String(expected[1])}`).toBe(true)
}

it('knows the ids of a natural voice like the original',()=>{
 const ids=['piper:es_ES-davefx-medium','piper:','piper','Piper:x',' piper:x','supertonic3:F1:es','supertonic3:M5:en','supertonic3:F0:es','supertonic3:F6:es',
  'supertonic3:X1:es','supertonic3:F1:ES','supertonic3:F1:e','supertonic3:F1:esp','supertonic3:F1:es\n','supertonic3:F1:e\ud800','piper:\ud800','supertonic3:F1:é1',
  '',null,undefined,0,1,true,{},[],['piper:x'],Symbol('piper:x'),new String('piper:x'),{toString:()=>'piper:x'},...neuralVoices.map(voice=>voice.id)]
 for(const id of ids)same(outcome(()=>door(0,id)),outcome(()=>frozen.isNeuralId(id)),String(typeof id==='symbol'?'symbol':id))
})

it('reads the language a book declares like the original',()=>{
 const thrower={get language(){throw new Error('no')}}
 const readers=[null,undefined,0,'',{},{metadata:null},{metadata:undefined},{metadata:{}},{metadata:{language:'es'}},{metadata:{language:['en-US','fr']}},
  {metadata:{language:[]}},{metadata:{language:['']}},{metadata:{language:[null,'x']}},{metadata:{language:0}},{metadata:{language:7}},{metadata:{language:true}},
  {metadata:{language:{toString:()=>'de'}}},{metadata:{language:{toString(){throw new Error('no')}}}},{metadata:{language:Symbol('es')}},{metadata:{language:[Symbol('fr')]}},
  {metadata:thrower},{get metadata(){throw new Error('no')}},{metadata:{language:'\ud800es'}},{metadata:{language:' es-MX '}},{metadata:'text'},{metadata:5},
  {metadata:{language:new String('pt')}},{metadata:{language:{0:'x',length:1}}},{metadata:{language:[['ca']]}},{metadata:{language:[{toString:()=>'gl'}]}}]
 readers.forEach((reader,index)=>same(outcome(()=>door(1,reader)),outcome(()=>frozen.declaredLanguage(reader)),'reader '+index))
})

it('chooses the voice of an utterance like the original, over the shipped catalogue',()=>{
 let compared=0
 const languages=['es','es-ES','es_MX','en','en-GB','en-US','fr','de-DE','pt-BR','he','zz','','spa-ESP','ES-es',undefined]
 for(let round=0;round<60;round++){
  const installed=new Set(neuralVoices.filter((_,index)=>(index*7+round*13)%11<(round%6)).map(voice=>voice.id))
  const voices=neuralVoices.map(entry=>frozen.normalizeNeuralVoice(entry,installed)).filter(Boolean)
  const usable=voices.filter(voice=>voice.installed)
  for(const language of languages)for(const multilingual of [false,true]){
   const voiceId=round%3===0?'':round%3===1?(usable[round%Math.max(usable.length,1)]?.id||'piper:missing'):voices[(round*5)%voices.length].id
   const options={voiceId,language,multilingual,deviceLang:['es-ES','en-US','',undefined][round%4]}
   for(const list of [voices,round%5===0?[]:usable]){
    const expected=frozen.resolveVoice(list,options),actual=door(2,list,options)
    expect(Object.keys(actual)).toEqual(Object.keys(expected))
    expect(actual.voice).toBe(expected.voice);expect(actual.voiceId).toBe(expected.voiceId);expect(Object.is(actual.language,expected.language)).toBe(true)
    compared++
   }
  }
 }
 expect(compared).toBe(60*languages.length*2*2)
 const voices=neuralVoices.map(entry=>frozen.normalizeNeuralVoice(entry,new Set(neuralVoices.map(voice=>voice.id)))).filter(Boolean)
 expect(door(2,voices)).toEqual(frozen.resolveVoice(voices))
 expect(door(2,voices,{})).toEqual(frozen.resolveVoice(voices,{}))
 expect(door(2,null,{language:'es'})).toEqual(frozen.resolveVoice(null,{language:'es'}))
 // A record that is not the catalogue's is left unanswered by the kernel: the door throws, as the wrapper did.
 expect(()=>door(2,[{installed:true,base:'es',neural:false,id:'x',lang:'es'}],{language:'es'})).toThrow('Unsupported neural voice record')
})

it('names languages and regions like the original',()=>{
 const tags=['es','es-MX','es_ES','en','en-US','en-GB','pt-BR','fr-CA','de','he','iw','zh','zh-CN','cmn','ca','gl','eu','xx','zz-ZZ','tlh','spa-ESP','es-419','fr-419',
  'sr-Latn-RS','EN-us','',' ',null,undefined,0,'e','english','1','-','es-','-MX','nb','no','nor','ar-JO','sw-KE','ka-GE','ne','ml-IN','kk','lb','is','cy-GB','fa-IR',
  ...new Set(neuralVoices.map(voice=>voice.lang))]
 for(const tag of tags){
  same(outcome(()=>door(4,tag)),outcome(()=>frozen.baseLanguageName(tag)),'base '+tag)
  same(outcome(()=>door(5,tag)),outcome(()=>frozen.regionName(tag)),'region '+tag)
  same(outcome(()=>door(6,tag)),outcome(()=>frozen.languageName(tag)),'language '+tag)
 }
})

it('orders the list and recommends a voice like the original',()=>{
 const cases=makeCases().filter((_,index)=>index%8===0)
 expect(cases.length).toBeGreaterThan(150)
 for(const [voices,book,device] of cases){
  const expected=frozen.orderNeuralVoices(voices,{bookLang:book,deviceLang:device}),actual=door(7,voices,book,device)
  expect(actual.length).toBe(expected.length);actual.forEach((voice,index)=>expect(voice).toBe(expected[index]))
  expect(door(8,voices,book,device)).toBe(frozen.recommendedNeuralFor(voices,book,device))
 }
 const catalogue=neuralVoices.map(entry=>frozen.normalizeNeuralVoice(entry)).filter(Boolean)
 for(const lang of new Set(catalogue.flatMap(voice=>[voice.lang,voice.base]))){
  const expected=frozen.orderNeuralVoices(catalogue,{bookLang:lang,deviceLang:'es-ES'}),actual=door(7,catalogue,lang,'es-ES')
  expect(actual.map(voice=>voice.id)).toEqual(expected.map(voice=>voice.id));actual.forEach((voice,index)=>expect(voice).toBe(expected[index]))
  expect(door(8,catalogue,lang,'es-ES')).toBe(frozen.recommendedNeuralFor(catalogue,lang,'es-ES'))
  expect(door(8,catalogue,lang)).toBe(frozen.recommendedNeuralFor(catalogue,lang))
 }
 // Missing tags are the empty ones; a set or a generator is spread like an array; nothing is an empty list.
 expect(door(7,catalogue).map(voice=>voice.id)).toEqual(frozen.orderNeuralVoices(catalogue).map(voice=>voice.id))
 expect(door(7,new Set(catalogue),'en').map(voice=>voice.id)).toEqual(frozen.orderNeuralVoices([...catalogue],{bookLang:'en'}).map(voice=>voice.id))
 expect(door(7,null,'en')).toEqual([]);expect(door(8,undefined,'en')).toBe(null)
 expect(()=>door(7,{length:1,0:catalogue[0]},'en')).toThrow(TypeError)
 expect(()=>door(7,[{neural:true}],'en')).toThrow('Unsupported neural voice record')
})

it('detects the language of a text like the original',()=>{
 const texts=['El perro corre por el campo y la casa es grande.','The quick brown fox jumps over the lazy dog and runs away.','Le chat est sur la table et il dort.',
  'Der Hund läuft schnell über die Straße und das Haus.','Il gatto è sul tavolo e la casa è bella.','O cão corre pelo campo e a casa é grande.','שלום עולם, מה שלומך היום?',
  'Привет мир, как дела сегодня?','こんにちは世界','你好，世界','안녕하세요 세계','',' ','1234 5678','ok',null,undefined,0,'El the le der il o']
 for(const text of texts)for(const fallback of ['en-US','es-ES','es','pt_BR',undefined,'']){
  const expected=outcome(()=>fallback===undefined?frozen.detectLanguage(text):frozen.detectLanguage(text,fallback))
  const actual=outcome(()=>fallback===undefined?door(3,text):door(3,text,fallback))
  expect(actual,JSON.stringify([text,fallback])).toEqual(expected)
 }
})
