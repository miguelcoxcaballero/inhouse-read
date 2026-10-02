import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { createBookModel, mixPaperTone, sampleBookMotion } from '../../src/js/book-model.js'
import { PDF_PAGE_FILTERS, READING_THEMES } from '../../src/js/readers/reading-preferences.js'
import { compositePageSnapshots, renderedPageFilter, sameColor, snapshotCanvas, snapshotDOMPage } from '../../src/js/readers/page-snapshot.js'

const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height })
const book = { title:'A printed cover', author:'An author', format:'EPUB' }
const style = { color:'#42604b', shade:'#324c3a', ink:'#ffffff', coverRatio:.66, width:40 }
let contexts, tone
// Every canvas has its own context; getImageData answers with that canvas's tone.
beforeEach(() => {
  contexts = new Map(); tone = new Map()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    if (!contexts.has(this)) {
      let drawn = null // paperTone() copies the page into a tiny canvas, then reads it back
      contexts.set(this, new Proxy({
        filter:'none', fillStyle:'', measureText:text => ({ width:String(text).length * 16, fontBoundingBoxAscent:16, fontBoundingBoxDescent:4 }),
        createLinearGradient:() => ({ addColorStop() {} }),
        fillText:vi.fn(), fillRect:vi.fn(), scale:vi.fn(), beginPath:vi.fn(), rect:vi.fn(), clip:vi.fn(),
        drawImage:vi.fn(source => { drawn = source }),
        getImageData:vi.fn((_x, _y, w, h) => {
          const [r, g, b] = tone.get(drawn) || [0, 0, 0]
          return { data:Uint8ClampedArray.from({ length:w * h * 4 }, (_, i) => i % 4 === 3 ? 255 : [r, g, b][i % 4]) }
        })
      }, { get:(target, key) => target[key] ?? (() => {}), set:(target, key, value) => { target[key] = value; return true } }))
    }
    return contexts.get(this)
  })
  vi.stubGlobal('requestAnimationFrame', callback => { callback(0); return 1 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Range.prototype.getClientRects; document.body.innerHTML = '' })

const page = (width, height, rgb) => { const c = Object.assign(document.createElement('canvas'), { width, height }); tone.set(c, rgb); return c }
const lineMetrics = () => {
  Range.prototype.getClientRects = function () {
    const left = Number(this.startContainer.parentElement.dataset.x) + this.startOffset * 10
    return [rect(left, 30, (this.endOffset - this.startOffset) * 10, 26)]
  }
}

describe('sepia palette the transition uses', () => {
  it('replays exactly the filter the reader gives a sepia PDF page', () => {
    const css = readFileSync('src/css/reading.css', 'utf8')
    for (const [name, filter] of Object.entries(PDF_PAGE_FILTERS)) {
      if (name === 'paper') continue
      expect(css).toContain(`[data-reading-theme='${name}'] .pdf-page-canvas { filter:${filter}; }`)
    }
    expect(READING_THEMES.sepia).toMatchObject({ background:'#eee0c4', color:'#483825' })
  })

  it('swaps only the theme filter of the page and keeps the reader brightness', () => {
    document.body.innerHTML = '<main class="reader-viewport" style="filter:brightness(0.8)"><canvas style="filter:invert(0.89) hue-rotate(180deg)"></canvas></main>'
    const canvas = document.querySelector('canvas')
    expect(renderedPageFilter(canvas)).toBe('invert(0.89) hue-rotate(180deg) brightness(0.8)')
    expect(renderedPageFilter(canvas, { themeFilter:PDF_PAGE_FILTERS.sepia })).toBe('sepia(.5) brightness(.94) brightness(0.8)')
    expect(canvas.style.filter).toBe('invert(0.89) hue-rotate(180deg)')
    expect(renderedPageFilter(canvas, { themeFilter:'none' })).toBe('brightness(0.8)')
  })

  it('compares a computed rgb() colour with a hex theme colour', () => {
    expect(sameColor('rgb(212, 216, 204)', '#d4d8cc')).toBe(true)
    expect(sameColor('rgb(0,0,0)', '#000000')).toBe(true)
    expect(sameColor('rgb(1, 2, 3)', '#d4d8cc')).toBe(false)
    expect(sameColor('', '#000')).toBe(false)
  })
})

