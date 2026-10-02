// A one-shot image of an already laid out reading page. Opening a book must
// use its restored page, not a fabricated block of text or the cover thumbnail.
// Text is painted at the browser's measured glyph positions, so pagination,
// headings, chosen fonts and images remain tied to the live reader.

const MAX_EDGE = 1600
const DECODE_BUDGET = 1500

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
  const visibleText = []
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
    const style = doc.defaultView.getComputedStyle(node.parentElement)
    if (style.display === 'none' || style.color === 'transparent' || style.color === 'rgba(0, 0, 0, 0)') continue
    const fontSize = Number.parseFloat(style.fontSize) || 20
    const font = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${fontSize}px ${style.fontFamily || 'serif'}`
    ctx.fillStyle = style.color || '#292821'
    // Only the theme's own ink becomes the sepia ink; a publisher's own colour stays.
    if (sepiaCtx) sepiaCtx.fillStyle = sameColor(style.color, sepia.themeColor) ? sepia.color : ctx.fillStyle
    for (const c of all) {
      c.font = font
      c.direction = style.direction || 'ltr'
      c.textAlign = c.direction === 'rtl' ? 'right' : 'left'
      c.textBaseline = 'alphabetic'
      if ('letterSpacing' in c) c.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
    }
    const metrics = ctx.measureText('Hg')
    const ascent = metrics.fontBoundingBoxAscent || fontSize * .8
    const descent = metrics.fontBoundingBoxDescent || fontSize * .2
    let run = null
    const flush = () => {
      if (!run) return
      const transformed = style.textTransform === 'uppercase' ? run.text.toLocaleUpperCase()
        : style.textTransform === 'lowercase' ? run.text.toLocaleLowerCase() : run.text
      for (const c of all) c.fillText(transformed, (ctx.direction === 'rtl' ? run.right : run.left) - offsetX,
        run.top - offsetY + (run.height - ascent - descent) / 2 + ascent)
      visibleText.push(run.text)
      run = null
    }
    for (const [from, to] of segments) {
      let index = from
      for (const character of node.nodeValue.slice(from, to)) {
        measured.setStart(node, index)
        index += character.length
        measured.setEnd(node, index)
        const rect = [...measured.getClientRects()].find(value => intersects(value, bounds))
        if (!rect) { flush(); continue }
        if (!run || Math.abs(run.top - rect.top) > 1 || Math.abs(run.height - rect.height) > 1 ||
            (ctx.direction === 'rtl' ? Math.abs(run.left - rect.right) : Math.abs(run.right - rect.left)) > 2) {
          flush()
          run = { left:rect.left, right:rect.right, top:rect.top, height:rect.height, text:character }
        } else {
          run.text += character
          run.left = Math.min(run.left, rect.left)
          run.right = Math.max(run.right, rect.right)
        }
      }
    }
    flush()
  }
  return { source:canvas, width:canvas.width, height:canvas.height,
    displayBounds:plainBounds(viewport), text:visibleText.join(' ').replace(/\s+/g, ' ').trim(),
    ...(sepiaTarget ? { sepia:{ source:sepiaTarget.canvas, width:sepiaTarget.canvas.width, height:sepiaTarget.canvas.height } } : {}) }
}
