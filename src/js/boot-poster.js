/**
 * boot-poster.js — la última estantería, pintada antes de que arranque la app.
 * =============================================================================
 *
 * Cada vez que la escena 3D reposa (sin movimiento, sin mejoras pendientes) se
 * guarda una imagen WebP de ese fotograma en localStorage. En el arranque
 * siguiente, un script en línea de index.html la lee de forma síncrona y la
 * pinta bajo la cabecera antes de descargar o ejecutar el bundle. Cuando la
 * escena real reposa, el póster se desvanece sobre los mismos píxeles.
 *
 * Contrato con index.html (el script en línea): las claves de localStorage,
 * `window.__ihrBoot` y la función de clave (`bootKey`) deben coincidir. Una
 * prueba unitaria ejecuta el script real de index.html contra `bootKey`.
 *
 * Un póster solo se muestra si su clave coincide: versión de la app, tema,
 * modo de vista, tipo de estantería, plantas y lámparas, firma de la
 * biblioteca, tamaño de ventana, densidad de píxeles y zonas seguras. Si algo
 * cambia no se enseña un póster antiguo: se ve el esqueleto y, al reposar la
 * escena, se guarda uno nuevo.
 */

export const POSTER_IMG_KEY = 'ihr-poster-img'
export const POSTER_META_KEY = 'ihr-poster-meta'
export const LIBRARY_SIG_KEY = 'ihr-lib-sig'
const THEME_KEY = 'inhouse-read-theme'
const VIEW_KEY = 'inhouse-read-shelf-view'
const TYPE_KEY = 'inhouse-read-shelf-type'
const PLANTS_KEY = 'inhouse-read-shelf-plants'
const LAMPS_KEY = 'inhouse-read-shelf-lamps'
const MAX_POSTER_CHARS = 900_000
const MIN_CAPTURE_GAP_MS = 8000
const TAP_REPLAY_MS = 5000
const FALLBACK_REMOVE_MS = 20_000

// Mismos campos que shelf-metadata-records.js: no cambian lo que se dibuja.
const METADATA_FIELDS = new Set(['progressUpdatedAt', 'progressDirty', 'progressStateFileId',
  'lengthDirty', 'readingHistory', 'bookmarks', 'quotes', 'locator'])

