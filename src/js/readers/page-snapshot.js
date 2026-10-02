// A one-shot image of an already laid out reading page. Opening a book must
// use its restored page, not a fabricated block of text or the cover thumbnail.
// Text is painted at the browser's measured glyph positions, so pagination,
// headings, chosen fonts and images remain tied to the live reader.

const MAX_EDGE = 1600
const DECODE_BUDGET = 1500
// Text painting. A line whose measured width differs from the font's natural
// width by more than this was stretched by the browser (justified text, word-spacing:
// layout only ever widens text beyond what the font alone would measure).
const STRETCH_TOLERANCE = .6
// Collapsed white space and soft hyphens inside a line measure 0 (or a 1/64 px sliver).
const ZERO_WIDTH = .25
const SPACE = /\s/u
const SOFT_HYPHEN = '\u00ad'
const LETTER = /\p{L}/u
const LETTER_BEFORE = /[\p{L}\p{N}'\u2019]/u
// What ::first-letter styles: the first letter or digit and the punctuation before it.
const INITIAL = /^[\s\p{P}\p{S}]*[\p{L}\p{N}]/u
// Zero-width marks that belong to the character before them: combining accents, joiners, variation selectors.
const ATTACHED = /[\p{M}\u200c\u200d]/u
// An emoji is often several code points the browser draws as one glyph: skin tones, ZWJ sequences, flags.
const EMOJI_JOIN = /^[\u{1f3fb}-\u{1f3ff}\u200d]/u
const REGIONAL = /^[\u{1f1e6}-\u{1f1ff}]$/u
const INITIAL_PROPERTIES = ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'color']

export function plainBounds(rect) {
  if (!rect) return null
  return { left:rect.left, top:rect.top, width:rect.width, height:rect.height }
}

