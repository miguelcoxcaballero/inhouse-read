import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ documents:[], layers:[] }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, OPS:{},
  getDocument:() => state.documents.shift(),
  TextLayer:class {
    constructor({ container, textContentSource }) { this.container = container; this.content = textContentSource; state.layers.push(this) }
    async render() {
      for (const item of this.content.items) {
        const span = document.createElement('span'); span.textContent = item.str; this.container.append(span)
      }
    }
    cancel = vi.fn()
  }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default:'worker.mjs' }))
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let reader, container, width, height, pages, renders, relocate
function page(number) {
  const value = {
    getViewport:({ scale }) => ({ width:600 * scale, height:900 * scale }),
    imageCoordinates:new Float32Array(), getOperatorList:async () => ({ fnArray:[] }),
    getTextContent:vi.fn(async () => ({ items:[{ str:`Page ${number}.`, hasEOL:true }] })),
    render:vi.fn(({ canvasContext }) => {
      const task = { promise:Promise.resolve(), cancel:vi.fn() }
      renders.push({ number, canvas:canvasContext.canvas, task }); return task
    })
  }
  pages.set(number, value); return value
}
function documentTask(promise) {
  const pdf = { numPages:4, getPage:vi.fn(async number => pages.get(number) || page(number)) }
  const task = { promise:promise || Promise.resolve(pdf), destroy:vi.fn() }
  state.documents.push(task); return { pdf, task }
}
async function open(options = {}) {
  documentTask(); reader = new PdfReader()
  await reader.open(container, new ArrayBuffer(0), { onRelocate:relocate, ...options })
}
beforeEach(() => {
  document.body.innerHTML = '<main></main>'; container = document.querySelector('main')
  width = 390; height = 748; pages = new Map(); renders = []; state.layers.length = 0; state.documents.length = 0
  Object.defineProperties(container, {
    clientWidth:{ configurable:true, get:() => width }, clientHeight:{ configurable:true, get:() => height }
  })
  container.getBoundingClientRect = () => ({ left:0, top:48, width, height, right:width, bottom:height + 48 })
  container.scrollTo = vi.fn(); relocate = vi.fn()
  vi.stubGlobal('devicePixelRatio', 2)
  vi.stubGlobal('requestAnimationFrame', callback => { callback(0); return 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    return { canvas:this, clearRect:vi.fn(), drawImage:vi.fn(), scale:vi.fn(),
      fillRect:vi.fn(), fillText:vi.fn(), measureText:() => ({ width:10 }) }
  })
})
afterEach(() => { reader?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })


const turns = async () => { for(let index=0;index<100;index++) await Promise.resolve() }
function stoppedFrames() {
 const frames=[]
 vi.stubGlobal('requestAnimationFrame',callback=>{frames.push(callback);return frames.length})
 return frames
}
async function release(reader,pending,frames) {
 reader.close();await turns()
 for(let index=0;index<12&&frames.length;index++){frames.shift()(0);await turns()}
 await pending?.catch(()=>{})
}
describe('settled physical PDF snapshot',()=>{
 it('copies an intact completed page without waiting for another frame',async()=>{
  await open({initialPage:3})
  const live=container.querySelector('canvas'),frames=stoppedFrames()
  let snapshot
  const pending=reader.getPageSnapshot({reuseSettledLayout:true}).then(value=>{snapshot=value;return value})
  try{
   await turns();expect(snapshot).toMatchObject({text:'Page 3.\n',sourceType:'pdf-canvas',location:{locator:{kind:'pdf-page',value:3}}})
   expect(snapshot.source).not.toBe(live);expect(snapshot.paper.source).not.toBe(live)
   expect([snapshot.width,snapshot.height]).toEqual([live.width,live.height]);expect(frames).toHaveLength(0)
   expect(renders).toHaveLength(1)
  }finally{await release(reader,pending,frames)}
 })
 it('settles a physical resize before copying its new pixels and keeps the same page',async()=>{
  await open({initialPage:3})
  width=510;const frames=stoppedFrames();let snapshot
  const pending=reader.getPageSnapshot({reuseSettledLayout:true}).then(value=>{snapshot=value;return value})
  try{
   await turns();expect(snapshot).toMatchObject({text:'Page 3.\n',width:1020,location:{locator:{kind:'pdf-page',value:3}}})
   expect(renders.map(r=>r.number)).toEqual([3,3]);expect(frames).toHaveLength(0)
   expect(container.querySelector('canvas').width).toBe(1020)
  }finally{await release(reader,pending,frames)}
 })
 it('waits for a pending render without depending on animation frames',async()=>{
  await open();const done=deferred();page(4).render.mockImplementation(()=>({promise:done.promise,cancel:vi.fn()}))
  const navigation=reader.goToPage(4);const frames=stoppedFrames();let snapshot
  const pending=reader.getPageSnapshot({reuseSettledLayout:true}).then(value=>{snapshot=value;return value})
  try{
   await turns();expect(snapshot).toBeUndefined();expect(frames).toHaveLength(0)
   done.resolve();await navigation;await turns()
   expect(snapshot).toMatchObject({text:'Page 4.\n',location:{locator:{kind:'pdf-page',value:4}}});expect(frames).toHaveLength(0)
  }finally{done.resolve();await navigation;await release(reader,pending,frames)}
 })
 it('keeps DOM text behind both layout frames',async()=>{
  const prototype=Object.getPrototypeOf(document.createRange()), descriptor=Object.getOwnPropertyDescriptor(prototype,'getClientRects')
  Object.defineProperty(prototype,'getClientRects',{configurable:true,value:()=>[]})
  await open({preferences:{pdfMode:'text'}});const frames=stoppedFrames();let snapshot
  const pending=reader.getPageSnapshot({reuseSettledLayout:true}).then(value=>{snapshot=value;return value})
  try{
   await turns();expect(snapshot).toBeUndefined();expect(frames).toHaveLength(1)
   frames.shift()(0);await turns();expect(snapshot).toBeUndefined();expect(frames).toHaveLength(1)
   frames.shift()(0);await pending;expect(snapshot.sourceType).toBe('pdf-text')
  }finally{
   await release(reader,pending,frames)
   if(descriptor)Object.defineProperty(prototype,'getClientRects',descriptor);else delete prototype.getClientRects
  }
 })
})
