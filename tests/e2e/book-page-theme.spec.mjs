import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { PDF_PAGE_FILTERS, READING_THEMES } from '../../src/js/readers/reading-preferences.js'

// The 3D book always opens and closes on white paper; while the camera zooms into the
// reader (and out of it) the pages cross-fade to / from the reading theme the
// user picked. These tests sample the pixels of the page on the 3D book canvas
// at the phases the app reports through data-* attributes, never at wall-clock
// instants, and compare them with tolerance bands so a slow software GL stays
// deterministic. IHR_EVIDENCE_DIR additionally saves PNG crops of every phase.

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 })

const PREFERENCES_KEY = 'inhouse-read-reading-preferences'
const EVIDENCE_DIR = process.env.IHR_EVIDENCE_DIR
const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
const luminance = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b
const distance = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])))

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' })
})

async function startWithTheme(page, theme, { reduced = false } = {}) {
  await page.emulateMedia({ reducedMotion:reduced ? 'reduce' : 'no-preference' })
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ theme })), { key:PREFERENCES_KEY, theme })
  await page.goto(process.env.IHR_TEST_URL || './')
}

// What a white PDF page looks like under a theme's filter: the reference the
// 3D page must reach (starting from unfiltered white paper).
function pdfPaper(page, theme) {
  return page.evaluate(filter => {
    const source = document.createElement('canvas'); source.width = source.height = 8
    const paint = source.getContext('2d'); paint.fillStyle = '#fff'; paint.fillRect(0, 0, 8, 8)
    const target = document.createElement('canvas'); target.width = target.height = 8
    const context = target.getContext('2d', { willReadFrequently:true })
    context.filter = filter; context.drawImage(source, 0, 0)
    return [...context.getImageData(4, 4, 1, 1).data].slice(0, 3)
  }, PDF_PAGE_FILTERS[theme])
}

