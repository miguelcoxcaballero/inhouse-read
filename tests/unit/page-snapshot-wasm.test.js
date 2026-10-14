import './helpers/rust-ui-ready.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as rust from '../../src/js/readers/page-snapshot.js'
import * as original from './helpers/reference-page-snapshot.js'

// The Rust snapshot is compared with the frozen JavaScript original on random pages:
// every canvas property written and every canvas method called, in order, on both
// canvases, plus the returned records. A pixel cannot differ if no call does.
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height })
const METHODS = new Set(['drawImage', 'fillRect', 'scale', 'beginPath', 'rect', 'clip', 'fillText', 'clearRect', 'save', 'restore'])
const recorders = []
let flavour

function recorder() {
  const log = [], state = { filter:'none', font:'', fillStyle:'#000000', textAlign:'', direction:'', textBaseline:'' }
  const proxy = new Proxy(state, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined
      if (key === 'measureText') return text => {
        log.push(['measureText', text])
        return { fontBoundingBoxAscent:flavour.ascent, fontBoundingBoxDescent:flavour.descent, ...(flavour.charWidth ? { width:flavour.charWidth * text.length } : {}) }
      }
      if (METHODS.has(key)) return (...args) => { log.push([key, ...args.map(argument => argument?.nodeName ? `<${argument.nodeName}>` : argument)]) }
      return target[key]
    },
    set(target, key, value) { log.push(['set', key, value]); target[key] = value; return true },
    has(target, key) { return key in target || METHODS.has(key) || (flavour.modern && (key === 'fontVariantCaps' || key === 'letterSpacing')) }
  })
  recorders.push({ log, proxy })
  return proxy
}

// A deterministic stand-in for the browser's layout: one rectangle per UTF-16 unit.
function geometry(node) {
  const text = node.nodeValue, seed = Number(node.parentElement?.dataset.seed || 0), rtl = node.parentElement?.dataset.rtl === '1'
  const units = []
  let x = 20, line = 0, previous = null
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    const low = code >= 0xdc00 && code <= 0xdfff, mark = (code >= 0x300 && code <= 0x36f) || code === 0x200d || code === 0xfe0f || code === 0xad
    let width = low ? 0 : mark ? 0 : /\s/.test(text[index]) ? 4 + (line + seed) % 3 : 8 + code % 5
    if (code >= 0x4e00 && code <= 0x9fff) width = 16
    if (!low && !mark && x + width > 380) { x = 20; line++ }
    let box = { x, w:width, line }
    // The pieces of one emoji sequence report the rectangle of the whole glyph.
    if (previous && (low || code === 0x200d || code === 0xfe0f || previous.joiner)) box = { ...previous.box }
    units.push(box)
    if (!(previous && box === previous.box)) x += width
    previous = { box, joiner:code === 0x200d }
    if (code === 0xad && (index + seed) % 3 === 0) units[index].wrapped = true
  }
  return units.map(box => ({ ...box, left:rtl ? 400 - box.x - box.w : box.x }))
}
function fakeRects(range) {
  const node = range.startContainer, units = geometry(node).slice(range.startOffset, range.endOffset)
  if (node !== range.endContainer || !units.length) return []
  const lines = new Map()
  for (const unit of units) {
    const known = lines.get(unit.line)
    if (known) { known.left = Math.min(known.left, unit.left); known.right = Math.max(known.right, unit.left + unit.w) }
    else lines.set(unit.line, { left:unit.left, right:unit.left + unit.w })
  }
  const rects = [...lines].map(([line, box]) => rect(box.left, 60 + line * 24, box.right - box.left, 20))
  // A soft hyphen that broke the line leaks the generated hyphen's rectangle into the next character's list.
  if (units.length === 1 && units[0].wrapped) rects.unshift(rect(units[0].left, 36 + units[0].line * 24, 3, 20))
  return rects
}

const FRAGMENTS = ['Hello ', 'wörld', ' café ', 'áe', '­', 'tion', ' 👩🏽‍💻 ', 'עברית ', 'مرحبا', '漢字', 'x‍y', '   ', 'END. ', 'Abc-def ', 'ǆ ', 'ß', 'İstanbul ', '1234 ', '"quoted" ', '👨‍👩‍👧 ', 'fi ', '️']
const STYLES = ['', 'font-size:18px', 'font-size:26px;color:rgb(72,56,37)', 'text-transform:uppercase', 'text-transform:capitalize', 'text-transform:lowercase',
  'font-weight:700;font-style:italic', 'text-decoration-line:underline', 'text-decoration-line:line-through;text-decoration-color:rgb(200,30,30);color:#3b4a80', 'text-decoration-line:underline line-through', 'hyphens:auto', 'letter-spacing:2px;font-family:Georgia',
  'font-variant-caps:small-caps', 'color:transparent', 'color:rgb(41,40,33)', 'color:#292821', 'display:inline-block', 'direction:rtl']

