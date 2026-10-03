import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { pdf, loading, layers } = vi.hoisted(() => ({
  pdf:{numPages:4,getPage:vi.fn()}, loading:{destroy:vi.fn()}, layers:[]
}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, getDocument:() => ({promise:Promise.resolve(pdf),destroy:loading.destroy}),
  TextLayer:class {
    constructor({textContentSource,container,viewport}) { Object.assign(this,{content:textContentSource,container,viewport}); layers.push(this) }
    async render() {
      for (const item of this.content.items) {
        if (typeof item.str !== 'string') continue
        const span = document.createElement('span'); span.textContent = item.str
        this.container.append(span)
        if (item.hasEOL) this.container.append(document.createElement('br'))
      }
    }
    cancel = vi.fn()
  }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({default:'worker.mjs'}))
vi.mock('../../src/js/gestures.js', () => ({attachSwipeNavigation:() => () => {}}))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'

let reader, container, relocate, width, height, resize, pages, renders
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes,no) => { resolve = yes; reject = no })
  return {promise,resolve,reject}
}
const rect = () => ({left:0,top:48,width,height,right:width,bottom:height+48})
function page(number, items = [{str:`Page ${number}.`,hasEOL:true}]) {
  const value = {
    getViewport:({scale}) => ({width:600*scale,height:900*scale}),
    getTextContent:vi.fn(async () => ({items})),
    render:vi.fn(({canvasContext,viewport}) => {
      const task = {promise:Promise.resolve(),cancel:vi.fn()}
      renders.push({number,canvas:canvasContext.canvas,viewport,task})
      return task
    })
  }
  pages.set(number,value)
  return value
}
async function open(preferences) {
  reader = new PdfReader()
  await reader.open(container,new ArrayBuffer(0),{onRelocate:relocate})
  if (preferences) await reader.applyPreferences(preferences)
  relocate.mockClear()
  return reader
}
beforeEach(() => {
  document.body.innerHTML = '<main></main>'
  container = document.querySelector('main')
  width = 390; height = 748; pages = new Map(); renders = []; layers.length = 0
  container.getBoundingClientRect = rect
  Object.defineProperties(container,{
    clientWidth:{configurable:true,get:() => width},clientHeight:{configurable:true,get:() => height}
  })
  container.scrollBy = vi.fn(); container.scrollTo = vi.fn()
  relocate = vi.fn()
  pdf.numPages = 4; pdf.getPage.mockReset(); loading.destroy.mockClear()
  pdf.getPage.mockImplementation(async number => pages.get(number) || page(number))
  vi.stubGlobal('devicePixelRatio',2)
  vi.stubGlobal('ResizeObserver',class { constructor(callback) {resize=callback} observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function () {return {canvas:this}})
})
afterEach(() => { reader?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML='' })

describe('PDF continuation prepared without an early page turn', () => {
  it('keeps visible pixels, page and progress unchanged until a synchronous activation', async () => {
    await open()
    const visible = container.querySelector('canvas'), layer = container.querySelector('.pdf-text-layer')
    const source = await reader.getNextSpeechSource({isActive:() => true})
    const staged = renders.at(-1).canvas
    expect(source.text).toBe('Page 2.')
    expect(source.start).toBe(0)
    expect(reader.currentPage).toBe(1)
    expect(container.querySelector('canvas')).toBe(visible)
    expect(container.querySelector('.pdf-text-layer')).toBe(layer)
    expect(staged.isConnected).toBe(false)
    expect(relocate).not.toHaveBeenCalled()
    expect(source.activate()).toBe(true)
    expect(reader.currentPage).toBe(2)
    expect(container.querySelector('canvas')).toBe(staged)
    expect(staged.isConnected).toBe(true)
    expect(visible.isConnected).toBe(false)
    expect(visible.width).toBe(0)
    expect(relocate).toHaveBeenCalledExactlyOnceWith({index:1,fraction:1/3})
    expect(source.activate()).toBe(true)
    expect(relocate).toHaveBeenCalledOnce()
  })

  it('maps the final text layer separators and first highlight offsets, not a guessed raw string', async () => {
    page(2,[{str:'First line.',hasEOL:true},{str:'Second line.',hasEOL:false}])
    await open()
    const source = await reader.getNextSpeechSource()
    expect(source.text).toBe('First line.\nSecond line.')
    expect(source.activate()).toBe(true)
    source.highlight(12,24)
    const spans = [...container.querySelectorAll('.pdf-text-layer span')]
    expect(spans.map(span => span.classList.contains('inhouse-speech-current'))).toEqual([false,true])
    source.clear()
    expect(spans.every(span => !span.classList.contains('inhouse-speech-current'))).toBe(true)
    expect(source.activate()).toBe(true) // clearing a heard page permits normal pause/resume
    source.highlight(0,11)
    expect(spans[0].classList.contains('inhouse-speech-current')).toBe(true)
  })

  it('preserves preference zoom, device pixels and PDF.js text-layer scale in the staged page', async () => {
    await open({zoom:150,theme:'night'})
    const source = await reader.getNextSpeechSource()
    const staged = renders.at(-1).canvas
    expect(staged.width).toBe(1170)
    expect(staged.height).toBe(1755)
    expect(staged.style.width).toBe('585px')
    expect(source.activate()).toBe(true)
    expect(container.dataset.readerZoomed).toBe('true')
    const layer = container.querySelector('.pdf-text-layer')
    expect(layer.style.getPropertyValue('--total-scale-factor')).toBe('0.9750000000000001')
    expect(layer.style.width).toBe('585px')
    expect(document.querySelector('style[data-inhouse-speech]').textContent).toContain('236,184,76')
  })

  it('preserves double-tap zoom instead of resetting it on continuation', async () => {
    await open()
    await reader.toggleZoom(100,100)
    const source = await reader.getNextSpeechSource()
    const widthBefore = container.querySelector('canvas').style.width
    expect(source.activate()).toBe(true)
    expect(container.querySelector('canvas').style.width).toBe(widthBefore)
    expect(parseFloat(widthBefore)).toBeCloseTo(858)
    expect(container.dataset.readerZoomed).toBe('true')
  })

  it('stages reflow text detached with the same typography and makes its mapping live on activation', async () => {
    await open({pdfMode:'text',font:'sans',fontSize:28,margin:32,lineHeight:2,zoom:150})
    const visible = container.querySelector('.pdf-reflow-page')
    const source = await reader.getNextSpeechSource()
    expect(source.text).toBe('Page 2.\n')
    expect(container.querySelector('.pdf-reflow-page')).toBe(visible)
    expect(visible.textContent).toBe('Page 1.\n')
    const renderCount = renders.length
    expect(source.activate()).toBe(true)
    const reflow = container.querySelector('.pdf-reflow-page')
    expect(reflow.textContent).toBe('Page 2.\n')
    expect(reflow.style.cssText).toBe(visible.style.cssText)
    expect(reflow.hidden).toBe(false)
    expect(container.querySelector('.pdf-page-wrap').hidden).toBe(true)
    expect(container.dataset.readerZoomed).toBe('false')
    expect(renders).toHaveLength(renderCount)
    source.highlight(0,7)
    expect(reflow.classList.contains('inhouse-speech-current')).toBe(true)
  })

  it('does not clone a previous sentence highlight onto the next reflow page', async () => {
    await open({pdfMode:'text'})
    const previous = await reader.getSpeechSource()
    previous.highlight(0,7)
    expect(container.querySelector('.pdf-reflow-page').classList.contains('inhouse-speech-current')).toBe(true)
    const source = await reader.getNextSpeechSource()
    expect(source.activate()).toBe(true)
    expect(container.querySelector('.pdf-reflow-page').classList.contains('inhouse-speech-current')).toBe(false)
    source.highlight(0,7)
    expect(container.querySelector('.pdf-reflow-page').classList.contains('inhouse-speech-current')).toBe(true)
  })

  it('an activated source remaps replacement text-layer nodes after zoom without losing visible pixels', async () => {
    await open()
    const source = await reader.getNextSpeechSource()
    expect(source.activate()).toBe(true)
    const original = container.querySelector('.pdf-text-layer span')
    source.highlight(0,7)
    await reader.applyPreferences({zoom:150})
    expect(source.activate()).toBe(true)
    const replacement = container.querySelector('.pdf-text-layer span')
    expect(replacement).not.toBe(original)
    source.highlight(0,7)
    expect(replacement.classList.contains('inhouse-speech-current')).toBe(true)
    expect(container.querySelector('canvas').width).toBe(1170)
    expect(reader.currentPage).toBe(2)
    expect(relocate).toHaveBeenCalledOnce()
  })

  it.each(['original','text'])('an activated %s source remaps the alternate PDF view with unchanged spoken offsets', async mode => {
    page(2,[{str:'First line.',hasEOL:true},{str:'Second line.',hasEOL:true}])
    await open({pdfMode:mode})
    const source = await reader.getNextSpeechSource()
    expect(source.activate()).toBe(true)
    source.highlight(12,24)
    await reader.applyPreferences({pdfMode:mode==='text' ? 'original' : 'text',theme:'sepia',fontSize:30})
    expect(source.activate()).toBe(true)
    source.highlight(12,24)
    if (mode==='text') {
      expect(container.querySelectorAll('.pdf-text-layer span')[1].classList.contains('inhouse-speech-current')).toBe(true)
      expect(container.querySelector('.pdf-text-layer').style.width).toBe('390px')
    } else expect(container.querySelector('.pdf-reflow-page').classList.contains('inhouse-speech-current')).toBe(true)
    expect(relocate).toHaveBeenCalledOnce()
  })

  it('an activated source refuses remapping when the same page text is no longer identical', async () => {
    await open()
    const source = await reader.getNextSpeechSource()
    expect(source.activate()).toBe(true)
    page(2,[{str:'Different text.'}])
    await reader.applyPreferences({zoom:150})
    expect(source.activate()).toBe(false)
    source.highlight(0,7)
    expect(container.querySelector('.inhouse-speech-current')).toBeNull()
  })

  it('skips image-only pages without displaying or rendering them', async () => {
    page(2,[]); page(3,[{str:'   '}])
    await open()
    const source = await reader.getNextSpeechSource()
    expect(source.text).toBe('Page 4.')
    expect(renders.map(value => value.number)).toEqual([1,4])
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
    expect(source.activate()).toBe(true)
    expect(reader.currentPage).toBe(4)
    expect(relocate).toHaveBeenCalledExactlyOnceWith({index:3,fraction:1})
  })

  it('returns null only at the true end, including trailing blank pages', async () => {
    page(2,[]); page(3,[]); page(4,[])
    await open()
    expect(await reader.getNextSpeechSource()).toBeNull()
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
    await reader.goToPage(4)
    expect(await reader.getNextSpeechSource()).toBeNull()
  })

  it('bounds blank-page work at twelve without claiming an unread end of book', async () => {
    pdf.numPages = 20
    for (let n=2;n<=13;n++) page(n,[])
    await open()
    await expect(reader.getNextSpeechSource()).rejects.toThrow('Página siguiente sin texto legible.')
    expect(pdf.getPage.mock.calls.map(([n]) => n)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13])
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
  })

  it('clear disposes only the prepared page and prevents a late activation', async () => {
    await open()
    const visible = container.querySelector('canvas')
    const source = await reader.getNextSpeechSource()
    const prepared = renders.at(-1), textTask = layers.at(-1)
    source.clear()
    expect(prepared.task.cancel).toHaveBeenCalledOnce()
    expect(textTask.cancel).toHaveBeenCalledOnce()
    expect(prepared.canvas.width).toBe(0)
    expect(source.activate()).toBe(false)
    expect(container.querySelector('canvas')).toBe(visible)
    expect(visible.width).toBeGreaterThan(0)
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
    const retry = await reader.getNextSpeechSource()
    expect(retry.text).toBe('Page 2.')
    expect(retry.activate()).toBe(true)
  })

  it.each(['next','prev','goToPage'])('manual %s invalidates an unplayed source', async method => {
    await open()
    if (method === 'prev') await reader.goToPage(2)
    const source = await reader.getNextSpeechSource()
    await reader[method](4)
    const expectedPage = method === 'next' ? 2 : method === 'prev' ? 1 : 4
    expect(reader.currentPage).toBe(expectedPage)
    const visible = container.querySelector('canvas'), count = relocate.mock.calls.length
    expect(source.activate()).toBe(false)
    expect(container.querySelector('canvas')).toBe(visible)
    expect(relocate).toHaveBeenCalledTimes(count)
  })

  it.each([{theme:'sepia'},{pdfMode:'text'},{zoom:150},{fontSize:30}])('preference change %j invalidates the prepared mapping', async preferences => {
    await open()
    const source = await reader.getNextSpeechSource()
    await reader.applyPreferences(preferences)
    expect(source.activate()).toBe(false)
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
  })

  it.each(['width','height','dpr'])('changed %s rejects activation even before the resize observer runs', async dimension => {
    await open()
    const source = await reader.getNextSpeechSource()
    if (dimension === 'width') width=500
    else if (dimension === 'height') height=600
    else vi.stubGlobal('devicePixelRatio',3)
    expect(source.activate()).toBe(false)
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
  })

  it('resize immediately disposes staging, before the delayed visible refit', async () => {
    vi.useFakeTimers()
    await open()
    const source = await reader.getNextSpeechSource(), staged = renders.at(-1)
    width=500; resize()
    expect(staged.task.cancel).toHaveBeenCalledOnce()
    expect(source.activate()).toBe(false)
    await vi.advanceTimersByTimeAsync(80)
    expect(parseFloat(container.querySelector('canvas').style.width)).toBe(500)
    expect(reader.currentPage).toBe(1)
  })

  it('isActive guards the completed stage until the matching audible start', async () => {
    await open()
    let active=true
    const source = await reader.getNextSpeechSource({isActive:() => active})
    active=false
    expect(source.activate()).toBe(false)
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
  })

  it('pause while extracting aborts without null/end or any visible mutation', async () => {
    const content = deferred(), next = page(2)
    next.getTextContent.mockReturnValue(content.promise)
    await open()
    let active=true
    const pending = reader.getNextSpeechSource({isActive:() => active})
    const assertion = expect(pending).rejects.toMatchObject({name:'AbortError'})
    await vi.waitFor(() => expect(next.getTextContent).toHaveBeenCalled())
    active=false; content.resolve({items:[{str:'Continuation.'}]})
    await assertion
    expect(reader.currentPage).toBe(1)
    expect(renders.map(value => value.number)).toEqual([1])
    expect(relocate).not.toHaveBeenCalled()
  })

  it('close during rendering cancels the detached task and never resurrects the document', async () => {
    const drawing = deferred(), next = page(2), cancel = vi.fn(() => drawing.reject(Object.assign(new Error(),{name:'RenderingCancelledException'})))
    next.render.mockReturnValue({promise:drawing.promise,cancel})
    await open()
    const pending = reader.getNextSpeechSource()
    const assertion = expect(pending).rejects.toMatchObject({name:'AbortError'})
    await vi.waitFor(() => expect(next.render).toHaveBeenCalled())
    reader.close()
    await assertion
    expect(cancel).toHaveBeenCalledOnce()
    expect(container.children).toHaveLength(0)
    expect(reader.pageCount).toBe(0)
    expect(relocate).not.toHaveBeenCalled()
  })

  it('close invalidates a ready source even if a new document opens at the same page', async () => {
    await open()
    const source = await reader.getNextSpeechSource()
    reader.close()
    await reader.open(container,new ArrayBuffer(0),{onRelocate:relocate})
    relocate.mockClear()
    expect(source.activate()).toBe(false)
    expect(reader.currentPage).toBe(1)
    expect(relocate).not.toHaveBeenCalled()
  })

  it('a second preparation cancels the previous detached bitmap without advancing its cursor', async () => {
    await open()
    const first = await reader.getNextSpeechSource(), firstCanvas = renders.at(-1).canvas
    const second = await reader.getNextSpeechSource()
    expect(firstCanvas.width).toBe(0)
    expect(first.activate()).toBe(false)
    expect(second.text).toBe('Page 2.')
    expect(second.activate()).toBe(true)
    expect(reader.currentPage).toBe(2)
  })

  it('clearing an old unactivated stage does not erase the new audible page highlight', async () => {
    const highlights = new Map()
    vi.stubGlobal('CSS',{highlights})
    vi.stubGlobal('Highlight',class {constructor(range) {this.range=range}})
    await open()
    const stale = await reader.getNextSpeechSource()
    const current = await reader.getNextSpeechSource()
    expect(current.activate()).toBe(true)
    current.highlight(0,7)
    const painted = highlights.get('inhouse-speech')
    expect(painted.range.startContainer.nodeValue).toBe('Page 2.')
    stale.clear()
    expect(highlights.get('inhouse-speech')).toBe(painted)
    expect(current.activate()).toBe(true)
  })

  it('only the newest concurrent preparation may commit after waiting for the same visible render', async () => {
    await open()
    const first = reader.getNextSpeechSource()
    const assertion = expect(first).rejects.toMatchObject({name:'AbortError'})
    const second = reader.getNextSpeechSource()
    await assertion
    const source = await second
    expect(source.text).toBe('Page 2.')
    expect(source.activate()).toBe(true)
    expect(relocate).toHaveBeenCalledOnce()
  })

  it('navigation while the visible render settles invalidates preparation instead of changing its starting page', async () => {
    await open()
    const pending = reader.getNextSpeechSource()
    const assertion = expect(pending).rejects.toMatchObject({name:'AbortError'})
    await reader.goToPage(3)
    await assertion
    expect(reader.currentPage).toBe(3)
    expect(renders.map(value => value.number)).toEqual([1,3])
  })
})