function canvasFor(width, height, scale = 1) {
  if (!(width > 0 && height > 0)) return null
  const ratio = Math.min(Math.max(1, scale), MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  const context = canvas.getContext('2d')
  return context ? { canvas, context, ratio } : null
}

/** Copies before returning: subsequent PDF renders cannot alter the preview. */
export function snapshotCanvas(source, { filter = 'none', displayBounds, sepiaFilter } = {}) {
  const target = canvasFor(source?.width, source?.height)
  if (!target) return null
  target.context.filter = filter
  target.context.drawImage(source, 0, 0, target.canvas.width, target.canvas.height)
  const snapshot = { source:target.canvas, width:target.canvas.width, height:target.canvas.height,
    displayBounds:plainBounds(displayBounds || source.getBoundingClientRect()) }
  // The same raw page under the sepia theme's filter, for the open/close
  // transition. One more drawImage; the themed copy is untouched.
  const sepia = sepiaFilter == null ? null : canvasFor(source.width, source.height)
  if (sepia) {
    sepia.context.filter = sepiaFilter
    sepia.context.drawImage(source, 0, 0, sepia.canvas.width, sepia.canvas.height)
    snapshot.sepia = { source:sepia.canvas, width:sepia.canvas.width, height:sepia.canvas.height }
  }
  return snapshot
}

export async function settlePageLayout(doc = document) {
  await doc.fonts?.ready
  // Foliate schedules column expansion and CSS background replacement in rAF.
  // Two paints also let restored offsets settle before geometry is sampled.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

const intersects = (rect, bounds) => rect.width > 0 && rect.height > 0 &&
  rect.right > bounds.left && rect.left < bounds.right &&
  rect.bottom > bounds.top && rect.top < bounds.bottom

function readingFilter(element, themeFilter) {
  const filters = []
  for (let node = element; node; node = node.parentElement) {
    // `themeFilter` stands in for the element's own (theme) filter, so the
    // page can be rendered as another theme still under the same brightness.
    const value = node === element && themeFilter != null
      ? themeFilter : node.ownerDocument.defaultView.getComputedStyle(node).filter
    if (value && value !== 'none') filters.push(value)
    if (node.classList.contains('reader-viewport')) break
  }
  return filters.join(' ') || 'none'
}

export function renderedPageFilter(element, { themeFilter } = {}) { return readingFilter(element, themeFilter) }

function beforeDeadline(promise, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Reading image decode timed out')), Math.max(0, deadline - performance.now()))
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

function blobDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const unsafePaintURL = value => [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
  .some(([, , url]) => !url.trim().startsWith('#') && !url.trim().startsWith('data:'))

/** Rasterize existing inline SVG without requesting any network resources. */
export async function rasterizeInlineSVG(svg, { deadline = performance.now() + DECODE_BUDGET } = {}) {
  const clone = svg.cloneNode(true)
  const originals = [svg, ...svg.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  const properties = ['fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity','stroke-linecap',
    'stroke-linejoin','stroke-dasharray','opacity','color','font-family','font-size','font-weight','font-style',
    'letter-spacing','text-anchor','dominant-baseline','visibility']
  for (let i = 0; i < copies.length; i++) {
    const element = copies[i], original = originals[i]
    if (['script','foreignObject','iframe','object','embed'].includes(element.localName)) { element.remove(); continue }
    const computed = svg.ownerDocument.defaultView.getComputedStyle(original)
    for (const property of properties) {
      const value = computed.getPropertyValue(property)
      if (value && !unsafePaintURL(value)) element.style.setProperty(property,value)
    }
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith('on')) { element.removeAttributeNode(attribute); continue }
      // External stylesheet/paint server URLs cannot be resolved safely inside
      // an SVG image. Embedded fragment references remain within this clone.
      if (unsafePaintURL(attribute.value)) element.removeAttributeNode(attribute)
    }
    if (element.localName === 'image') {
      const href = element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink','href') || ''
      let embedded = href.startsWith('data:') ? href : null
      if (href.startsWith('blob:')) {
        try {
          // The ebook already loaded this local Blob. Reading it performs no
          // network request; inline data lets SVG-as-image retain illustrations.
          const blob = await beforeDeadline(fetch(href).then(response => response.blob()),deadline)
          if (blob.size <= 8 * 1024 * 1024) embedded = await beforeDeadline(blobDataURL(blob),deadline)
        } catch { /* unavailable local illustration */ }
      }
      if (!embedded) { element.remove(); continue }
      element.removeAttributeNS('http://www.w3.org/1999/xlink','href')
      element.setAttribute('href',embedded)
    } else {
      for (const name of ['href','xlink:href','src']) {
        const value = element.getAttribute(name)
        if (value && !value.startsWith('#')) element.removeAttribute(name)
      }
    }
  }
  clone.querySelectorAll('style,link').forEach(element => element.remove())
  const rect = svg.getBoundingClientRect()
  const scale = Math.min(1,MAX_EDGE / Math.max(rect.width,rect.height))
  const width = Math.max(1,Math.round(rect.width * scale)), height = Math.max(1,Math.round(rect.height * scale))
  if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox',`0 0 ${Math.max(1,rect.width)} ${Math.max(1,rect.height)}`)
  clone.setAttribute('width',width); clone.setAttribute('height',height)
  clone.style.width = `${width}px`; clone.style.height = `${height}px`
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}))
  const image = new Image()
  let loaded = false
  try {
    await beforeDeadline(new Promise((resolve,reject) => {
      image.onload = resolve; image.onerror = reject; image.src = url
    }),deadline)
    loaded = true
    return image
  } finally {
    image.onload = null; image.onerror = null
    if (!loaded) image.removeAttribute?.('src')
    URL.revokeObjectURL(url)
  }
}