describe('sepia variant of a snapshot', () => {
  it('redraws the raw PDF canvas under the sepia filter next to the themed copy', () => {
    const raw = page(2400, 3200); raw.getBoundingClientRect = () => rect(22, 70, 360, 480)
    const snapshot = snapshotCanvas(raw, { filter:'invert(0.89)', sepiaFilter:'sepia(.5) brightness(.94)' })
    expect(snapshot.sepia.source).not.toBe(snapshot.source)
    expect(snapshot.sepia).toMatchObject({ width:snapshot.width, height:snapshot.height })
    expect(contexts.get(snapshot.sepia.source).filter).toBe('sepia(.5) brightness(.94)')
    expect(contexts.get(snapshot.sepia.source).drawImage).toHaveBeenCalledWith(raw, 0, 0, 1200, 1600)
    expect(contexts.get(snapshot.source).filter).toBe('invert(0.89)')
    expect(snapshotCanvas(raw, { filter:'none' }).sepia).toBeUndefined()
  })

  it('paints the same laid out page a second time on the sepia paper, images included once per canvas', async () => {
    document.body.innerHTML = '<article><p data-x="0" style="color:rgb(212,216,204)">Night text</p></article>'
    lineMetrics()
    const image = document.createElement('img'); image.src = 'data:image/png;base64,AA=='
    image.getBoundingClientRect = () => rect(20, 200, 100, 100); image.decode = async () => {}
    document.querySelector('article').append(image)
    const snapshot = await snapshotDOMPage(document.querySelector('article'), {
      viewport:rect(0, 0, 390, 720), background:'#191c1a',
      sepia:{ background:'#eee0c4', color:'#483825', themeColor:'#d4d8cc' }
    })
    const themed = contexts.get(snapshot.source), sepia = contexts.get(snapshot.sepia.source)
    expect(snapshot.sepia.source).not.toBe(snapshot.source)
    expect(snapshot.sepia).toMatchObject({ width:snapshot.width, height:snapshot.height })
    expect(themed.fillRect).toHaveBeenCalledWith(0, 0, 390, 720)
    expect(sepia.fillRect).toHaveBeenCalledWith(0, 0, 390, 720)
    // Same text at the same positions; images are drawn unthemed on both.
    expect(sepia.fillText.mock.calls).toEqual(themed.fillText.mock.calls)
    expect(themed.fillText.mock.calls.map(([text]) => text)).toEqual(['Night text'])
    expect(themed.drawImage).toHaveBeenCalledWith(image, 20, 200, 100, 100)
    expect(sepia.drawImage).toHaveBeenCalledWith(image, 20, 200, 100, 100)
    expect(themed.drawImage).toHaveBeenCalledOnce(); expect(sepia.drawImage).toHaveBeenCalledOnce()
  })

  it('turns the theme ink into the sepia ink and keeps a colour the publisher chose', async () => {
    document.body.innerHTML = '<article><p data-x="0" style="color:rgb(212,216,204)">Night text</p><p data-x="100" style="color:rgb(200,0,0)">Red</p></article>'
    lineMetrics()
    const inks = [], original = HTMLCanvasElement.prototype.getContext
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      const fresh = !contexts.has(this), ctx = original.call(this)
      if (fresh) {
        const fillText = ctx.fillText, label = inks.length ? 'sepia' : 'themed'
        inks.push(label)
        ctx.fillText = (text, ...rest) => { inks.push([label, text, ctx.fillStyle]); return fillText(text, ...rest) }
      }
      return ctx
    })
    await snapshotDOMPage(document.querySelector('article'), { viewport:rect(0, 0, 390, 720), background:'#191c1a',
      sepia:{ background:'#eee0c4', color:'#483825', themeColor:'#d4d8cc' } })
    spy.mockRestore()
    expect(inks.filter(Array.isArray)).toEqual([
      ['themed', 'Night text', 'rgb(212, 216, 204)'], ['sepia', 'Night text', '#483825'],
      ['themed', 'Red', 'rgb(200, 0, 0)'], ['sepia', 'Red', 'rgb(200, 0, 0)']
    ])
  })

  it('does no extra work and returns no variant when the reader is already sepia', async () => {
    document.body.innerHTML = '<article><p data-x="0">Text</p></article>'
    lineMetrics()
    const snapshot = await snapshotDOMPage(document.querySelector('article'), { viewport:rect(0, 0, 390, 720) })
    expect(snapshot.sepia).toBeUndefined()
    expect(contexts.size).toBe(1)
  })

  it('composes the variants of a fixed-layout spread only when every frame has one', () => {
    const frame = withSepia => ({ source:page(200, 300), text:'x', ...(withSepia ? { sepia:{ source:page(200, 300) } } : {}) })
    const both = compositePageSnapshots([frame(true), frame(true)], { viewport:rect(0, 0, 390, 720), background:'#191c1a', sepiaBackground:'#eee0c4' })
    expect(both.sepia.source).not.toBe(both.source)
    expect(contexts.get(both.sepia.source).fillStyle).toBe('#eee0c4')
    expect(contexts.get(both.sepia.source).drawImage).toHaveBeenCalledTimes(2)
    expect(contexts.get(both.source).fillStyle).toBe('#191c1a')
    expect(compositePageSnapshots([frame(true), frame(false)], { viewport:rect(0, 0, 390, 720), sepiaBackground:'#eee0c4' }).sepia).toBeUndefined()
    expect(compositePageSnapshots([frame(true)], { viewport:rect(0, 0, 390, 720) }).sepia).toBeUndefined()
  })
})