/** Records the median colour of the book's right-hand page at every drawn state. */
async function record(page, direction, tag) {
  await page.evaluate(({ direction, tag, capture }) => {
    const probe = document.createElement('canvas'); probe.width = probe.height = 24
    const context = probe.getContext('2d', { willReadFrequently:true })
    const state = window.__paperTransition = { samples:[], shots:{}, phases:[], done:false }
    let last = ''
    const median = values => values.sort((a, b) => a - b)[values.length >> 1]
    const region = (canvas, width = 24, height = 24) => {
      const bounds = JSON.parse(canvas.dataset.boardBounds || 'null')
      if (!bounds) return null
      const scale = canvas.width / innerWidth
      const clampX = value => Math.max(0, Math.min(innerWidth, value)), clampY = value => Math.max(0, Math.min(innerHeight, value))
      // The saved page is the right-hand leaf of the open spread.
      const x0 = clampX(bounds.left + bounds.width * .58), x1 = clampX(bounds.left + bounds.width * .86)
      const y0 = clampY(bounds.top + bounds.height * .32), y1 = clampY(bounds.top + bounds.height * .68)
      return x1 - x0 > 4 && y1 - y0 > 4 ? { x:x0 * scale, y:y0 * scale, width:(x1 - x0) * scale, height:(y1 - y0) * scale, bounds, scale } : null
    }
    const shoot = (name, canvas) => {
      if (!capture || state.shots[name]) return
      state.shotInfo = state.shotInfo || {}
      state.shotInfo[name] = { phase:canvas.dataset.pageTheme === undefined ? null : last, pageTheme:canvas.dataset.pageTheme }
      const bounds = JSON.parse(canvas.dataset.boardBounds || 'null')
      if (!bounds) return
      const scale = canvas.width / innerWidth
      const x = Math.max(0, bounds.left * scale), y = Math.max(0, bounds.top * scale)
      const width = Math.min(canvas.width - x, bounds.width * scale), height = Math.min(canvas.height - y, bounds.height * scale)
      if (width < 8 || height < 8) return
      const crop = document.createElement('canvas'); crop.width = Math.round(width); crop.height = Math.round(height)
      crop.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, crop.width, crop.height)
      state.shots[name] = crop.toDataURL('image/png')
    }
    const sample = () => {
      const flyout = document.querySelector(direction === 'open' ? '.ihr-flyout:not(.ihr-flyout--return)' : '.ihr-flyout--return')
      const phase = flyout?.dataset[direction === 'open' ? 'openingPhase' : 'returnPhase']
      const canvas = flyout?.querySelector('.ihr-book-canvas')
      if (phase && !state.phases.includes(phase)) state.phases.push(phase)
      if (!canvas || !phase || phase === 'preparing') return
      const opened = Number(canvas.dataset.coverOpen), withdraw = Number(canvas.dataset.bookmarkWithdraw)
      const pageTheme = Number(canvas.dataset.pageTheme)
      const key = [phase, opened, withdraw, pageTheme].join('|')
      if (key === last) return
      last = key
      const area = region(canvas)
      let colour = null
      if (area && opened > .6) {
        context.clearRect(0, 0, 24, 24)
        context.drawImage(canvas, area.x, area.y, area.width, area.height, 0, 0, 24, 24)
        const data = context.getImageData(0, 0, 24, 24).data, channels = [[], [], []]
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) for (let c = 0; c < 3; c++) channels[c].push(data[i + c])
        if (channels[0].length > 100) colour = channels.map(median)
      }
      state.samples.push({ phase, opened, withdraw, pageTheme, colour })
      if (direction === 'open') {
        if (phase === 'opening' && opened >= .55) shoot(`${tag}-1-cover-half-open`, canvas)
        if (phase === 'bookmark' && withdraw >= .4) shoot(`${tag}-2-bookmark`, canvas)
        if (phase === 'zooming' && opened >= .99) {
          if (pageTheme < .1) shoot(`${tag}-3-zoom-start`, canvas)
          if (pageTheme >= .4 && pageTheme <= .75) shoot(`${tag}-4-zoom-mid`, canvas)
          if (pageTheme >= .97) shoot(`${tag}-5-zoom-end`, canvas)
        }
      } else {
        if (phase === 'zooming' && pageTheme >= .97) shoot(`${tag}-1-zoom-out-start`, canvas)
        if (phase === 'zooming' && pageTheme >= .35 && pageTheme <= .75) shoot(`${tag}-2-zoom-out-mid`, canvas)
        if (phase === 'bookmark' && withdraw >= .3 && withdraw <= .8) shoot(`${tag}-3-bookmark`, canvas)
        if (phase === 'closing' && opened >= .35 && opened <= .85) shoot(`${tag}-4-cover-closing`, canvas)
      }
    }
    const observer = new MutationObserver(sample)
    observer.observe(document.body, { subtree:true, childList:true, attributes:true,
      attributeFilter:['data-page-theme', 'data-cover-open', 'data-bookmark-withdraw', 'data-opening-phase', 'data-return-phase'] })
    const tick = () => { sample(); if (!state.done) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    state.stop = () => { observer.disconnect(); state.done = true }
  }, { direction, tag, capture:Boolean(EVIDENCE_DIR) })
}

