import {beforeAll,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import * as reference from './helpers/reference-speech-highlight.js'
import * as highlight from '../../src/js/readers/speech-highlight.js'
import {speechFollowOffset,speechFollowOffsetLegacy} from '../../src/js/readers/speech-follow.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});runtime.ui=ui})
afterEach(()=>{vi.unstubAllGlobals();runtime.ui=ui;document.body.innerHTML='';document.querySelectorAll('style[data-inhouse-speech]').forEach(el=>el.remove());window.getSelection().removeAllRanges()})
const themes=['paper','sepia','night','amoled','sage','unknown','']
it('retains exact theme CSS and one stable style node per document',()=>{
 for(const theme of themes){
  expect(highlight.speechCSS(theme)).toBe(reference.speechCSS(theme));expect(highlight.speechOverlayColor(theme)).toBe(reference.speechOverlayColor(theme))
  const a=document.implementation.createHTMLDocument(),b=document.implementation.createHTMLDocument()
  reference.installSpeechStyle(a,theme);highlight.installSpeechStyle(b,theme)
  expect(b.documentElement.outerHTML).toBe(a.documentElement.outerHTML)
  const style=b.querySelector('style');highlight.installSpeechStyle(b,theme)
  expect(b.querySelector('style')).toBe(style);expect(b.querySelectorAll('style')).toHaveLength(1)
 }
})
it('paints in the owning registry without replacing text or selection',()=>{
 document.body.innerHTML='<p>One <b>two</b> three.</p>'
 const range=document.createRange();range.setStart(document.querySelector('p').firstChild,0);range.setEnd(document.querySelector('b').firstChild,3)
 const registry=new Map();vi.stubGlobal('CSS',{highlights:registry});vi.stubGlobal('Highlight',class{constructor(range){this.range=range}})
 const before=document.body.innerHTML;window.getSelection().addRange(range.cloneRange());const selection=window.getSelection().toString()
 expect(highlight.canPaintHighlights(document)).toBe(true)
 for(let i=0;i<100;i++){
  expect(highlight.paintSpeechRange(range)).toBe(true);expect(registry.get(highlight.SPEECH_HIGHLIGHT).range).toBe(range)
  highlight.clearSpeechRange(document);expect(registry.size).toBe(0)
 }
 expect(document.body.innerHTML).toBe(before);expect(window.getSelection().toString()).toBe(selection)
})
it('preserves absent API handling and propagates a constructor failure without poisoning Rust',()=>{
 for(const doc of [null,undefined,{},document]){expect(highlight.canPaintHighlights(doc)).toBe(reference.canPaintHighlights(doc));highlight.clearSpeechRange(doc)}
 expect(highlight.paintSpeechRange(null)).toBe(false)
 document.body.textContent='Words';const range=document.createRange();range.selectNodeContents(document.body)
 vi.stubGlobal('CSS',{highlights:new Map()});vi.stubGlobal('Highlight',class{constructor(){throw Error('constructor failed')}})
 expect(()=>highlight.paintSpeechRange(range)).toThrow('constructor failed')
 vi.stubGlobal('Highlight',class{constructor(range){this.range=range}})
 expect(highlight.paintSpeechRange(range)).toBe(true)
})
it('does not grow WASM memory after thousands of restyles and paints',()=>{
 document.body.textContent='Words';const range=document.createRange();range.selectNodeContents(document.body)
 vi.stubGlobal('CSS',{highlights:new Map()});vi.stubGlobal('Highlight',class{constructor(range){this.range=range}})
 for(const theme of themes)highlight.installSpeechStyle(document,theme)
 const before=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++){highlight.installSpeechStyle(document,themes[i%5]);highlight.paintSpeechRange(range);highlight.clearSpeechRange(document)}
 expect(core.memory.buffer.byteLength).toBe(before)
})
const box={top:50,bottom:550,left:0,right:390,width:390,height:500}
it('keeps every wrapped line visible when a sentence fits the viewport',()=>{
 const rects=[{top:470,bottom:495,left:16,right:260},{top:545,bottom:570,left:16,right:260}]
 const offset=speechFollowOffset(rects,box)
 expect(offset.top).toBeGreaterThan(0)
 expect(rects.every(r=>r.top-offset.top>=box.top&&r.bottom-offset.top<=box.bottom)).toBe(true)
 expect(speechFollowOffset([{top:70,bottom:100,left:16,right:260}],box)).toBeNull()
})
it('matches 3000 complete-range visibility decisions and scroll offsets exactly',()=>{
 let seed=971;const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n}
 for(let i=0;i<3000;i++){
  const top=rnd(900)-200,left=rnd(800)-200,height=rnd(150)+1,width=rnd(1200)+1
  const rects=Array.from({length:rnd(20)},(_,n)=>({top:top+n*height,bottom:top+(n+1)*height,left,right:left+width}))
  if(i%11===0)rects.push({top:NaN,bottom:20,left:2,right:4})
  expect(speechFollowOffset(rects,box)).toEqual(speechFollowOffsetLegacy(rects,box))
 }
 for(const rects of [null,undefined,[],[{}]])for(const viewport of [null,{},box,{...box,width:0}])expect(speechFollowOffset(rects,viewport)).toEqual(speechFollowOffsetLegacy(rects,viewport))
})
it('retains the first line of oversized sentences; the highlight has no fallback without Rust',()=>{
 const rects=[{top:70,bottom:1050,left:10,right:360}]
 expect(speechFollowOffset(rects,box).top).toBe(12)
 runtime.ui=null
 expect(speechFollowOffset(rects,box)).toEqual(speechFollowOffsetLegacy(rects,box))
 expect(()=>highlight.speechCSS('sepia')).toThrow('Rust UI is not loaded')
})
