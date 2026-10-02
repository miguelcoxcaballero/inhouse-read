import { test, expect } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'

const PDF = 'tests/e2e/fixtures/reading-journey.pdf'
const EPUB = 'tests/e2e/fixtures/reading-journey.epub'
const EVIDENCE = process.env.FOLLOW_EVIDENCE_DIR || 'test-results'

// The same neural-engine contract as production, with deterministic start/done
// events and adjustable cadence. No system voice participates in this suite.
test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width:390, height:844 })
  const configure = () => {
    const engine = window.__inhouseNeuralTest.engine, state = { cancels:0, stacks:[] }
    Object.defineProperties(state, {
      ms:{ get:() => engine.config.speakMs, set:value => { engine.config.speakMs = value } },
      startDelay:{ get:() => engine.config.startDelay, set:value => { engine.config.startDelay = value } },
      hold:{ get:() => engine.config.holdAfter ?? Infinity, set:value => { engine.config.holdAfter = Number.isFinite(value) ? value : null } }
    })
    const stop = engine.stop.bind(engine)
    engine.stop = () => { state.cancels++; state.stacks.push(new Error().stack); stop() }
    window.__narration = { log:engine.calls, state }
    window.__speechHighlight = () => {
      const read = win => { const highlight = win?.CSS?.highlights?.get('inhouse-speech'); return highlight ? [...highlight].map(range => range.toString()).join('') : '' }
      return read(window) || read(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.defaultView)
    }
  }
  await page.addInitScript(fakeEngineScript({ installed:['piper:en_US-lessac-high'], speakMs:140 }) + `;(${configure.toString()})();`)
})

const squash = text => String(text).replace(/\s+/g, '')
// A heading is read as its own sentence: the spoken text gains a full stop the page does not have.
const unstopped = text => squash(text).replace(/\.$/, '')
async function open(page, file, motion = 'reduce') {
  await page.emulateMedia({ reducedMotion:motion })
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles(file)
  await expect(page.locator(file.endsWith('pdf') ? '.pdf-text-layer span' : 'foliate-view').first()).toBeVisible()
  if (file.endsWith('pdf')) await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
  else await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)), { timeout:30_000 }).toBe(true)
}
async function setTheme(page, name) {
  await page.getByRole('button', { name:'Aspecto de lectura' }).click()
  await page.getByRole('button', { name, exact:true }).click()
  await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
}
async function play(page, { closePanel = true } = {}) {
  // Opening the book resets the voice once; what matters is that nothing cancels speech after Play.
  await page.evaluate(() => { window.__narration.state.cancels = 0; window.__narration.state.stacks = [] })
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  if (closePanel) await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
}
const logged = page => page.evaluate(() => window.__narration.log.map(entry => ({ ...entry, highlight:entry.atStart ?? '' })))
const holdAfter = (page, count) => page.evaluate(n => { window.__narration.state.hold = n }, count)
// Is the highlighted sentence actually inside the reader viewport, in screen coordinates?
const highlightOnScreen = page => page.evaluate(() => {
  const own = CSS.highlights.get('inhouse-speech')
  const frame = document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.defaultView
  const highlight = own || frame?.CSS.highlights.get('inhouse-speech')
  const range = highlight && [...highlight][0]
  if (!range) return null
  const rect = range.getClientRects()[0]
  if (!rect) return null
  const offset = !own && frame ? frame.frameElement.getBoundingClientRect() : { left:0, top:0 }
  const box = document.querySelector('#reader-viewport').getBoundingClientRect()
  const x = offset.left + rect.left, y = offset.top + rect.top
  return { inside:x >= box.left - 1 && x + rect.width <= box.right + 1 && y >= box.top - 1 && y + rect.height <= box.bottom + 1, x, y }
})

