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

describe('PDF restored-page preview', () => {
  it('changes themes using the same decoded PDF and text layer, without a fresh PDF render', async () => {
    const rendered = vi.fn(() => ({promise:Promise.resolve(),cancel:vi.fn()}))
    getPage.mockImplementation(async number => ({...fakePage(number),render:rendered}))
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const live = container.querySelector('canvas'), layer = container.querySelector('.pdf-text-layer')
    await reader.applyPreferences({theme:'night'})
    await reader.applyPreferences({theme:'sepia'})
    await reader.applyPreferences({theme:'paper'})
    expect(rendered).toHaveBeenCalledOnce()
    expect(container.querySelector('canvas')).toBe(live)
    expect(container.querySelector('.pdf-text-layer')).toBe(layer)
    expect(container.getAttribute('aria-busy')).toBe('false')
    reader.close()
  })

  it('releases the separate original bitmap when a themed document closes', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    await reader.applyPreferences({theme:'amoled'})
    const snapshot = await reader.getPageSnapshot()
    const original = contexts.get(snapshot.paper.source).drawImage.mock.calls[0][0]
    expect(original.width).toBeGreaterThan(0)
    reader.close()
    expect(original.width).toBe(0); expect(original.height).toBe(0)
    expect(container.hasAttribute('aria-busy')).toBe(false)
  })

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

  it.each(Object.keys(READING_THEMES))('keeps the original PDF pixels unfiltered for white paper under %s', async theme => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    await reader.applyPreferences({theme})
    const live = container.querySelector('canvas')
    container.style.filter = 'brightness(0.65)'
    live.getBoundingClientRect = () => ({...rect,height:600,bottom:664})
    const snapshot = await reader.getPageSnapshot()
    expect(contexts.get(snapshot.source).filter).toContain('brightness(0.65)')
    expect(snapshot.paper.source).not.toBe(snapshot.source)
    expect(contexts.get(snapshot.paper.source).filter).toBe('none')
    const original = contexts.get(snapshot.paper.source).drawImage.mock.calls[0][0]
    expect(original === live).toBe(theme === 'paper')
    if (theme !== 'paper') expect(contexts.get(live).drawImage.mock.calls[0][0]).toBe(original)
    expect(snapshot.paper).toMatchObject({width:snapshot.width,height:snapshot.height})
    reader.close()
  })

  it('captures reflowed sepia PDF text on white paper without moving its glyphs or dimming its ink', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    await reader.applyPreferences({theme:'sepia',pdfMode:'text'})
    container.style.filter = 'brightness(0.65)'
    const reflow = container.querySelector('.pdf-reflow-page')
    reflow.textContent = 'Saved PDF text'
    reflow.style.color = '#483825'
    const rangePrototype = Object.getPrototypeOf(document.createRange())
    rangePrototype.getClientRects = function () {
      return [{left:this.startOffset * 10,top:90,width:(this.endOffset-this.startOffset)*10,height:20,
        right:this.endOffset * 10,bottom:110}]
    }
    try {
      const snapshot = await reader.getPageSnapshot()
      expect(snapshot.text).toBe('Saved PDF text')
      const themed = contexts.get(snapshot.source), paper = contexts.get(snapshot.paper.source)
      expect(themed.filter).toBe('brightness(0.65)')
      expect(paper.filter).toBe('none')
      expect(paper.fillStyle).toBe('#292821')
      expect(paper.fillText.mock.calls).toEqual(themed.fillText.mock.calls)
    } finally {
      delete rangePrototype.getClientRects
      reader.close()
    }
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

describe('PDF snapshot tone identities', () => {
  it('keeps fresh pixel copies and bounds while identifying an unchanged settled raster', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const first = await reader.getPageSnapshot(), next = await reader.getPageSnapshot()
    expect(next.source).not.toBe(first.source)
    expect(next.paper.source).not.toBe(first.paper.source)
    expect(next.toneKey).toBe(first.toneKey)
    expect(next.paper.toneKey).toBe(first.paper.toneKey)
    expect(next.toneKey).not.toBe(next.paper.toneKey)
    expect(Object.isFrozen(next.toneKey)).toBe(true)
    expect(Object.keys(next.toneKey)).toEqual([])
    reader.close()
  })

  it('invalidates both tone identities when the effective brightness filter changes', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const first = await reader.getPageSnapshot()
    container.style.filter = 'brightness(0.6)'
    const next = await reader.getPageSnapshot()
    expect(next.toneKey).not.toBe(first.toneKey)
    expect(next.paper.toneKey).not.toBe(first.paper.toneKey)
    expect(contexts.get(next.source).filter).toContain('brightness(0.6)')
    reader.close()
  })

  it('invalidates after a theme repaint even when PDF page rendering is reused', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const first = await reader.getPageSnapshot()
    await reader.applyPreferences({theme:'sepia'})
    const next = await reader.getPageSnapshot()
    expect(next.toneKey).not.toBe(first.toneKey)
    expect(next.paper.toneKey).not.toBe(first.paper.toneKey)
    reader.close()
  })

  it('never reuses a tone identity across navigation, including a return to the same page', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const first = await reader.getPageSnapshot()
    await reader.goToPage(2)
    const second = await reader.getPageSnapshot()
    await reader.goToPage(1)
    const returned = await reader.getPageSnapshot()
    expect(second.toneKey).not.toBe(first.toneKey)
    expect(returned.toneKey).not.toBe(first.toneKey)
    expect(returned.toneKey).not.toBe(second.toneKey)
    reader.close()
  })

  it('invalidates when zoom changes the raster', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const first = await reader.getPageSnapshot()
    await reader.applyPreferences({zoom:150})
    expect((await reader.getPageSnapshot()).toneKey).not.toBe(first.toneKey)
    reader.close()
  })

  it('invalidates if the underlying canvas dimensions change without a new render promise', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const first = await reader.getPageSnapshot()
    container.querySelector('canvas').width += 1
    expect((await reader.getPageSnapshot()).toneKey).not.toBe(first.toneKey)
    reader.close()
  })

  it('releases its tone identities when closing and reopening the reader', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const first = await reader.getPageSnapshot()
    reader.close()
    await reader.open(container,new ArrayBuffer(0))
    expect((await reader.getPageSnapshot()).toneKey).not.toBe(first.toneKey)
    reader.close()
  })

  it('keeps adaptable DOM snapshots on the existing per-source colour sampling path', async () => {
    const reader = new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    await reader.applyPreferences({pdfMode:'text'})
    const rangePrototype = Object.getPrototypeOf(document.createRange())
    rangePrototype.getClientRects = function () {
      return [{left:this.startOffset * 10,top:90,width:(this.endOffset-this.startOffset)*10,height:20,
        right:this.endOffset * 10,bottom:110}]
    }
    try {
      const snapshot = await reader.getPageSnapshot()
      expect(snapshot.sourceType).toBe('pdf-text')
      expect(snapshot.toneKey).toBeUndefined()
      expect(snapshot.paper.toneKey).toBeUndefined()
    } finally {
      delete rangePrototype.getClientRects
      reader.close()
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


describe('PDF worker sampling lifecycle', () => {
  function workers() {
    const jobs = []
    vi.stubGlobal('OffscreenCanvas',function () {})
    vi.stubGlobal('createImageBitmap',vi.fn(async () => ({close:vi.fn()})))
    vi.stubGlobal('Worker',class {
      constructor() { this.terminate=vi.fn(); jobs.push(this) }
      postMessage() {}
    })
    return jobs
  }
  const reply = job => job.onmessage({data:{tones:[[255,255,255],[255,255,255]]}})
  it('cancels pending sampling when the document closes and does not return a stale page', async () => {
    const jobs=workers(), reader=new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const capture=reader.getPageSnapshot()
    await vi.waitFor(() => expect(jobs).toHaveLength(1))
    reader.close()
    expect(await capture).toBeNull()
    expect(jobs[0].terminate).toHaveBeenCalledOnce()
  })
  it('replaces a page that navigated during asynchronous sampling with the current saved page', async () => {
    const jobs=workers(), reader=new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const capture=reader.getPageSnapshot()
    await vi.waitFor(() => expect(jobs).toHaveLength(1))
    await reader.goToPage(3)
    reply(jobs[0])
    await vi.waitFor(() => expect(jobs).toHaveLength(2))
    reply(jobs[1])
    expect(await capture).toMatchObject({label:'Página 3 de 4',location:{locator:{kind:'pdf-page',value:3}}})
    reader.close()
  })
  it('replaces the pixel copy and tone token if brightness changes while the worker runs', async () => {
    const jobs=workers(), reader=new PdfReader()
    await reader.open(container,new ArrayBuffer(0))
    const capture=reader.getPageSnapshot()
    await vi.waitFor(() => expect(jobs).toHaveLength(1))
    container.style.filter='brightness(0.65)'
    reply(jobs[0])
    await vi.waitFor(() => expect(jobs).toHaveLength(2))
    reply(jobs[1])
    const snapshot=await capture
    expect(contexts.get(snapshot.source).filter).toContain('brightness(0.65)')
    reader.close()
  })
})