function page(random) {
  const pick = list => list[Math.floor(random() * list.length)]
  const words = count => Array.from({ length:count }, () => pick(FRAGMENTS)).join('')
  const root = document.createElement(random() > .1 ? 'div' : 'article')
  const blocks = 1 + Math.floor(random() * 4)
  for (let block = 0; block < blocks; block++) {
    const paragraph = document.createElement(pick(['p', 'p', 'h2', 'li', 'blockquote']))
    paragraph.dataset.seed = String(Math.floor(random() * 5)); paragraph.dataset.rtl = random() > .85 ? '1' : '0'
    const style = pick(STYLES); if (style) paragraph.setAttribute('style', style)
    if (random() > .75) paragraph.style.display = 'none'
    paragraph.append(words(2 + Math.floor(random() * 14)))
    for (let child = Math.floor(random() * 3); child > 0; child--) {
      const inline = document.createElement(pick(['span', 'a', 'em', 'del', 'span']))
      inline.dataset.seed = String(Math.floor(random() * 5)); inline.dataset.rtl = random() > .9 ? '1' : '0'
      const inlineStyle = pick(STYLES); if (inlineStyle) inline.setAttribute('style', inlineStyle)
      if (inline.localName === 'a') inline.style.setProperty('text-decoration-line', 'underline')
      inline.append(words(1 + Math.floor(random() * 5)))
      paragraph.append(inline, words(random() > .5 ? 1 : 0))
    }
    if (random() > .8) paragraph.append(document.createElement('script'), 'hidden')
    root.append(paragraph)
  }
  document.body.replaceChildren(root)
  // A dropped initial: the first letter of the first block gets its own pseudo style.
  const real = window.getComputedStyle
  if (random() > .7) vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real.call(window, element)
    return pseudo === '::first-letter' ? new Proxy(style, { get: (target, key) => key === 'fontSize' ? '40px' : key === 'color' ? 'rgb(90, 20, 20)' : key === 'fontWeight' ? '700' : target[key] }) : style
  })
  return root
}

beforeEach(() => {
  recorders.length = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { if (!this.__recorder) this.__recorder = recorder(); return this.__recorder })
  vi.stubGlobal('requestAnimationFrame', callback => { callback(0); return 1 })
  Range.prototype.getClientRects = function () { return fakeRects(this) }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Range.prototype.getClientRects; document.body.innerHTML = '' })

const summary = snapshot => snapshot && ({ ...snapshot, source:undefined, paper:snapshot.paper && { ...snapshot.paper, source:undefined }, hasSource:Boolean(snapshot.source), canvas:[snapshot.source?.width, snapshot.source?.height] })

async function both(operation) {
  const results = []
  for (const module of [original, rust]) {
    recorders.length = 0
    const value = await operation(module)
    results.push({ value:summary(value), calls:recorders.map(entry => entry.log), canvases:recorders.length })
  }
  return results
}

it('paints exactly what the original painted on three hundred random pages', async () => {
  let state = 4242, painted = 0, papers = 0, decorated = 0, justified = 0, upper = 0
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  for (let sample = 0; sample < 300; sample++) {
    flavour = { modern:random() > .3, ascent:random() > .15 ? 12 + Math.floor(random() * 6) : 0, descent:random() > .15 ? 3 + Math.floor(random() * 3) : 0,
      charWidth:random() > .35 ? 7 + Math.floor(random() * 6) : 0 }
    vi.stubGlobal('devicePixelRatio', random() > .5 ? 2 : random() > .5 ? 1 : undefined)
    const root = page(random)
    const first = root.querySelector('p, h2, li, blockquote')?.firstChild
    const options = { viewport:rect(0, 64, 360 + Math.floor(random() * 60), 700), offsetX:Math.floor(random() * 30) - 10, offsetY:Math.floor(random() * 30),
      background:random() > .5 ? '#eee0c4' : undefined, filter:random() > .6 ? 'sepia(.5)' : undefined,
      ...(random() > .6 ? { paper:{ background:'#ffffff', color:'#292821', themeColor:random() > .5 ? 'rgb(41, 40, 33)' : 'rgb(72, 56, 37)' } } : {}),
      ...(random() > .8 ? { coordinateScaleX:.5, coordinateScaleY:.75, clipBounds:rect(20, 80, 200, 300) } : {}) }
    if (first?.nodeValue && random() > .6) {
      const range = document.createRange(); range.setStart(first, Math.floor(random() * 5)); range.setEnd(first, Math.min(first.nodeValue.length, 10 + Math.floor(random() * 90)))
      options.range = range
    }
    const [expected, actual] = await both(module => module.snapshotDOMPage(root, options))
    expect(actual).toEqual(expected)
    if (expected.value) painted++
    if (expected.value?.paper) papers++
    if (expected.calls[0].some(([name]) => name === 'fillText')) {
      const texts = expected.calls[0].filter(([name]) => name === 'fillText').map(call => call[1])
      if (texts.some(text => /[A-Z]{3}/.test(text))) upper++
      if (expected.calls[0].some(([name, key]) => name === 'set' && key === 'direction')) justified++
    }
    if (expected.calls[0].filter(([name]) => name === 'fillRect').length > 1) decorated++
  }
  // The corpus has to reach the paths it claims to compare.
  expect(painted).toBeGreaterThan(250)
  expect(papers).toBeGreaterThan(60)
  expect(decorated).toBeGreaterThan(30)
  expect(upper).toBeGreaterThan(20)
  expect(justified).toBeGreaterThan(100)
}, 180000)

