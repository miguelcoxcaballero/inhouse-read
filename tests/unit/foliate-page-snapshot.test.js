import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('foliate-js/view.js', () => ({}))
vi.mock('foliate-js/overlayer.js', () => ({Overlayer:{highlight:vi.fn()}}))
vi.mock('../../src/js/gestures.js', () => ({attachSwipeNavigation:() => () => {}}))
import { FoliateReader } from '../../src/js/readers/foliate-reader.js'
import { READING_THEMES } from '../../src/js/readers/reading-preferences.js'
import { Overlayer } from 'foliate-js/overlayer.js'

const rect = (left,top,width,height) => ({left,top,width,height,right:left+width,bottom:top+height})
let container, view, doc, contexts, rangePrototype
beforeEach(() => {
  document.body.innerHTML = '<main class="reader-viewport" style="filter:brightness(0.9)"></main><iframe></iframe>'
  container = document.querySelector('main')
  const iframe = document.querySelector('iframe')
  iframe.getBoundingClientRect = () => rect(-400,64,1200,720)
  doc = iframe.contentDocument
  doc.body.innerHTML = '<p data-x="0">Initial page</p><h1 data-x="400" style="color:rgb(212,216,204);font-family:Arial;font-size:24px">Beyond the window</h1><p data-x="800">Following page</p>'
  const range = doc.createRange(); range.selectNodeContents(doc.querySelector('h1'))
  rangePrototype = Object.getPrototypeOf(range)
  rangePrototype.getClientRects = function () {
    const left = Number(this.startContainer.parentElement.dataset.x) + this.startOffset * 10
    return [rect(left,40,(this.endOffset-this.startOffset)*10,26)]
  }
  view = document.createElement('div')
  view.getBoundingClientRect = () => rect(0,64,390,720)
  Object.assign(view, {
    open:vi.fn(async () => {}),init:vi.fn(async () => {}),close:vi.fn(),
    lastLocation:{fraction:.6,cfi:'epubcfi(/6/4!/4/2)',range,tocItem:{label:'Beyond the window'}},
    renderer:{getContents:() => [{doc,index:1}],setStyles:vi.fn(),setAttribute:vi.fn(),removeAttribute:vi.fn()}
  })
  const create = document.createElement.bind(document)
  vi.spyOn(document,'createElement').mockImplementation(name => name==='foliate-view' ? view : create(name))
  contexts = new Map()
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function () {
    const context = {drawImage:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),scale:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),
      measureText:() => ({fontBoundingBoxAscent:18,fontBoundingBoxDescent:5})}
    contexts.set(this,context); return context
  })
  vi.stubGlobal('requestAnimationFrame',callback => {callback(0);return 1})
})
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();delete rangePrototype.getClientRects;document.body.innerHTML=''})

