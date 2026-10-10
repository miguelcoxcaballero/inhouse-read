import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const {getPage}=vi.hoisted(()=>({getPage:vi.fn()}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>({
 GlobalWorkerOptions:{}, OPS:{},getDocument:()=>({promise:Promise.resolve({numPages:3,getPage}),destroy:vi.fn()}),
 TextLayer:class {render=vi.fn(async()=>{});cancel=vi.fn()}
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',()=>({default:'worker.mjs'}))
vi.mock('../../src/js/gestures.js',()=>({attachSwipeNavigation:()=>()=>{}}))
import {PdfReader} from '../../src/js/readers/pdf-reader.js'
import {pageRaster} from '../../src/js/page-raster.js'
let container,contexts
beforeEach(()=>{
 contexts=new Map();document.body.innerHTML='<main class="reader-viewport"></main>';container=document.querySelector('main')
 container.getBoundingClientRect=()=>({left:0,top:64,width:390,height:720,right:390,bottom:784})
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){
  if(!contexts.has(this))contexts.set(this,{clearRect:vi.fn(),drawImage:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),scale:vi.fn(),measureText:()=>({width:10})})
  return contexts.get(this)
 })
 vi.stubGlobal('requestAnimationFrame',callback=>{callback(0);return 1})
 getPage.mockImplementation(async number=>({
  getViewport:({scale})=>({width:390*scale,height:600*scale}),imageCoordinates:new Float32Array(),getOperatorList:async()=>({fnArray:[]}),
  getTextContent:async()=>({items:[{str:`Restored page ${number}.`,hasEOL:true}]}),render:()=>({promise:Promise.resolve(),cancel:vi.fn()})
 }))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML=''})
describe('reader proof for shared white-paper pixels',()=>{
 it('shares texture revisions only for actual equal source, filter and resampling',async()=>{
  const reader=new PdfReader();await reader.open(container,new ArrayBuffer(0));const page=await reader.getPageSnapshot()
  const themed=contexts.get(page.source),paper=contexts.get(page.paper.source)
  expect(themed.drawImage.mock.calls[0]).toEqual(paper.drawImage.mock.calls[0]);expect(themed.filter).toBe('none');expect(paper.filter).toBe('none')
  expect(page.source).not.toBe(page.paper.source);expect(page.toneKey).not.toBe(page.paper.toneKey)
  expect(pageRaster(page.source)).toBe(pageRaster(page.paper.source));reader.close()
 })
 it.each(['sepia','night','amoled','sage'])('keeps %s and original paper as separate physical rasters',async theme=>{
  const reader=new PdfReader();await reader.open(container,new ArrayBuffer(0));await reader.applyPreferences({theme});const page=await reader.getPageSnapshot()
  expect(pageRaster(page.source)).not.toBe(pageRaster(page.paper.source));expect(page.toneKey).not.toBe(page.paper.toneKey);reader.close()
 })
 it('does not share the original paper with a brightness-filtered copy',async()=>{
  const reader=new PdfReader();await reader.open(container,new ArrayBuffer(0));container.style.filter='brightness(0.6)';const page=await reader.getPageSnapshot()
  expect(contexts.get(page.source).filter).toContain('brightness(0.6)');expect(pageRaster(page.source)).not.toBe(pageRaster(page.paper.source));reader.close()
 })
 it('never shares a page revision with later navigation or a return to that page',async()=>{
  const reader=new PdfReader();await reader.open(container,new ArrayBuffer(0));const first=await reader.getPageSnapshot();await reader.goToPage(2)
  const next=await reader.getPageSnapshot();await reader.goToPage(1);const returned=await reader.getPageSnapshot()
  expect(pageRaster(next.source)).not.toBe(pageRaster(first.source));expect(pageRaster(returned.source)).not.toBe(pageRaster(first.source))
  expect(pageRaster(returned.source)).toBe(pageRaster(returned.paper.source));reader.close()
 })
})
