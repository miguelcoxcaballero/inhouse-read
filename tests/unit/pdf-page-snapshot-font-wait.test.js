import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPage, destroy } = vi.hoisted(() => ({getPage:vi.fn(),destroy:vi.fn()}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, OPS:{}, getDocument:() => ({promise:Promise.resolve({numPages:4,getPage}),destroy}),
  TextLayer:class { render = vi.fn(async () => {}); cancel = vi.fn() }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({default:'worker.mjs'}))
vi.mock('../../src/js/gestures.js', () => ({attachSwipeNavigation:() => () => {}}))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'
import { PDF_PAGE_FILTERS, READING_THEMES } from '../../src/js/readers/reading-preferences.js'

let container, contexts
const rect = {left:0,top:64,width:390,height:720,right:390,bottom:784}
function fakePage(number, renderReady = Promise.resolve()) {
  return { getViewport:({scale}) => ({width:390*scale,height:600*scale}),
    imageCoordinates:new Float32Array(), getOperatorList:async () => ({fnArray:[]}),
    getTextContent:async () => ({items:[{str:`Reading journey. Page ${number}.`,hasEOL:true}]}),
    render:() => ({promise:renderReady,cancel:vi.fn()}) }
}
beforeEach(() => {
  contexts = new Map()
  document.body.innerHTML = '<main class="reader-viewport"></main>'
  container = document.querySelector('main')
  container.getBoundingClientRect = () => rect
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function () {
    if (!contexts.has(this)) contexts.set(this,{clearRect:vi.fn(),drawImage:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),scale:vi.fn(),measureText:() => ({width:10})})
    return contexts.get(this)
  })
  vi.stubGlobal('requestAnimationFrame',callback => {callback(0);return 1})
  getPage.mockImplementation(async number => fakePage(number))
})
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML=''})

let fontsDescriptor, rangeDescriptor
const rangePrototype = Object.getPrototypeOf(document.createRange())
beforeEach(() => {
  fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
  rangeDescriptor = Object.getOwnPropertyDescriptor(rangePrototype, 'getClientRects')
  Object.defineProperty(rangePrototype, 'getClientRects', { configurable:true, value:function () {
    return [{ left:this.startOffset * 10, top:90, width:(this.endOffset-this.startOffset)*10,
      height:20, right:this.endOffset * 10, bottom:110 }]
  } })
})
afterEach(() => {
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor)
  else delete document.fonts
  if (rangeDescriptor) Object.defineProperty(rangePrototype, 'getClientRects', rangeDescriptor)
  else delete rangePrototype.getClientRects
})
function deferredFonts() {
  let resolve
  const promise = new Promise(finish => { resolve = finish })
  const read = vi.fn(() => promise)
  Object.defineProperty(document, 'fonts', { configurable:true, value:Object.defineProperty({}, 'ready', { get:read }) })
  return { promise, resolve, read }
}
async function microtasks() { for (let index=0; index<6; index++) await Promise.resolve() }
function framesQueue() {
  const frames = []
  vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
  return frames
}
async function frame(frames) {
  expect(frames).toHaveLength(1)
  frames.shift()(0)
  await microtasks()
}
async function cleanupSnapshot(reader, fonts, frames, pending) {
  fonts.resolve(); reader.close()
  await microtasks()
  for (let index=0; index<8 && frames.length; index++) { frames.shift()(0); await microtasks() }
  await pending?.catch(() => {})
}