/** Composite visible fixed-layout spread frames into the same reader viewport. */
export function compositePageSnapshots(snapshots, { viewport, background = '#faf9f5', filter = 'none', sepiaBackground } = {}) {
  const scale = Math.min(2,window.devicePixelRatio || 1)
  const target = canvasFor(viewport?.width,viewport?.height,scale)
  if (!target || !snapshots.length) return null
  const { canvas, context } = target
  context.filter = filter; context.fillStyle = background
  context.fillRect(0,0,canvas.width,canvas.height)
  context.filter = 'none' // each frame has its final reading filters already
  for (const snapshot of snapshots) context.drawImage(snapshot.source,0,0,canvas.width,canvas.height)
  const composite = {source:canvas,width:canvas.width,height:canvas.height,displayBounds:plainBounds(viewport),
    text:snapshots.map(snapshot => snapshot.text).filter(Boolean).join(' ')}
  // The sepia transition copy is composed the same way, only when every frame has one.
  const sepia = sepiaBackground != null && snapshots.every(snapshot => snapshot.sepia?.source)
    ? canvasFor(viewport.width,viewport.height,scale) : null
  if (sepia) {
    sepia.context.filter = filter; sepia.context.fillStyle = sepiaBackground
    sepia.context.fillRect(0,0,sepia.canvas.width,sepia.canvas.height)
    sepia.context.filter = 'none'
    for (const snapshot of snapshots) sepia.context.drawImage(snapshot.sepia.source,0,0,sepia.canvas.width,sepia.canvas.height)
    composite.sepia = { source:sepia.canvas, width:sepia.canvas.width, height:sepia.canvas.height }
  }
  return composite
}

const colorKey = value => {
  const text = String(value || '').trim().toLowerCase()
  const hex = /^#([0-9a-f]{6})$/.exec(text)
  return hex ? `rgb(${[0,2,4].map(i => parseInt(hex[1].slice(i,i + 2),16)).join(',')})` : text.replace(/\s+/g,'')
}
/** Does a computed CSS colour (rgb()) equal a theme colour (#rrggbb)? */
export const sameColor = (a, b) => Boolean(a && b) && colorKey(a) === colorKey(b)

/** Underline / line-through of the element and the inline ancestors it propagates from. */
function decorationsOf(element, styleOf) {
  const lines = []
  for (let node = element; node; node = node.parentElement) {
    const style = styleOf(node)
    if (style.textDecorationLine && style.textDecorationLine !== 'none') lines.push({ line:style.textDecorationLine, color:style.textDecorationColor || style.color })
    if (!style.display.startsWith('inline')) break
  }
  return lines
}

/**
 * Snapshot DOM in its actual visible viewport, including iframe offset after
 * a Foliate column/CFI jump. No HTML serialization or remote image requests.
 * This is safe to use as a GPU canvas texture even with external ebook images.
 */