describe('restored EPUB visible page', () => {
  it('captures the restored CFI column instead of the beginning of its chapter document', async () => {
    const reader = new FoliateReader()
    await reader.open(container,new File(['epub'],'book.epub'))
    await reader.applyPreferences({theme:'night',fontSize:24,font:'sans'})
    const snapshot = await reader.getPageSnapshot()
    expect(snapshot).toMatchObject({engine:'foliate',sourceType:'epub-page',text:'Beyond the window',
      label:'Beyond the window',location:{fraction:.6,locator:{kind:'cfi',value:'epubcfi(/6/4!/4/2)'}},
      displayBounds:{left:0,top:64,width:390,height:720}})
    const ctx = contexts.get(snapshot.source)
    expect(ctx.fillRect).toHaveBeenCalledWith(0,0,390,720)
    expect(ctx.filter).toBe('none')
    const pageContext = [...contexts.values()].find(value => value.fillText.mock.calls.length)
    expect(pageContext.filter).toBe('brightness(0.9)')
    expect(pageContext.fillText.mock.calls.map(([text]) => text)).toEqual(['Beyond the window'])
    expect(pageContext.font).toContain('24px Arial')
    reader.close()
    expect(await reader.getPageSnapshot()).toBeNull()
  })

  it.each(Object.keys(READING_THEMES))('paints the restored %s page on white paper with unfiltered dark ink', async theme => {
    const reader = new FoliateReader()
    await reader.open(container,new File(['epub'],'book.epub'))
    await reader.applyPreferences({theme})
    doc.querySelector('h1').style.color = READING_THEMES[theme].color
    const snapshot = await reader.getPageSnapshot()
    expect(snapshot.paper.source).not.toBe(snapshot.source)
    expect(snapshot.paper).toMatchObject({width:snapshot.width,height:snapshot.height})
    expect(contexts.get(snapshot.paper.source).fillStyle).toBe('#ffffff')
    expect(contexts.get(snapshot.paper.source).filter).toBe('none')
    expect(contexts.get(snapshot.source).fillStyle).toBe(READING_THEMES[theme].background)
    const painted = [...contexts.values()].filter(value => value.fillText.mock.calls.length)
    expect(painted).toHaveLength(2)
    expect(painted[0].fillStyle).toBe(doc.querySelector('h1').style.color)
    expect(painted[0].filter).toBe('brightness(0.9)')
    expect(painted[1].fillStyle).toBe('#292821')
    expect(painted[1].filter).toBe('none')
    expect(painted[1].fillText.mock.calls).toEqual(painted[0].fillText.mock.calls)
    reader.close()
  })

  it('drops its snapshot when the book closes during the font/layout wait', async () => {
    const callbacks = []
    vi.stubGlobal('requestAnimationFrame',callback => {callbacks.push(callback);return 1})
    const reader = new FoliateReader()
    await reader.open(container,new File(['epub'],'book.epub'))
    const pending = reader.getPageSnapshot()
    await Promise.resolve()
    reader.close()
    callbacks.shift()(0);callbacks.shift()(0)
    expect(await pending).toBeNull()
  })

  it('ignores a hidden first spread iframe and captures the visible scaled fixed-layout page', async () => {
    const reader = new FoliateReader()
    await reader.open(container,new File(['comic'],'book.cbz'))
    const hiddenFrame = doc.defaultView.frameElement
    hiddenFrame.getBoundingClientRect = () => rect(0,0,0,0)
    const frame = document.createElement('iframe');document.body.append(frame)
    const visibleDoc = frame.contentDocument
    visibleDoc.body.innerHTML = '<h1 style="font-size:24px">Saved blue page</h1>'
    const prototype = Object.getPrototypeOf(visibleDoc.createRange())
    prototype.getClientRects = function () {return [rect(this.startOffset*10,40,(this.endOffset-this.startOffset)*10,26)]}
    frame.getBoundingClientRect = () => rect(50,80,200,300)
    Object.defineProperties(frame,{clientWidth:{value:400},clientHeight:{value:600}})
    view.renderer.getContents = () => [{doc},{doc:visibleDoc}]
    view.lastLocation = {fraction:.7,cfi:'epubcfi(/6/6)',range:null,pageItem:{label:'3'}}
    const snapshot = await reader.getPageSnapshot()
    expect(snapshot).toMatchObject({text:'Saved blue page',sourceType:'epub-page',
      location:{locator:{kind:'cfi',value:'epubcfi(/6/6)'}}})
    expect([...contexts.values()].some(ctx => ctx.scale.mock.calls.some(([x,y])=>x===.5&&y===.5))).toBe(true)
    // The page is painted once for the reader's theme and once more, identically placed, on white paper.
    const painted = [...contexts.values()].filter(ctx => ctx.fillText.mock.calls.length)
    expect(painted).toHaveLength(2)
    for (const ctx of painted) expect(ctx.fillText.mock.calls.map(([text])=>text)).toEqual(['Saved blue page'])
    expect(painted[1].fillText.mock.calls).toEqual(painted[0].fillText.mock.calls)
    delete prototype.getClientRects
    reader.close()
  })
})

