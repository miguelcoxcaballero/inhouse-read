import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('foliate-js/view.js', () => ({}))
vi.mock('foliate-js/overlayer.js', () => ({Overlayer:{highlight:vi.fn()}}))
vi.mock('../../src/js/gestures.js', () => ({attachSwipeNavigation:() => () => {}}))
import { FoliateReader } from '../../src/js/readers/foliate-reader.js'

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
    renderer:{getContents:() => [{doc,index:1}],setStyles:vi.fn(),setAttribute:vi.fn()}
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
    expect([...contexts.values()].flatMap(ctx => ctx.fillText.mock.calls).map(([text])=>text)).toEqual(['Saved blue page'])
    delete prototype.getClientRects
    reader.close()
  })
})
