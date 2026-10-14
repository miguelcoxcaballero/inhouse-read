// @vitest-environment node
import './helpers/rust-ui-ready.js'
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {loadRustCore} from '../../src/js/rust-core.js';
import {rustSpeechFragments} from './helpers/speech-kernels.js';
import {speechSentences,planSpeech} from '../../src/js/readers/speech-text.js';
import * as reference from './helpers/reference-speech-text.js';
let core;
beforeAll(async()=>{core=await loadRustCore({bytes:readFileSync('src/wasm/inhouse_read_core.wasm')});expect(typeof core?.speech_fragments).toBe('function');});
const paragraphs=['One long sentence, with natural clauses and words that need to remain together without changing positions',
 'これは長い文です、次の節を続けます；句読点と改行をそのまま保存します：',
 'هذه فقرة طويلة، وهي مستمرة في الصفحة التالية مع الحفاظ على الكلمات',
 '😀 \ud800 \udfff esta oración contiene caracteres que ocupan distintas unidades de texto', 'nospaces', 'a\u00a0b\u3000c\u2028d\u2029e', '      '];
for(let i=0;i<paragraphs.length;i++)for(const length of [0,1,179,180,181,359,360,361,4000])it(`exact speech fragments ${i}/${length}`,()=>{
 const text=paragraphs[i].repeat(Math.ceil(length/paragraphs[i].length)).slice(0,length);
 expect(speechSentences(text)).toEqual(reference.speechSentences(text));
 expect(rustSpeechFragments(core,text,length?[length]:[])).toEqual(reference.speechSentences(text));
});
it('keeps every sentence and every raw/page position in complete narration plans',()=>{
 const raw=('Sr. García continuó, '+paragraphs[0].repeat(4)+'.\u2029'+paragraphs[1].repeat(8)+'。\u2029').repeat(5);
 for(const from of [0,30,182,900])for(const opening of [false,true]){
  const options={opening,pageBreaks:[1,39,110,201,390,1100],footnotes:false};
  expect(planSpeech(raw,options,from)).toEqual(reference.planSpeech(raw,options,from));
 }
});
it('keeps random clause decisions, ties and whitespace exactly',()=>{
 let seed=8765;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const alphabet=['a','e',' ',' ','\t',',',';','—','，','、',':','\ud800','\udfff','\u3000'];
 for(let i=0;i<45;i++){
  const text=Array.from({length:500+i*83},()=>alphabet[random()%alphabet.length]).join('');
  expect(speechSentences(text)).toEqual(reference.speechSentences(text));
 }
});
it('preserves host fallback for malformed boundaries and oversized text',()=>{
 const alloc=vi.fn(),engine={...core,alloc_f64:alloc};
 for(const ends of [[0],[4],[1,1],[-1],[1.5],[NaN],['2']])expect(rustSpeechFragments(engine,'abc',ends)).toBeNull();
 expect(rustSpeechFragments(engine,'a'.repeat(1000001),[1000001])).toBeNull();expect(alloc).not.toHaveBeenCalled();
});
it('refreshes growing memory, owns results and releases failed calls',()=>{
 const free=vi.fn(core.free_f64),text=paragraphs[0].repeat(8);
 const engine={...core,free_f64:free,speech_fragments(...args){core.memory.grow(1);return core.speech_fragments(...args);}};
 expect(rustSpeechFragments(engine,text,[text.length])).toEqual(reference.speechSentences(text));expect(free).toHaveBeenCalledOnce();
 expect(rustSpeechFragments({...core,free_f64:free,speech_fragments:()=>0},text,[text.length])).toBeNull();expect(free).toHaveBeenCalledTimes(2);
});
