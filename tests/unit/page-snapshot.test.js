import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compositePageSnapshots, rasterizeInlineSVG, renderedPageFilter, settlePageLayout, snapshotCanvas, snapshotDOMPage } from '../../src/js/readers/page-snapshot.js'

const rect = (left, top, width, height) => ({ left, top, width, height, right:left+width, bottom:top+height })
let contexts
// Width of one character in the mock canvas font; 0 leaves measureText without a width (a natural line).
let charWidth = 0
function mockContext() {
  const context = { filter:'none', font:'', fillStyle:'', textAlign:'', direction:'', letterSpacing:'0px',
    drawImage:vi.fn(), fillRect:vi.fn(), scale:vi.fn(), beginPath:vi.fn(), rect:vi.fn(), clip:vi.fn(),
    measureText:vi.fn(text => ({fontBoundingBoxAscent:16,fontBoundingBoxDescent:4,...(charWidth ? {width:charWidth * text.length} : {})})) }
  // Records the font and alignment each string was painted with.
  context.painted = []
  context.fillText = vi.fn((text, x, y) => context.painted.push({text,x,y,font:context.font,align:context.textAlign,direction:context.direction,fill:context.fillStyle}))
  return context
}
beforeEach(() => {
  contexts = new Map()
  charWidth = 0
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

  // The rects a browser reports for the characters of one text node. `places[i]` lists the rects of
  // UTF-16 unit i as [left, width, top = 30]; a range of several characters reports all of theirs.
  const layout = (places, height = 20) => {
    Range.prototype.getClientRects = function () {
      const list = []
      for (let i = this.startOffset; i < this.endOffset; i++) for (const [left, width, top = 30] of places[i] || []) list.push(rect(left,top,width,height))
      return list
    }
  }
  const one = (...cells) => cells.map(cell => [cell])
  const paint = async (html, places, options = {}) => {
    document.body.innerHTML = html
    layout(places, options.height)
    const snapshot = await snapshotDOMPage(document.querySelector('article'),{viewport:rect(0,0,390,720),...options.snapshot})
    return { snapshot, painted:contexts.get(snapshot.source).painted, context:contexts.get(snapshot.source) }
  }
  const asCalls = painted => painted.map(({text,x}) => [text,x])

  it('paints a justified line word by word where the browser put each word, not as one left-packed string', async () => {
    charWidth = 10
    // "aa bb cc": the two spaces were stretched from 10 to 40 px to fill the line.
    const { painted, snapshot } = await paint('<article><p>aa bb cc</p></article>',
      one([0,10],[10,10],[20,40],[60,10],[70,10],[80,40],[120,10],[130,10]))
    expect(asCalls(painted)).toEqual([['aa',0],['bb',60],['cc',120]])
    expect(snapshot.text).toBe('aa bb cc')
  })

  it('paints both the theme and the sepia canvas with the same word positions', async () => {
    charWidth = 10
    const { snapshot } = await paint('<article><p>aa bb</p></article>',
      one([0,10],[10,10],[20,40],[60,10],[70,10]),{snapshot:{sepia:{background:'#eee0c4',color:'#483825',themeColor:'rgb(41, 40, 33)'}}})
    expect(asCalls(contexts.get(snapshot.source).painted)).toEqual([['aa',0],['bb',60]])
    expect(asCalls(contexts.get(snapshot.sepia.source).painted)).toEqual([['aa',0],['bb',60]])
  })

  it('keeps an unstretched line as one string so kerning and ligatures across spaces survive', async () => {
    charWidth = 10
    const { painted } = await paint('<article><p>aa bb cc</p></article>',
      one([0,10],[10,10],[20,10],[30,10],[40,10],[50,10],[60,10],[70,10]))
    expect(asCalls(painted)).toEqual([['aa bb cc',0]])
  })

  it('anchors the words of a justified right-to-left line at their right edge', async () => {
    charWidth = 10
    const { painted } = await paint('<article><p dir="rtl">אב גד</p></article>',
      one([290,10],[280,10],[240,40],[230,10],[220,10]))
    expect(painted.map(({text,x,align,direction}) => [text,x,align,direction])).toEqual([
      ['אב',300,'right','rtl'],['גד',240,'right','rtl']
    ])
  })

  it('leaves the characters of a word where the browser spread them when they do not fit its natural width', async () => {
    charWidth = 10
    // Inter-character justification / tabular figures: "ab" is 25 px wide in the page but 20 in the font.
    const { painted } = await paint('<article><p>ab cd</p></article>', one([0,12.5],[12.5,12.5],[25,10],[35,10],[45,10]))
    expect(asCalls(painted)).toEqual([['a',0],['b',12.5],['cd',35]])
  })

  it('keeps an emoji sequence in one piece even when the word has to be spread character by character', async () => {
    charWidth = 10
    // "👍🏽 ab": the thumb and its skin tone (two code points, two UTF-16 units each) are one 50 px glyph in the page
    // (each reports the rect of the whole glyph) but 40 px of characters in the font.
    const { painted } = await paint('<article><p>👍🏽 ab</p></article>',
      [[[0,50]],[[0,50]],[[0,50]],[[0,50]],[[50,40]],[[90,10]],[[100,10]]])
    expect(asCalls(painted)).toEqual([['👍🏽',0],['ab',90]])
  })

  it('keeps a combining accent, a variation selector and a joiner with the character they belong to', async () => {
    charWidth = 10
    const { painted, snapshot } = await paint('<article><p>ae\u0301 b\u2764\ufe0f</p></article>',
      one([0,10],[10,10],[20,0],[20,10],[30,10],[40,10],[50,0]))
    expect(asCalls(painted)).toEqual([['ae\u0301 b\u2764\ufe0f',0]])
    expect(snapshot.text).toBe('ae\u0301 b\u2764\ufe0f')
  })

  it('draws the hyphen the browser generates at a soft hyphen line break and does not move the next letter to it', async () => {
    charWidth = 10
    // "ma­nera" broke after "ma": the soft hyphen has a zero-width rect plus the hyphen's, and its
    // hyphen rect also leaks into the first rect of the character that starts the next line.
    const { painted } = await paint('<article><p>ma­nera</p></article>', [
      [[0,10]],[[10,10]],[[20,0],[20,10]],[[20,10],[0,10,60]],[[10,10,60]],[[20,10,60]],[[30,10,60]]
    ])
    expect(asCalls(painted)).toEqual([['ma-',0],['nera',0]])
    expect(painted.map(item => item.y)[1]).toBeGreaterThan(painted[0].y)
  })

  it('ignores a soft hyphen in the middle of a line: no gap, no hyphen', async () => {
    charWidth = 10
    const { painted, snapshot } = await paint('<article><p>ma­nera</p></article>',
      one([0,10],[10,10],[20,.015],[20,10],[30,10],[40,10],[50,10]))
    expect(asCalls(painted)).toEqual([['manera',0]])
    expect(snapshot.text).toBe('manera')
  })

  it('adds the hyphen of automatic hyphenation when a word continues on the next line', async () => {
    charWidth = 10
    const html = '<article><p style="hyphens:auto">wonderful end</p></article>'
    const original = window.getComputedStyle
    vi.spyOn(window,'getComputedStyle').mockImplementation(element => new Proxy(original.call(window,element),{
      get:(style,name) => name === 'hyphens' ? 'auto' : typeof style[name] === 'function' ? style[name].bind(style) : style[name]
    }))
    const places = one(...[0,10,20,30,40,50].map(left => [left,10]),...[0,10,20].map(left => [left,10,60]),[30,10,60],[40,10,60],[50,10,60],[60,10,60])
    const { painted } = await paint(html,places)
    expect(asCalls(painted)).toEqual([['wonder-',0],['ful end',0]])
  })

  it('does not invent a hyphen when the text breaks at a space or the page does not hyphenate', async () => {
    charWidth = 10
    const { painted } = await paint('<article><p>wonder ful</p></article>',
      one(...[0,10,20,30,40,50].map(left => [left,10]),[60,0],...[0,10,20].map(left => [left,10,60])))
    expect(asCalls(painted).map(([text]) => text)).toEqual(['wonder','ful'])
  })

  it('underlines a link and strikes through deleted text with the colour the page gives them', async () => {
    charWidth = 10
    const original = window.getComputedStyle
    vi.spyOn(window,'getComputedStyle').mockImplementation(element => new Proxy(original.call(window,element),{
      get:(style,name) => name === 'textDecorationLine' ? (element.localName === 'a' ? 'underline' : element.localName === 's' ? 'line-through' : 'none')
        : name === 'textDecorationColor' ? 'rgb(1, 2, 3)' : name === 'display' && ['a','s'].includes(element.localName) ? 'inline'
        : typeof style[name] === 'function' ? style[name].bind(style) : style[name]
    }))
    const { context } = await paint('<article><p>go <a href="#x">link</a> <s>old</s></p></article>',
      one(...Array.from({length:12},(_, i) => [i * 10,10])))
    // 1st fillRect is the page background; then the underline under "link" and the strike through "old".
    const [, underline, strike] = context.fillRect.mock.calls
    // (Every text node of the mock starts at x = 0: "link" is 4 characters, "old" 3.)
    expect([underline[0],underline[2]]).toEqual([0,40])
    expect([strike[0],strike[2]]).toEqual([0,30])
    expect(underline[1]).toBeGreaterThan(strike[1]) // under the baseline vs. through the x-height
    expect(context.fillRect).toHaveBeenCalledTimes(3) // the plain text of "go" has no line
  })

  it('paints an enlarged first letter (drop cap) at the size and colour its ::first-letter style gives it', async () => {
    charWidth = 10
    const original = window.getComputedStyle
    vi.spyOn(window,'getComputedStyle').mockImplementation((element, pseudo) => new Proxy(original.call(window,element),{
      get:(style,name) => pseudo && name === 'fontSize' ? '48px' : pseudo && name === 'color' ? 'rgb(120, 30, 30)'
        : typeof style[name] === 'function' ? style[name].bind(style) : style[name]
    }))
    const { painted } = await paint('<article><p>Once more</p></article>',
      [[[0,30,30]],...Array.from({length:8},(_, i) => [[30 + i * 10,10]])],{height:20})
    // The initial's rect is 20 px tall too in this mock; what matters is that it is its own run in its own font.
    expect(painted[0].text).toBe('O')
    expect(painted[0].font).toContain('48px')
    expect(painted[0].fill).toBe('rgb(120, 30, 30)')
    expect(painted[1].text).toBe('nce more')
    expect(painted[1].font).not.toContain('48px')
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