describe('paper tone cross-fade', () => {
  const sepiaPaper = new THREE.Color().setRGB(.93, .88, .77, THREE.SRGBColorSpace)
  const nightPaper = new THREE.Color().setRGB(.1, .11, .1, THREE.SRGBColorSpace)
  it('runs from the sepia paper to the theme paper in sRGB with exact ends', () => {
    const out = new THREE.Color()
    expect(mixPaperTone(out, sepiaPaper, nightPaper, 0).getHex(THREE.SRGBColorSpace)).toBe(sepiaPaper.getHex(THREE.SRGBColorSpace))
    expect(mixPaperTone(out, sepiaPaper, nightPaper, 1).getHex(THREE.SRGBColorSpace)).toBe(nightPaper.getHex(THREE.SRGBColorSpace))
    const mid = mixPaperTone(out, sepiaPaper, nightPaper, .5).getRGB({}, THREE.SRGBColorSpace)
    expect(mid.r).toBeCloseTo((.93 + .1) / 2, 4); expect(mid.g).toBeCloseTo((.88 + .11) / 2, 4); expect(mid.b).toBeCloseTo((.77 + .1) / 2, 4)
    expect(mixPaperTone(out, sepiaPaper, nightPaper, -3).getHex()).toBe(sepiaPaper.getHex())
    expect(mixPaperTone(out, sepiaPaper, nightPaper, 7).getHex()).toBe(nightPaper.getHex())
  })
  it('lets the side that has a paper margin win when the other is a full-bleed picture', () => {
    const out = new THREE.Color()
    expect(mixPaperTone(out, null, nightPaper, .3).getHex()).toBe(nightPaper.getHex())
    expect(mixPaperTone(out, sepiaPaper, null, 1).getHex()).toBe(sepiaPaper.getHex())
    expect(mixPaperTone(out, null, null, .5)).toBeNull()
  })
})

