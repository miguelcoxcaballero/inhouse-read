// Microbench of the readers' own doors (rust-ui reader_doors.rs) against the JavaScript modules they replaced
// (src/js/readers/speech-map.js and speech-hold.js as they were, rebuilt here over the same exports). jsdom, so the
// DOM work is not a browser's; interleaved rounds, medians. Not part of the suite. To run it:
//   cp tools/bench/reader-doors-bench.test.js tests/unit/zz-reader-doors-bench.test.js
//   npx vitest run tests/unit/zz-reader-doors-bench.test.js && rm tests/unit/zz-reader-doors-bench.test.js
import './helpers/rust-ui-ready.js'
import { it } from 'vitest'
import { readerUI } from '../../src/js/readers/rust-ui-required.js'
import { speechHold as frozenHold } from './helpers/reference-speech-hold.js'
const median = v => { const s=[...v].sort((a,b)=>a-b); return s[s.length>>1] }
it('bench', () => {
  const ui = readerUI()
  const before = (root, mode) => { const {text,spans,doc}=ui.speech_map(root,mode); return {text,spans,rangeFor:(start,end)=>ui.speech_range(doc,spans,start,end),offsetOf:(container,offset)=>ui.speech_offset(doc,spans,container,offset)} }
  document.body.innerHTML = '<article>' + Array.from({length:40},(_,i)=>`<p>Paragraph ${i} with <em>some</em> words in it.</p>`).join('') + '</article>'
  const root = document.querySelector('article'), small = document.createElement('p'); small.textContent = 'One line.'
  const event = { clientX: 10, clientY: 20 }
  const liveHold = ui.speech_hold(ui, document), oldHold = frozenHold(document)
  const liveMap = ui.speech_mapped(ui,0,root), oldMap = before(root,0)
  const sides = {
    mapBefore:()=>before(root,0), mapNow:()=>ui.speech_mapped(ui,0,root),
    smallBefore:()=>before(small,2), smallNow:()=>ui.speech_mapped(ui,2,small),
    rangeBefore:()=>oldMap.rangeFor(100,140), rangeNow:()=>liveMap.rangeFor(100,140),
    holdMakeBefore:()=>frozenHold(document), holdMakeNow:()=>ui.speech_hold(ui,document),
    holdBefore:()=>oldHold.canLongPress(event), holdNow:()=>liveHold.canLongPress(event)
  }
  const names = Object.keys(sides), times = Object.fromEntries(names.map(k=>[k,[]]))
  for (let r=0;r<41;r++) for (const name of r%2?names:[...names].reverse()) { const run=sides[name], reps=name.startsWith('map')?20:500; const t=performance.now(); for(let i=0;i<reps;i++) run(); if(r>4)times[name].push((performance.now()-t)/reps*1000) }
  console.log('READER-DOORS', JSON.stringify(Object.fromEntries(names.map(n=>[n,median(times[n]).toFixed(2)+' us']))))
}, 600000)