export async function snapshotDOMPage(root, {
  viewport, offsetX = 0, offsetY = 0, background = '#faf9f5', filter = 'none', range,
  coordinateScaleX = 1, coordinateScaleY = 1, clipBounds, sepia,
  deadline = performance.now() + DECODE_BUDGET
} = {}) {
  if (!root || !viewport) return null
  const doc = root.ownerDocument
  const target = canvasFor(viewport.width, viewport.height, Math.min(2, window.devicePixelRatio || 1))
  if (!target) return null
  const { canvas, context:ctx, ratio } = target
  // `sepia` ({ background, color, themeColor }) paints the very same laid out
  // page a second time under the sepia theme: the layout (the expensive part)
  // is measured once, text and background are drawn on both canvases and
  // images, which no theme recolours, are shared.
  const sepiaTarget = sepia ? canvasFor(viewport.width, viewport.height, Math.min(2, window.devicePixelRatio || 1)) : null
  const sepiaCtx = sepiaTarget?.context
  const all = sepiaCtx ? [ctx, sepiaCtx] : [ctx]
  for (const [index, c] of all.entries()) {
    c.scale(ratio * coordinateScaleX, ratio * coordinateScaleY)
    if (clipBounds) {
      c.beginPath()
      c.rect((clipBounds.left - viewport.left) / coordinateScaleX,(clipBounds.top - viewport.top) / coordinateScaleY,
        clipBounds.width / coordinateScaleX,clipBounds.height / coordinateScaleY)
      c.clip()
    }
    c.filter = filter
    c.fillStyle = index ? sepia.background : background
    c.fillRect(0, 0, viewport.width / coordinateScaleX, viewport.height / coordinateScaleY)
  }
  const bounds = { left:offsetX, top:offsetY, right:offsetX + viewport.width / coordinateScaleX,
    bottom:offsetY + viewport.height / coordinateScaleY }

  // Blob/data ebook resources are same-origin. Cross-origin images are omitted
  // rather than poisoning the canvas and preventing WebGL from uploading it.
  const images = [...(root.localName === 'svg' ? [root] : []),...root.querySelectorAll('img, canvas, svg')]
  for (const image of images) {
    if (image.parentElement?.closest('svg')) continue // rasterize nested SVG once with its parent
    const rect = image.getBoundingClientRect()
    if (!intersects(rect, bounds)) continue
    if (image.localName === 'img') {
      const url = image.currentSrc || image.src || ''
      if (!url.startsWith('blob:') && !url.startsWith('data:')) {
        try { if (new URL(url, doc.baseURI).origin !== window.location.origin) continue } catch { continue }
      }
      try { await beforeDeadline(image.decode?.(),deadline) } catch { continue }
    }
    try {
      const source = image.localName === 'svg' ? await rasterizeInlineSVG(image,{deadline}) : image
      for (const c of all) c.drawImage(source, rect.left - offsetX, rect.top - offsetY, rect.width, rect.height)
    } catch { /* missing embedded image */ }
  }

  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */)
  const measured = doc.createRange()
  const view = doc.defaultView
  const visibleText = []
  const styles = new Map() // computed styles of the ancestors, shared by the text nodes
  const styleOf = element => { let value = styles.get(element); if (!value) styles.set(element, value = view.getComputedStyle(element)); return value }
  const blockLetters = new Map() // block -> its ::first-letter style when that differs from the block's own
  /** `{ length, style }` of the ::first-letter group (drop caps, enlarged initials) when `node` opens its block. */
  const initialOf = (node, start) => {
    if (start > 0) return null
    const match = INITIAL.exec(node.nodeValue)
    const block = node.parentElement
    if (!match || !block || styleOf(block).display.startsWith('inline')) return null
    if (!blockLetters.has(block)) {
      const own = styleOf(block), pseudo = view.getComputedStyle(block, '::first-letter')
      blockLetters.set(block, Number.parseFloat(pseudo.fontSize) > 0 && INITIAL_PROPERTIES.some(name => pseudo[name] !== own[name]) ? pseudo : null)
    }
    const pseudo = blockLetters.get(block)
    if (!pseudo) return null
    const first = doc.createTreeWalker(block, 4)
    let text = first.nextNode()
    while (text && !text.nodeValue.trim()) text = first.nextNode()
    return text === node ? { length:match[0].length, style:pseudo } : null
  }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim() || node.parentElement?.closest('script,style,noscript,svg')) continue
    if (range && !range.intersectsNode(node)) continue
    const start = range?.startContainer === node ? range.startOffset : 0
    const end = range?.endContainer === node ? range.endOffset : node.nodeValue.length
    if (end <= start) continue
    // A single paragraph can contain an entire novel. Use the visible CFI
    // range first, then bisect measured chunks so off-page text never incurs
    // one layout query per character (also for long PDF reflow paragraphs).
    const segments = []
    const visibleChunks = (from, to) => {
      measured.setStart(node, from); measured.setEnd(node, to)
      if (![...measured.getClientRects()].some(rect => intersects(rect, bounds))) return
      if (to - from <= 128) { segments.push([from, to]); return }
      let mid = Math.floor((from + to) / 2)
      const code = node.nodeValue.charCodeAt(mid)
      if (code >= 0xdc00 && code <= 0xdfff) mid++
      visibleChunks(from, mid); visibleChunks(mid, to)
    }
    visibleChunks(start, end)
    if (!segments.length) continue
    const style = styleOf(node.parentElement)
    if (style.display === 'none' || style.color === 'transparent' || style.color === 'rgba(0, 0, 0, 0)') continue
    const initial = initialOf(node, start)
    const baseDirection = style.direction || 'ltr'
    const inkOf = value => value || '#292821'
    const fontFor = (source, size) => `${source.fontStyle || 'normal'} ${source.fontWeight || '400'} ${size}px ${source.fontFamily || 'serif'}`
    const setInk = color => {
      ctx.fillStyle = inkOf(color)
      // Only the theme's own ink becomes the sepia ink; a publisher's own colour stays.
      if (sepiaCtx) sepiaCtx.fillStyle = sameColor(color, sepia.themeColor) ? sepia.color : ctx.fillStyle
    }
    const setFont = (source, size) => {
      for (const c of all) {
        c.font = fontFor(source, size)
        if ('fontVariantCaps' in c) c.fontVariantCaps = source.fontVariantCaps || 'normal'
        if ('letterSpacing' in c) c.letterSpacing = !source.letterSpacing || source.letterSpacing === 'normal' ? '0px' : source.letterSpacing
        c.textBaseline = 'alphabetic'
      }
      const metrics = ctx.measureText('Hg')
      return { ascent:metrics.fontBoundingBoxAscent || size * .8, descent:metrics.fontBoundingBoxDescent || size * .2 }
    }
    const fontSize = Number.parseFloat(style.fontSize) || 20
    const baseFace = setFont(style, fontSize)
    setInk(style.color)
    const lines = decorationsOf(node.parentElement, styleOf)
    const transform = style.textTransform
    // The generated hyphen of `hyphens:auto` (and of a soft hyphen) is not a text character.
    const hyphenates = style.hyphens === 'auto' && (style.overflowWrap || 'normal') === 'normal' && (style.wordBreak || 'normal') === 'normal'

    // A run is one stretch of one line, painted in one go. A line the browser
    // stretched (justification, word-spacing) is painted word by word, each at
    // its measured position, instead of with the font's natural spacing.
    let run = null
    const paint = current => {
      const initialRun = current.initial
      const size = initialRun ? Number.parseFloat(initialRun.fontSize) || fontSize : fontSize
      const face = initialRun ? setFont(initialRun, size) : baseFace
      if (initialRun) setInk(initialRun.color)
      const direction = current.direction || baseDirection, reverse = direction === 'rtl'
      for (const c of all) { c.direction = direction; c.textAlign = reverse ? 'right' : 'left' }
      const anchor = item => reverse ? item.right : item.left
      const baseline = current.top - offsetY + (current.height - face.ascent - face.descent) / 2 + face.ascent
      const hyphen = current.hyphen ? '-' : ''
      const put = (glyphs, x) => { for (const c of all) c.fillText(glyphs, x - offsetX, baseline) }
      const glyphs = current.chars.map(item => item.glyph).join('')
      const stretch = current.right - current.left - ctx.measureText(glyphs).width
      if (!(stretch > STRETCH_TOLERANCE)) put(glyphs + hyphen, reverse ? current.right : current.left)
      else {
        let word = []
        const emit = last => {
          if (!word.length) return
          const tail = last ? hyphen : ''
          const wordGlyphs = word.map(item => item.glyph).join('')
          const width = Math.max(...word.map(item => item.right)) - Math.min(...word.map(item => item.left))
          // Words that do not match their natural width (letter-spaced scripts, tabular figures) keep their characters where they are.
          if (!(width - ctx.measureText(wordGlyphs).width > STRETCH_TOLERANCE)) put(wordGlyphs + tail, anchor(word[0]))
          else {
            // ...but a glyph the font draws from several code points (emoji sequences, flags) stays together.
            const glyphs = []
            for (const item of word) {
              const before = glyphs.at(-1)
              if (before && (EMOJI_JOIN.test(item.glyph) || before.glyph.endsWith('\u200d') || (REGIONAL.test(item.glyph) && REGIONAL.test(before.glyph)))) before.glyph += item.glyph
              else glyphs.push({ ...item })
            }
            for (const item of glyphs) put(item.glyph, anchor(item))
            if (tail) put(tail, reverse ? word.at(-1).left - ctx.measureText(tail).width : word.at(-1).right)
          }
          word = []
        }
        for (const item of current.chars) { if (item.space) emit(false); else word.push(item) }
        emit(true)
      }
      const inked = current.chars.filter(item => !item.space)
      if (lines.length && inked.length) {
        const left = Math.min(...inked.map(item => item.left)), right = Math.max(...inked.map(item => item.right))
        const thickness = Math.max(1, Math.round(size / 18 * 4) / 4)
        for (const { line, color } of lines) {
          for (const [kind, y] of [['underline', baseline + size * .12], ['line-through', baseline - size * .3]]) {
            if (!line.includes(kind)) continue
            for (const [which, c] of all.entries()) {
              c.fillStyle = which && sameColor(color, sepia.themeColor) ? sepia.color : inkOf(color)
              c.fillRect(left - offsetX, y - thickness / 2, right - left, thickness)
            }
          }
        }
        setInk(initialRun ? initialRun.color : style.color)
      }
      visibleText.push(current.text)
      if (initialRun) { setFont(style, fontSize); setInk(style.color) }
    }
    const flush = () => { if (run) paint(run); run = null }
    let index = start
    for (const [from, to] of segments) {
      index = from
      for (const character of node.nodeValue.slice(from, to)) {
        const at = index
        index += character.length
        measured.setStart(node, at)
        measured.setEnd(node, index)
        // A character that wraps carries two rects: the line-end hyphen of a
        // soft hyphen leaks into the next character's list. The last one is its own.
        const rect = [...measured.getClientRects()].at(-1)
        // Collapsed white space and zero-width marks occupy no space: they neither paint nor break the line.
        if (!rect || rect.width < ZERO_WIDTH) {
          // A mark, joiner or variation selector has no width of its own: it is drawn with the character before it.
          const last = run?.chars.at(-1)
          if (last && !last.space && ATTACHED.test(character)) { last.glyph += character; run.text += character }
          continue
        }
        if (!intersects(rect, bounds)) { flush(); continue }
        const variant = initial && at < initial.length ? initial.style : null
        const capital = transform === 'capitalize' && !LETTER_BEFORE.test(node.nodeValue[at - 1] || ' ')
        const glyph = character === SOFT_HYPHEN ? '-' : transform === 'uppercase' || capital ? character.toLocaleUpperCase()
          : transform === 'lowercase' ? character.toLocaleLowerCase() : character
        const previous = run?.chars.at(-1)
        // The way the characters advance tells their direction: right for left-to-right
        // text, left for right-to-left, so mixed scripts in one paragraph keep their own runs.
        const way = !previous ? null : Math.abs(rect.left - previous.right) <= 2 && Math.abs(rect.right - previous.left) <= 2 ? 'either'
          : Math.abs(rect.left - previous.right) <= 2 ? 'ltr' : Math.abs(rect.right - previous.left) <= 2 ? 'rtl' : null
        const joins = run && run.initial === variant && Math.abs(run.top - rect.top) <= 1 && Math.abs(run.height - rect.height) <= 1 &&
          way && (way === 'either' || !run.direction || run.direction === way)
        if (!joins) {
          // Same word on the next line: the browser broke it with a hyphen it generated.
          if (run && hyphenates && rect.top > run.top + run.height / 2 && LETTER.test(node.nodeValue[at - 1] || '') && LETTER.test(character)) run.hyphen = true
          flush()
          run = { left:rect.left, right:rect.right, top:rect.top, height:rect.height, direction:null, initial:variant, chars:[], text:'', hyphen:false }
        } else {
          if (way !== 'either' && !run.direction) run.direction = way
          run.left = Math.min(run.left, rect.left)
          run.right = Math.max(run.right, rect.right)
        }
        run.chars.push({ glyph, left:rect.left, right:rect.right, space:SPACE.test(character) })
        if (character !== SOFT_HYPHEN) run.text += character
      }
    }
    flush()
  }
  return { source:canvas, width:canvas.width, height:canvas.height,
    displayBounds:plainBounds(viewport), text:visibleText.join(' ').replace(/\s+/g, ' ').trim(),
    ...(sepiaTarget ? { sepia:{ source:sepiaTarget.canvas, width:sepiaTarget.canvas.width, height:sepiaTarget.canvas.height } } : {}) }
}
