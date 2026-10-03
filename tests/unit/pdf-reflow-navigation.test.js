import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({pages:2,reads:[],resize:null}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>({
 GlobalWorkerOptions:{},OPS:{},getDocument:()=>({promise:Promise.resolve({numPages:state.pages,getPage:async n=>({
  getTextContent:async()=>{state.reads.push(n);return {items:[{str:`Page ${n}. `+'Complete sentence. '.repeat(220),hasEOL:true}]}},
  getViewport:({scale})=>({width:600*scale,height:800*scale}),getOperatorList:async()=>({fnArray:[]}),
  render:()=>({promise:Promise.resolve(),cancel:vi.fn()}),imageCoordinates:new Float32Array()
 })}),destroy:vi.fn()}),TextLayer:class {constructor({container,textContentSource}){this.container=container;this.content=textContentSource}async render(){this.container.textContent=this.content.items.map(i=>i.str).join('')}cancel(){}}
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',()=>({default:'worker.mjs'}))
vi.mock('../../src/js/readers/page-snapshot.js',()=>({
 renderedPageFilter:()=> 'none',settlePageLayout:async()=>{},
 snapshotDOMPage:async()=>({text:'Mock snapshot.',source:document.createElement('canvas')}),
 snapshotCanvas:()=>({source:document.createElement('canvas')})
}))
vi.mock('../../src/js/gestures.js',()=>({attachSwipeNavigation:()=>()=>{}}))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'
let reader,container,height,overflow,relocate
beforeEach(()=>{
 document.body.innerHTML='<main></main>';container=document.querySelector('main');height=500;overflow=1700;state.pages=2;state.reads=[]
 Object.defineProperties(container,{clientWidth:{value:390,configurable:true},clientHeight:{get:()=>height,configurable:true},scrollHeight:{get:()=>overflow,configurable:true}})
 container.getBoundingClientRect=()=>({top:50,left:0,right:390,bottom:height+50,height,width:390})
 container.scrollTo=vi.fn(({top,left})=>{if(top!=null)container.scrollTop=Math.max(0,Math.min(overflow-height,top));if(left!=null)container.scrollLeft=left})
 container.scrollBy=vi.fn(({top=0,left=0})=>container.scrollTo({top:container.scrollTop+top,left:container.scrollLeft+left}))
 vi.stubGlobal('ResizeObserver',class {constructor(callback){state.resize=callback}observe(){}disconnect(){}})
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){return{canvas:this,drawImage:vi.fn()}})
 vi.stubGlobal('matchMedia',()=>({matches:true}))
 Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:function(){
  const p=this.startContainer.parentElement, font=parseFloat(p?.style.fontSize)||20,leading=parseFloat(p?.style.lineHeight)||1.6
  const top=50+12+Math.floor(this.startOffset/20)*font*leading-container.scrollTop
  return[{top,bottom:top+font,left:16,right:260,width:244,height:font}]
 }})
 relocate=vi.fn()
})
afterEach(()=>{reader?.close();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';delete Range.prototype.getClientRects})
async function open(preferences={pdfMode:'text'},options={}){reader=new PdfReader();await reader.open(container,new ArrayBuffer(0),{preferences,onRelocate:relocate,...options})}
describe('complete navigation through long adaptable PDF pages',()=>{
 it('advances one visible screen with line overlap before changing the physical PDF page',async()=>{
  await open();await reader.next();expect(reader.currentPage).toBe(1);expect(container.scrollTop).toBe(468);expect(state.reads).toEqual([1])
 })
 it('reaches the last screen and only then advances to the following physical page',async()=>{
  await open();await reader.next();await reader.next();expect(reader.currentPage).toBe(1);await reader.next();expect(container.scrollTop).toBe(1200);expect(reader.currentPage).toBe(1)
  await reader.next();expect(reader.currentPage).toBe(2);expect(container.scrollTop).toBe(0);expect(state.reads).toEqual([1,2])
 })
 it('goes back to the previous screen, then to the last screen of the preceding PDF page',async()=>{
  await open();await reader.goToPage(2);container.scrollTop=300;await reader.prev();expect(reader.currentPage).toBe(2);expect(container.scrollTop).toBe(0)
  await reader.prev();expect(reader.currentPage).toBe(1);expect(container.scrollTop).toBe(1200)
 })
 it('can traverse the last physical page instead of treating its first screen as the end',async()=>{
  state.pages=1;await open();await reader.next();expect(reader.currentPage).toBe(1);expect(container.scrollTop).toBe(468)
  container.scrollTop=1200;await reader.next();expect(container.scrollTop).toBe(1200);expect(state.reads).toEqual([1])
 })
 it('does not repurpose explicit page navigation or original-page navigation',async()=>{
  await open({pdfMode:'original'});await reader.next();expect(reader.currentPage).toBe(2);expect(container.scrollTop).toBe(0)
  await reader.applyPreferences({pdfMode:'text'});await reader.goToPage(1);expect(reader.currentPage).toBe(1);expect(container.scrollTop).toBe(0)
 })
 it('lets narration request the next whole source without rereading visible screens',async()=>{
  await open();await reader.next({source:true,isActive:()=>true});expect(reader.currentPage).toBe(2);expect(container.scrollTop).toBe(0)
 })
 it('ignores a cancelled narration request before scrolling or navigating',async()=>{
  await open();await reader.next({source:true,isActive:()=>false});expect(reader.currentPage).toBe(1);expect(container.scrollTop).toBe(0)
 })
 it('derives the next screen from the current viewport and text size',async()=>{
  await open({pdfMode:'text',fontSize:36,lineHeight:2});height=300;await reader.next();expect(reader.currentPage).toBe(1);expect(container.scrollTop).toBe(228)
 })
 it('keeps deferred audiobook activation independent of screen navigation',async()=>{
  await open();const source=await reader.getNextSpeechSource();expect(source.text).toContain('Page 2.');expect(reader.currentPage).toBe(1)
  expect(source.activate()).toBe(true);expect(reader.currentPage).toBe(2);expect(container.scrollTop).toBe(0)
 })
 it('saves an adaptable character offset and restores it after changing text size',async()=>{
  await open();container.scrollTop=300;container.dispatchEvent(new Event('scroll'));await new Promise(r=>setTimeout(r,180))
  const saved=relocate.mock.calls.at(-1)[0];expect(saved.textOffset).toBeGreaterThan(0)
  await reader.applyPreferences({pdfMode:'text',fontSize:30});const restored=relocate.mock.calls.at(-1)[0];expect(restored.textOffset).toBe(saved.textOffset);expect(container.scrollTop).toBeGreaterThan(300)
 })
 it('restores a saved initial text offset and an explicit offset locator',async()=>{
  await open({pdfMode:'text'},{initialLocator:{kind:'pdf-page',value:1,textOffset:200}});expect(container.scrollTop).toBe(332)
  await reader.goToPage(2,{textOffset:400});expect(container.scrollTop).toBe(652)
 })
 it('preserves the latest adaptable offset in its snapshot before the scroll debounce fires',async()=>{
  await open();container.scrollTop=300;container.dispatchEvent(new Event('scroll'));
  const snapshot=await reader.getPageSnapshot();
  expect(snapshot.location.locator).toMatchObject({kind:'pdf-page',value:1,textOffset:180});
  expect(relocate.mock.calls.at(-1)[0].textOffset).toBe(180)
 })
 it('keeps an already visible spoken fragment steady and reveals an offscreen one',async()=>{
  await open();const source=await reader.getSpeechSource();source.follow(0,10);expect(container.scrollBy).not.toHaveBeenCalled()
  source.follow(1000,1010);expect(container.scrollBy).toHaveBeenCalled();expect(container.scrollTop).toBeGreaterThan(0)
 })
})
