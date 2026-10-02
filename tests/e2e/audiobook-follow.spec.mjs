import { test, expect } from '@playwright/test'

const PDF = 'tests/e2e/fixtures/reading-journey.pdf'
const EPUB = 'tests/e2e/fixtures/reading-journey.epub'
const EVIDENCE = process.env.FOLLOW_EVIDENCE_DIR || 'test-results'

// A deterministic speechSynthesis: every utterance "finishes" after a short
// timer, so playback advances sentence by sentence without any audio device.
// Each speak() snapshots what the page highlights at that very moment.
test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.addInitScript(() => {
    const log = [], state = { cancels:0, hold:Infinity, pending:null, ms:140 }
    window.__tts = { log, state }
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
    window.__speechHighlight = () => {
      const read = win => { const highlight = win?.CSS?.highlights?.get('inhouse-speech'); return highlight ? [...highlight].map(range => range.toString()).join('') : '' }
      return read(window) || read(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.defaultView)
    }
    const fake = {
      getVoices:() => [{ name:'Fake', lang:'en-US', voiceURI:'fake', localService:true }],
      addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
      cancel() { state.cancels++; (state.stacks ||= []).push(new Error().stack); clearTimeout(state.pending) },
      speak(utterance) {
        log.push({ text:utterance.text, highlight:window.__speechHighlight() })
        if (log.length >= state.hold) return
        state.pending = setTimeout(() => utterance.onend?.({}), state.ms)
      }
    }
    Object.defineProperty(window, 'speechSynthesis', { value:fake, configurable:true })
  })
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
  await page.evaluate(() => { window.__tts.state.cancels = 0; window.__tts.state.stacks = [] })
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  if (closePanel) await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
}
const logged = page => page.evaluate(() => window.__tts.log.map(entry => ({ ...entry })))
const holdAfter = (page, count) => page.evaluate(n => { window.__tts.state.hold = n }, count)
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
  expect(await page.evaluate(() => window.__tts.state.stacks || [])).toEqual([])
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
  await page.getByRole('slider', { name:'Velocidad de voz' }).fill('2')
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 4 de 4/, { timeout:30_000 })
  await expect(page.locator('.reading-audio-status')).toHaveText('Has llegado al final.', { timeout:30_000 })
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
  expect(await page.evaluate(() => window.__tts.state.stacks)).toEqual([])
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
  await page.evaluate(() => { window.__tts.state.ms = 15 })
  await play(page)
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.doc.querySelector('h1')?.textContent), { timeout:60_000 }).toBe('Beyond the window')
  await expect.poll(async () => (await logged(page)).some(entry => entry.text.startsWith('Beyond the window')), { timeout:10_000 }).toBe(true)
  // The chapter's own sentences were read first, in order, before the next chapter began.
  const texts = (await logged(page)).map(entry => entry.text), heading = texts.findIndex(text => text.startsWith('Beyond the window'))
  expect(heading).toBeGreaterThan(20)
  expect(texts[heading - 1]).toMatch(/follow a story wherever it leads\.$/)
  await expect.poll(async () => (await logged(page)).at(-1).highlight).not.toBe('')
  expect(await page.evaluate(() => window.__tts.state.stacks)).toEqual([])
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
  expect(await page.evaluate(() => window.__tts.state.stacks)).toEqual([])
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
    await page.evaluate(() => { window.__tts.log.length = 0; window.__tts.state.hold = 3 })
    await play(page)
    await expect.poll(async () => (await logged(page)).length).toBe(3)
    await expect.poll(async () => (await highlightOnScreen(page))?.inside).toBe(true)
    await page.screenshot({ path:`${EVIDENCE}/pdf-${theme}.png` })
  })
}

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
