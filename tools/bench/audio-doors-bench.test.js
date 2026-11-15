// @vitest-environment node
// Microbench of the audio doorways the native player asks on every clock read (rust-ui neural_player.rs over
// neural_audio.rs): handed the JavaScript wrappers, as src/js/readers/neural-voice/audio.js was until
// readers-voice-30, against asking rust-ui itself (no `audio` argument). Interleaved rounds, medians.
// Not part of the suite. To run it:
//   cp tools/bench/audio-doors-bench.test.js tests/unit/zz-audio-doors-bench.test.js
//   npx vitest run tests/unit/zz-audio-doors-bench.test.js && rm tests/unit/zz-audio-doors-bench.test.js
import './helpers/rust-ui-ready.js'
import { it } from 'vitest'
import { readerUI } from '../../src/js/readers/rust-ui-required.js'
import * as wrappers from './helpers/live-audio.js'
const median = v => { const s=[...v].sort((a,b)=>a-b); return s[s.length>>1] }
it('bench', () => {
  const ui = readerUI()
  const audio = { nativeAudio:wrappers.nativeAudio, pauseNativeAudio:wrappers.pauseNativeAudio, stopNativeAudio:wrappers.stopNativeAudio }
  // A player with no native session open: the clock asks for the session and answers 0.
  const player = { session:null, epoch:1, scheduled:true, nextTime:2 }
  const env = { Worker() {}, WebAssembly:{}, AudioContext:null, webkitAudioContext:null, caches:{}, InhousePcm:null }
  const sides = {
    clockBefore:()=>ui.native_clock(player,audio), clockNow:()=>ui.native_clock(player),
    bufferedBefore:()=>ui.native_buffered(player,audio), bufferedNow:()=>ui.native_buffered(player),
    supportedBefore:()=>ui.neural_supported(env,wrappers.nativePcmBridge), supportedNow:()=>ui.neural_supported(env)
  }
  const names = Object.keys(sides), times = Object.fromEntries(names.map(k=>[k,[]]))
  for (let r=0;r<41;r++) for (const name of r%2?names:[...names].reverse()) { const run=sides[name]; const t=performance.now(); for(let i=0;i<2000;i++) run(); if(r>4)times[name].push((performance.now()-t)/2000*1000) }
  console.log('AUDIO-DOORS', JSON.stringify(Object.fromEntries(names.map(n=>[n,median(times[n]).toFixed(3)+' us']))))
}, 600000)
