// @vitest-environment node
import './helpers/rust-ui-ready.js'
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustNormalizeSpeech } from '../../src/js/readers/speech-normalize-wasm.js';
import { normalizeSpeech, planSpeech } from '../../src/js/readers/speech-text.js';
import * as reference from './helpers/reference-speech-text.js';
let core;
beforeAll(async()=>{core=await loadRustCore({bytes:readFileSync('src/wasm/inhouse_read_core.wasm')});expect(typeof core?.speech_normalize).toBe('function');});
const texts=['', ' ', 'Título\u2029Párrafo\u2029\u2029Después.', 'Dijo: «Voy.»\u2029Volvió.',
  '"\u2029\u2029\u2029', 'informa-\ntion e invisi\u00adble\u200b. [12] (nota 2)',
  'Capítulo\nUno\nCapítulo\nDos', '😀 a\ud800 b\udfff Z\u2029Final',
  'هذه جملة.\u2029日本語。次の文！\u2029Это текст.\u2029हाँ।',
  '« Bonjour ! » dit-il. Sr. García, una oración que cruza páginas y continúa hasta el final.'];
for(let i=0;i<texts.length;i++)for(const options of [{},{footnotes:false},{skipHeaders:true},{footnotes:false,skipHeaders:true,headerRanges:[]}])
it(`preserves cleanup, raw maps and plans ${i}/${JSON.stringify(options)}`,()=>{
 const raw=texts[i],opts={...options,pageBreaks:[1,8,20],opening:true};
 expect(normalizeSpeech(raw,opts)).toEqual(reference.normalizeSpeech(raw,opts));
 for(const from of [0,3,8,raw.length])expect(planSpeech(raw,opts,from)).toEqual(reference.planSpeech(raw,opts,from));
});
it('preserves every UTF-16 code unit and all ECMAScript whitespace classes',()=>{
 const pieces=[];for(let i=0;i<65536;i++)pieces.push('A'+String.fromCharCode(i)+'B\u2029');
 const raw=pieces.join(''),actual=normalizeSpeech(raw),expected=reference.normalizeSpeech(raw);
 expect(actual.text).toBe(expected.text);
 expect(Buffer.from(Uint32Array.from(actual.map).buffer).equals(Buffer.from(Uint32Array.from(expected.map).buffer))).toBe(true);
 expect(Buffer.from(Uint32Array.from(actual.breaks).buffer).equals(Buffer.from(Uint32Array.from(expected.breaks).buffer))).toBe(true);
});
it('preserves random removals, adjacent hard breaks and chunk boundaries',()=>{
 let seed=123456789;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const alphabet=['\u2029','\u2029','a',' ','.','”','\u2060','\t','\u3000','\ud800','\udc00','é','!'];
 for(let round=0;round<35;round++){
  const raw=Array.from({length:17000+round},()=>alphabet[random()%alphabet.length]).join('');
  const removed=Uint8Array.from({length:raw.length},()=>random()%7===0?1:0),visible=raw.split('').map((c,i)=>removed[i]?'\u200b':c).join('');
  expect(rustNormalizeSpeech(core,raw,removed)).toEqual(reference.normalizeSpeech(visible));
 }
});
it('keeps confirmed marginal headers and cross-page speech marks',()=>{
 const raw='HEADER\nTexto primero que sigue en la página siguiente sin partir la frase.\nHEADER\nFinal.';
 const options={skipHeaders:true,headerRanges:[{start:0,end:6},{start:raw.lastIndexOf('HEADER'),end:raw.lastIndexOf('HEADER')+6}],pageBreaks:[35,51]};
 expect(planSpeech(raw,options)).toEqual(reference.planSpeech(raw,options));
 expect(planSpeech(raw,options).some(item=>item.marks?.length)).toBe(true);
});
it('rejects unsupported or oversized inputs before allocation',()=>{
 const alloc=vi.fn();const engine={...core,alloc_f64:alloc};
 for(const [raw,removed] of [['a'.repeat(1000001),new Uint8Array(1000001)],['hi',new Uint8Array(1)],[null,new Uint8Array(0)]])expect(rustNormalizeSpeech(engine,raw,removed)).toBeNull();
 expect(alloc).not.toHaveBeenCalled();expect(rustNormalizeSpeech({},'a',new Uint8Array(1))).toBeNull();
});
it('refreshes memory after growth and copies results before release',()=>{
 let live=0;const engine={...core,alloc_f64(n){live+=n;return core.alloc_f64(n);},free_f64(p,n){live-=n;new Uint8Array(core.memory.buffer,p,n*8).fill(0);core.free_f64(p,n);},speech_normalize(...args){core.memory.grow(1);return core.speech_normalize(...args);}};
 const raw='a\u2029 b.\u2029c',actual=rustNormalizeSpeech(engine,raw,new Uint8Array(raw.length));
 expect(actual).toEqual(reference.normalizeSpeech(raw));expect(live).toBe(0);
});
it.each([()=>0,()=>{throw Error('kernel');}])('releases failed kernels',kernel=>{
 const free=vi.fn(core.free_f64);expect(rustNormalizeSpeech({...core,speech_normalize:kernel,free_f64:free},'a',new Uint8Array(1))).toBeNull();expect(free).toHaveBeenCalledOnce();
});