describe('EPUB usable viewport', () => {
  it('caps the two-page spread to a book measure on wide windows and keeps phones full width', async () => {
    let width = 1280
    Object.defineProperties(container, { clientWidth:{ configurable:true, get:() => width }, clientHeight:{ configurable:true, get:() => 780 } })
    const reader = new FoliateReader()
    await reader.open(container, new File(['epub'], 'book.epub'))
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('max-inline-size', '580px')
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('gap', `${((48 + 16) / 1280 * 100).toFixed(4)}%`)
    width = 390
    await reader.applyPreferences({})
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('max-block-size', '1440px')
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('max-inline-size', '720px')
    reader.close()
  })
  it('applies valid compact vertical gutters and real horizontal margins before the first page', async () => {
    const reader = new FoliateReader()
    view.init.mockImplementation(async () => {
      expect(view.renderer.setAttribute).toHaveBeenCalledWith('margin', '12px')
      expect(view.renderer.setAttribute).toHaveBeenCalledWith('gap', `${(16 / 390 * 100).toFixed(4)}%`)
      expect(view.renderer.setStyles).toHaveBeenCalled()
    })
    await reader.open(container, new File(['epub'], 'book.epub'))
    await reader.applyPreferences({ margin:32 })
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('gap', `${(32 / 390 * 100).toFixed(4)}%`)
    await reader.applyPreferences({ margin:32, flow:'scrolled' })
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('gap', `${(32 / (390 + 32) * 100).toFixed(4)}%`)
    reader.close()
  })

  it('uses native animated snapping only when reduced motion allows it', async () => {
    let reduced = false
    vi.stubGlobal('matchMedia', () => ({matches:reduced}))
    const reader = new FoliateReader()
    await reader.open(container,new File(['epub'],'book.epub'))
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('animated','')
    reduced = true
    await reader.applyPreferences({})
    expect(view.renderer.removeAttribute).toHaveBeenCalledWith('animated')
    reader.close()
  })

  it('keeps the page box while the status bar, full screen or the mini player change the free height a little', async () => {
    vi.useFakeTimers()
    let width = 390, height = 720, resize
    Object.defineProperties(container, {
      clientWidth:{ configurable:true, get:() => width },
      clientHeight:{ configurable:true, get:() => height }
    })
    vi.stubGlobal('ResizeObserver', class { constructor(callback) { resize = callback } observe() {} disconnect() {} })
    const reader = new FoliateReader()
    try {
      await reader.open(container, new File(['epub'], 'book.epub'))
      // Room for the 48 px mini player is kept from the start.
      expect(view.style.height).toBe('672px')
      for (const free of [750, 720, 672, 700]) {
        height = free; resize(); await vi.advanceTimersByTimeAsync(80)
        expect(view.style.height).toBe('672px')
      }
      // A rotation is a real resize: the book is paginated for the new box.
      width = 844; height = 300; resize(); await vi.advanceTimersByTimeAsync(80)
      expect(view.style.height).toBe('252px')
    } finally {
      reader.close()
      vi.useRealTimers()
    }
  })

  it('adapts to the actual resized container without calling navigation or replacing the current CFI', async () => {
    vi.useFakeTimers()
    let width = 390, height = 720, resize
    const disconnect = vi.fn()
    Object.defineProperties(container, {
      clientWidth:{ configurable:true, get:() => width },
      clientHeight:{ configurable:true, get:() => height }
    })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback }
      observe() {}
      disconnect = disconnect
    })
    const reader = new FoliateReader()
    try {
      await reader.open(container, new File(['epub'], 'book.epub'))
      const location = view.lastLocation
      width = 640; height = 1800
      resize()
      await vi.advanceTimersByTimeAsync(80)
      expect(view.renderer.setAttribute).toHaveBeenCalledWith('gap', `${(16 / 640 * 100).toFixed(4)}%`)
      expect(view.renderer.setAttribute).toHaveBeenCalledWith('max-block-size', '1800px')
      expect(view.lastLocation).toBe(location)
      expect(view.init).toHaveBeenCalledOnce()
    } finally {
      reader.close()
      vi.useRealTimers()
    }
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

describe('EPUB search', () => {
  it('flattens foliate excerpts into text plus a separate match and clears hits on request', async () => {
    view.search = async function * () {
      yield { progress:.5 }
      yield { label:'The quiet room', subitems:[{ cfi:'epubcfi(/6/2!/4/2,/1:0,/1:3)', excerpt:{ pre:'…a book waited beside ', match:'the', post:' plant' } }] }
      yield 'done'
    }
    view.clearSearch = vi.fn()
    const reader = new FoliateReader()
    await reader.open(container,new File(['epub'],'book.epub'))
    const results = await reader.search('the')
    expect(results).toEqual([{ label:'The quiet room', excerpt:'…a book waited beside the plant',
      parts:{ pre:'…a book waited beside ', match:'the', post:' plant' }, locator:{ kind:'cfi', value:'epubcfi(/6/2!/4/2,/1:0,/1:3)' } }])
    reader.clearSearch()
    expect(view.clearSearch).toHaveBeenCalledOnce()
    reader.close()
  })

  it('marks search hits with a soft amber fill instead of the red debug outline', () => {
    const g = Overlayer.outline([{ left:10, top:20, width:30, height:18 }])
    expect(g.getAttribute('fill')).toBe('#d9a23a')
    expect(g.getAttribute('stroke')).toBeNull()
    expect(g.querySelectorAll('rect')).toHaveLength(1)
  })
})
