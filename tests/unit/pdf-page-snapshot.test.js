import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPage, destroy } = vi.hoisted(() => ({getPage:vi.fn(),destroy:vi.fn()}))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions:{}, getDocument:() => ({promise:Promise.resolve({numPages:4,getPage}),destroy}),
  TextLayer:class { render = vi.fn(async () => {}); cancel = vi.fn() }
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({default:'worker.mjs'}))
vi.mock('../../src/js/gestures.js', () => ({attachSwipeNavigation:() => () => {}}))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'

let container, contexts
const rect = {left:0,top:64,width:390,height:720,right:390,bottom:784}
function fakePage(number, renderReady = Promise.resolve()) {
  return { getViewport:({scale}) => ({width:390*scale,height:600*scale}),
    getTextContent:async () => ({items:[{str:`Reading journey. Page ${number}.`,hasEOL:true}]}),
    render:() => ({promise:renderReady,cancel:vi.fn()}) }
}
beforeEach(() => {
  contexts = new Map()
  document.body.innerHTML = '<main class="reader-viewport"></main>'
  container = document.querySelector('main')
  container.getBoundingClientRect = () => rect
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function () {
    if (!contexts.has(this)) contexts.set(this,{drawImage:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),scale:vi.fn(),measureText:() => ({width:10})})
    return contexts.get(this)
  })
  vi.stubGlobal('requestAnimationFrame',callback => {callback(0);return 1})
  getPage.mockImplementation(async number => fakePage(number))
})
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML=''})

describe('PDF restored-page preview', () => {
  it('uses saved page 3 pixels, text, exact locator and applied visual filter', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    await reader.goToPage(3)
    const live = container.querySelector('canvas')
    live.style.filter = 'invert(0.89) hue-rotate(180deg)'
    live.getBoundingClientRect = () => ({...rect,height:600,bottom:664})
    const snapshot = await reader.getPageSnapshot()
    expect(snapshot).toMatchObject({engine:'pdf',sourceType:'pdf-canvas',label:'Página 3 de 4',
      text:'Reading journey. Page 3.\n',location:{fraction:2/3,locator:{kind:'pdf-page',value:3}}})
    expect(snapshot.source).not.toBe(live)
    expect(contexts.get(snapshot.source).drawImage.mock.calls[0][0]).toBe(live)
    expect(contexts.get(snapshot.source).filter).toContain('invert(0.89)')
    reader.close()
    expect(await reader.getPageSnapshot()).toBeNull()
  })

  it('awaits an in-flight restored page instead of taking pixels left from page 1', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    let finishRender
    getPage.mockImplementation(async number => fakePage(number,number===4 ? new Promise(resolve => {finishRender=resolve}) : Promise.resolve()))
    const restoring = reader.goToPage(4)
    await Promise.resolve()
    let captured = false
    const pending = reader.getPageSnapshot().then(value => {captured=true;return value})
    await Promise.resolve(); expect(captured).toBe(false)
    finishRender(); await restoring
    expect(await pending).toMatchObject({text:'Reading journey. Page 4.\n',location:{locator:{kind:'pdf-page',value:4}}})
    reader.close()
  })
})