describe('book model page theme', () => {
  const snapshotWith = (themeRgb, sepiaRgb, variant = true) => ({
    source:page(400, 600, themeRgb), width:400, height:600,
    ...(variant ? { sepia:{ source:page(400, 600, sepiaRgb), width:400, height:600 } } : {})
  })
  const make = () => createBookModel({ ...book, progressFraction:.4 }, style, 132, 200, 40, null)
  const srgb = color => color.getRGB({}, THREE.SRGBColorSpace)

  it('keeps the page exactly as before when there is no sepia variant', () => {
    const model = make()
    const themed = model.getObjectByName('reading-page'), sepia = model.getObjectByName('reading-page-sepia')
    expect(model.userData.setPageSnapshot(snapshotWith([20, 20, 20], null, false))).toBe(true)
    expect(sepia.visible).toBe(false); expect(sepia.material.map).toBeNull()
    expect(themed.material.transparent).toBe(false); expect(themed.material.opacity).toBe(1)
    expect(model.userData.setPageTheme(0)).toBe(false)
    expect(themed.material.opacity).toBe(1)
    model.userData.dispose()
  })

  it('starts the installed page in sepia and fades the reader theme in over it', () => {
    const model = make()
    const themed = model.getObjectByName('reading-page'), sepia = model.getObjectByName('reading-page-sepia')
    const paper = model.getObjectByName('reading-page-paper'), leaves = model.getObjectByName('read-leaves').material[0]
    model.userData.setPageSnapshot(snapshotWith([0, 0, 0], [238, 224, 196]), { pageTheme:0 })
    expect(model.userData.getPageTheme()).toBe(0)
    expect(sepia.visible).toBe(true); expect(sepia.material.map.image.width).toBe(400)
    expect(themed.material.transparent).toBe(true); expect(themed.material.opacity).toBe(0)
    // Page, the paper behind it and the leaves already read are all sepia.
    expect(srgb(paper.material.color).r).toBeCloseTo(238 / 255, 2)
    expect(srgb(paper.material.color).b).toBeCloseTo(196 / 255, 2)
    const sepiaLeaves = leaves.color.clone()
    // The sepia plane sits just behind the themed one, same fitted size.
    expect(sepia.position.z).toBeLessThan(themed.position.z)
    expect(sepia.position.z).toBeGreaterThan(paper.position.z)
    expect(sepia.geometry.parameters).toMatchObject({ width:themed.geometry.parameters.width, height:themed.geometry.parameters.height })
    model.userData.setPageTheme(.5)
    expect(themed.material.opacity).toBe(.5)
    expect(srgb(paper.material.color).r).toBeCloseTo(238 / 255 / 2, 2)
    model.userData.setPageTheme(1)
    expect(themed.material.opacity).toBe(1)
    expect(srgb(paper.material.color).r).toBeCloseTo(0, 2)
    expect(leaves.color.r).toBeLessThan(sepiaLeaves.r)
    model.userData.dispose()
  })

  it('clamps the mix, ignores garbage and reports whether anything faded', () => {
    const model = make()
    model.userData.setPageSnapshot(snapshotWith([0, 0, 0], [238, 224, 196]))
    expect(model.userData.getPageTheme()).toBe(1)
    model.userData.setPageTheme(-2); expect(model.userData.getPageTheme()).toBe(0)
    model.userData.setPageTheme(9); expect(model.userData.getPageTheme()).toBe(1)
    model.userData.setPageTheme(Number.NaN); expect(model.userData.getPageTheme()).toBe(1)
    expect(model.userData.setPageTheme(.25)).toBe(true)
    model.userData.dispose()
    expect(model.userData.setPageTheme(.5)).toBe(false)
  })

  it('releases the replaced variant, then every texture exactly once on disposal', () => {
    const model = make()
    const sepia = model.getObjectByName('reading-page-sepia'), themed = model.getObjectByName('reading-page')
    model.userData.setPageSnapshot(snapshotWith([0, 0, 0], [238, 224, 196]), { pageTheme:0 })
    const release = vi.spyOn(sepia.material.map, 'dispose')
    model.userData.setPageSnapshot(snapshotWith([0, 0, 0], [238, 224, 196]), { pageTheme:0 })
    expect(release).toHaveBeenCalledOnce()
    const releases = [vi.spyOn(sepia.material.map, 'dispose'), vi.spyOn(themed.material.map, 'dispose')]
    model.userData.dispose(); model.userData.dispose()
    for (const spy of releases) expect(spy).toHaveBeenCalledOnce()
  })

  it('drops a stale variant when the next snapshot has none', () => {
    const model = make()
    const sepia = model.getObjectByName('reading-page-sepia')
    model.userData.setPageSnapshot(snapshotWith([0, 0, 0], [238, 224, 196]), { pageTheme:0 })
    const stale = vi.spyOn(sepia.material.map, 'dispose')
    model.userData.setPageSnapshot(snapshotWith([0, 0, 0], null, false))
    expect(stale).toHaveBeenCalledOnce()
    expect(sepia.visible).toBe(false)
    expect(model.getObjectByName('reading-page').material.opacity).toBe(1)
    model.userData.dispose()
  })

  it('ignores a variant whose size is not the page it belongs to', () => {
    const model = make()
    model.userData.setPageSnapshot({ source:page(400, 600, [0, 0, 0]), width:400, height:600,
      sepia:{ source:page(100, 100, [238, 224, 196]), width:100, height:100 } }, { pageTheme:0 })
    expect(model.getObjectByName('reading-page-sepia').visible).toBe(false)
    expect(model.getObjectByName('reading-page').material.opacity).toBe(1)
    model.userData.dispose()
  })
})

describe('page theme rides the zoom', () => {
  const pose = { x:0, y:0, scale:1, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1 }
  it('interpolates on the same eased clock as the zoom, exactly at both ends', () => {
    const frames = [{ transform:{ ...pose, scale:1, pageTheme:0 } }, { transform:{ ...pose, scale:2.4, pageTheme:1 } }]
    expect(sampleBookMotion(frames, 0).pageTheme).toBe(0)
    expect(sampleBookMotion(frames, 1).pageTheme).toBe(1)
    let previous = -1
    for (let step = 0; step <= 100; step++) {
      const sample = sampleBookMotion(frames, step / 100)
      expect(sample.pageTheme).toBeGreaterThanOrEqual(previous); previous = sample.pageTheme
      // One progress: the colour has covered the same fraction of its way as the scale.
      expect(sample.pageTheme).toBeCloseTo((sample.scale - 1) / 1.4, 6)
    }
    expect(sampleBookMotion(frames, .5).pageTheme).toBeCloseTo(.5, 6)
    // Closing: theme to sepia, mirrored.
    expect(sampleBookMotion([{ transform:{ ...pose, pageTheme:1 } }, { transform:{ ...pose, pageTheme:0 } }], .5).pageTheme).toBeCloseTo(.5, 6)
    expect(sampleBookMotion([{ transform:{ ...pose, pageTheme:1 } }, { transform:{ ...pose, pageTheme:0 } }], 1).pageTheme).toBe(0)
  })
  it('leaves the mix out of a motion that does not mention it', () => {
    const sample = sampleBookMotion([{ transform:{ ...pose, pageTheme:.3 } }, { transform:{ ...pose, x:10 } }], .5)
    expect(sample).not.toHaveProperty('pageTheme')
    expect(sample.x).toBeGreaterThan(0)
  })
})
