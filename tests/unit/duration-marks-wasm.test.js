// @vitest-environment node
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {durationMarks} from '../../src/js/readers/neural-voice/piper-alignment.js'
import {rustDurationMarks,releaseDurationArena} from '../../src/js/readers/neural-voice/duration-marks-wasm.js'
const state=vi.hoisted(()=>({core:null,calls:0}));vi.mock('../../src/js/rust-voice-core.js',()=>({getRustVoiceCore:()=>state.core}));
let core;const native={};beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_voice.wasm'))).instance.exports;Object.assign(native,core,{duration_marks:(...args)=>{state.calls++;return core.duration_marks(...args)}})});beforeEach(()=>{state.core=native;state.calls=0});afterAll(()=>releaseDurationArena());
const compare=(marks,durations,cfg)=>{state.core=null;const expected=durationMarks(marks,durations,cfg);state.core=native;expect(durationMarks(marks,durations,cfg)).toEqual(expected)};
it('uses the compiled frame mapping and preserves opaque offsets and clamps',()=>{
 const values=Float32Array.from({length:128},(_,i)=>i%8),marks=[{offset:{point:1},phoneme:2},{offset:'source',phoneme:70},{offset:3,phoneme:133},{offset:4,phoneme:1}];
 compare(marks,values,{base:2,count:128,samples:9000,trim:150,lead:5,length:2000});expect(state.calls).toBe(1);
});
it('matches 10000 whole packets with actual Float32 durations',()=>{
 let seed=3;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed};let eligible=0;
 for(let i=0;i<10000;i++){const count=1+next()%1200,values=Float32Array.from({length:count},()=>next()%2000/50),base=next()%80,marks=Array.from({length:1+next()%40},(_,index)=>({offset:'opaque:'+index,phoneme:base-4+next()%(count+8)}));compare(marks,values,{base,count,samples:next()%100000,trim:next()%1000,lead:next()%1000,length:next()%100000});if(count>=32)eligible++}expect(state.calls).toBe(eligible);
});
it.each([Float32Array,Float64Array,Array])('keeps standard numeric %s input exact',Type=>{
 const values=Type.from({length:100},(_,i)=>i/10),marks=[{offset:3,phoneme:25},{offset:9,phoneme:50}];compare(marks,values,{count:100,samples:5000,length:4000});expect(state.calls).toBe(1);
});
it('keeps small packets and fractional indices on their existing path',()=>{
 compare([{offset:1,phoneme:1}],Float32Array.of(2,3,4),{count:3,samples:40,length:40});compare([{offset:1,phoneme:2.5}],new Float32Array(100).fill(1),{count:100,samples:40,length:40});expect(state.calls).toBe(0);
});
it('keeps zero, invalid and overflowing durations on the complete original behavior',()=>{
 const marks=[{offset:1,phoneme:20}];for(const value of [0,NaN,Infinity,-1,1e308])compare(marks,new Float64Array(100).fill(value),{count:100,samples:40,length:40});expect(state.calls).toBe(5);
});
it('preserves sparse arrays, coercible values and custom methods through fallback',()=>{
 const marks=[{offset:1,phoneme:20}],cfg={count:100,samples:40,length:40},sparse=new Array(100);sparse[0]=1;compare(marks,sparse,cfg);compare(marks,Array(100).fill('1'),cfg);const custom=new Float32Array(100).fill(1);custom.every=()=>false;compare(marks,custom,cfg);expect(state.calls).toBe(0);
});
it('leaves getters on the original evaluation path without triggering them twice',()=>{
 let reads=0;const mark={offset:1,get phoneme(){reads++;return 20}},values=new Float32Array(100).fill(1),cfg={count:100,samples:40,length:40};state.core=null;durationMarks([mark],values,cfg);const expected=reads;reads=0;state.core=native;durationMarks([mark],values,cfg);expect(reads).toBe(expected);expect(state.calls).toBe(0);
});
it('retains failed/missing/malformed-module fallback without changing samples',()=>{
 const marks=[{offset:1,phoneme:20}],values=new Float32Array(100).fill(1),cfg={count:100,samples:40,length:40};state.core=null;const expected=durationMarks(marks,values,cfg);for(const module of [null,{}, {...core,duration_marks:()=>-1},{...core,duration_marks:()=>Infinity},{...core,duration_marks:()=>{throw Error('failed')}}]){state.core=module;expect(durationMarks(marks,values,cfg)).toEqual(expected)}
});
it('bounds memory through repeated complete mappings',()=>{
 const marks=Array.from({length:16},(_,i)=>({offset:i,phoneme:i*30})),values=new Float32Array(1000).fill(1),cfg={count:1000,samples:5000,length:5000};durationMarks(marks,values,cfg);const capacity=core.memory.buffer.byteLength;for(let i=0;i<200;i++)durationMarks(marks,values,cfg);expect(core.memory.buffer.byteLength).toBe(capacity);expect(state.calls).toBe(201);
});
it('declines incomplete options and oversized packets without a native call',()=>{
 const marks=[{offset:1,phoneme:20}],values=new Float32Array(100).fill(1);for(const cfg of [{count:99,samples:4,length:4},{count:100,samples:4,length:4,base:.5},{count:100,samples:Infinity,length:4}])expect(rustDurationMarks(native,marks,values,{base:0,trim:0,lead:0,...cfg})).toBeUndefined();expect(state.calls).toBe(0);
});
