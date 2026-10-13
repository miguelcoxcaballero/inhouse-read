// @vitest-environment node
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {hebrewToIpa} from '../../src/js/readers/neural-voice/hebrew.js'
import {releaseHebrewArena} from '../../src/js/readers/neural-voice/hebrew-wasm.js'
import {IPA_ORACLES} from './fixtures/hebrew-oracles.js'
import './neural-voice-hebrew.test.js'
const state=vi.hoisted(()=>({core:null,calls:0}));vi.mock('../../src/js/rust-voice-core.js',()=>({getRustVoiceCore:()=>state.core,loadRustVoiceCore:async()=>state.core}));
let core;const native={};
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_voice.wasm'))).instance.exports;Object.assign(native,core,{hebrew_ipa_words:(...args)=>{state.calls++;return core.hebrew_ipa_words(...args)}})});
beforeEach(()=>{state.core=native;state.calls=0});afterAll(()=>{releaseHebrewArena()});
it.each(IPA_ORACLES)('preserves upstream IPA in a native full fragment: %s',(text)=>{
 const input=Array(20).fill(text).join(' ');state.core=null;const expected=hebrewToIpa(input);state.core=native;expect(hebrewToIpa(input)).toBe(expected);if(input.length>=96)expect(state.calls).toBe(1);
});
it('keeps exact glyph, stress and sheva output for 10000 generated inputs',()=>{
 const chars=Array.from('אבגדהוזחטיכלמנסעפצקרשתךםןףץ!•A🙂׳\u0301\u034F'),marks=Array.from('\u05B0\u05B1\u05B2\u05B3\u05B4\u05B5\u05B6\u05B7\u05B8\u05B9\u05BA\u05BB\u05BC\u05BF\u05C1\u05C2\u05C7');let seed=3;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed};
 let eligible=0;
 for(let i=0;i<10000;i++){let text='';for(let j=0;j<(i%30)+1;j++){text+=chars[next()%chars.length];if(next()%2)text+=marks[next()%marks.length];if(next()%3===0)text+=marks[next()%marks.length];if(next()%5===0)text+=' '};text=Array(8).fill(text).join(' ');if(text.length>=96)eligible++;state.core=null;const expected=hebrewToIpa(text);state.core=native;expect(hebrewToIpa(text)).toBe(expected)}expect(state.calls).toBe(eligible);expect(eligible).toBe(8052);
});
it('keeps small fragments on the measured existing path and adopts a late module',()=>{
 expect(hebrewToIpa('שָׁלוֹם')).toBe('ʃˈalom');expect(state.calls).toBe(0);const text='שָׁלוֹם '.repeat(30);state.core=null;const expected=hebrewToIpa(text);state.core=native;expect(hebrewToIpa(text)).toBe(expected);expect(state.calls).toBe(1);
});
it('uses the previous rules for unavailable, failed, malformed and incomplete modules',()=>{
 const text='שָׁלוֹם עוֹלָם '.repeat(20);state.core=null;const expected=hebrewToIpa(text);
 for(const module of [null,{}, {...core,hebrew_ipa_words:()=>-1},{...core,hebrew_ipa_words:()=>{throw Error('failed')}},{...core,hebrew_ipa_words:()=>Infinity}]){state.core=module;expect(hebrewToIpa(text)).toBe(expected)}
});
it('keeps unpaired UTF-16 values unchanged through the original fallback',()=>{
 const text='שָׁלוֹם \ud800 '.repeat(30);state.core=null;const expected=hebrewToIpa(text);state.core=native;expect(hebrewToIpa(text)).toBe(expected);expect(state.calls).toBe(1);
});
it('keeps memory bounded across repeated complete IPA packets',()=>{
 const text='שָׁלוֹם עוֹלָם '.repeat(40);hebrewToIpa(text);const capacity=core.memory.buffer.byteLength;
 for(let i=0;i<200;i++){hebrewToIpa(text)}expect(core.memory.buffer.byteLength).toBe(capacity);expect(state.calls).toBe(201);
});
it('rejects oversized packets without native calls',()=>{
 state.core=null;const text='שָׁלוֹם '.repeat(7000),expected=hebrewToIpa(text);state.core=native;expect(hebrewToIpa(text)).toBe(expected);expect(state.calls).toBe(0);
});
it('separates the voice module from the numerical and decoration domains',()=>{expect(core.core_domain()).toBe(2);expect(core.core_abi_version()).toBe(1);expect(core.pcm_prepare).toBeUndefined();expect(core.plant_monstera_mesh).toBeUndefined();expect(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync('src/wasm/inhouse_read_voice.wasm')))).toEqual([])});
