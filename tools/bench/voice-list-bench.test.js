// @vitest-environment node
// Microbench of the natural-voice list (neuralVoiceList in src/js/readers/neural-runtime.js over rust-ui
// catalog_neural_voices) and of the audiobook's choice of a voice (voice_for), against the frozen JavaScript
// (tests/unit/helpers/reference-voice-catalog.js) with the app's own catalogue. Interleaved rounds, medians.
// Not part of the suite. To run it:
//   cp tools/bench/voice-list-bench.test.js tests/unit/zz-voice-list-bench.test.js
//   npx vitest run tests/unit/zz-voice-list-bench.test.js && rm tests/unit/zz-voice-list-bench.test.js
import { it } from 'vitest'
import { rustUI } from './helpers/rust-ui-ready.js'
import { neuralVoiceList } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices } from '../../src/js/readers/neural-voice/catalog.js'
import * as catalog from '../../src/js/readers/voice-catalog.js'
import * as frozen from './helpers/reference-voice-catalog.js'
const median = v => { const s=[...v].sort((a,b)=>a-b); return s[s.length>>1] }
it('bench', () => {
  for (const count of [0, 2, 8]) {
  const installed = new Set(neuralVoices.filter((v,i)=>i%Math.ceil(259/Math.max(count,1))===3).slice(0,count).map(v=>v.id))
  const engine = { installed }
  const frozenList = () => neuralVoices.map(e=>frozen.normalizeNeuralVoice(e, installed)).filter(Boolean)
  const host = { options:{multilingual:false}, languageOverride:'', reader:{language:'es'}, missing:new Set(), voice:'' }
  const list = (a, b) => neuralVoiceList(engine, b)
  const sides = {
    frozenList, liveList:list, liveInstalled:()=>list(undefined,true),
    frozenFor:() => { const voices=frozenList().filter(v=>v.installed&&!host.missing.has(v.id)); return frozen.resolveVoice(voices,{voiceId:'',language:'es',multilingual:false,deviceLang:'es-ES'}) },
    liveFor:() => rustUI.voice_for(host,'Hola mundo',list,catalog.isNeuralId,catalog.declaredLanguage,catalog.langBase,catalog.resolveVoice,()=>'es-ES')
  }
  const times = Object.fromEntries(Object.keys(sides).map(k=>[k,[]]))
  const names = Object.keys(sides)
  for (let r=0;r<41;r++) for (const name of r%2?names:[...names].reverse()) { const run=sides[name], reps=name.startsWith('frozen')?200:10; const t=performance.now(); for(let i=0;i<reps;i++) run(); if(r>4)times[name].push((performance.now()-t)/reps*1000) }
  console.log('VOICE-LIST installed='+installed.size, neuralVoices.length, JSON.stringify(Object.fromEntries(names.map(n=>[n,median(times[n]).toFixed(1)+' us']))), JSON.stringify(sides.liveFor())===JSON.stringify(sides.frozenFor()))
  }
}, 600000)