describe('PDF snapshot font dependency', () => {
  it('copies the rendered physical page with pending unrelated fonts after exactly two frames', async () => {
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    const live = container.querySelector('canvas')
    live.getBoundingClientRect = () => ({ ...rect, height:600, bottom:664 })
    const fonts = deferredFonts(), frames = framesQueue()
    let captured = false
    const pending = reader.getPageSnapshot().then(value => { captured=true; return value })
    try {
      await microtasks(); expect(fonts.read).not.toHaveBeenCalled(); expect(captured).toBe(false)
      await frame(frames); expect(captured).toBe(false)
      await frame(frames)
      const snapshot = await pending
      expect(snapshot).toMatchObject({ engine:'pdf', sourceType:'pdf-canvas', label:'Página 1 de 4',
        displayBounds:{ left:0, top:64, width:390, height:600 },
        location:{ locator:{ kind:'pdf-page', value:1 } } })
      expect(snapshot.source).not.toBe(live)
      expect(contexts.get(snapshot.source).drawImage.mock.calls[0][0]).toBe(live)
      expect(contexts.get(snapshot.paper.source).drawImage.mock.calls[0][0]).toBe(live)
      expect(snapshot.paper).toMatchObject({ width:snapshot.width, height:snapshot.height })
      expect(fonts.read).not.toHaveBeenCalled()
    } finally { await cleanupSnapshot(reader, fonts, frames, pending) }
  })

  it('keeps PDF text snapshots behind their document fonts and then both frames', async () => {
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    await reader.applyPreferences({ pdfMode:'text' })
    const fonts = deferredFonts(), frames = framesQueue()
    let captured = false
    const pending = reader.getPageSnapshot().then(value => { captured=true; return value })
    try {
      await microtasks(); expect(fonts.read).toHaveBeenCalledOnce(); expect(frames).toHaveLength(0); expect(captured).toBe(false)
      fonts.resolve(); await microtasks(); await frame(frames); expect(captured).toBe(false)
      await frame(frames)
      expect(await pending).toMatchObject({ sourceType:'pdf-text', text:'Reading journey. Page 1.' })
    } finally { await cleanupSnapshot(reader, fonts, frames, pending) }
  })

  it('rechecks physical-to-text changes and waits for fonts before capturing the new text mode', async () => {
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    const fonts = deferredFonts(), frames = framesQueue()
    let captured = false
    const pending = reader.getPageSnapshot().then(value => { captured=true; return value })
    try {
      await microtasks(); expect(frames).toHaveLength(1)
      await reader.applyPreferences({ pdfMode:'text' })
      await frame(frames); await frame(frames)
      expect(captured).toBe(false); expect(fonts.read).toHaveBeenCalledOnce(); expect(frames).toHaveLength(0)
      fonts.resolve(); await microtasks(); await frame(frames); await frame(frames)
      expect(await pending).toMatchObject({ sourceType:'pdf-text', text:'Reading journey. Page 1.' })
    } finally { await cleanupSnapshot(reader, fonts, frames, pending) }
  })

  it('still awaits a replacement PDF render started during the physical settle frames', async () => {
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    let finishRender
    const rendering = new Promise(resolve => { finishRender=resolve })
    getPage.mockImplementation(async number => fakePage(number, number===4 ? rendering : Promise.resolve()))
    const fonts = deferredFonts(), frames = framesQueue()
    let captured = false
    const pending = reader.getPageSnapshot().then(value => { captured=true; return value })
    let restoring
    try {
      await microtasks(); expect(frames).toHaveLength(1)
      restoring = reader.goToPage(4)
      await microtasks(); await frame(frames); await frame(frames)
      expect(captured).toBe(false); expect(frames).toHaveLength(0); expect(fonts.read).not.toHaveBeenCalled()
      finishRender(); await restoring; await microtasks(); await frame(frames); await frame(frames)
      expect(await pending).toMatchObject({ sourceType:'pdf-canvas', text:'Reading journey. Page 4.\n',
        location:{ locator:{ kind:'pdf-page', value:4 } } })
      expect(fonts.read).not.toHaveBeenCalled()
    } finally { finishRender(); await restoring; await cleanupSnapshot(reader, fonts, frames, pending) }
  })

  it('returns null when the physical reader closes during its settle frames', async () => {
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    const fonts = deferredFonts(), frames = framesQueue()
    const pending = reader.getPageSnapshot()
    try {
      await microtasks(); await frame(frames); reader.close(); await frame(frames)
      expect(await pending).toBeNull(); expect(fonts.read).not.toHaveBeenCalled()
    } finally { await cleanupSnapshot(reader, fonts, frames, pending) }
  })
})