test('PDF: the sentence being read is highlighted in the text layer and the page turns by itself', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await open(page, PDF)
  await play(page)
  await expect.poll(async () => (await logged(page)).length).toBeGreaterThan(1)
  // Every utterance starts with its own sentence already highlighted, and the highlight moves.
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 4/, { timeout:20_000 })
  const entries = await logged(page)
  for (const entry of entries) expect(squash(entry.highlight)).toContain(unstopped(entry.text))
  expect(new Set(entries.map(entry => squash(entry.highlight))).size).toBeGreaterThan(2)
  // The voice was never stopped or interrupted by the automatic page turn.
  expect(await page.evaluate(() => window.__narration.state.stacks || [])).toEqual([])
  await expect(page.getByRole('button', { name:'Pausar lectura' })).toBeVisible()
  expect(await page.evaluate(() => document.querySelectorAll('.pdf-text-layer span').length)).toBeGreaterThan(0)

  // Pause clears the highlight; resume brings back the same sentence.
  await page.getByRole('button', { name:'Pausar lectura' }).click()
  await expect.poll(() => page.evaluate(() => window.__speechHighlight())).toBe('')
  const before = (await logged(page)).length
  const paused = (await logged(page)).at(-1).text
  await page.getByRole('button', { name:'Continuar lectura' }).click()
  await expect.poll(async () => (await logged(page)).length).toBeGreaterThan(before)
  expect((await logged(page))[before].text).toBe(paused)
  expect(squash((await logged(page))[before].highlight)).toContain(squash(paused))
  expect(await highlightOnScreen(page)).toMatchObject({ inside:true })

  // A tap/swipe by the reader is user navigation: it stops the voice and clears the highlight.
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await expect.poll(() => page.evaluate(() => window.__speechHighlight())).toBe('')
  await expect(page.getByRole('button', { name:'Pausar lectura' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('PDF: reaches the end of the book and says so', async ({ page }) => {
  await open(page, PDF)
  await page.getByRole('button', { name:'Aspecto de lectura' }).click()
  await page.getByRole('combobox', { name:'Vista del PDF' }).selectOption('text')
  await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  await page.getByRole('radio', { name:'2×', exact:true }).check()
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 4 de 4/, { timeout:30_000 })
  await expect(page.locator('.reading-audio-status')).toHaveText('Final del libro.', { timeout:30_000 })
  expect(await page.evaluate(() => window.__speechHighlight())).toBe('')
})

test('EPUB paginated: highlight moves sentence by sentence and the visible page follows it', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await open(page, EPUB, 'no-preference')
  const start = await page.evaluate(() => document.querySelector('foliate-view').renderer.page)
  await play(page)
  // Starts from the visible page, with whole sentences highlighted ("Paragraph 1. ..." is cut at sentence ends).
  await expect.poll(async () => (await logged(page)).length).toBeGreaterThan(3)
  const first = (await logged(page))[0]
  expect(squash(first.highlight)).toContain(unstopped(first.text))
  const body = (await logged(page)).find(entry => /[.!?]$/.test(entry.highlight.trim()))
  expect(body.highlight.trim()).toMatch(/^[A-Z].*[.!?]$/)
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.page), { timeout:30_000 }).toBeGreaterThan(start + 1)
  // Whenever a new sentence has started, it ends up on the visible page.
  for (let i = 0; i < 4; i++) {
    const count = (await logged(page)).length
    await expect.poll(async () => (await logged(page)).length).toBeGreaterThan(count)
    await expect.poll(async () => (await highlightOnScreen(page))?.inside, { timeout:5_000 }).toBe(true)
  }
  expect(await page.evaluate(() => window.__narration.state.stacks)).toEqual([])
  const entries = await logged(page)
  expect(entries.every(entry => squash(entry.highlight).includes(unstopped(entry.text)))).toBe(true)
  expect(new Set(entries.map(entry => entry.highlight)).size).toBeGreaterThan(5)
  // The saved position moved with the voice.
  await expect(page.getByRole('button', { name:'Pausar lectura' })).toBeVisible()

  await page.getByRole('button', { name:'Pausar lectura' }).click()
  await expect.poll(() => page.evaluate(() => window.__speechHighlight())).toBe('')
  const pausedAt = (await logged(page)).at(-1)
  await page.getByRole('button', { name:'Continuar lectura' }).click()
  await expect.poll(async () => (await logged(page)).at(-1).text).toBeTruthy()
  const resumed = (await logged(page))[(await logged(page)).length - 1]
  expect(resumed.text).toBe(pausedAt.text)
  expect(squash(resumed.highlight)).toContain(unstopped(pausedAt.text))
  expect(errors).toEqual([])
})