function readStorage(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

/** FNV-1a de 32 bits en hexadecimal; idéntico al del script de index.html. */
export function hashString(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
  return (hash >>> 0).toString(16)
}

function safeAreaInsets(doc = document) {
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
  doc.body.append(probe)
  const style = getComputedStyle(probe)
  const insets = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(',')
  probe.remove()
  return insets
}

export function currentTheme() {
  const saved = readStorage(THEME_KEY)
  return saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

/** Clave de validez del póster. Debe producir lo mismo que index.html. */
export function bootKey() {
  const parts = [globalThis.__ihrBoot?.build ?? 'dev', currentTheme(), readStorage(VIEW_KEY), readStorage(TYPE_KEY),
    readStorage(PLANTS_KEY), readStorage(LAMPS_KEY), readStorage(LIBRARY_SIG_KEY),
    window.devicePixelRatio || 1, innerWidth, innerHeight, safeAreaInsets()]
  return hashString(parts.join('\u0001'))
}

const isBlob = value => /^\[object (Blob|File)\]$/.test(Object.prototype.toString.call(value))

/** Firma de lo que cambia el dibujo de la estantería (no la sincronización). */
export function librarySignature(books) {
  const text = JSON.stringify((books || []).map(book => Object.fromEntries(Object.entries(book || {})
    .filter(([key]) => !METADATA_FIELDS.has(key))
    .map(([key, value]) => [key, isBlob(value) ? `blob:${value.size}:${value.type}` : value]))),
  (_, value) => isBlob(value) ? `blob:${value.size}:${value.type}` : value)
  return hashString(text) + ':' + (books?.length || 0)
}

/** Se llama al pintar la estantería con una lista de libros. */
export function recordLibrary(books) {
  let signature
  try { signature = librarySignature(books) } catch { return }
  const previous = readStorage(LIBRARY_SIG_KEY)
  if (previous === signature) return
  try { localStorage.setItem(LIBRARY_SIG_KEY, signature) } catch { /* sin almacenamiento: sin póster */ }
  // Un póster pintado con una biblioteca distinta no puede seguir a la vista.
  if (previous !== null) dismissPoster({ fade:false })
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const state = { started:false, liveReady:false, lastCapture:0, capturing:false, lastRenderCount:-1, pendingRender:-1, posterShown:false }

function dismissSkeleton() {
  const root = document.documentElement
  if (!root.classList.contains('ihr-boot-skeleton')) return
  if (reducedMotion()) { root.classList.remove('ihr-boot-skeleton', 'ihr-boot-skeleton-out'); return }
  root.classList.add('ihr-boot-skeleton-out')
  setTimeout(() => root.classList.remove('ihr-boot-skeleton', 'ihr-boot-skeleton-out'), 240)
}

export function dismissPoster({ fade = true } = {}) {
  document.getElementById('boot-pill')?.remove()
  const poster = document.getElementById('boot-poster')
  if (!poster) return false
  poster.style.pointerEvents = 'none'
  if (!fade || reducedMotion()) poster.remove()
  else {
    poster.style.opacity = '0'
    setTimeout(() => poster.remove(), 240)
  }
  return true
}

function replayQueuedTap() {
  const tap = globalThis.__ihrBoot?.tap
  if (!tap) return
  globalThis.__ihrBoot.tap = null
  if (Date.now() - tap.t > TAP_REPLAY_MS) return
  // The poster no longer takes pointer events: hit-test the real shelf.
  const spine = document.elementsFromPoint(tap.x, tap.y).find(node => node.classList?.contains('ihr-spine'))
  spine?.click()
}

function onFirstFrame() {
  if (state.liveReady) return
  state.liveReady = true
  try { performance.mark('ihr:first-live-frame') } catch { /* sin User Timing */ }
  dismissSkeleton()
  const poster = document.getElementById('boot-poster')
  if (poster) {
    // The real spines exist now: taps go to them from here on.
    poster.style.pointerEvents = 'none'
    state.posterShown = true
    requestAnimationFrame(replayQueuedTap)
  }
}

function captureEligible(canvas) {
  const scroller = canvas.closest?.('.ihr-bookshelf__scroll')
  const home = document.getElementById('home-screen')
  return Boolean(scroller) && !document.hidden && home && !home.hidden && scroller.scrollTop === 0 &&
    !document.body.classList.contains('is-reading') && !document.body.classList.contains('is-closing-reader') &&
    !document.querySelector('.ihr-flyout') && canvas.dataset.animating === 'false' &&
    Math.abs(Number(canvas.dataset.inspectionZoom || 1) - 1) < .001 && window.scrollY === 0
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function encode(canvas, quality) {
  return new Promise(resolve => { try { canvas.toBlob(resolve, 'image/webp', quality) } catch { resolve(null) } })
}

export function clearPoster() {
  try { localStorage.removeItem(POSTER_META_KEY); localStorage.removeItem(POSTER_IMG_KEY) } catch { /* nada que limpiar */ }
}

async function capturePoster(canvas) {
  if (state.capturing || !canvas.isConnected || !captureEligible(canvas)) return
  state.capturing = true
  try {
    const scroller = canvas.closest('.ihr-bookshelf__scroll')
    const rect = canvas.getBoundingClientRect(), area = scroller.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0 && area.width > 0 && area.height > 0)) return
    const key = bootKey()
    let blob = null
    for (const quality of [.82, .55]) {
      blob = await encode(canvas, quality)
      // Browsers without WebP encoding return PNG: too large and not worth storing.
      if (!blob || blob.type !== 'image/webp') { blob = null; break }
      if (blob.size * 4 / 3 <= MAX_POSTER_CHARS) break
      blob = null
    }
    // Something may have changed while encoding: only a still-valid frame is kept.
    if (!blob || !captureEligible(canvas) || bootKey() !== key) return
    const dataUrl = await blobToDataUrl(blob)
    if (!captureEligible(canvas) || bootKey() !== key) return
    const left = Math.max(rect.left, area.left), top = Math.max(rect.top, area.top)
    const right = Math.min(rect.right, area.right), bottom = Math.min(rect.bottom, area.bottom)
    const meta = { k:key, v:globalThis.__ihrBoot?.build ?? 'dev', x:rect.left, y:rect.top, w:rect.width, h:rect.height,
      c:[top - rect.top, rect.right - right, rect.bottom - bottom, left - rect.left].map(value => Math.max(0, Math.round(value * 100) / 100)),
      at:Date.now(), bytes:dataUrl.length }
    try {
      localStorage.removeItem(POSTER_META_KEY)
      localStorage.setItem(POSTER_IMG_KEY, dataUrl)
      localStorage.setItem(POSTER_META_KEY, JSON.stringify(meta))
      state.lastCapture = Date.now()
    } catch {
      // Quota or storage blocked: no poster is better than a broken pair.
      clearPoster()
    }
  } finally { state.capturing = false }
}

function scheduleCapture(canvas, renderCount) {
  if (renderCount === state.lastRenderCount) return
  state.pendingRender = renderCount
  // A shelf that settles while a book is still flying home is captured once
  // the room is quiet again: retry for a while instead of waiting for a redraw.
  const attempt = tries => {
    if (!canvas.isConnected || state.pendingRender !== renderCount) return
    if (!captureEligible(canvas)) { if (tries < 40) setTimeout(() => attempt(tries + 1), 1500); return }
    const wait = state.lastCapture + MIN_CAPTURE_GAP_MS - Date.now()
    if (wait > 0) { setTimeout(() => attempt(tries), wait); return }
    const idle = globalThis.requestIdleCallback || (callback => setTimeout(callback, 50))
    idle(() => { state.lastRenderCount = renderCount; capturePoster(canvas).catch(() => {}) }, { timeout:4000 })
  }
  attempt(0)
}

function onSettled(event) {
  const canvas = event.target
  const renderCount = event.detail?.renderCount ?? 0
  onFirstFrame()
  const hadPoster = dismissPoster()
  // A poster that was just shown and matches the live frame needs no rewrite
  // at launch; any later settled frame (theme, library, plants) refreshes it.
  if (hadPoster && state.lastRenderCount === -1 && readStorage(POSTER_META_KEY)) {
    try { if (JSON.parse(readStorage(POSTER_META_KEY)).k === bootKey()) { state.lastRenderCount = renderCount; state.lastCapture = Date.now(); return } } catch { /* captura normal */ }
  }
  scheduleCapture(canvas, renderCount)
}

/** Idempotente. Lo llama bookshelf.js al crear la estantería. */
export function initBootPoster() {
  if (state.started || typeof document === 'undefined') return
  state.started = true
  document.addEventListener('ihr-scene-first-frame', onFirstFrame)
  document.addEventListener('ihr-scene-settled', onSettled)
  // The real shelf takes over the moment the user touches it: a poster of a
  // book that is lifting off the shelf would show it twice.
  const takeOver = () => { if (state.liveReady) dismissPoster({ fade:false }) }
  document.addEventListener('pointerdown', takeOver, true)
  document.addEventListener('keydown', takeOver, true)
  addEventListener('resize', () => { dismissPoster({ fade:false }); dismissSkeleton() })
  setTimeout(() => { dismissPoster(); dismissSkeleton() }, FALLBACK_REMOVE_MS)
  // Stale posters (older build) are removed; a mismatching key is simply never shown.
  try {
    const meta = JSON.parse(readStorage(POSTER_META_KEY) || 'null')
    if (meta && meta.v !== (globalThis.__ihrBoot?.build ?? 'dev')) clearPoster()
  } catch { clearPoster() }
}