async function collect(page, direction, testInfo, tag = direction) {
  // The flyout only exists once the page snapshot is ready: wait until it was seen, then gone.
  await page.waitForFunction(() => window.__paperTransition.phases.length > 0, null, { timeout:120_000 })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:120_000 })
  if (direction === 'close') await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/, { timeout:120_000 })
  const result = await page.evaluate(() => { const state = window.__paperTransition; state.stop(); return state })
  await testInfo.attach(`${direction}-samples`, { body:JSON.stringify({ ...result, shots:Object.keys(result.shots) }, null, 2), contentType:'application/json' })
  if (EVIDENCE_DIR) {
    await mkdir(EVIDENCE_DIR, { recursive:true })
    await writeFile(`${EVIDENCE_DIR}/${tag}-${direction}-samples.json`, JSON.stringify({ phases:result.phases, samples:result.samples, shotInfo:result.shotInfo }, null, 1))
    for (const [name, url] of Object.entries(result.shots)) await writeFile(`${EVIDENCE_DIR}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'))
  }
  return result
}

async function importAndRead(page, file) {
  await page.locator('#file-picker').setInputFiles(file)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Progreso y capítulos, /)
  await expect(page.locator('#reader-toolbar')).toBeVisible()
}

const stockColour = [255, 255, 255]

/**
 * Runs one close (reader -> shelf) then one open (shelf -> reader) with the
 * given theme and checks both ends and the fade between them.
 */
async function transition(page, testInfo, { kind, file, theme, tag }) {
  const themePaper = kind === 'pdf' ? await pdfPaper(page, theme) : hex(READING_THEMES[theme].background)
  await importAndRead(page, file)

  // ---- closing: the theme page leaves the reader, the book closes on white paper
  await record(page, 'close', `${tag}-close`)
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  const closing = await collect(page, 'close', testInfo, tag)
  const fadeBand = 34
  const zoomOut = closing.samples.filter(s => s.phase === 'zooming' && s.colour)
  expect(zoomOut.length).toBeGreaterThan(0)
  // It starts exactly as the reader showed it (the DOM still on top of it) ...
  expect(zoomOut[0].pageTheme).toBeGreaterThan(.5)
  expect(distance(zoomOut[0].colour, themePaper)).toBeLessThanOrEqual(fadeBand)
  // ... and the mix only ever moves from the theme towards white paper.
  const closingMix = closing.samples.filter(s => s.phase === 'zooming').map(s => s.pageTheme)
  for (let i = 1; i < closingMix.length; i++) expect(closingMix[i]).toBeLessThanOrEqual(closingMix[i - 1] + 1e-9)
  for (const sample of closing.samples.filter(s => ['bookmark', 'closing'].includes(s.phase) && s.colour && s.opened > .6)) {
    // White while the bookmark goes in and the cover shuts, whatever the theme.
    expect(sample.pageTheme).toBe(0)
    expect(distance(sample.colour, stockColour)).toBeLessThanOrEqual(fadeBand)
    expect(luminance(sample.colour)).toBeGreaterThan(150)
  }

  // ---- opening: white paper through hinge and bookmark, fade during the zoom
  await page.locator('.ihr-spine').click()
  await record(page, 'open', `${tag}-open`)
  await page.getByRole('button', { name:/Toca para leer/ }).click()
  const opening = await collect(page, 'open', testInfo, tag)
  // The mix itself is checked on every drawn state, whatever the load ...
  for (const sample of opening.samples.filter(s => ['opening', 'bookmark'].includes(s.phase))) expect(sample.pageTheme).toBe(0)
  // ... the pixels only on states where the cover is open enough to show the page. A
  // starved software GL can release the hinge's watchdog before it opens that far (then
  // the run says so instead of failing on an unobservable moment).
  const still = opening.samples.filter(s => ['opening', 'bookmark'].includes(s.phase) && s.colour && s.opened > .6)
  if (!still.length) testInfo.annotations.push({ type:'starved', description:`${tag}: no drawn frame showed the open page during the hinge/bookmark` })
  for (const sample of still) {
    expect(sample.pageTheme).toBe(0)
    expect(distance(sample.colour, stockColour)).toBeLessThanOrEqual(fadeBand)
    expect(luminance(sample.colour)).toBeGreaterThan(150) // never the black pages of night/amoled
  }
  const zoom = opening.samples.filter(s => s.phase === 'zooming')
  const openingMix = zoom.map(s => s.pageTheme)
  for (let i = 1; i < openingMix.length; i++) expect(openingMix[i]).toBeGreaterThanOrEqual(openingMix[i - 1] - 1e-9)
  {
    // Arrives exactly at the reader's colour: a starved GL may draw no frame between the
    // last eased step and the handoff, so the handoff state counts as the end of the zoom.
    const toHandoff = opening.samples.filter(s => s.phase === 'zooming' || s.phase === 'handoff')
    expect(toHandoff.at(-1).pageTheme).toBeGreaterThanOrEqual(.999)
    const arrival = toHandoff.filter(s => s.pageTheme >= .97 && s.colour).at(-1)
    expect(arrival, 'a frame at the end of the zoom').toBeTruthy()
    expect(distance(arrival.colour, themePaper)).toBeLessThanOrEqual(fadeBand)
    // The colour travels monotonically from white paper towards the theme paper.
    const progress = zoom.filter(s => s.colour).map(s => distance(s.colour, themePaper))
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeLessThanOrEqual(progress[i - 1] + 8)
  }
  return { closing, opening, stockColour, themePaper }
}

for (const [kind, file] of [['pdf', 'tests/e2e/fixtures/reading-journey.pdf'], ['epub', 'tests/e2e/fixtures/reading-journey.epub']]) {
  for (const theme of ['amoled', 'night', 'paper', 'sepia']) {
    // PDF paper (white) only differs slightly from white paper: keep it to the dark themes and one light one.
    if (kind === 'epub' && theme === 'sepia') continue
    test(`${kind} ${theme}: el libro abre y cierra con papel blanco y hace fundido al tema elegido durante el zoom`, async ({ page }, testInfo) => {
      test.setTimeout(240_000)
      const errors = []; page.on('pageerror', error => errors.push(error.message))
      await startWithTheme(page, theme)
      const { opening, closing } = await transition(page, testInfo, { kind, file, theme, tag:`${kind}-${theme}` })
      // The fade is real: some frame is strictly in between.
      expect([...opening.samples, ...closing.samples].some(s => s.phase === 'zooming' && s.pageTheme > .05 && s.pageTheme < .95)).toBe(true)
      expect(errors).toEqual([])
    })
  }
}

test('epub sepia: el papel blanco cambia a sepia al abrir y vuelve a blanco al cerrar', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await startWithTheme(page, 'sepia')
  const { opening, closing } = await transition(page, testInfo, { kind:'epub', file:'tests/e2e/fixtures/reading-journey.epub', theme:'sepia', tag:'epub-sepia' })
  const all = [...opening.samples, ...closing.samples].filter(s => s.colour && s.opened > .6)
  expect(all.length).toBeGreaterThan(2)
  const whiteFrames = all.filter(sample => sample.pageTheme === 0)
  expect(whiteFrames.length).toBeGreaterThan(0)
  for (const sample of whiteFrames) expect(distance(sample.colour, stockColour)).toBeLessThanOrEqual(18)
  expect(all.some(sample => sample.pageTheme > .05 && sample.pageTheme < .95)).toBe(true)
  expect(errors).toEqual([])
})

test('movimiento reducido: la página llega al color del tema sin saltos al entregar el lector', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await startWithTheme(page, 'amoled', { reduced:true })
  await importAndRead(page, 'tests/e2e/fixtures/reading-journey.epub')
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).toHaveClass(/is-closing-reader/)
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/, { timeout:120_000 })
  await page.locator('.ihr-spine').click()
  await record(page, 'open', 'reduced-open')
  await page.getByRole('button', { name:/Toca para leer/ }).click()
  const opening = await collect(page, 'open', testInfo)
  // With ~1 ms phases few frames exist, but none may end in the middle of a fade.
  const withTheme = opening.samples.filter(s => s.phase === 'zooming' || s.phase === 'handoff')
  if (withTheme.length) expect(withTheme.at(-1).pageTheme).toBeGreaterThanOrEqual(.999)
  expect(errors).toEqual([])
})