test('EPUB: keeps speaking across the end of a chapter', async ({ page }) => {
  await open(page, EPUB)
  await page.evaluate(() => { window.__narration.state.ms = 15 })
  await play(page)
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.doc.querySelector('h1')?.textContent), { timeout:60_000 }).toBe('Beyond the window')
  await expect.poll(async () => (await logged(page)).some(entry => entry.text.startsWith('Beyond the window')), { timeout:10_000 }).toBe(true)
  // The chapter's own sentences were read first, in order, before the next chapter began.
  const texts = (await logged(page)).map(entry => entry.text), heading = texts.findIndex(text => text.startsWith('Beyond the window'))
  expect(heading).toBeGreaterThan(20)
  expect(texts[heading - 1]).toMatch(/follow a story wherever it leads\.$/)
  await expect.poll(async () => (await logged(page)).at(-1).highlight).not.toBe('')
  expect(await page.evaluate(() => window.__narration.state.stacks)).toEqual([])
})

test('EPUB scrolled flow: the page scrolls to keep the sentence in view', async ({ page }) => {
  await open(page, EPUB)
  await page.getByRole('button', { name:'Aspecto de lectura' }).click()
  await page.getByRole('combobox', { name:'Modo de desplazamiento' }).selectOption('scrolled')
  await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.scrolled)).toBe(true)
  const start = await page.evaluate(() => document.querySelector('foliate-view').renderer.start)
  await play(page)
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.start), { timeout:30_000 }).toBeGreaterThan(start + 200)
  for (let i = 0; i < 3; i++) {
    const count = (await logged(page)).length
    await expect.poll(async () => (await logged(page)).length).toBeGreaterThan(count)
    await expect.poll(async () => (await highlightOnScreen(page))?.inside, { timeout:5_000 }).toBe(true)
  }
  expect(await page.evaluate(() => window.__narration.state.stacks)).toEqual([])
})

for (const [theme, label] of [['paper', 'Papel'], ['sepia', 'Sepia'], ['night', 'Noche'], ['amoled', 'AMOLED']]) {
  test(`EPUB and PDF: highlight stays legible on the ${theme} theme`, async ({ page }) => {
    await open(page, EPUB)
    await setTheme(page, label)
    await holdAfter(page, 3)
    await play(page)
    await expect.poll(async () => (await logged(page)).length).toBe(3)
    await expect.poll(async () => (await highlightOnScreen(page))?.inside).toBe(true)
    const css = await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].doc.querySelector('style[data-inhouse-speech]').textContent)
    expect(css).toContain('::highlight(inhouse-speech)')
    await page.screenshot({ path:`${EVIDENCE}/epub-${theme}.png` })
    // Same wash over the PDF's canvas + text layer.
    await page.getByRole('button', { name:'Volver a la estantería' }).click()
    await page.locator('#file-picker').setInputFiles(PDF)
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
    await page.evaluate(() => { window.__narration.log.length = 0; window.__narration.state.hold = 3 })
    await play(page)
    await expect.poll(async () => (await logged(page)).length).toBe(3)
    await expect.poll(async () => (await highlightOnScreen(page))?.inside).toBe(true)
    await page.screenshot({ path:`${EVIDENCE}/pdf-${theme}.png` })
  })
}

