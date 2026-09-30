import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compositePageSnapshots, rasterizeInlineSVG, renderedPageFilter, settlePageLayout, snapshotCanvas, snapshotDOMPage } from '../../src/js/readers/page-snapshot.js'

const rect = (left, top, width, height) => ({ left, top, width, height, right:left+width, bottom:top+height })
let contexts
function mockContext() {
  return { filter:'none', font:'', fillStyle:'', textAlign:'', direction:'', letterSpacing:'0px',
    drawImage:vi.fn(), fillRect:vi.fn(), fillText:vi.fn(), scale:vi.fn(), beginPath:vi.fn(), rect:vi.fn(), clip:vi.fn(),
    measureText:vi.fn(() => ({fontBoundingBoxAscent:16,fontBoundingBoxDescent:4})) }
}
beforeEach(() => {
  contexts = new Map()
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function () {
    if (!contexts.has(this)) contexts.set(this,mockContext())
    return contexts.get(this)
  })
  vi.stubGlobal('requestAnimationFrame', callback => { callback(0); return 1 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Range.prototype.getClientRects; document.body.innerHTML = '' })

describe('actual rendered reading page snapshots', () => {
  it('copies the real PDF pixels into a detached bounded bitmap and preserves displayed bounds', () => {
    const source = document.createElement('canvas')
    source.width = 2400; source.height = 3200
    source.getBoundingClientRect = () => rect(22,70,360,480)
    const snapshot = snapshotCanvas(source,{filter:'invert(0.89) hue-rotate(180deg)'})
    expect(snapshot.source).not.toBe(source)
    expect(snapshot).toMatchObject({width:1200,height:1600,displayBounds:{left:22,top:70,width:360,height:480}})
    expect(contexts.get(snapshot.source).filter).toBe('invert(0.89) hue-rotate(180deg)')
    expect(contexts.get(snapshot.source).drawImage).toHaveBeenCalledWith(source,0,0,1200,1600)
  })

  it('collects the page filter and reader brightness without changing either live element', () => {
    document.body.innerHTML = '<main class="reader-viewport" style="filter:brightness(0.8)"><canvas style="filter:sepia(0.5) brightness(0.94)"></canvas></main>'
    const source = document.querySelector('canvas')
    expect(renderedPageFilter(source)).toBe('sepia(0.5) brightness(0.94) brightness(0.8)')
    expect(source.style.filter).toBe('sepia(0.5) brightness(0.94)')
  })

  it('draws only the actual saved column text using live font and glyph coordinates', async () => {
    document.body.innerHTML = '<article><p data-x="0">Earlier page</p><h1 data-x="400" style="font-family:Georgia;font-size:26px;color:rgb(72,56,37)">Saved chapter</h1><p data-x="800">Later page</p></article>'
    Range.prototype.getClientRects = function () {
      const left = Number(this.startContainer.parentElement.dataset.x) + this.startOffset * 10
      const width = (this.endOffset - this.startOffset) * 10
      return [rect(left,30,width,26)]
    }
    const viewport = rect(0,64,390,720)
    const snapshot = await snapshotDOMPage(document.querySelector('article'),{
      viewport,offsetX:400,offsetY:0,background:'#eee0c4'
    })
    expect(snapshot.text).toBe('Saved chapter')
    const ctx = contexts.get(snapshot.source)
    expect(ctx.fillText).toHaveBeenCalledOnce()
    expect(ctx.fillText.mock.calls[0][0]).toBe('Saved chapter')
    expect(ctx.fillText.mock.calls[0][1]).toBe(0)
    expect(ctx.font).toContain('26px Georgia')
    expect(ctx.fillStyle).toBe('rgb(72, 56, 37)')
    expect(snapshot.displayBounds).toEqual({left:0,top:64,width:390,height:720})
  })

  it('includes embedded illustrations while avoiding a cross-origin poisoned GPU texture', async () => {
    document.body.innerHTML = '<article><img src="data:image/png;base64,AA=="><img src="https://example.net/private.png"></article>'
    const images = [...document.querySelectorAll('img')]
    for (const image of images) {
      image.getBoundingClientRect = () => rect(20,40,180,260)
      image.decode = vi.fn(async () => {})
    }
    const snapshot = await snapshotDOMPage(document.querySelector('article'),{viewport:rect(0,0,390,720)})
    expect(contexts.get(snapshot.source).drawImage).toHaveBeenCalledOnce()
    expect(contexts.get(snapshot.source).drawImage).toHaveBeenCalledWith(images[0],20,40,180,260)
    expect(images[1].decode).not.toHaveBeenCalled()
  })

  it('clamps a very long text node to the restored visible range without scanning the novel', async () => {
    const article = document.createElement('article')
    article.textContent = `${'Earlier text. '.repeat(4000)}Saved page${' Later text.'.repeat(4000)}`
    document.body.append(article)
    const node = article.firstChild
    const start = node.nodeValue.indexOf('Saved page')
    const range = document.createRange(); range.setStart(node,start);range.setEnd(node,start+10)
    let queries = 0
    Range.prototype.getClientRects = function () {
      queries++
      return [rect((this.startOffset-start)*10,30,(this.endOffset-this.startOffset)*10,20)]
    }
    const snapshot = await snapshotDOMPage(article,{viewport:rect(0,0,390,720),range})
    expect(snapshot.text).toBe('Saved page')
    expect(queries).toBeLessThan(20)
  })

  it('accounts for scaled fixed-layout iframe coordinates and clips each spread page', async () => {
    document.body.innerHTML = '<article><p>Saved page</p></article>'
    Range.prototype.getClientRects = function () {return [rect(this.startOffset*10,40,(this.endOffset-this.startOffset)*10,20)]}
    const snapshot = await snapshotDOMPage(document.querySelector('article'),{
      viewport:rect(0,64,390,720),offsetX:-100,offsetY:-32,coordinateScaleX:.5,coordinateScaleY:.5,
      clipBounds:rect(50,80,200,300)
    })
    const ctx = contexts.get(snapshot.source)
    expect(ctx.scale).toHaveBeenCalledWith(.5,.5)
    expect(ctx.rect).toHaveBeenCalledWith(100,32,400,600)
    expect(ctx.fillText.mock.calls[0][1]).toBe(100)
    expect(snapshot.text).toBe('Saved page')
    const combined = compositePageSnapshots([snapshot],{viewport:rect(0,64,390,720),background:'#faf9f5',filter:'brightness(0.9)'})
    expect(contexts.get(combined.source).drawImage).toHaveBeenCalledWith(snapshot.source,0,0,390,720)
    expect(combined.text).toBe('Saved page')
  })

  it('rasterizes bounded inline SVG including fragment paint references without requesting remote images', async () => {
    document.body.innerHTML = '<svg viewBox="0 0 2400 3200"><defs><linearGradient id="foil"><stop stop-color="gold"/></linearGradient></defs><rect width="2400" height="3200" fill="url(#foil)"/><image href="https://example.net/remote.png"/><script>window.bad=true</script><text x="32" y="80">Actual saved illustration</text></svg>'
    const svg = document.querySelector('svg')
    svg.getBoundingClientRect = () => rect(0,0,2400,3200)
    let copied
    const fetch = vi.fn();vi.stubGlobal('fetch',fetch)
    vi.stubGlobal('Image',class {
      set src(value) {this.currentSrc=value;queueMicrotask(() => this.onload?.())}
    })
    URL.createObjectURL = vi.fn(blob => {copied=blob;return 'blob:local-rendered-svg'})
    URL.revokeObjectURL = vi.fn()
    const source = await rasterizeInlineSVG(svg)
    const sourceText = await new Promise(resolve => {const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(copied)})
    expect(sourceText).toContain('width="1200"')
    expect(sourceText).toContain('height="1600"')
    expect(sourceText).toContain('url(#foil)')
    expect(sourceText).toContain('Actual saved illustration')
    expect(sourceText).not.toContain('https://example.net')
    expect(sourceText).not.toContain('<script')
    expect(fetch).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-rendered-svg')
    expect(source.currentSrc).toBe('blob:local-rendered-svg')
    delete URL.createObjectURL;delete URL.revokeObjectURL
  })

  it('stops waiting for a stalled illustration at the shared page decode deadline', async () => {
    document.body.innerHTML = '<article><img src="data:image/png;base64,AA=="></article>'
    const image = document.querySelector('img')
    image.getBoundingClientRect = () => rect(20,40,180,260)
    image.decode = () => new Promise(() => {})
    const snapshot = await snapshotDOMPage(document.querySelector('article'),{
      viewport:rect(0,0,390,720),deadline:performance.now()+10
    })
    expect(contexts.get(snapshot.source).drawImage).not.toHaveBeenCalled()
  })

  it('bisects unbounded PDF text to avoid a per-character scan beyond the visible page', async () => {
    const article = document.createElement('article')
    article.textContent = `Saved page${' Later text.'.repeat(5000)}`
    document.body.append(article)
    let queries = 0
    Range.prototype.getClientRects = function () {
      queries++
      return [rect(this.startOffset*10,30,(this.endOffset-this.startOffset)*10,20)]
    }
    const snapshot = await snapshotDOMPage(article,{viewport:rect(0,0,100,720)})
    expect(snapshot.text).toBe('Saved page')
    expect(queries).toBeLessThan(300)
  })

  it('waits for fonts then both deferred pagination frames', async () => {
    let finishFonts
    const callbacks = []
    vi.stubGlobal('requestAnimationFrame',callback => {callbacks.push(callback);return callbacks.length})
    const pending = settlePageLayout({fonts:{ready:new Promise(resolve => {finishFonts=resolve})}})
    await Promise.resolve(); expect(callbacks).toHaveLength(0)
    finishFonts(); await Promise.resolve(); expect(callbacks).toHaveLength(1)
    callbacks.shift()(0); expect(callbacks).toHaveLength(1)
    let settled = false; pending.then(() => {settled = true})
    await Promise.resolve(); expect(settled).toBe(false)
    callbacks.shift()(0); await pending; expect(settled).toBe(true)
  })
})