it('copies, composes, filters and compares colours exactly like the original', async () => {
  let state = 99
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  flavour = { modern:true, ascent:14, descent:4, charWidth:0 }
  for (let sample = 0; sample < 120; sample++) {
    const source = document.createElement('canvas'); source.width = Math.floor(random() * 4000); source.height = Math.floor(random() * 4000)
    source.getBoundingClientRect = () => rect(10, 20, 300, 400)
    const paperSource = document.createElement('canvas'); paperSource.width = 100 + Math.floor(random() * 2500); paperSource.height = 90 + Math.floor(random() * 3000)
    const options = { filter:random() > .5 ? 'invert(.89)' : undefined, displayBounds:random() > .5 ? rect(1, 2, 3, 4) : undefined, paper:random() > .5, paperSource:random() > .5 ? paperSource : undefined }
    const [expected, actual] = await both(module => module.snapshotCanvas(source, options))
    expect(actual).toEqual(expected)
    const pieces = Array.from({ length:Math.floor(random() * 4) }, () => ({ source:document.createElement('canvas'), text:random() > .5 ? 'text ' + sample : '', ...(random() > .3 ? { paper:{ source:document.createElement('canvas') } } : {}) }))
    const composition = { viewport:random() > .1 ? rect(0, 64, 390, 720) : undefined, background:random() > .5 ? '#fff' : undefined, filter:random() > .5 ? 'brightness(.9)' : undefined, paperBackground:random() > .5 ? '#ffffff' : undefined }
    const [composed, composedRust] = await both(module => module.compositePageSnapshots(pieces, composition))
    expect(composedRust).toEqual(composed)
  }
  const colors = ['#292821', '#292821 ', 'RGB( 41 , 40 , 33 )', 'rgb(41, 40, 33)', '#ABCDEF', '#abcdef', 'rgb(171,205,239)', '', undefined, null, 'red', '#12345', '#1234567', '  #ABCDEF  ', 'rgb(1,\t2,\n3)', 'İ']
  for (const a of colors) for (const b of colors) expect(rust.sameColor(a, b)).toBe(original.sameColor(a, b))
})

it('reports the page filter and settles layout like the original', async () => {
  document.body.innerHTML = '<main class="reader-viewport" style="filter:brightness(.8)"><section style="filter:sepia(.4)"><canvas style="filter:invert(.9)"></canvas></section></main><aside><i id="outer" style="filter:blur(2px)"></i></aside>'
  const canvas = document.querySelector('canvas'), outer = document.querySelector('#outer')
  for (const element of [canvas, document.querySelector('section'), outer, document.querySelector('main')])
    for (const options of [undefined, {}, { themeFilter:'none' }, { themeFilter:'grayscale(1)' }, { themeFilter:null }])
      expect(rust.renderedPageFilter(element, options)).toBe(original.renderedPageFilter(element, options))
  const frames = []
  vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
  for (const options of [undefined, { waitForFonts:false }, { waitForFonts:true }]) {
    const order = []
    for (const module of [original, rust]) {
      frames.length = 0
      const pending = module.settlePageLayout({ fonts:{ ready:Promise.resolve() } }, options).then(() => order.push('settled'))
      await Promise.resolve(); await Promise.resolve()
      order.push(frames.length); frames.shift()?.(0); order.push(frames.length); frames.shift()?.(0)
      await pending
    }
    expect(order.slice(0, order.length / 2)).toEqual(order.slice(order.length / 2))
  }
})