// Neural synthesis can take hundreds of ms to start; highlight and page follow must wait for its actual start.
test('EPUB: the sentence is highlighted when the engine starts speaking it, not when it is asked to', async ({ page }) => {
  await open(page, EPUB, 'reduce')
  await page.evaluate(() => { window.__narration.state.startDelay = 450; window.__narration.state.ms = 60 })
  await play(page)
  await expect.poll(async () => (await logged(page)).length, { timeout:30_000 }).toBeGreaterThan(4)
  const entries = (await logged(page)).slice(0, 4)
  expect(entries[0].atSpeak).toBe('')
  for (const [i, entry] of entries.entries()) {
    expect(squash(entry.highlight)).toContain(unstopped(entry.text))
    // when speak() was called, the page still showed the sentence being finished (or nothing before the first one)
    if (i) expect(squash(entry.atSpeak)).toContain(unstopped(entries[i - 1].text))
    if (i) expect(squash(entry.atSpeak)).not.toContain(unstopped(entry.text))
  }
})

test('PDF: the highlight hugs the printed text instead of spanning the whole text item', async ({ page }) => {
  await open(page, PDF)
  await holdAfter(page, 3) // "Reading journey." "Page 1." "A quiet room, a book and a moment to read."
  await play(page)
  await expect.poll(async () => (await logged(page)).length).toBe(3)
  await expect.poll(async () => (await logged(page))[2].highlight).toContain('quiet')
  const box = await page.evaluate(() => {
    const range = [...CSS.highlights.get('inhouse-speech')][0]
    const rect = range.getClientRects()[0], canvas = document.querySelector('.pdf-page-canvas') || document.querySelector('canvas')
    const origin = canvas.getBoundingClientRect(), scale = canvas.width / origin.width
    const data = canvas.getContext('2d').getImageData(0, Math.round((rect.top - origin.top) * scale), canvas.width, Math.max(1, Math.round(rect.height * scale))).data
    let left = Infinity, right = -Infinity
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) { const x = (i / 4) % canvas.width / scale; left = Math.min(left, x); right = Math.max(right, x) }
    return { ink:{ left:origin.left + left, right:origin.left + right }, highlight:{ left:rect.left, right:rect.right, height:rect.height } }
  })
  expect(box.ink.right).toBeGreaterThan(box.ink.left + 100)
  expect(box.highlight.left).toBeGreaterThan(box.ink.left - 4)
  expect(box.highlight.right).toBeLessThan(box.ink.right + 4)
  expect(box.highlight.height).toBeLessThan(20)
})

// Old Android WebViews (before Chromium 105) have no CSS Custom Highlight API: the readers paint their own marks.
test.describe('without the CSS Custom Highlight API', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { delete window.Highlight; Object.defineProperty(CSS, 'highlights', { value:undefined, configurable:true }) })
  })
  test('EPUB: foliate draws the sentence on its own overlay', async ({ page }) => {
    await open(page, EPUB)
    await holdAfter(page, 2)
    await play(page)
    await expect.poll(async () => (await logged(page)).length).toBe(2)
    const rects = () => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].overlayer.element.querySelectorAll('rect').length)
    await expect.poll(rects).toBeGreaterThan(0)
    await page.getByRole('button', { name:'Pausar lectura' }).click()
    await expect.poll(rects).toBe(0)
  })
  test('PDF: the text-layer spans of the sentence get the highlight class', async ({ page }) => {
    await open(page, PDF)
    await holdAfter(page, 2)
    await play(page)
    await expect.poll(async () => (await logged(page)).length).toBe(2)
    const marked = page.locator('.pdf-text-layer .inhouse-speech-current')
    await expect.poll(() => marked.count()).toBeGreaterThan(0)
    expect(squash((await marked.allTextContents()).join(''))).toContain(squash((await logged(page)).at(-1).text))
    await page.getByRole('button', { name:'Pausar lectura' }).click()
    await expect(marked).toHaveCount(0)
  })
})
