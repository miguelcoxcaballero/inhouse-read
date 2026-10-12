// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, it, expect, vi } from 'vitest'
const state=vi.hoisted(()=>({core:null}))
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}))
import { rustSpeechTempo, speechTempoJS, speedUpSpeech, synthesisRate } from '../../src/js/readers/neural-voice/speech-tempo.js'
let core
beforeAll(async()=>{
  core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports
  expect(typeof core.speech_tempo).toBe('function');state.core=core
})
const tone=(rate,seconds,hz=180)=>Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>.6*Math.sin(2*Math.PI*hz*i/rate))
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength)
for(const sr of [8000,22050,24000,44100,48000,96000])for(const speed of [1,1.25,1.5,2,3])
it(`preserves complete waveform/timeline and pitch at ${sr} Hz, ${speed}x`,()=>{
  const pcm=tone(sr,.6), original=pcm.slice(), positions=[0,13,Math.floor(pcm.length/2),pcm.length-1]
  const expected=speechTempoJS(pcm,sr,speed,positions), actual=rustSpeechTempo(core,pcm,sr,speed,positions)
  expect(actual).not.toBeNull();expect(bytes(actual.pcm).equals(bytes(expected.pcm))).toBe(true)
  expect(actual.positions).toEqual(expected.positions);expect(bytes(pcm).equals(bytes(original))).toBe(true)
  expect(actual.pcm.buffer).not.toBe(core.memory.buffer)
  expect(Math.abs(actual.pcm.length/sr-.6/speed)).toBeLessThan(.035)
  // Zero crossings measure pitch independently of implementation/duration.
  let crossings=0;for(let i=1;i<actual.pcm.length;i++)if(actual.pcm[i-1]<=0&&actual.pcm[i]>0)crossings++
  expect(Math.abs(crossings*sr/actual.pcm.length-180)).toBeLessThan(7)
  expect(actual.positions.at(-1)).toBe(actual.pcm.length-1)
})
it('copies short clips and the last samples instead of cutting to a guessed duration',()=>{
  for(const count of [1,2,10,199,245,1001]) {
    const pcm=Float32Array.from({length:count},(_,i)=>i/count)
    const out=rustSpeechTempo(core,pcm,8000,2,[count-1])
    expect(out.pcm.at(-1)).toBe(pcm.at(-1));expect(out.positions[0]).toBe(out.pcm.length-1)
  }
})
it('preserves distinct final consonant bursts, silence and nonperiodic speech without reallocating its arena',()=>{
  let seed=86701;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)*2-1
  for(let j=0;j<24;j++) {
    const sr=24000,pcm=Float32Array.from({length:24000+j*113},(_,i)=>i%600<300?random()*.15:.4*Math.sin(i*.09))
    pcm.fill(0,4000,7000)
    const marks=[1,4100,6899,9000,pcm.length-32,pcm.length-1]
    const actual=rustSpeechTempo(core,pcm,sr,1.25+(j%8)*.25,marks), expected=speechTempoJS(pcm,sr,1.25+(j%8)*.25,marks)
    expect(bytes(actual.pcm).equals(bytes(expected.pcm))).toBe(true);expect(actual.positions).toEqual(expected.positions)
    expect(actual.pcm.every(Number.isFinite)).toBe(true)
  }
  const pcm=tone(24000,2), first=rustSpeechTempo(core,pcm,24000,2), memory=core.memory.buffer.byteLength, copy=first.pcm.slice()
  for(let i=0;i<80;i++)rustSpeechTempo(core,pcm,24000,2)
  expect(core.memory.buffer.byteLength).toBe(memory);expect(bytes(first.pcm).equals(bytes(copy))).toBe(true)
})
it('remaps page marks through the actual tempo operations and uses the cold-core fallback',()=>{
  const pcm=tone(24000,1),marks=[{sample:23999,offset:92},{sample:12000,offset:41,estimated:true}]
  const call=vi.fn(core.speech_tempo);state.core={...core,speech_tempo:call}
  const a=speedUpSpeech(pcm,24000,1.5,marks);expect(call).toHaveBeenCalledOnce()
  state.core=null;const b=speedUpSpeech(pcm,24000,1.5,marks);state.core=core
  expect(bytes(a.pcm).equals(bytes(b.pcm))).toBe(true);expect(a.marks).toEqual(b.marks)
  expect(a.marks.map(m=>m.offset)).toEqual([41,92]);expect(a.marks[0].estimated).toBe(true)
  expect(a.marks.at(-1).sample).toBe(a.pcm.length-1);expect(marks[0].sample).toBe(23999)
})
it('never requests fast phoneme/latent generation and leaves slow voices unchanged',()=>{
  for(const rate of [1.25,1.5,2,3])expect(synthesisRate(rate)).toBe(1)
  expect(synthesisRate(.5)).toBe(.5);expect(synthesisRate(.75)).toBe(.75)
  const pcm=tone(24000,.2),marks=[{offset:3,sample:123}]
  for(const rate of [.5,1]){const out=speedUpSpeech(pcm,24000,rate,marks);expect(out.pcm).toBe(pcm);expect(out.marks).toBe(marks)}
})
it('rejects malformed input and frees the arena even after a rejected export',()=>{
  const pcm=tone(24000,.2),release=vi.fn(core.free_f64)
  expect(rustSpeechTempo({...core,free_f64:release,speech_tempo:()=>0},pcm,24000,2)).toBeNull();expect(release).toHaveBeenCalledOnce()
  for(const points of [[-1],[2,1],[NaN],[pcm.length],[1.25]])expect(rustSpeechTempo(core,pcm,24000,2,points)).toBeNull()
  for(const speed of [0,.5,Infinity,NaN,3.1])expect(rustSpeechTempo(core,pcm,24000,speed)).toBeNull()
  pcm[5]=NaN;expect(rustSpeechTempo(core,pcm,24000,2)).toBeNull()
})
