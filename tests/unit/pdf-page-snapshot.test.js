import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPage, destroy } = vi.hoisted(() => ({getPage:vi.fn(),destroy:vi.fn()}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, getDocument:() => ({promise:Promise.resolve({numPages:4,getPage}),destroy}),
  TextLayer:class { render = vi.fn(async () => {}); cancel = vi.fn() }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({default:'worker.mjs'}))
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

describe('PDF usable viewport', () => {
  it('fits a wide original page to a narrow phone instead of enforcing an overflowing minimum scale', async () => {
    Object.defineProperty(container, 'clientWidth', { configurable:true, value:320 })
    getPage.mockImplementation(async number => ({ ...fakePage(number),
      getViewport:({scale}) => ({width:595 * scale, height:842 * scale}) }))
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    const canvas = container.querySelector('canvas')
    expect(parseFloat(canvas.style.width)).toBeCloseTo(320)
    expect(parseFloat(canvas.style.height)).toBeCloseTo(842 * 320 / 595)
    await reader.applyPreferences({ zoom:150 })
    expect(parseFloat(canvas.style.width)).toBeCloseTo(480)
    reader.close()
  })

  it('uses measured viewport bounds when clientWidth is unavailable', async () => {
    container.getBoundingClientRect = () => ({ ...rect, width:412 })
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    expect(parseFloat(container.querySelector('canvas').style.width)).toBeCloseTo(412)
    reader.close()
  })

  it('keeps text padding compact and symmetric without an extra toolbar-sized bottom gutter', async () => {
    const reader = new PdfReader()
    await reader.open(container, new ArrayBuffer(0))
    await reader.applyPreferences({ pdfMode:'text', margin:16 })
    const reflow = container.querySelector('.pdf-reflow-page')
    expect(reflow.style.padding).toBe('12px 16px')
    expect(reflow.hidden).toBe(false)
    expect(container.querySelector('.pdf-page-wrap').hidden).toBe(true)
    reader.close()
  })

  it('refits pixels and selection after rotation without navigating away from the restored page', async () => {
    vi.useFakeTimers()
    let width = 320, resize
    const disconnect = vi.fn()
    Object.defineProperty(container, 'clientWidth', { configurable:true, get:() => width })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback }
      observe() {}
      disconnect = disconnect
    })
    const onRelocate = vi.fn()
    const reader = new PdfReader()
    try {
      await reader.open(container, new ArrayBuffer(0), { onRelocate })
      await reader.goToPage(3)
      const navigations = onRelocate.mock.calls.length
      width = 640
      resize()
      await vi.advanceTimersByTimeAsync(80)
      expect(parseFloat(container.querySelector('canvas').style.width)).toBeCloseTo(640)
      expect(parseFloat(container.querySelector('.pdf-text-layer').style.width)).toBeCloseTo(640)
      expect(reader.currentPage).toBe(3)
      expect(onRelocate).toHaveBeenCalledTimes(navigations)
    } finally {
      reader.close()
      vi.useRealTimers()
    }
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('cancels a queued viewport refit when the book closes', async () => {
    vi.useFakeTimers()
    let width = 320, resize
    Object.defineProperty(container, 'clientWidth', { configurable:true, get:() => width })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const reader = new PdfReader()
    try {
      await reader.open(container, new ArrayBuffer(0))
      const renders = getPage.mock.calls.length
      width = 640
      resize()
      reader.close()
      await vi.advanceTimersByTimeAsync(80)
      expect(getPage).toHaveBeenCalledTimes(renders)
    } finally {
      reader.close()
      vi.useRealTimers()
    }
  })
})

describe('PDF search excerpts', () => {
  it('cuts the context at word boundaries and returns the match separately', async () => {
    const long = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore quiet room another chapter et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo'
    getPage.mockImplementation(async number => ({ ...fakePage(number), getTextContent:async () => ({items:[{str:number === 2 ? long : 'Nothing here.'}]}) }))
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const [hit, ...rest] = await reader.search('another')
    expect(rest).toEqual([])
    expect(hit).toMatchObject({label:'Página 2',locator:{kind:'pdf-page',value:2},parts:{match:'another'}})
    expect(hit.parts.pre).toMatch(/^…[A-Za-z]/)
    expect(long).toContain(`${hit.parts.pre.slice(1)}another`)
    expect(long.split(' ')).toContain(hit.parts.pre.slice(1).split(' ')[0])
    expect(long.split(' ')).toContain(hit.parts.post.replace(/…$/,'').trim().split(' ').at(-1))
    expect(hit.excerpt).toBe(`${hit.parts.pre}${hit.parts.match}${hit.parts.post}`)
    reader.close?.()
  })
})
