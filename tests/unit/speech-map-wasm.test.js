import {beforeAll,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import * as maps from '../../src/js/readers/speech-map.js'
import * as reference from './helpers/reference-speech-map.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});runtime.ui=ui})
afterEach(()=>{document.body.innerHTML='';runtime.ui=ui})
const names=['mapSpeechText','mapTextLayer','mapTextNode','mapTextNodes']
const outcome=fn=>{try{return fn()}catch(error){return ['error',error.name]}}
function compare(root,mode){
 const expected=reference[names[mode]](root),actual=maps[names[mode]](root)
 assert.equal(actual.text,expected.text);assert.deepEqual(actual.spans,expected.spans)
 const range=(map,start,end)=>outcome(()=>{const r=map.rangeFor(start,end);return r?[r.startContainer,r.startOffset,r.endContainer,r.endOffset,r.toString()]:null})
 for(let start=-1;start<expected.text.length+2;start++)for(const end of [start,start+1,start+2,expected.text.length,Infinity]){
  assert.deepEqual(range(actual,start,end),range(expected,start,end),JSON.stringify({mode,text:actual.text,start,end}))
 }
 const nodes=root?[root,...(root.querySelectorAll?.('*')||[]),...expected.spans.map(s=>s.node)]:[]
 for(const node of nodes)for(const offset of [-1,0,0.5,1,node.nodeType===3?node.nodeValue.length:node.childNodes.length,Infinity]){
  assert.deepEqual(outcome(()=>actual.offsetOf(node,offset)),outcome(()=>expected.offsetOf(node,offset)))
 }
}
it('matches all ranges and DOM boundaries of 100 seeded multilingual chapters',()=>{
 let seed=1928;const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n}
 for(let i=0;i<100;i++){
  const tags=['p','div','h2','li','em','span','figcaption'],words=['a','Hola','😀','世界','é',' ','.','\ud800']
  document.body.innerHTML=Array.from({length:1+rnd(8)},()=>{const tag=tags[rnd(tags.length)];return `<${tag}>${words[rnd(words.length)]}<span>${words[rnd(words.length)]}</span>${rnd(3)?'':'<br>'}${words[rnd(words.length)]}</${tag}>`}).join('')
  const before=document.body.innerHTML
  for(const mode of [0,1,3])compare(document.body,mode)
  expect(document.body.innerHTML).toBe(before)
 }
},15000)
it('preserves empty, single-node, parsed and complete-document maps',()=>{
 compare(null,2);compare(null,3);compare(document.createTextNode('Hello 😀\ud800!'),2)
 const doc=new DOMParser().parseFromString('<title>Ignored</title><h1>Title</h1><p>First <b>bold</b>.</p><aside hidden>Hidden.</aside>','text/html')
 compare(doc,0);for(const mode of [0,1,3])compare(doc.body,mode)
 const xml=new DOMParser().parseFromString('<chapter><para>Text</para><paragraph>More</paragraph></chapter>','application/xml')
 compare(xml.documentElement,0)
 for(const mode of [0,1])expect(()=>maps[names[mode]](null)).toThrow()
})
it('retains ordinary node references without allocating persistent Rust handles',()=>{
 document.body.innerHTML='<p>Hello <em>reader</em>!</p><p>Another sentence.</p>'
 for(let i=0;i<20;i++)maps.mapSpeechText(document.body)
 const before=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++){
  const map=maps.mapSpeechText(document.body)
  expect(map.spans[0].node).toBe(document.querySelector('p').firstChild)
  expect(map.rangeFor(0,5).toString()).toBe('Hello')
 }
 expect(core.memory.buffer.byteLength).toBe(before)
},15000)
it('keeps the original mapping available when Rust is unavailable',()=>{
 runtime.ui=null;document.body.innerHTML='<h2>Heading</h2><p>Hello <em>world</em>.</p>'
 for(const mode of [0,1,3])compare(document.body,mode)
})
